// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/ISwapperImpl.sol";
import "../interfaces/ICurvePool.sol";

contract EthUsdtLPSwapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public uniswapV2Router;
    address public airUSD;
    address public constant weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant usdt = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address public constant ethUsdtLP =
        0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852;

    constructor(address _uniswapV2Router, address _airUSD) {
        uniswapV2Router = _uniswapV2Router;
        airUSD = _airUSD;
    }

    function tokenIn() external pure override returns (address) {
        return ethUsdtLP;
    }

    function tokenOut() external view override returns (address) {
        return airUSD;
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        IERC20(ethUsdtLP).safeTransferFrom(
            msg.sender,
            address(this),
            _amountIn
        );
        IERC20(ethUsdtLP).safeApprove(uniswapV2Router, _amountIn);

        // remove liquidity -> weth/usdt
        IUniswapV2Router(uniswapV2Router).removeLiquidity(
            weth,
            usdt,
            _amountIn,
            0,
            0,
            address(this),
            block.timestamp
        );

        {
            // swap weth -> airUSD
            uint256 wethAmount = IERC20(weth).balanceOf(address(this));

            IERC20(weth).approve(uniswapV2Router, wethAmount);
            address[] memory path = new address[](2);
            path[0] = weth;
            path[1] = airUSD;
            uint256[] memory amountsOut = IUniswapV2Router(uniswapV2Router)
                .swapExactTokensForTokens(
                    wethAmount,
                    0,
                    path,
                    _to,
                    block.timestamp
                );

            amountOut += amountsOut[amountsOut.length - 1];
        }

        {
            // swap usdt -> airUSD
            uint256 usdtAmount = IERC20(usdt).balanceOf(address(this));

            IERC20(usdt).approve(uniswapV2Router, usdtAmount);
            address[] memory path = new address[](3);
            path[0] = usdt;
            path[1] = weth;
            path[2] = airUSD;
            uint256[] memory amountsOut = IUniswapV2Router(uniswapV2Router)
                .swapExactTokensForTokens(
                    usdtAmount,
                    0,
                    path,
                    _to,
                    block.timestamp
                );

            amountOut += amountsOut[amountsOut.length - 1];
        }
    }
}
