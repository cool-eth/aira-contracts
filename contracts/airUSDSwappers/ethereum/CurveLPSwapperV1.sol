// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/ISwapper.sol";
import "../../interfaces/ISwapperImpl.sol";
import "../../external/curve/ICurvePool.sol";
import "../../external/velodrome/IVelodromeRouter.sol";
import "../../external/velodrome/IVelodromePair.sol";

contract CurveLPSwapperV1 is ISwapperImpl {
    using SafeERC20 for IERC20;

    address public immutable swapper;
    address public immutable override tokenIn; // curve lp
    address public immutable override tokenOut;
    address public immutable curveMinter; // curve minter
    uint256 public immutable coinCount; // curve lp component count

    constructor(
        address _swapper,
        address _tokenIn,
        address _tokenOut,
        address _curveMinter,
        uint256 _coinCount
    ) {
        swapper = _swapper;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        curveMinter = _curveMinter;
        coinCount = _coinCount;
    }

    function swap(uint256 _amountIn, address _to)
        external
        override
        returns (uint256 amountOut)
    {
        if (coinCount == 2) {
            uint256[2] memory minAmounts;
            ICurvePool(curveMinter).remove_liquidity(_amountIn, minAmounts);
        } else if (coinCount == 3) {
            uint256[3] memory minAmounts;
            ICurvePool(curveMinter).remove_liquidity(_amountIn, minAmounts);
        } else if (coinCount == 4) {
            uint256[4] memory minAmounts;
            ICurvePool(curveMinter).remove_liquidity(_amountIn, minAmounts);
        }

        for (uint256 i = 0; i < coinCount; i++) {
            address token = ICurvePool(curveMinter).coins(i);
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));
            if (tokenBalance > 0) {
                IERC20(token).safeApprove(swapper, tokenBalance);
                amountOut += ISwapper(swapper).swap(
                    token,
                    tokenOut,
                    tokenBalance,
                    _to
                );
            }
        }
    }
}
