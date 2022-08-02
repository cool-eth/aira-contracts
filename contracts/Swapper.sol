// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ISwapper.sol";
import "./interfaces/ISwapperImpl.sol";
import "./interfaces/IPriceOracleAggregator.sol";
import "./interfaces/ILendingAddressRegistry.sol";

contract Swapper is ISwapper, Ownable {
    using SafeERC20 for IERC20Metadata;

    ILendingAddressRegistry public addressProvider;
    uint256 public slippageLimitNumerator;
    uint256 public slippageLimitDenominator;
    mapping(address => mapping(address => address)) public swapperImpls;

    constructor(address _addressProvider, uint256 _slippageLimitNumerator)
        Ownable()
    {
        addressProvider = ILendingAddressRegistry(_addressProvider);
        slippageLimitNumerator = _slippageLimitNumerator;
        slippageLimitDenominator = 10**18;
    }

    function updateAddressProvider(address _addressProvider)
        external
        onlyOwner
    {
        require(_addressProvider != address(0), "invalid address provider");
        addressProvider = ILendingAddressRegistry(_addressProvider);
    }

    function updateSlippageLimit(uint256 _slippageLimitNumerator)
        external
        onlyOwner
    {
        slippageLimitNumerator = _slippageLimitNumerator;
    }

    function addSwapperImpl(
        address _tokenIn,
        address _tokenOut,
        address _swapperImpl
    ) external onlyOwner {
        require(
            ISwapperImpl(_swapperImpl).tokenIn() == _tokenIn &&
                ISwapperImpl(_swapperImpl).tokenOut() == _tokenOut,
            "invalid swapper implementation"
        );

        swapperImpls[_tokenIn][_tokenOut] = _swapperImpl;
    }

    function removeSwapperImpl(address _tokenIn, address _tokenOut)
        external
        onlyOwner
    {
        require(
            swapperImpls[_tokenIn][_tokenOut] != address(0),
            "swapper implementation not found"
        );

        swapperImpls[_tokenIn][_tokenOut] = address(0);
    }

    function swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _to
    ) external override returns (uint256 amountOut) {
        address swapperImpl = swapperImpls[_tokenIn][_tokenOut];
        require(swapperImpl != address(0), "swapper implementation not found");

        IERC20Metadata(_tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            _amountIn
        );
        IERC20Metadata(_tokenIn).safeApprove(swapperImpl, _amountIn);

        amountOut = ISwapperImpl(swapperImpl).swap(_amountIn, _to);

        // check slippage limit
        IPriceOracleAggregator aggregator = IPriceOracleAggregator(
            addressProvider.getPriceOracleAggregator()
        );
        uint256 assetValueIn = (_amountIn *
            aggregator.viewPriceInUSD(_tokenIn)) /
            (10**IERC20Metadata(_tokenIn).decimals());
        uint256 assetValueOut = (amountOut *
            aggregator.viewPriceInUSD(_tokenOut)) /
            (10**IERC20Metadata(_tokenOut).decimals());

        require(
            assetValueIn >=
                (assetValueOut *
                    (slippageLimitDenominator - slippageLimitNumerator)) /
                    slippageLimitDenominator &&
                assetValueIn <=
                (assetValueOut *
                    (slippageLimitDenominator + slippageLimitNumerator)) /
                    slippageLimitDenominator,
            "slippage limit"
        );
    }
}
