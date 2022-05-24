// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";

import "./interfaces/ILendingMarket.sol";

/**
 * @title LiquidationBot
 */
contract LiquidationBot is KeeperCompatible {
    uint256 public constant MAX_SEARCH_COUNT = 100;
    uint256 public constant MAX_LIQUIDATION_COUNT = 3;
    ILendingMarket public immutable lendingMarket;

    constructor(address _lendingMarket) {
        lendingMarket = ILendingMarket(_lendingMarket);
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

        // liquidate user's position
    }
}
