// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

// TODO: this is draft one - will be updated later
interface IPriceOracle {
    function getPrice(address _asset) external view returns (uint256);
}