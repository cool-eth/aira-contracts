// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILendingAddressRegistry.sol";
import "./interfaces/ILendingMarket.sol";
import "./interfaces/IStablePool.sol";

/**
 * @title LiquidationBot
 */
contract LiquidationBot is KeeperCompatible {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SEARCH_COUNT = 100;
    uint256 public constant MAX_LIQUIDATION_COUNT = 3;

    /// @notice address provider
    ILendingAddressRegistry public addressProvider;
    /// @notice AirUSD token address
    IERC20 public airUSD;

    constructor(address _provider, address _airUSD) {
        addressProvider = ILendingAddressRegistry(_provider);
        airUSD = IERC20(_airUSD);
    }

    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        address token = abi.decode(checkData, (address));

        address[] memory liquidatableUsers = new address[](
            MAX_LIQUIDATION_COUNT
        );
        uint256 idx;

        ILendingMarket lendingMarket = ILendingMarket(
            addressProvider.getLendingMarket()
        );

        uint256 userCount = lendingMarket.getUserCount(token);
        for (uint256 i = 0; i < userCount; i++) {
            address user = lendingMarket.getUserAt(token, i);
            if (lendingMarket.liquidatable(user, token)) {
                liquidatableUsers[idx++] = user;

                if (idx == MAX_LIQUIDATION_COUNT) {
                    break;
                }
            }
        }

        if (idx > 0) {
            upkeepNeeded = true;
            performData = abi.encode(token, liquidatableUsers);
        }
    }

    function performUpkeep(bytes calldata performData) external override {
        (address token, address[] memory liquidatableUsers) = abi.decode(
            performData,
            (address, address[])
        );

        ILendingMarket lendingMarket = ILendingMarket(
            addressProvider.getLendingMarket()
        );
        IStablePool stablePool = IStablePool(addressProvider.getStablePool());

        for (uint256 i = 0; i < liquidatableUsers.length; i++) {
            if (liquidatableUsers[i] == address(0)) {
                break;
            }

            ILendingMarket.PositionView memory position = lendingMarket
                .positionView(liquidatableUsers[i], token);
            if (position.liquidatable) {
                stablePool.prepare(
                    position.debtPrincipal + position.debtInterest,
                    abi.encode(token, liquidatableUsers[i])
                );
            }
        }
    }

    function onPrepare(uint256 amount, bytes calldata data) external {
        IStablePool stablePool = IStablePool(addressProvider.getStablePool());

        require(msg.sender == address(stablePool), "not stable pool");

        (address token, address user) = abi.decode(data, (address, address));

        ILendingMarket lendingMarket = ILendingMarket(
            addressProvider.getLendingMarket()
        );

        // approve and liquidate user's position
        airUSD.safeApprove(address(lendingMarket), amount);
        lendingMarket.liquidate(user, token);

        // transfer back to stable pool
        airUSD.transfer(address(stablePool), airUSD.balanceOf(address(this)));
    }
}
