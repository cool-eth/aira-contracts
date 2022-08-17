// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface ILendingVaultRewarder {
    function pendingReward(address user, address rewardToken)
        external
        view
        returns (uint256 pending);

    function deposit(address _user, uint256 _amount) external;

    function withdraw(address _user, uint256 _amount) external;

    function claim(address _user) external;
}
