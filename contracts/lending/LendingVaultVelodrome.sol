// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/ILendingVault.sol";
import "../interfaces/ILendingVaultRewarder.sol";
import "../external/velodrome/IVelodromeGauge.sol";
import "./LendingVaultBase.sol";

contract LendingVaultVelodrome is LendingVaultBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public gauge;
    address public vaultRewarder;

    function initialize(
        address _provider,
        address _want,
        address _gauge,
        address _vaultRewarder
    ) external initializer {
        __LendingVaultBase__init(_provider, _want);

        gauge = _gauge;
        vaultRewarder = _vaultRewarder;
        IERC20Upgradeable(want).safeApprove(_gauge, type(uint256).max);
    }

    function totalSupply() public view override returns (uint256) {
        return
            IERC20Upgradeable(want).balanceOf(address(this)) +
            IVelodromeGauge(gauge).balanceOf(address(this));
    }

    function deposit(address user, uint256 amount)
        public
        override
        onlyLendingMarket
    {
        super.deposit(user, amount);

        // update vault rewarder
        updateRewards();
        ILendingVaultRewarder(vaultRewarder).deposit(user, amount);

        // deposit into gauge
        IVelodromeGauge(gauge).depositAll(0);
    }

    function withdraw(address user, uint256 amount)
        public
        override
        onlyLendingMarket
    {
        uint256 share = shareFromBalance(amount);
        // need to consider dust here
        if (balanceFromShare(share) < amount) {
            share += 1;
        }

        require(share <= shareOf[user], "insufficient collateral");

        shareOf[user] -= share;
        totalShare -= share;

        // update vault rewarder
        updateRewards();
        ILendingVaultRewarder(vaultRewarder).withdraw(user, amount);

        // withdraw from gauge
        IVelodromeGauge(gauge).withdraw(
            amount - IERC20Upgradeable(want).balanceOf(address(this))
        );

        // transfer collateral to user
        IERC20Upgradeable(want).safeTransfer(msg.sender, amount);

        emit Withdraw(user, amount, share);
    }

    function claim(address user) external {
        updateRewards();
        ILendingVaultRewarder(vaultRewarder).claim(user);
    }

    function updateRewards() public {
        // claim rewards
        uint256 length = IVelodromeGauge(gauge).rewardsListLength();
        address[] memory rewardTokens = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            rewardTokens[i] = IVelodromeGauge(gauge).rewards(i);
        }
        IVelodromeGauge(gauge).getReward(address(this), rewardTokens);

        // transfer rewards to rewarder
        for (uint256 i = 0; i < length; i++) {
            uint256 rewardAmount = IERC20Upgradeable(rewardTokens[i]).balanceOf(
                address(this)
            );

            if (rewardAmount > 0) {
                IERC20Upgradeable(rewardTokens[i]).safeTransfer(
                    vaultRewarder,
                    rewardAmount
                );
            }
        }
    }
}
