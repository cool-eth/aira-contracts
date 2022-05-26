// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILendingMarket.sol";
import "./interfaces/IStablePool.sol";

/**
 * @title LiquidationBot
 */
contract LiquidationBot is KeeperCompatible {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SEARCH_COUNT = 100;
    uint256 public constant MAX_LIQUIDATION_COUNT = 3;
    ILendingMarket public immutable lendingMarket;
    IStablePool public immutable stablePool;
    IERC20 public airUSD;

    constructor(
        address _lendingMarket,
        address _stablePool,
        address _airUSD
    ) {
        lendingMarket = ILendingMarket(_lendingMarket);
        stablePool = IStablePool(_stablePool);
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

        uint256 userCount = lendingMarket.getUserCount(token);
        for (uint256 i = 0; i < userCount; i++) {
            address user = lendingMarket.getUserAt(token, i);
            if (lendingMarket.liquidatable(user, token)) {
                liquidatableUsers[idx++] = user;

                if (idx == 3) {
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

        for (uint256 i = 0; i < liquidatableUsers.length; i++) {
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
        require(msg.sender == address(stablePool), "not stable pool");

        (address token, address user) = abi.decode(data, (address, address));

        airUSD.safeApprove(address(lendingMarket), amount);
    }
}
