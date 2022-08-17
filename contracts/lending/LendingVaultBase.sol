// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/ILendingVault.sol";
import "../interfaces/ILendingAddressRegistry.sol";

abstract contract LendingVaultBase is OwnableUpgradeable, ILendingVault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event Deposit(address indexed user, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint256 amount, uint256 shares);

    ILendingAddressRegistry public addressProvider;
    address public want; // collateral token
    mapping(address => uint256) public shareOf;
    uint256 public totalShare;

    function __LendingVaultBase__init(address _provider, address _want)
        internal
        onlyInitializing
    {
        __Ownable_init();

        addressProvider = ILendingAddressRegistry(_provider);
        want = _want;
    }

    modifier onlyLendingMarket() {
        require(
            lendingMarket() == _msgSender(),
            "caller is not the lending market"
        );
        _;
    }

    function lendingMarket() public view returns (address) {
        return addressProvider.getLendingMarket();
    }

    function totalSupply() public view virtual override returns (uint256) {
        return IERC20Upgradeable(want).balanceOf(address(this));
    }

    function balanceFromShare(uint256 share) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (totalShare == 0 || supply == 0) {
            return share;
        }

        return ((supply) * share) / totalShare;
    }

    function shareFromBalance(uint256 balance) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (totalShare == 0 || supply == 0) {
            return balance;
        }

        return (totalShare * balance) / supply;
    }

    function balanceOf(address user) public view override returns (uint256) {
        return balanceFromShare(shareOf[user]);
    }

    function deposit(address user, uint256 amount)
        public
        virtual
        override
        onlyLendingMarket
    {
        uint256 share = shareFromBalance(amount);

        IERC20Upgradeable(want).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        shareOf[user] += share;
        totalShare += share;

        emit Deposit(user, amount, share);
    }

    function withdraw(address user, uint256 amount)
        public
        virtual
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

        // transfer collateral to user
        IERC20Upgradeable(want).safeTransfer(msg.sender, amount);

        emit Withdraw(user, amount, share);
    }
}
