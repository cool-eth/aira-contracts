// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "../interfaces/ILendingVaultRewarder.sol";

contract LendingVaultRewarder is
    ILendingVaultRewarder,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    struct RewardTokenInfo {
        uint256 accRewardPerShare; // Accumulated Rewards per share, times 1e36. See below.
        uint256 reserves;
    }

    address public vault;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    EnumerableSetUpgradeable.AddressSet internal rewardTokens;
    mapping(address => RewardTokenInfo) public rewardTokenInfos; // reward token => info
    mapping(address => mapping(address => uint256)) internal userRewardDebt; // reward token => user => reward debt
    mapping(address => mapping(address => uint256)) internal userPendingRewards; // reward token => user => pending rewards

    function initialize(address _vault) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        vault = _vault;
    }

    modifier onlyVault() {
        require(vault == _msgSender(), "caller is not the lending vault");
        _;
    }

    function rewardsCount() external view returns (uint256) {
        return rewardTokens.length();
    }

    function isRewardToken(address _rewardToken) external view returns (bool) {
        return rewardTokens.contains(_rewardToken);
    }

    function rewardTokenAt(uint256 _index) external view returns (address) {
        return rewardTokens.at(_index);
    }

    function addRewardToken(address _rewardToken) public onlyOwner {
        require(rewardTokens.add(_rewardToken), "already exists");
    }

    function removeRewardToken(address _rewardToken) external onlyOwner {
        require(rewardTokens.remove(_rewardToken), "invalid reward token");
    }

    function pendingReward(address _user, address _rewardToken)
        external
        view
        returns (uint256 pending)
    {
        if (totalSupply != 0) {
            uint256 newReward = IERC20Upgradeable(_rewardToken).balanceOf(
                address(this)
            ) - rewardTokenInfos[_rewardToken].reserves;
            uint256 newAccRewardPerShare = rewardTokenInfos[_rewardToken]
                .accRewardPerShare + ((newReward * 1e36) / totalSupply);

            pending =
                userPendingRewards[_rewardToken][_user] +
                (balanceOf[_user] * newAccRewardPerShare) /
                1e36 -
                userRewardDebt[_rewardToken][_user];
        }
    }

    function deposit(address _user, uint256 _amount)
        external
        override
        onlyVault
    {
        _updateAccPerShare(true, _user);

        _mint(_user, _amount);

        _updateUserRewardDebt(_user);
    }

    function withdraw(address _user, uint256 _amount)
        external
        override
        onlyVault
    {
        _updateAccPerShare(true, _user);

        _burn(_user, _amount);

        _updateUserRewardDebt(_user);
    }

    function claim(address _user) external override nonReentrant {
        _updateAccPerShare(true, _user);

        uint256 length = rewardTokens.length();
        for (uint256 i = 0; i < length; ++i) {
            _claim(_user, rewardTokens.at(i));
        }

        _updateUserRewardDebt(_user);
    }

    // Internal Functions

    function _updateAccPerShare(bool withdrawReward, address user) internal {
        uint256 length = rewardTokens.length();
        for (uint256 i = 0; i < length; ++i) {
            address rewardToken = rewardTokens.at(i);

            RewardTokenInfo storage info = rewardTokenInfos[rewardToken];

            if (totalSupply == 0) {
                info.accRewardPerShare = block.number;
            } else {
                uint256 newReward = IERC20Upgradeable(rewardToken).balanceOf(
                    address(this)
                ) - info.reserves;

                info.reserves += newReward;
                info.accRewardPerShare += (newReward * (1e36)) / totalSupply;
            }

            if (withdrawReward) {
                uint256 pending = ((balanceOf[user] * info.accRewardPerShare) /
                    1e36) - userRewardDebt[rewardToken][user];

                if (pending > 0) {
                    userPendingRewards[rewardToken][user] += pending;
                }
            }
        }
    }

    function _updateUserRewardDebt(address user) internal {
        uint256 length = rewardTokens.length();
        for (uint256 i = 0; i < length; ++i) {
            address rewardToken = rewardTokens.at(i);
            userRewardDebt[rewardToken][user] =
                (balanceOf[user] *
                    rewardTokenInfos[rewardToken].accRewardPerShare) /
                1e36;
        }
    }

    function _claim(address user, address rewardToken)
        internal
        returns (uint256 claimAmount)
    {
        claimAmount = userPendingRewards[rewardToken][user];
        if (claimAmount > 0) {
            IERC20Upgradeable(rewardToken).safeTransfer(user, claimAmount);
            rewardTokenInfos[rewardToken].reserves -= claimAmount;
            userPendingRewards[rewardToken][user] = 0;
        }
    }

    function _mint(address _user, uint256 _amount) internal {
        balanceOf[_user] += _amount;
        totalSupply += _amount;
    }

    function _burn(address _user, uint256 _amount) internal {
        balanceOf[_user] -= _amount;
        totalSupply -= _amount;
    }
}
