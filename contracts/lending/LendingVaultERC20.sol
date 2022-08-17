// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "../interfaces/ILendingVault.sol";
import "./LendingVaultBase.sol";

contract LendingVaultERC20 is LendingVaultBase {
    function initialize(address _provider, address _want) external initializer {
        __LendingVaultBase__init(_provider, _want);
    }
}
