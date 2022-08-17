// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISwapper.sol";
import "../interfaces/ISwapperImpl.sol";
import "../external/uniswapV2/IUniswapV2Router.sol";

contract UniswapV2Swapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public immutable swapper;
    address public immutable uniswapV2Router;
    address public immutable override tokenIn;
    address public immutable override tokenOut;
    address[] public path;

    constructor(
        address _swapper,
        address _uniswapV2Router,
        address _tokenIn,
        address _tokenOut,
        address[] memory _path
    ) {
        require(_tokenIn != _tokenOut, "invalid token");
        require(_path[0] == _tokenIn, "invalid path");

        swapper = _swapper;
        uniswapV2Router = _uniswapV2Router;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        path = _path;
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256)
    {
        IERC20(tokenIn).safeApprove(uniswapV2Router, _amountIn);

        if (path[path.length - 1] == tokenOut) {
            uint256[] memory amountsOut = IUniswapV2Router(uniswapV2Router)
                .swapExactTokensForTokens(
                    _amountIn,
                    0,
                    path,
                    _to,
                    block.timestamp
                );
            return amountsOut[amountsOut.length - 1];
        } else {
            uint256[] memory amountsOut = IUniswapV2Router(uniswapV2Router)
                .swapExactTokensForTokens(
                    _amountIn,
                    0,
                    path,
                    address(this),
                    block.timestamp
                );
            uint256 amountOut = amountsOut[amountsOut.length - 1];

            address newTokenIn = path[path.length - 1];
            IERC20(newTokenIn).safeApprove(swapper, amountOut);
            return ISwapper(swapper).swap(newTokenIn, tokenOut, amountOut, _to);
        }
    }
}
