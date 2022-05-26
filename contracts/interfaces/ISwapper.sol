// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface ISwapper {
    function swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _to
    ) external returns (uint256 amountOut);
}
