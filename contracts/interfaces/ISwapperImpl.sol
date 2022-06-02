// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface ISwapperImpl {
    function tokenIn() external view returns (address);

    function tokenOut() external view returns (address);

    function swap(uint256 _amountIn, address _to)
        external
        returns (uint256 amountOut);
}
