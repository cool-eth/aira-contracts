// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface IStablePool {
    function prepare(uint256 amount, bytes calldata data) external;
}
