// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../lib/math/PRBMath.sol";
import "../interfaces/IPriceOracleAggregator.sol";
import "../external/velodrome/IVelodromePair.sol";

/**
 * @title Velodrome Stable LP oracle.
 * @notice You can use this contract for Velodrome lp token pricing oracle.
 * @dev This should have `viewPriceInUSD` which returns price in USD
 */
contract VelodromeStableLPAggregator is IOracle {
    /// @notice oracle that returns price in USD
    IPriceOracleAggregator public immutable aggregator;

    address public immutable pair;
    address public immutable token0;
    address public immutable token1;

    constructor(address _pair, address _priceOracleAggregator) {
        pair = _pair;
        token0 = IVelodromePair(pair).token0();
        token1 = IVelodromePair(pair).token1();

        aggregator = IPriceOracleAggregator(_priceOracleAggregator);
    }

    /// @dev returns the latest price of asset
    /// @notice we can reference LP pricing from
    function viewPriceInUSD() external view override returns (uint256 price) {
        uint256 price0 = aggregator.viewPriceInUSD(token0); // decimals 8
        uint256 price1 = aggregator.viewPriceInUSD(token1); // decimals 8

        uint256 totalSupply = IVelodromePair(pair).totalSupply();
        (uint256 r0, uint256 r1, ) = IVelodromePair(pair).getReserves();
        uint256 decimal0 = IERC20Metadata(token0).decimals();
        uint256 decimal1 = IERC20Metadata(token1).decimals();
        r0 = (r0 * (10**18)) / (10**decimal0); // decimal = 18
        r1 = (r1 * (10**18)) / (10**decimal1); // decimal = 18

        (uint256 fairX, uint256 fairY) = _calculateFairReserves(
            r0,
            r1,
            price0,
            price1
        );

        price = (fairX * price0 + fairY * price1) / totalSupply; // decimal = 8
    }

    function _calculateFairReserves(
        uint256 x,
        uint256 y,
        uint256 px,
        uint256 py
    ) private pure returns (uint256 fairX, uint256 fairY) {
        // NOTE:
        // fairY = fairX * px / py
        // fairX = sqrt(sqrt(x * y) * sqrt(x^2 + y^2)) / sqrt(sqrt(ratio) * sqrt(1 + ratio^2))

        uint256 r0 = PRBMath.sqrt(x * y);
        uint256 r1 = PRBMath.sqrt(x * x + y * y);
        uint256 r = PRBMath.sqrt(r0 * r1);

        uint256 ratio = (px * 10**18) / py;
        uint256 p0 = PRBMath.sqrt(ratio * 10**18);
        uint256 p1 = PRBMath.sqrt(10**36 + ratio * ratio);
        uint256 p = PRBMath.sqrt(p0 * p1);

        fairX = (r * 10**18) / p;
        fairY = (fairX * px) / py;
    }
}
