// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/ILendingAddressRegistry.sol";
import "../interfaces/IPriceOracleAggregator.sol";
import "../interfaces/ILendingMarket.sol";
import "../interfaces/ISwapper.sol";
import "../interfaces/IAirUSD.sol";
import "../interfaces/ILendingVault.sol";

import "hardhat/console.sol";

/**
 * @title LendingMarket
 * @notice Lending pools where users can deposit/withdraw collateral and borrow AirUSD.
 * @dev If the user's health factor is below 1, anyone can liquidate his/her position.
 * Protocol will charge debt interest from borrowers and protocol revenue from liquidation.
 */
contract LendingMarketV2 is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ILendingMarket
{
    using SafeERC20Upgradeable for IERC20MetadataUpgradeable;
    using SafeERC20 for IAirUSD;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /// @notice A struct to represent the rate in numerator/denominator
    enum CollateralStatus {
        Invalid,
        Enabled,
        Disabled
    }

    /// @notice A struct to represent the rate in numerator/denominator
    struct Rate {
        uint128 numerator;
        uint128 denominator;
    }

    /// @notice A struct for lending market settings
    struct MarketSettings {
        Rate interestApr; // debt interest rate in APR
        Rate orgFeeRate; // fees that will be charged upon minting AirUSD (0.3% in AirUSD)
        Rate liquidationPenalty; // liquidation penalty fees (5%)
    }

    /// @notice A struct for collateral settings
    struct CollateralSetting {
        CollateralStatus status; // collateral status (invalid, running, stopped)
        Rate creditLimitRate; // collateral borrow limit (e.g. USDs = 80%, BTCs = 70%, AVAXs=70%)
        Rate liqLimitRate; // collateral liquidation threshold rate (greater than credit limit rate)
        uint8 decimals; // collateral token decimals
        uint256 totalBorrowCap;
    }

    /// @notice A struct for users collateral position
    struct Position {
        uint256 debtPrincipal; // debt amount
        uint256 debtPortion; // accumulated debt interest
    }

    /// @notice An event thats emitted when user deposits collateral
    event Deposit(address indexed user, address indexed token, uint256 amount);
    /// @notice An event thats emitted when user borrows AirUSD
    event Borrowed(address indexed user, uint256 airUSDAmount);
    /// @notice An event thats emitted when user withdraws collateral
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    /// @notice An event thats emitted when user repays AirUSD
    event Repay(address indexed user, uint256 airUSDAmount);
    /// @notice An event thats emitted when liquidator liquidates a user's position
    event Liquidate(
        address indexed user,
        address indexed token,
        uint256 amount,
        address indexed liquidator
    );

    /// @notice address provider
    ILendingAddressRegistry public addressProvider;
    /// @notice AirUSD token address
    IAirUSD public airUSD;
    /// @notice lending market settings
    MarketSettings public settings;
    /// @notice collateral tokens in array
    address[] public collateralTokens;
    /// @notice collateral settings
    mapping(address => CollateralSetting) public collateralSettings; // token => collateral setting
    /// @notice lending vault contract of collateral token
    mapping(address => ILendingVault) public lendingVault; // token => lending vault
    /// @notice users debt position by collateral token
    mapping(address => mapping(address => Position)) internal userPositions; // user => collateral token => debt position
    /// @notice airUSD total borrows per collateral token
    mapping(address => uint256) public totalBorrowsPerCollateral;
    /// @notice users per collateral token
    mapping(address => EnumerableSetUpgradeable.AddressSet)
        internal marketUsers; // collateral token => users set

    /// @notice total borrowed amount accrued so far
    uint256 public totalDebtAmount;
    /// @notice last time of debt accrued
    uint256 public totalDebtAccruedAt;
    /// @notice total borrowed portion
    uint256 public totalDebtPortion;
    /// @notice total protocol fees accrued so far
    uint256 public totalFeeCollected;

    /**
     * @notice Initializer.
     * @param _provider address provider
     * @param _airUSD AirUSD token address
     * @param _settings lending market settings
     */
    function initialize(
        address _provider,
        IAirUSD _airUSD,
        MarketSettings memory _settings
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        // validates lending market settings
        _validateRate(_settings.interestApr); // should be updated to use cov ratio
        _validateRate(_settings.orgFeeRate); // 0.3%
        _validateRate(_settings.liquidationPenalty); // 5%

        addressProvider = ILendingAddressRegistry(_provider);
        airUSD = _airUSD;
        settings = _settings;
    }

    /**
     * @notice accrue debt interest
     * @dev Updates the contract's state by calculating the additional interest accrued since the last time
     */
    function accrue() public {
        // calculate additional interest from last time
        uint256 additionalInterest = _calculateInterestFromLastTime();

        // set last time accrued
        totalDebtAccruedAt = block.timestamp;

        // plus additional interest
        totalDebtAmount += additionalInterest;
        totalFeeCollected += additionalInterest;
    }

    /**
     * @notice set new address provider
     * @param _provider new address provider
     */
    function setAddressProvider(address _provider) external onlyOwner {
        addressProvider = ILendingAddressRegistry(_provider);
    }

    /**
     * @notice enable a new collateral token
     * @dev only owner can call this function
     * @param _token collateral token address
     * @param _vault lending vault address
     * @param _creditLimitRate borrow limit
     * @param _liqLimitRate liquidation threshold rate
     */
    function enableCollateralToken(
        address _token,
        address _vault,
        Rate memory _creditLimitRate,
        Rate memory _liqLimitRate,
        uint256 _totalBorrowCap
    ) external onlyOwner {
        // validates collateral settings
        _validateRate(_creditLimitRate);
        _validateRate(_liqLimitRate);

        // check if collateral token already exists
        require(
            collateralSettings[_token].status != CollateralStatus.Enabled,
            "already enabled collateral token"
        );

        // add a new collateral
        collateralSettings[_token] = CollateralSetting({
            status: CollateralStatus.Enabled,
            creditLimitRate: _creditLimitRate,
            liqLimitRate: _liqLimitRate,
            decimals: IERC20MetadataUpgradeable(_token).decimals(),
            totalBorrowCap: _totalBorrowCap
        });
        lendingVault[_token] = ILendingVault(_vault);
        collateralTokens.push(_token);
    }

    /**
     * @notice update collateral token settings
     * @dev only owner can call this function
     * @param _token collateral token address
     * @param _creditLimitRate borrow limit
     * @param _liqLimitRate liquidation threshold rate
     */
    function updateCollateralToken(
        address _token,
        Rate memory _creditLimitRate,
        Rate memory _liqLimitRate,
        uint256 _totalBorrowCap
    ) external onlyOwner {
        // validates collateral settings
        _validateRate(_creditLimitRate);
        _validateRate(_liqLimitRate);

        require(
            collateralSettings[_token].status != CollateralStatus.Invalid,
            "invalid collateral token"
        );

        // update collateral token settings
        collateralSettings[_token].creditLimitRate = _creditLimitRate;
        collateralSettings[_token].liqLimitRate = _liqLimitRate;
        collateralSettings[_token].totalBorrowCap = _totalBorrowCap;
    }

    /**
     * @notice disable an existing collateral token
     * @dev only owner can call this function
     * @param _token collateral token address
     */
    function disableCollateralToken(address _token) external onlyOwner {
        // check if collateral token already exists
        require(
            collateralSettings[_token].status == CollateralStatus.Enabled,
            "not enabled collateral token"
        );

        collateralSettings[_token].status = CollateralStatus.Disabled;

        // remove an existing collateral
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
     * @notice collect protocol fees accrued so far
     * @dev only owner can call this function
     */
    function collectOrgFee() external nonReentrant onlyOwner {
        accrue();

        // collect protocol fees in AirUSD
        _transferFee(totalFeeCollected, true);
        totalFeeCollected = 0;
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
        require(
            collateralSettings[_token].status == CollateralStatus.Enabled,
            "not enabled"
        );

        // get collateral from depositor
        IERC20MetadataUpgradeable(_token).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        ILendingVault vault = lendingVault[_token];
        IERC20MetadataUpgradeable(_token).safeApprove(address(vault), _amount);
        vault.deposit(_onBehalfOf, _amount);

        emit Deposit(_onBehalfOf, _token, _amount);
    }

    /**
     * @notice borrow AirUSD
     * @dev user can call this function after depositing his/her collateral
     * @param _token collateral token address
     * @param _airUSDAmount AirUSD amount to borrow
     */
    function borrow(address _token, uint256 _airUSDAmount)
        external
        nonReentrant
    {
        // check if collateral is valid
        require(
            collateralSettings[_token].status == CollateralStatus.Enabled,
            "not enabled"
        );

        accrue();

        // calculate borrow limit in USD
        uint256 creditLimit = _creditLimitUSD(msg.sender, _token);
        // calculate debt amount in USD
        uint256 debtAmount = _debtUSD(msg.sender, _token);

        // check if additional borrow is available
        require(
            debtAmount + _airUSDAmount <= creditLimit,
            "insufficient collateral"
        );

        require(
            totalBorrowsPerCollateral[_token] + _airUSDAmount <=
                collateralSettings[_token].totalBorrowCap,
            "borrow cap reached"
        );

        // calculate AirUSD mint fee
        uint256 orgFee = (_airUSDAmount * settings.orgFeeRate.numerator) /
            settings.orgFeeRate.denominator;
        totalFeeCollected += orgFee;

        // mint AirUSD to user
        airUSD.mint(msg.sender, _airUSDAmount - orgFee);

        // update user's collateral position
        Position storage position = userPositions[msg.sender][_token];
        if (totalDebtPortion == 0) {
            totalDebtPortion = _airUSDAmount;
            position.debtPortion = _airUSDAmount;
        } else {
            uint256 plusPortion = (totalDebtPortion * _airUSDAmount) /
                totalDebtAmount;
            totalDebtPortion += plusPortion;
            position.debtPortion += plusPortion;
        }
        position.debtPrincipal += _airUSDAmount;
        totalDebtAmount += _airUSDAmount;

        // increase total borrows of the collateral market
        totalBorrowsPerCollateral[_token] += _airUSDAmount;

        // check if new market user enters
        if (!marketUsers[_token].contains(msg.sender)) {
            marketUsers[_token].add(msg.sender);
        }

        emit Borrowed(msg.sender, _airUSDAmount);
    }

    /**
     * @notice withdraw collateral
     * @dev user can call this function after depositing his/her collateral
     * @param _token collateral token address
     * @param _amount collateral amount to withdraw
     */
    function withdraw(address _token, uint256 _amount) external nonReentrant {
        // check if collateral is valid
        require(
            collateralSettings[_token].status != CollateralStatus.Invalid,
            "invalid token"
        );

        accrue();

        ILendingVault vault = lendingVault[_token];

        vault.withdraw(msg.sender, _amount);

        // calculate borrow limit after withdraw in USD
        uint256 creditLimitAfterWithdraw = (_tokenUSD(
            _token,
            vault.balanceOf(msg.sender)
        ) * collateralSettings[_token].creditLimitRate.numerator) /
            collateralSettings[_token].creditLimitRate.denominator;
        // calculate debt amount in USD
        uint256 debtAmount = _debtUSD(msg.sender, _token);

        // check if withdraw is available
        require(
            debtAmount <= creditLimitAfterWithdraw,
            "insufficient collateral"
        );

        // transfer collateral to user
        IERC20MetadataUpgradeable(_token).safeTransfer(msg.sender, _amount);

        emit Withdraw(msg.sender, _token, _amount);
    }

    /**
     * @notice repay position with AirUSD
     * @dev user can call this function after approving his/her AirUSD amount to repay
     * @param _token collateral token address
     * @param _airUSDAmount AirUSD amount to repay
     */
    function repay(address _token, uint256 _airUSDAmount)
        external
        nonReentrant
    {
        // check if collateral is valid
        require(
            collateralSettings[_token].status != CollateralStatus.Invalid,
            "invalid token"
        );

        accrue();

        require(_airUSDAmount > 0, "invalid amount");

        Position storage position = userPositions[msg.sender][_token];

        // calculate debt amount in USD
        uint256 debtAmount = _debtUSD(msg.sender, _token);
        uint256 debtPrincipal = position.debtPrincipal;
        uint256 debtInterest = debtAmount - debtPrincipal;

        // only pays for the debt and returns remainings
        _airUSDAmount = _airUSDAmount > debtAmount ? debtAmount : _airUSDAmount;

        // burn repaid AirUSD
        airUSD.burnFrom(msg.sender, _airUSDAmount);

        // update user's collateral position
        uint256 paidPrincipal = _airUSDAmount > debtInterest
            ? _airUSDAmount - debtInterest
            : 0;
        uint256 minusPortion = paidPrincipal == debtPrincipal
            ? position.debtPortion
            : (totalDebtPortion * _airUSDAmount) / totalDebtAmount;

        totalDebtAmount -= _airUSDAmount;
        totalDebtPortion -= minusPortion;
        position.debtPrincipal -= paidPrincipal;
        position.debtPortion -= minusPortion;

        if (position.debtPrincipal == 0) {
            // remove market user
            if (marketUsers[_token].contains(msg.sender)) {
                marketUsers[_token].remove(msg.sender);
            }
        }

        // decrease total borrows of the collateral market (exclude only principls)
        totalBorrowsPerCollateral[_token] -= paidPrincipal;

        emit Repay(msg.sender, _airUSDAmount);
    }

    function liquidate(address _user, address _token)
        external
        override
        nonReentrant
    {
        // check if msg.sender is chainlink keeper
        require(addressProvider.isKeeper(msg.sender), "not keeper");
        // check if collateral is valid
        require(
            collateralSettings[_token].status != CollateralStatus.Invalid,
            "invalid token"
        );

        accrue();

        Position storage position = userPositions[_user][_token];
        // calculate debt amount in USD
        uint256 debtAmount = _debtUSD(_user, _token);

        // check if liquidation is available
        require(
            debtAmount >= _liquidateLimitUSD(_user, _token),
            "not liquidatable"
        );

        // burn airUSD from keeper
        airUSD.burnFrom(msg.sender, debtAmount);

        // get price from collateral token oracle contract
        uint256 price = IPriceOracleAggregator(
            addressProvider.getPriceOracleAggregator()
        ).viewPriceInUSD(_token);

        // returnUSD = debtAmount + liquidation penalty (105%)
        uint256 returnUSD = debtAmount +
            (debtAmount * settings.liquidationPenalty.numerator) /
            settings.liquidationPenalty.denominator;

        // collateral amount in returnUSD
        uint256 collateralAmountIn = (returnUSD *
            (10**collateralSettings[_token].decimals)) /
            price /
            10**10;

        ILendingVault vault = lendingVault[_token];
        uint256 userCollateralAmount = vault.balanceOf(_user);

        // withdraw user's collateral amount
        vault.withdraw(_user, userCollateralAmount);

        require(
            collateralAmountIn <= userCollateralAmount,
            "not enough collateral"
        );

        // swap collateral token in airUSD
        address swapper = addressProvider.getSwapper();
        IERC20(_token).approve(swapper, collateralAmountIn);
        uint256 airUSDAmountOut = ISwapper(swapper).swap(
            _token,
            address(airUSD),
            collateralAmountIn,
            address(this)
        );

        require(airUSDAmountOut > debtAmount, "zero penalty");

        // liquidation penalty
        uint256 liquidationPenalty = airUSDAmountOut - debtAmount;

        // debtAmount + 50% of penalty => keeper
        airUSD.transfer(msg.sender, debtAmount + liquidationPenalty / 2);

        // 50% of penalty => fees
        _transferFee(liquidationPenalty / 2, false);

        // return rest collateral token to user
        if (userCollateralAmount > collateralAmountIn) {
            IERC20MetadataUpgradeable(_token).safeTransfer(
                _user,
                userCollateralAmount - collateralAmountIn
            );
        }

        // update total info
        totalDebtAmount -= debtAmount;
        totalDebtPortion -= position.debtPortion;

        // remove user position
        position.debtPortion = 0;
        position.debtPrincipal = 0;

        emit Liquidate(_user, _token, debtAmount, msg.sender);
    }

    /**
     * @notice returns a user's collateral position
     * @return position this includes a user's collateral, debt, liquidation data.
     */
    function positionView(address _user, address _token)
        external
        view
        override
        returns (PositionView memory)
    {
        Position memory position = userPositions[_user][_token];

        // this is a copy from _debtUSD but should include additional-interest calculation
        uint256 debtCalculated = totalDebtPortion == 0
            ? 0
            : ((totalDebtAmount + _calculateInterestFromLastTime()) *
                userPositions[_user][_token].debtPortion) / totalDebtPortion;
        uint256 debtPrincipal = userPositions[_user][_token].debtPrincipal;
        uint256 debtAmount = debtPrincipal > debtCalculated
            ? debtPrincipal
            : debtCalculated;

        uint256 collateralAmount = lendingVault[_token].balanceOf(_user);
        return
            PositionView({
                owner: _user,
                token: _token,
                amount: collateralAmount,
                amountUSD: _tokenUSD(_token, collateralAmount),
                creditLimitUSD: _creditLimitUSD(_user, _token),
                debtPrincipal: position.debtPrincipal,
                debtInterest: debtAmount - position.debtPrincipal,
                liquidatable: debtAmount >= _liquidateLimitUSD(_user, _token)
            });
    }

    function liquidatable(address _user, address _token)
        external
        view
        override
        returns (bool)
    {
        // this is a copy from _debtUSD but should include additional-interest calculation
        uint256 debtCalculated = totalDebtPortion == 0
            ? 0
            : ((totalDebtAmount + _calculateInterestFromLastTime()) *
                userPositions[_user][_token].debtPortion) / totalDebtPortion;
        uint256 debtPrincipal = userPositions[_user][_token].debtPrincipal;
        uint256 debtAmount = debtPrincipal > debtCalculated
            ? debtPrincipal
            : debtCalculated;

        return debtAmount >= _liquidateLimitUSD(_user, _token);
    }

    function getUserCount(address _token)
        external
        view
        override
        returns (uint256)
    {
        return marketUsers[_token].length();
    }

    function getUserAt(address _token, uint256 _index)
        external
        view
        returns (address)
    {
        return marketUsers[_token].at(_index);
    }

    function getAllUsers(address _token)
        external
        view
        returns (address[] memory)
    {
        return marketUsers[_token].values();
    }

    /// INTERNAL FUNCTIONS

    /**
     * @notice validate rate denominator and numerator
     */
    function _validateRate(Rate memory rate) internal pure {
        require(
            rate.denominator > 0 && rate.denominator >= rate.numerator,
            "invalid rate"
        );
    }

    /**
     * @notice calculate additional interest accrued from last time
     * @return The interest accrued from last time
     */
    function _calculateInterestFromLastTime() internal view returns (uint256) {
        // calculate elapsed time from last accrued at
        uint256 elapsedTime = block.timestamp - totalDebtAccruedAt;

        // calculate interest based on elapsed time and interest APR
        return
            (elapsedTime * totalDebtAmount * settings.interestApr.numerator) /
            settings.interestApr.denominator /
            365 days;
    }

    /**
     * @notice returns the USD amount
     * @param token collateral token address
     * @param amount token amount
     * @return The USD amount in 18 decimals
     */
    function _tokenUSD(address token, uint256 amount)
        internal
        view
        returns (uint256)
    {
        // get price from collateral token oracle contract
        uint256 price = IPriceOracleAggregator(
            addressProvider.getPriceOracleAggregator()
        ).viewPriceInUSD(token);

        // convert to 18 decimals
        return
            (amount * price * 10**10) /
            (10**collateralSettings[token].decimals);
    }

    /**
     * @notice returns the borrow limit amount in USD
     * @param _user user address
     * @param _token collateral token address
     * @return The USD amount in 18 decimals
     */
    function _creditLimitUSD(address _user, address _token)
        internal
        view
        returns (uint256)
    {
        uint256 amount = lendingVault[_token].balanceOf(_user);
        uint256 totalUSD = _tokenUSD(_token, amount);
        return
            (totalUSD * collateralSettings[_token].creditLimitRate.numerator) /
            collateralSettings[_token].creditLimitRate.denominator;
    }

    /**
     * @notice returns the liquidation threshold amount in USD
     * @param _user user address
     * @param _token collateral token address
     * @return The USD amount in 18 decimals
     */
    function _liquidateLimitUSD(address _user, address _token)
        internal
        view
        returns (uint256)
    {
        uint256 amount = lendingVault[_token].balanceOf(_user);
        uint256 totalUSD = _tokenUSD(_token, amount);
        return
            (totalUSD * collateralSettings[_token].liqLimitRate.numerator) /
            collateralSettings[_token].liqLimitRate.denominator;
    }

    /**
     * @notice returns the debt amount in USD
     * @param _user user address
     * @param _token collateral token address
     * @return The USD amount in 18 decimals
     */
    function _debtUSD(address _user, address _token)
        internal
        view
        returns (uint256)
    {
        uint256 debtCalculated = totalDebtPortion == 0
            ? 0
            : (totalDebtAmount * userPositions[_user][_token].debtPortion) /
                totalDebtPortion;
        uint256 debtPrincipal = userPositions[_user][_token].debtPrincipal;

        return debtPrincipal > debtCalculated ? debtPrincipal : debtCalculated; // consider of round at debt calculation
    }

    /**
     * @notice transfer airUSD fee to staking (80%) and treasury (20%)
     * @param _fee fee amount
     * @param _mint airUSD mint or transfer
     */
    function _transferFee(uint256 _fee, bool _mint) internal {
        address treasury = addressProvider.getTreasury();
        uint256 treasuryFee = _fee / 5;

        address staking = addressProvider.getStaking();
        uint256 stakingFee = _fee - treasuryFee;

        if (_mint) {
            airUSD.mint(treasury, treasuryFee);
            airUSD.mint(staking, stakingFee);
        } else {
            airUSD.safeTransfer(treasury, treasuryFee);
            airUSD.safeTransfer(staking, stakingFee);
        }
    }
}
