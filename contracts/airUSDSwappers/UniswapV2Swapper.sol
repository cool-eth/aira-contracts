// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISwapperImpl.sol";
import "../external/uniswapV2/IUniswapV2Router.sol";

contract UniswapV2Swapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public uniswapV2Router;
    address public override tokenIn;
    address public override tokenOut;
    address[] public path;

    constructor(
        address _uniswapV2Router,
        address _tokenIn,
        address _tokenOut,
        address[] memory _path
    ) {
        require(_tokenIn != _tokenOut, "invalid token");
        require(
            _path[0] == _tokenIn && _path[_path.length - 1] == _tokenOut,
            "invalid path"
        );

        uniswapV2Router = _uniswapV2Router;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        path = _path;
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), _amountIn);
        IERC20(tokenIn).safeApprove(uniswapV2Router, _amountIn);

        uint256[] memory amountsOut = IUniswapV2Router(uniswapV2Router)
            .swapExactTokensForTokens(_amountIn, 0, path, _to, block.timestamp);

        return amountsOut[amountsOut.length - 1];
    }
}
