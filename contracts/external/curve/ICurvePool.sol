// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

interface ICurvePool {
    function coins(uint256 index) external view returns (address);

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 dy
    ) external payable returns (uint256);

    function remove_liquidity(
        uint256 burn_amount,
        uint256[2] calldata min_amounts
    ) external;

    function remove_liquidity(
        uint256 burn_amount,
        uint256[3] memory min_amounts
    ) external;

    function remove_liquidity(
        uint256 burn_amount,
        uint256[4] memory min_amounts
    ) external;
}
