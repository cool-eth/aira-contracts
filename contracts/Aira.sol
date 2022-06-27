// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/utils/Context.sol";

/**
 * @title Aira
 * @notice Aira Governance Token
 * @dev Only owner mint tokens (max cap: 1B token)
 */
contract Aira is Context, Ownable, ERC20Capped {
    uint256 public constant MAX_CAP = 1000000000 * 10**18;

    constructor() ERC20("Aira", "Aira") ERC20Capped(MAX_CAP) Ownable() {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
