// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/ILendingVault.sol";
import "../interfaces/ILendingVaultRewarder.sol";
import "../external/convex/IConvexBooster.sol";
import "../external/convex/IBaseRewardPool.sol";
import "../external/convex/IVirtualBalanceRewardPool.sol";
import "./LendingVaultBase.sol";

contract LendingVaultConvex is LendingVaultBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public constant CVX = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address public constant CRV = 0xD533a949740bb3306d119CC777fa900bA034cd52;
    address public constant CONVEX_BOOSTER =
        0xF403C135812408BFbE8713b5A23a04b3D48AAE31;

    uint256 public cvxPoolId;
    address public convexRewards;
    address public vaultRewarder;

    function initialize(
        address _provider,
        address _want,
        uint256 _cvxPoolId,
        address _convexRewards,
        address _vaultRewarder
    ) external initializer {
        __LendingVaultBase__init(_provider, _want);

        cvxPoolId = _cvxPoolId;
        convexRewards = _convexRewards;
        vaultRewarder = _vaultRewarder;
        IERC20Upgradeable(want).safeApprove(CONVEX_BOOSTER, type(uint256).max);
    }

    function totalSupply() public view override returns (uint256) {
        return
            IERC20Upgradeable(want).balanceOf(address(this)) +
            IBaseRewardPool(convexRewards).balanceOf(address(this));
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

        // deposit into convex pools
        IConvexBooster(CONVEX_BOOSTER).depositAll(cvxPoolId, true);
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

        // withdraw from convex pools
        IBaseRewardPool(convexRewards).withdrawAndUnwrap(amount, false);

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
        IBaseRewardPool(convexRewards).getReward(address(this), true);

        uint256 rewardAmount = IERC20Upgradeable(CRV).balanceOf(address(this));
        if (rewardAmount > 0) {
            IERC20Upgradeable(CRV).safeTransfer(vaultRewarder, rewardAmount);
        }

        rewardAmount = IERC20Upgradeable(CVX).balanceOf(address(this));
        if (rewardAmount > 0) {
            IERC20Upgradeable(CVX).safeTransfer(vaultRewarder, rewardAmount);
        }

        uint256 length = IBaseRewardPool(convexRewards).extraRewardsLength();
        for (uint256 i = 0; i < length; i++) {
            address extraRewards = IBaseRewardPool(convexRewards).extraRewards(
                i
            );
            address rewardToken = IVirtualBalanceRewardPool(extraRewards)
                .rewardToken();
            rewardAmount = IERC20Upgradeable(rewardToken).balanceOf(
                address(this)
            );

            if (rewardAmount > 0) {
                IERC20Upgradeable(rewardToken).safeTransfer(
                    vaultRewarder,
                    rewardAmount
                );
            }
        }
    }
}
