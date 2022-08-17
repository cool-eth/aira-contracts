// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/ISwapper.sol";
import "../../interfaces/ISwapperImpl.sol";
import "../../external/velodrome/IVelodromeRouter.sol";
import "../../external/velodrome/IVelodromePair.sol";

contract VelodromeLPSwapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public immutable swapper;
    address public immutable override tokenIn; // velodrome pair
    address public immutable override tokenOut;
    address public immutable velodromeRouter;
    address public immutable token0;
    address public immutable token1;
    bool public immutable isStable;

    constructor(
        address _swapper,
        address _velodromeRouter,
        address _tokenIn,
        address _tokenOut
    ) {
        swapper = _swapper;
        velodromeRouter = _velodromeRouter;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        token0 = IVelodromePair(tokenIn).token0();
        token1 = IVelodromePair(tokenIn).token1();
        isStable = IVelodromePair(tokenIn).stable();

        IERC20(tokenIn).safeApprove(_velodromeRouter, type(uint256).max);
        IERC20(token0).safeApprove(_velodromeRouter, type(uint256).max);
        IERC20(token1).safeApprove(_velodromeRouter, type(uint256).max);
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        IVelodromeRouter(velodromeRouter).removeLiquidity(
            token0,
            token1,
            isStable,
            _amountIn,
            0,
            0,
            address(this),
            block.timestamp
        );

        uint256 token0Balance = IERC20(token0).balanceOf(address(this));
        if (token0Balance > 0) {
            amountOut += ISwapper(swapper).swap(
                token0,
                tokenOut,
                token0Balance,
                _to
            );
        }

        uint256 token1Balance = IERC20(token1).balanceOf(address(this));
        if (token1Balance > 0) {
            amountOut += ISwapper(swapper).swap(
                token1,
                tokenOut,
                token1Balance,
                _to
            );
        }
    }
}
