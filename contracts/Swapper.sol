// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ISwapper.sol";
import "./interfaces/ISwapperImpl.sol";

contract Swapper is ISwapper, Ownable {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => address)) public swapperImpls;

    constructor() Ownable() {}

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

    function swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _to
    ) external override returns (uint256 amountOut) {
        address swapperImpl = swapperImpls[_tokenIn][_tokenOut];
        require(swapperImpl != address(0), "swapper implementation not found");

        IERC20(_tokenIn).safeTransferFrom(msg.sender, address(this), _amountIn);
        IERC20(_tokenIn).safeApprove(swapperImpl, _amountIn);

        return ISwapperImpl(swapperImpl).swap(_amountIn, _to);
    }
}
