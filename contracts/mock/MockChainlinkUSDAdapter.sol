// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../interfaces/IOracle.sol";
import "../external/chainlink/IChainlinkV3Aggregator.sol";

contract MockChainlinkUSDAdapter is IOracle {
    uint256 public override viewPriceInUSD;

    constructor(uint256 price) {
        viewPriceInUSD = price;
    }

    function setViewPriceInUSD(uint256 price) external {
        viewPriceInUSD = price;
    }
}
