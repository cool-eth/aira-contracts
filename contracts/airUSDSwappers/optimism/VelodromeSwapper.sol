// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/ISwapperImpl.sol";
import "../../external/velodrome/IVelodromeRouter.sol";

contract VelodromeSwapper is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public immutable velodromeRouter;
    address public immutable override tokenIn;
    address public immutable override tokenOut;
    IVelodromeRouter.route[] public routes;

    constructor(
        address _velodromeRouter,
        address _tokenIn,
        address _tokenOut,
        IVelodromeRouter.route[] memory _routes
    ) {
        require(_tokenIn != _tokenOut, "invalid token");
        require(
            _routes[0].from == _tokenIn &&
                _routes[_routes.length - 1].to == _tokenOut,
            "invalid path"
        );

        velodromeRouter = _velodromeRouter;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        for (uint256 i = 0; i < _routes.length; i++) {
            routes.push(_routes[i]);
        }
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).safeApprove(velodromeRouter, _amountIn);

        uint256[] memory amountsOut = IVelodromeRouter(velodromeRouter)
            .swapExactTokensForTokens(
                _amountIn,
                0,
                routes,
                _to,
                block.timestamp
            );

        return amountsOut[amountsOut.length - 1];
    }
}
