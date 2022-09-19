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

    /// @notice A struct for collateral settings
    struct CollateralSetting {
        CollateralStatus status; // collateral status (invalid, running, stopped)
        Rate creditLimitRate; // collateral borrow limit (e.g. USDs = 80%, BTCs = 70%, AVAXs=70%)
        Rate interestApr; // debt interest rate in APR
        Rate orgFeeRate; // fees that will be charged upon minting AirUSD (0.3% in AirUSD)
        Rate liqLimitRate; // collateral liquidation threshold rate (greater than credit limit rate)
        Rate liquidationPenalty; // liquidation penalty fees (5%)
        uint8 decimals; // collateral token decimals
        /// @notice airUSD total borrows per collateral token
        uint256 totalBorrows;
        /// @notice total borrow cap
        uint256 totalBorrowCap;
        /// @notice total borrowed amount accrued so far
        uint256 totalDebtAmount;
        /// @notice last time of debt accrued
        uint256 totalDebtAccruedAt;
        /// @notice total borrowed portion
        uint256 totalDebtPortion;
    }

    /// @notice A struct for users collateral position
    struct UserDebtPosition {
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
    /// @notice collateral tokens in array
    address[] public collateralTokens;
    /// @notice collateral settings
    mapping(address => CollateralSetting) public collateralSettings; // token => collateral setting
    /// @notice lending vault contract of collateral token
    mapping(address => ILendingVault) public lendingVault; // token => lending vault
    /// @notice users debt position by collateral token
    mapping(address => mapping(address => UserDebtPosition))
        internal userDebtPositions; // user => collateral token => debt position
    /// @notice users per collateral token
    mapping(address => EnumerableSetUpgradeable.AddressSet)
        internal marketUsers; // collateral token => users set

    /// @notice total protocol fees accrued so far
    uint256 public totalFeeCollected;

    /**
     * @notice Initializer.
     * @param _provider address provider
     * @param _airUSD AirUSD token address
     */
    function initialize(address _provider, IAirUSD _airUSD)
        external
        initializer
    {
        __Ownable_init();
        __ReentrancyGuard_init();

        addressProvider = ILendingAddressRegistry(_provider);
        airUSD = _airUSD;
    }

    /**
     * @notice accrue debt interest
     * @dev Updates the contract's state by calculating the additional interest accrued since the last time
     */
    function accrue(address _token) public {
        // calculate additional interest from last time
        uint256 additionalInterest = _calculateInterestFromLastTime(_token);

        // set last time accrued
        collateralSettings[_token].totalDebtAccruedAt = block.timestamp;
        // plus additional interest
        collateralSettings[_token].totalDebtAmount += additionalInterest;

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
        Rate memory _interestApr,
        Rate memory _orgFeeRate,
        Rate memory _liqLimitRate,
        Rate memory _liquidationPenalty,
        uint256 _totalBorrowCap
    ) external onlyOwner {
        // validates collateral settings
        _validateRate(_creditLimitRate);
        _validateRate(_interestApr);
        _validateRate(_orgFeeRate);
        _validateRate(_liqLimitRate);
        _validateRate(_liquidationPenalty);

        // check if collateral token already exists
        require(
            collateralSettings[_token].status != CollateralStatus.Enabled,
            "already enabled collateral token"
        );

        // add a new collateral
        collateralSettings[_token] = CollateralSetting({
            status: CollateralStatus.Enabled,
            creditLimitRate: _creditLimitRate,
            interestApr: _interestApr,
            orgFeeRate: _orgFeeRate,
            liqLimitRate: _liqLimitRate,
            liquidationPenalty: _liquidationPenalty,
            decimals: IERC20MetadataUpgradeable(_token).decimals(),
            totalBorrows: 0,
            totalBorrowCap: _totalBorrowCap,
            totalDebtAmount: 0,
            totalDebtAccruedAt: block.timestamp,
            totalDebtPortion: 0
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
        Rate memory _interestApr,
        Rate memory _orgFeeRate,
        Rate memory _liqLimitRate,
        Rate memory _liquidationPenalty,
        uint256 _totalBorrowCap
    ) external onlyOwner {
        // validates collateral settings
        _validateRate(_creditLimitRate);
        _validateRate(_interestApr);
        _validateRate(_orgFeeRate);
        _validateRate(_liqLimitRate);
        _validateRate(_liquidationPenalty);

        require(
            collateralSettings[_token].status != CollateralStatus.Invalid,
            "invalid collateral token"
        );

        // update collateral token settings
        collateralSettings[_token].creditLimitRate = _creditLimitRate;
        collateralSettings[_token].interestApr = _interestApr;
        collateralSettings[_token].orgFeeRate = _orgFeeRate;
        collateralSettings[_token].liqLimitRate = _liqLimitRate;
        collateralSettings[_token].liquidationPenalty = _liquidationPenalty;
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
        CollateralSetting storage setting = collateralSettings[_token];
        // check if collateral is valid
        require(setting.status == CollateralStatus.Enabled, "not enabled");

        accrue(_token);

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
            setting.totalBorrows + _airUSDAmount <= setting.totalBorrowCap,
            "borrow cap reached"
        );

        // calculate AirUSD mint fee
        uint256 orgFee = (_airUSDAmount * setting.orgFeeRate.numerator) /
            setting.orgFeeRate.denominator;
        totalFeeCollected += orgFee;

        // mint AirUSD to user
        airUSD.mint(msg.sender, _airUSDAmount - orgFee);

        // update user's collateral position
        UserDebtPosition storage position = userDebtPositions[msg.sender][
            _token
        ];
        if (setting.totalDebtPortion == 0) {
            setting.totalDebtPortion = _airUSDAmount;
            position.debtPortion = _airUSDAmount;
        } else {
            uint256 plusPortion = (setting.totalDebtPortion * _airUSDAmount) /
                setting.totalDebtAmount;
            setting.totalDebtPortion += plusPortion;
            position.debtPortion += plusPortion;
        }
        position.debtPrincipal += _airUSDAmount;
        setting.totalDebtAmount += _airUSDAmount;

        // increase total borrows of the collateral market
        setting.totalBorrows += _airUSDAmount;

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
        CollateralSetting storage setting = collateralSettings[_token];

        // check if collateral is valid
        require(setting.status != CollateralStatus.Invalid, "invalid token");

        accrue(_token);

        ILendingVault vault = lendingVault[_token];

        vault.withdraw(msg.sender, _amount);

        // calculate borrow limit after withdraw in USD
        uint256 creditLimitAfterWithdraw = (_tokenUSD(
            _token,
            vault.balanceOf(msg.sender)
        ) * setting.creditLimitRate.numerator) /
            setting.creditLimitRate.denominator;
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
        CollateralSetting storage setting = collateralSettings[_token];
        // check if collateral is valid
        require(setting.status != CollateralStatus.Invalid, "invalid token");

        accrue(_token);

        require(_airUSDAmount > 0, "invalid amount");

        UserDebtPosition storage position = userDebtPositions[msg.sender][
            _token
        ];

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
            : (setting.totalDebtPortion * _airUSDAmount) /
                setting.totalDebtAmount;

        setting.totalDebtAmount -= _airUSDAmount;
        setting.totalDebtPortion -= minusPortion;
        position.debtPrincipal -= paidPrincipal;
        position.debtPortion -= minusPortion;

        if (position.debtPrincipal == 0) {
            // remove market user
            if (marketUsers[_token].contains(msg.sender)) {
                marketUsers[_token].remove(msg.sender);
            }
        }

        // decrease total borrows of the collateral market (exclude only principls)
        setting.totalBorrows -= paidPrincipal;

        emit Repay(msg.sender, _airUSDAmount);
    }

    function liquidate(address _user, address _token)
        external
        override
        nonReentrant
    {
        CollateralSetting storage setting = collateralSettings[_token];
        // check if msg.sender is chainlink keeper
        require(addressProvider.isKeeper(msg.sender), "not keeper");
        // check if collateral is valid
        require(setting.status != CollateralStatus.Invalid, "invalid token");

        accrue(_token);

        UserDebtPosition storage position = userDebtPositions[_user][_token];
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
            (debtAmount * setting.liquidationPenalty.numerator) /
            setting.liquidationPenalty.denominator;

        // collateral amount in returnUSD
        uint256 collateralAmountIn = (returnUSD * (10**setting.decimals)) /
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
        setting.totalDebtAmount -= debtAmount;
        setting.totalDebtPortion -= position.debtPortion;

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
        UserDebtPosition memory position = userDebtPositions[_user][_token];
        CollateralSetting memory setting = collateralSettings[_token];

        // this is a copy from _debtUSD but should include additional-interest calculation
        uint256 debtCalculated = setting.totalDebtPortion == 0
            ? 0
            : ((setting.totalDebtAmount +
                _calculateInterestFromLastTime(_token)) *
                userDebtPositions[_user][_token].debtPortion) /
                setting.totalDebtPortion;
        uint256 debtPrincipal = userDebtPositions[_user][_token].debtPrincipal;
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
        CollateralSetting memory setting = collateralSettings[_token];
        // this is a copy from _debtUSD but should include additional-interest calculation
        uint256 debtCalculated = setting.totalDebtPortion == 0
            ? 0
            : ((setting.totalDebtAmount +
                _calculateInterestFromLastTime(_token)) *
                userDebtPositions[_user][_token].debtPortion) /
                setting.totalDebtPortion;
        uint256 debtPrincipal = userDebtPositions[_user][_token].debtPrincipal;
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
    function _calculateInterestFromLastTime(address token)
        internal
        view
        returns (uint256)
    {
        // calculate elapsed time from last accrued at
        uint256 elapsedTime = block.timestamp -
            collateralSettings[token].totalDebtAccruedAt;

        // calculate interest based on elapsed time and interest APR
        return
            (elapsedTime *
                collateralSettings[token].totalDebtAmount *
                collateralSettings[token].interestApr.numerator) /
            collateralSettings[token].interestApr.denominator /
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
        uint256 debtCalculated = collateralSettings[_token].totalDebtPortion ==
            0
            ? 0
            : (collateralSettings[_token].totalDebtAmount *
                userDebtPositions[_user][_token].debtPortion) /
                collateralSettings[_token].totalDebtPortion;
        uint256 debtPrincipal = userDebtPositions[_user][_token].debtPrincipal;

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
