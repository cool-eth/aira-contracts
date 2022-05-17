// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';

import './interfaces/IAIRA.sol';
import './interfaces/IPriceOracleAggregator.sol';

/**
 * @title LendingMarket
 * @notice Lending pools where users can deposit/withdraw collateral and borrow AIRA.
 * @dev If the user's health factor is below 1, anyone can liquidate his/her position.
 * Protocol will charge debt interest from borrowers and protocol revenue from liquidation.
 */
contract LendingMarket is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20MetadataUpgradeable;

    /// @notice A struct to represent the rate in numerator/denominator
    struct Rate {
        uint128 numerator;
        uint128 denominator;
    }

    /// @notice A struct for lending market settings
    struct MarketSettings {
        Rate interestApr; // debt interest rate in APR
        Rate orgFeeRate; // fees that will be charged upon minting AIRA (0.3% in AIRA)
        Rate liquidatorFeeRate; // liquidation fee for liquidators. (5% in collateral)
        Rate orgRevenueFeeRate; // liquidation fee for protocol revenue. (3% in collateral)
    }

    /// @notice A struct for collateral settings
    struct CollateralSetting {
        bool isValid; // if collateral is valid or not
        IPriceOracleAggregator oracle; // collateral price oracle (returns price in usd: 8 decimals)
        Rate creditLimitRate; // collateral borrow limit (e.g. USDs = 80%, BTCs = 70%, AVAXs=70%)
        Rate liqLimitRate; // collateral liquidation threshold rate (greater than credit limit rate)
        uint8 decimals; // collateral token decimals
    }

    /// @notice A struct for users collateral position
    struct Position {
        uint256 amount; // collateral amount
        uint256 debtPrincipal; // debt amount
        uint256 debtPortion; // accumulated debt interest
    }

    /// @notice An event thats emitted when user deposits collateral
    event Deposit(address indexed user, address indexed token, uint256 amount);

    /// @notice AIRA token address
    IAIRA public aira;
    /// @notice lending market settings
    MarketSettings public settings;
    /// @notice collateral tokens in array
    address[] public collateralTokens;
    /// @notice collateral settings
    mapping(address => CollateralSetting) public collateralSettings; // token => collateral setting
    /// @notice users collateral position
    mapping(address => mapping(address => Position)) internal userPositions; // user => collateral token => position

    /**
     * @notice Initializer.
     * @param _aira AIRA token address
     * @param _settings lending market settings
     */
    function initialize(IAIRA _aira, MarketSettings memory _settings) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        // validates lending market settings
        _validateRate(_settings.interestApr); // should be updated to use cov ratio
        _validateRate(_settings.orgFeeRate); // 0.3%
        _validateRate(_settings.liquidatorFeeRate); // 5%
        _validateRate(_settings.orgRevenueFeeRate); // 3%

        aira = _aira;
        settings = _settings;
    }

    /**
     * @notice add a new collateral token
     * @dev only owner can call this function
     * @param _token collateral token address
     * @param _oracle collateral token price oracle
     * @param _creditLimitRate borrow limit
     * @param _liqLimitRate liquidation threshold rate
     */
    function addCollateralToken(
        address _token,
        address _oracle,
        Rate memory _creditLimitRate,
        Rate memory _liqLimitRate
    ) external onlyOwner {
        // validates collateral settings
        require(_oracle != address(0), 'invalid oracle address');
        _validateRate(_creditLimitRate);
        _validateRate(_liqLimitRate);

        // check if collateral token already exists
        require(!collateralSettings[_token].isValid, 'collateral token exists');

        // add a new collateral
        collateralSettings[_token] = CollateralSetting({
            isValid: true,
            oracle: IPriceOracleAggregator(_oracle),
            creditLimitRate: _creditLimitRate,
            liqLimitRate: _liqLimitRate,
            decimals: IERC20MetadataUpgradeable(_token).decimals()
        });
        collateralTokens.push(_token);
    }

    /**
     * @notice remove an existing collateral token
     * @dev only owner can call this function
     * @param _token collateral token address
     */
    function removeCollateralToken(address _token) external onlyOwner {
        // check if collateral token already exists
        require(collateralSettings[_token].isValid, 'invalid collateral token');

        // add a new collateral
        uint256 index = 0;
        uint256 length = collateralTokens.length;
        for (; index < length; index++) {
            if (collateralTokens[index] == _token) {
                break;
            }
        }

        collateralTokens[index] = collateralTokens[length - 1];
        delete collateralTokens[length - 1];
        collateralTokens.pop();
    }

    /**
     * @notice returns all collateral tokens in array format
     * @return The collateral tokens in array format
     */
    function allCollateralTokens() external view returns (address[] memory) {
        return collateralTokens;
    }

    /**
     * @notice deposit collateral
     * @dev user can call this function after approving his/her collateral amount
     * @param _token collateral token address
     * @param _amount collateral amount to deposit
     * @param _onBehalfOf deposit collateral for
     */
    function deposit(
        address _token,
        uint256 _amount,
        address _onBehalfOf
    ) external nonReentrant {
        require(collateralSettings[_token].isValid, 'invalid token');

        // get collateral from depositor
        IERC20MetadataUpgradeable(_token).safeTransferFrom(msg.sender, address(this), _amount);

        // update a user's collateral position
        userPositions[_onBehalfOf][_token].amount += _amount;

        emit Deposit(_onBehalfOf, _token, _amount);
    }

    /// INTERNAL FUNCTIONS

    /**
     * @notice validate rate denominator and numerator
     */
    function _validateRate(Rate memory rate) internal pure {
        require(rate.denominator > 0 && rate.denominator >= rate.numerator, 'invalid rate');
    }
}