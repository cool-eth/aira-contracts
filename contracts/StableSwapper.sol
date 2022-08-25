// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./interfaces/ILendingAddressRegistry.sol";
import "./interfaces/IStableSwapper.sol";
import "./interfaces/IStablePoolKeeper.sol";
import "./interfaces/IAirUSD.sol";

/**
 * @title Stable swapper
 */
contract StableSwapper is IStableSwapper, Ownable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    event Deposit(
        address user,
        address token,
        uint256 tokenAmount,
        uint256 airUSDAmount,
        address onBehalf
    );
    event Withdraw(
        address user,
        uint256 airUSDAmount,
        address token,
        uint256 tokenAmount,
        address onBehalf
    );

    /// @notice AirUSD token address
    address public airUSD;

    /// @notice supported stable coins
    EnumerableSet.AddressSet _supportedAssets;

    /// @notice swapper fee config
    uint256 public feeNumerator;
    uint256 public feeDenominator;
    address public feeReceiver;

    constructor(
        address _airUSD,
        uint256 _feeNumerator,
        uint256 _feeDenominator,
        address _feeReceiver
    ) Ownable() {
        airUSD = _airUSD;
        feeNumerator = _feeNumerator;
        feeDenominator = _feeDenominator;
        feeReceiver = _feeReceiver;
    }

    function updateFee(uint256 _feeNumerator, uint256 _feeDenominator)
        external
        onlyOwner
    {
        feeNumerator = _feeNumerator;
        feeDenominator = _feeDenominator;
    }

    function updateFeeReceiver(address _feeReceiver) external onlyOwner {
        feeReceiver = _feeReceiver;
    }

    function addSupportedCoin(address coin) external onlyOwner {
        require(!_supportedAssets.contains(coin), "already exists");
        _supportedAssets.add(coin);
    }

    function removeSupportedCoin(address coin) external onlyOwner {
        require(_supportedAssets.contains(coin), "not exists");
        _supportedAssets.remove(coin);
    }

    function isSupportedCoin(address coin) public view returns (bool) {
        return _supportedAssets.contains(coin);
    }

    function getSupportedCoins() external view returns (address[] memory) {
        return _supportedAssets.values();
    }

    function deposit(
        address token,
        uint256 tokenAmount,
        address onBehalf
    ) external override returns (uint256 airUSDAmount) {
        require(_supportedAssets.contains(token), "not supported coin");

        uint256 feeAmount = (tokenAmount * feeNumerator) / feeDenominator;
        airUSDAmount = tokenAmount - feeAmount;

        // receive token
        IERC20(token).safeTransferFrom(msg.sender, address(this), airUSDAmount);
        IERC20(token).safeTransferFrom(msg.sender, feeReceiver, feeAmount);

        // mint airUSD
        IAirUSD(airUSD).mint(onBehalf, airUSDAmount);

        emit Deposit(msg.sender, token, tokenAmount, airUSDAmount, onBehalf);
    }

    function withdraw(
        uint256 airUSDAmount,
        address token,
        address onBehalf
    ) external override returns (uint256 tokenAmount) {
        require(_supportedAssets.contains(token), "not supported coin");

        uint256 feeAmount = (airUSDAmount * feeNumerator) / feeDenominator;
        tokenAmount = tokenAmount - feeAmount;

        // receive airUSD
        IAirUSD(airUSD).burnFrom(msg.sender, tokenAmount);
        IERC20(airUSD).safeTransferFrom(msg.sender, feeReceiver, feeAmount);

        // withdraw token
        IERC20(token).safeTransfer(onBehalf, tokenAmount);

        emit Withdraw(msg.sender, airUSDAmount, token, tokenAmount, onBehalf);
    }
}
