// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/ISwapperImpl.sol";
import "../interfaces/ICurvePool.sol";

contract StethAirUSDSwapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public uniswapV2Router;
    address public airUSD;
    address public constant weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant stETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address public constant stETHCurve =
        0x828b154032950C8ff7CF8085D841723Db2696056;

    constructor(address _uniswapV2Router, address _airUSD) {
        uniswapV2Router = _uniswapV2Router;
        airUSD = _airUSD;
    }

    function tokenIn() external pure override returns (address) {
        return stETH;
    }

    function tokenOut() external view override returns (address) {
        return airUSD;
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        IERC20(stETH).safeTransferFrom(msg.sender, address(this), _amountIn);
        IERC20(stETH).safeApprove(stETHCurve, _amountIn);

        // considering stETH is rebase token
        _amountIn = IERC20(stETH).balanceOf(address(this));

        // swap steth -> weth
        ICurvePool(stETHCurve).exchange(1, 0, _amountIn, 0);

        // swap weth -> airUSD
        uint256 wethAmount = IERC20(weth).balanceOf(address(this));
        IERC20(weth).safeApprove(uniswapV2Router, wethAmount);
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

        return amountsOut[amountsOut.length - 1];
    }
}
