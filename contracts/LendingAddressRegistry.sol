// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./interfaces/ILendingAddressRegistry.sol";

contract LendingAddressRegistry is Ownable, ILendingAddressRegistry {
    using Counters for Counters.Counter;

    /// @notice lending contract
    bytes32 public constant LENDING_MARKET = "LENDING_MARKET";
    /// @notice token price oracle aggregator
    bytes32 public constant PRICE_ORACLE_AGGREGATOR = "PRICE_ORACLE_AGGREGATOR";
    /// @notice treasury address (10% of liquidation penalty + 20% of interest + borrow fee)
    bytes32 public constant TREASURY = "TREASURY";
    /// @notice staking address (40% of liquidation penalty + 80% of interest + borrow fee)
    bytes32 public constant STAKING = "STAKING";
    /// @notice stability pool
    bytes32 public constant STABLE_POOL = "STABLE_POOL";
    /// @notice swapper contract
    bytes32 public constant SWAPPER = "SWAPPER";

    mapping(bytes32 => address) private _addresses;

    Counters.Counter private _keeperIndexTracker;
    mapping(uint256 => address) private _keepers;
    mapping(address => bool) private _isKeeper;

    constructor() Ownable() {}

    // Set up all addresses for the registry.
    function initialize(
        address lendingMarket,
        address priceOracleAggregator,
        address treasury,
        address staking,
        address stablePool,
        address swapper
    ) external override onlyOwner {
        _addresses[LENDING_MARKET] = lendingMarket;
        _addresses[PRICE_ORACLE_AGGREGATOR] = priceOracleAggregator;
        _addresses[TREASURY] = treasury;
        _addresses[STAKING] = staking;
        _addresses[STABLE_POOL] = stablePool;
        _addresses[SWAPPER] = swapper;
    }

    function getLendingMarket() external view override returns (address) {
        return _addresses[LENDING_MARKET];
    }

    function setLendingMarket(address lendingMarket)
        external
        override
        onlyOwner
    {
        _addresses[LENDING_MARKET] = lendingMarket;
    }

    function getPriceOracleAggregator() external view returns (address) {
        return _addresses[PRICE_ORACLE_AGGREGATOR];
    }

    function setPriceOracleAggregator(address priceOracleAggregator)
        external
        onlyOwner
    {
        _addresses[PRICE_ORACLE_AGGREGATOR] = priceOracleAggregator;
    }

    function getTreasury() external view override returns (address) {
        return _addresses[TREASURY];
    }

    function setTreasury(address treasury) external override onlyOwner {
        _addresses[TREASURY] = treasury;
    }

    function getStaking() external view override returns (address) {
        return _addresses[STAKING];
    }

    function setStaking(address staking) external override onlyOwner {
        _addresses[STAKING] = staking;
    }

    function getStablePool() external view override returns (address) {
        return _addresses[STABLE_POOL];
    }

    function setStablePool(address stablePool) external override onlyOwner {
        _addresses[STABLE_POOL] = stablePool;
    }

    function getSwapper() external view override returns (address) {
        return _addresses[SWAPPER];
    }

    function setSwapper(address swapper) external override onlyOwner {
        _addresses[SWAPPER] = swapper;
    }

    function getKeepers() external view override returns (address[] memory) {
        uint256 length = _keeperIndexTracker.current();
        address[] memory keepers = new address[](length);

        for (uint256 i = 0; i < length; i++) {
            keepers[i] = _keepers[i];
        }

        return keepers;
    }

    function addKeeper(address keeper) external override onlyOwner {
        require(!isKeeper(keeper), "already exists");
        _keepers[_keeperIndexTracker.current()] = keeper;
        _keeperIndexTracker.increment();
        _isKeeper[keeper] = true;
    }

    function isKeeper(address keeper) public view override returns (bool) {
        return _isKeeper[keeper];
    }

    function getAddress(bytes32 id) external view override returns (address) {
        return _addresses[id];
    }
}
