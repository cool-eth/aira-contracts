// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface ILendingVault {
    function totalSupply() external view returns (uint256);

    function balanceOf(address user) external view returns (uint256);

    function deposit(address user, uint256 amount) external;

    function withdraw(address user, uint256 amount) external;
}
