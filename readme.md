# Aira Protocol smart contracts

## LendingAddressRegistry

This is a registry contract for Aira protocol.

- Ownable
- Owner can update addresses for `LendingMarket`, `PriceOracleAggregator`, `Treasury`, `Staking`, `StablePool` and `Swapper` contracts.
- Owner can update keeper addresses.
  ```
  function addKeeper(address keeper) external;
  ```
- Anyone can query addresses for `LendingMarket`, `PriceOracleAggregator`, `Treasury`, `Staking`, `StablePool`, `Swapper` and `Keepers`.

## Aira

This is a ERC20 standard contract which represents the Aira Governance token.

- ERC20 + Ownable
- Max Supply: 1B
- Token mint by the owner

## AirUSD

This is a ERC20 standard contract which represents the Aira stable token.
This token is used as the debt token in Lending Market.

- ERC20 + AccessControlEnumerable
- Token mint by `MINTER_ROLE`. (LendingMarket and StablePool has MINTER_ROLE.)

## StablePool

This is a which users can deposit AirUSD and earn yields in AirUSD from Lending Market fees.

- Ownable
- Owner can set LendingAddressRegistry contract address. (LendingAddressRegistry is used to check if msg.sender is liquidation keeper bot)
- Users can deposit AirUSD using following functions
  ```
  function deposit(uint256 _airUSDAmount) external;
  function depositFor(uint256 _airUSDAmount, address _onBehalf) external;
  ```
- Users can withdraw AirUSD using following functions
  ```
  function withdraw(uint256 _shares) external;
  function withdrawTo(uint256 _shares, address _onBehalf) external;
  ```
- Users can get their shares of stable pool
  ```
  function balanceOf(address user) external view returns(uint256);
  ```
- Users can calculate their AirUSD amount from shares
  ```
  function amountFromShares(uint256 shares) external view returns(uint256 airUSDAmount);
  ```
- Liquidation keeper bots can use `prepare` function to flashloan AirUSD.
  If StablePool doesn't have enogh AirUSD, it tries to mint AirUSD and burn after repayment.
  ```
  function prepare(uint256 _airUSDAmount, bytes calldata _data) external;
  ```
  This `prepare` function will call `onPrepare(uint256 _airUSDAmount, bytes calldata _data)` of msg.sender as a hook function.
  The caller should fully return back the flashloan amount.

## PriceOracleAggregator

This is a oracle aggregator contract which integrates several sub oracle contracts.

- Ownable
- Owner can update oracle for each asset
  ```
  function updateOracleForAsset(address _asset, address _oracle) external;
  ```
- Anyone can query USD price of an asset
  ```
  function viewPriceInUSD(address _asset) external view returns(uint256 priceInUSD);
  ```

The oracle contract for each asset should have `function viewPriceInUSD() external view returns(uint256 priceInUSD)` interface

### ChainlinkUSDAdapter

If an asset has chainlink oracle price feed, we can use this contract to register oracle to PriceOracleAggregator.

- constructor(address _asset, address _aggregator, address _baseAsset, address _priceOracleAggregator)
  _asset: the asset you want to get price in USD
  _aggregator: chainlink price feed address
  _baseAsset: the base asset of chainlink price feed. (e.g. stETH/ETH chainlink price feed's base asset is ETH)
  _priceOracleAggregator: PriceOracleAggretator address - this is used to get base asset price in USD. (asset_price_in_usd = asset_price_in_base_asset * base_asset_price_in_usd)
- Anyone can get asset price in USD
  ```
  function viewPriceInUSD() external view returns (uint256);
  ```

### UniswapV2LPOracle

If an asset is uniswap v2 lp asset, we can use this contract to register oracle to PriceOracleAggregator.

- constructor(address _pair, address _priceOracleAggregator)
  _pair: uniswap v2 lp asset address
  _priceOracleAggregator: PriceOracleAggretator address - this is used to get both token0 and token1 price in USD.
- Anyone can get asset price in USD
  ```
  function viewPriceInUSD() external view returns (uint256);
  ```

## Swapper

This is a swapper contract which users can swap assets via swapper implementation contracts.

- Ownable
- Owner can register swapper implementation for token pair
  ```
  function addSwapperImpl(address _tokenIn, address _tokenOut, address _swapperImpl) external;
  ```
  Here all swapper implementation contracts should have following interface.
  ```
  function swap(uint256 amountIn, address _to);
  ```
- Anyone can swap tokens
  ```
  function swap(address _tokenIn, address _tokenOut, uint256 _amountIn, address _to) external returns (uint256 amountOut);
  ```

Each swapper implementation contract should implement `swap` function interface.

### UniswapV2Swapper

If you are going to use uniswap v2 path, you can use this contract and register to Swapper contract.

- constructor(address _uniswapV2Router, address _tokenIn, address _tokenOut, address[] memory _path);
  _uniswapV2Router: uniswap v2 router address
  _tokenIn: input token address
  _tokenOut: output token address
  _path: uniswap v2 swap path

  After this contract deployed, should add it to Swapper contract.
  ```
  swapper.addSwapperImpl(_tokenIn, _tokenOut, _swapperImpl);
  ```
- Anyone can swap tokens
  ```
  function swap(uint256 _amountIn, address _to);
  ```
  _amountIn: tokenIn amount
  _to: the address which will receive swapped tokenOut

### StethSwapper

This is a swapper implementation contract which swap stETH to airUSD.
- It swapps stETH to ETH via Curve Finance.
- It swapps ETH to airUSD via Uniswap V2.

### EthUsdtLPSwapper

This is a swapper implementation contract which swap ETH/USDT lp to airUSD.
- It withdraws liquidity from ETH/USDT Uniswap v2 pool.
- It swapps ETH to airUSD via Uniswap V2.

## LiquidationBot

This is a chainlink keeper compatible contract which monitors user's health positions.

To liquidate the user position, it flashloan AirUSD from StablePool and call `liquidate` function of LendingMarket.

## LendingMarket

This is a lending market contract.
It supports several collateral tokens, but all user positions are isolated per each collateral token.

- Ownable
- Owner can add or remove collateral tokens
  For each collateral tokens, owner needs to set `creditLimitRate`, `liqLimitRate` and `totalBorrowCap`.
  creditLimitRate: The borrow limit rate. (e.g. 70% means users can borrow 70% of his collateral value.)
  liqLimitRate: The liquidation limit rate. (e.g. 80% means user's position is liquidated once his debt is more than 80% of collateral value.)
  totalBorrowCap: The mintable airUSD cap. (e.g. 1M means total borrowed airUSD can't be higher than 1M.)
- Owner can collect fees from lending market.
  ```
  function collectOrgFee() external;
  ```
  80% of the fee is transfered to staking.
  20% of the fee is transfered to treasury.
- Users can deposit collaterals
  ```
  function deposit(address _token, uint256 _amount, address _onBehalfOf) external;
  ```
- Users can withdraw collaterals
  ```
  function withdraw(address _token, uint256 _amount) external;
  ```
  Lending market checks if user's position is healthy after collateral withdraws.
- Users can borrow airUSD based on their collateral value
  ```
  function borrow(address _token, uint256 _airUSDAmount) external;
  ```
  Lending market will take organization fees from the debt.
  Also user's debt amount is increased at a interest rate.
  These fees are collected at `collectOrgFee()` function.
- Users can repay airUSD.
  ```
  function repay(address _token, uint256 _airUSDAmount) external;
  ```
  Users can repay their debt and increase their health factor.
- Liquidation bot liquidates a users position if its collateral value hits a certain level.
  ```
  function liquidate(address _user, address _token) external;
  ```
  Only liquidation keeper bots can call this function.
  50% of liquidation penalty goes to StablePool.
  10% of liquidation penalty goes to Treasury.
  40% of liquidation penalty goes to Staking.
  The remaining collateral after liquidation goes back to the user.
- Users can view details of a user position
  ```
  function positionView(address _user, address _token) external view returns(PositionView memory);
  ```
  PositionView.owner: user address
  PositionView.token: collateral token address
  PositionView.amount: collateral token amount
  PositionView.amountUSD: collateral token amount in USD
  PositionView.creditLimitUSD: the borrowable airUSD amount using his collateral
  PositionView.debtPrincipal: user's airUSD mint amount.
  PositionView.debtInterest: user's debt interest (increased by time)
  PositionView.liquidatable: boolean if user's position is liquidatable or not
