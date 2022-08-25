// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface IStableSwapper {
    function deposit(
        address token,
        uint256 tokenAmount,
        address onBehalf
    ) external returns (uint256 airUSDAmount);

    function withdraw(
        uint256 airUSDAmount,
        address token,
        address onBehalf
    ) external returns (uint256 tokenAmount);
}
