// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILendingAddressRegistry.sol";
import "./interfaces/IStablePool.sol";
import "./interfaces/IStablePoolKeeper.sol";
import "./interfaces/IAirUSD.sol";

/**
 * @title Stable Pool
 */
contract StablePool is IStablePool, Ownable {
    using SafeERC20 for IERC20;

    event Deposit(
        address user,
        uint256 amount,
        uint256 shares,
        address onBehalf
    );
    event Withdraw(
        address user,
        uint256 amount,
        uint256 shares,
        address recipient
    );
    event Prepare(address keeper, uint256 amount, bytes data);

    /// @notice address provider
    ILendingAddressRegistry public addressProvider;
    /// @notice AirUSD token address
    address public airUSD;

    /// @notice user deposited amount
    mapping(address => uint256) public balanceOf;
    /// @notice total deposited amount
    uint256 public totalSupply;

    constructor(address _provider, address _airUSD) Ownable() {
        addressProvider = ILendingAddressRegistry(_provider);
        airUSD = _airUSD;
    }

    function setAddressProvider(address _provider) external onlyOwner {
        addressProvider = ILendingAddressRegistry(_provider);
    }

    function prepare(uint256 _amount, bytes calldata _data) external override {
        require(addressProvider.isKeeper(msg.sender), "not keeper");

        uint256 reservesBefore = totalAirUSD();
        uint256 mintRequires;
        if (reservesBefore < _amount) {
            mintRequires = _amount - reservesBefore;
            IAirUSD(airUSD).mint(address(this), _amount);
        }

        IERC20(airUSD).safeTransfer(msg.sender, _amount);
        IStablePoolKeeper(msg.sender).onPrepare(_amount, _data);

        if (mintRequires > 0) {
            IAirUSD(airUSD).burn(mintRequires);
        }

        uint256 reservesAfter = totalAirUSD();
        require(reservesAfter >= reservesBefore, "not enough fund back");

        emit Prepare(msg.sender, _amount, _data);
    }

    function deposit(uint256 _amount) external {
        depositFor(_amount, msg.sender);
    }

    function depositFor(uint256 _amount, address _onBehalf) public {
        uint256 shares = sharesFromAmount(_amount);

        IERC20(airUSD).safeTransferFrom(msg.sender, address(this), _amount);

        balanceOf[_onBehalf] += shares;
        totalSupply += shares;

        emit Deposit(msg.sender, _amount, shares, _onBehalf);
    }

    function withdraw(uint256 _shares) external {
        withdrawTo(_shares, msg.sender);
    }

    function withdrawTo(uint256 _shares, address _onBehalf) public {
        require(balanceOf[msg.sender] >= _shares, "invalid amount");

        uint256 amount = amountFromShares(_shares);
        balanceOf[msg.sender] -= _shares;
        totalSupply -= _shares;

        IERC20(airUSD).safeTransfer(_onBehalf, amount);

        emit Withdraw(msg.sender, amount, _shares, _onBehalf);
    }

    function sharesFromAmount(uint256 amount) public view returns (uint256) {
        uint256 totalReserves = totalAirUSD();
        if (totalSupply == 0 || totalReserves == 0) {
            return amount;
        }

        return (amount * totalSupply) / totalReserves;
    }

    function amountFromShares(uint256 shares) public view returns (uint256) {
        uint256 totalReserves = totalAirUSD();

        if (totalSupply == 0 || totalReserves == 0) {
            return shares;
        }

        return (shares * IERC20(airUSD).balanceOf(address(this))) / totalSupply;
    }

    function totalAirUSD() public view returns (uint256) {
        return IERC20(airUSD).balanceOf(address(this));
    }
}
