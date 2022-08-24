import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { deployContract } from "../../helper/contracts";
import {
  AirUSD,
  IBaseRewardPool,
  IBaseRewardPool__factory,
  IERC20,
  IUniswapV2Router,
  LendingAddressRegistry,
  LendingMarketV2,
  LendingVaultVelodrome,
  LendingVaultRewarder,
  LiquidationBot,
  MockChainlinkUSDAdapter,
  PriceOracleAggregator,
  StablePool,
  Swapper,
  IVelodromeGauge__factory,
} from "../../types";

const WETH_PRICE = "2000";
const VELODROME_USDC_DAI_LP_PRICE = "2000000";
const VELODROME_ROUTER = "0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9";
const UNISWAP_V2_ROUTER = "0xE6Df0BB08e5A97b40B21950a0A51b94c4DbA0Ff6";
const SETH = "0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49";
const VELODROME_USDC_DAI_LP = "0x4F7ebc19844259386DBdDB7b2eB759eeFc6F8353";
const VELODROME_USDC_DAI_GAUGE = "0xc4ff55a961bc04b880e60219ccbbdd139c6451a4";
const USDC = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
const DAI = "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1";
const USDT = "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58";
const WETH = "0x4200000000000000000000000000000000000006";
const VELO = "0x3c8B650257cFb5f272f799F5e2b4e65093a11a05";

describe("LendingMarketV2 with Velodrome", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    otherUser: SignerWithAddress,
    bot: SignerWithAddress,
    treasury: SignerWithAddress,
    staking: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let liquidationBot: LiquidationBot;
  let stablePool: StablePool;
  let lendingMarketV2: LendingMarketV2;
  let lendingVault: LendingVaultVelodrome;
  let lendingVaultRewarder: LendingVaultRewarder;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;
  let velodromeLpOracle: MockChainlinkUSDAdapter;
  let velodromeUsdcDaiLp: IERC20, usdc: IERC20, dai: IERC20, velo: IERC20;

  before(async () => {
    [deployer, user, otherUser, bot, treasury, staking] =
      await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    lendingAddressRegistry = await ethers.getContract("LendingAddressRegistry");
    liquidationBot = await ethers.getContract("LiquidationBot");
    stablePool = await ethers.getContract("StablePool");
    swapper = await ethers.getContract("Swapper");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");

    // deploy lending market v2
    const lendingMarketAddress = (
      await deployments.deploy("LendingMarketV2", {
        from: deployer.address,
        args: [],
        log: true,
        proxy: {
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            methodName: "initialize",
            args: [
              lendingAddressRegistry.address,
              airUSD.address,
              {
                interestApr: {
                  numerator: "10",
                  denominator: "1000",
                }, // 1% interest APR
                orgFeeRate: {
                  numerator: "3",
                  denominator: "1000",
                }, // 0.3% org fee rate
                liquidationPenalty: {
                  numerator: "50",
                  denominator: "1000",
                }, // 5% liquidation penalty
              },
            ],
          },
        },
      })
    ).address;
    lendingMarketV2 = await ethers.getContractAt(
      "LendingMarketV2",
      lendingMarketAddress
    );

    const LendingVaultRewarder = await ethers.getContractFactory(
      "LendingVaultRewarder"
    );
    lendingVaultRewarder = <LendingVaultRewarder>(
      await LendingVaultRewarder.deploy()
    );
    lendingVaultRewarder.deployed();

    // deploy lending vault
    const lendingVaultAddress = (
      await deployments.deploy("LendingVaultVelodrome", {
        from: deployer.address,
        args: [],
        log: true,
        proxy: {
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            methodName: "initialize",
            args: [
              lendingAddressRegistry.address,
              VELODROME_USDC_DAI_LP,
              VELODROME_USDC_DAI_GAUGE,
              lendingVaultRewarder.address,
            ],
          },
        },
      })
    ).address;

    lendingVault = await ethers.getContractAt(
      "LendingVaultVelodrome",
      lendingVaultAddress
    );

    await lendingVaultRewarder.initialize(lendingVault.address);
    await lendingVaultRewarder.addRewardToken(USDC);
    await lendingVaultRewarder.addRewardToken(DAI);
    await lendingVaultRewarder.addRewardToken(VELO);

    // set treasury and staking address
    await lendingAddressRegistry.setTreasury(treasury.address);
    await lendingAddressRegistry.setStaking(staking.address);
    await lendingAddressRegistry.setLendingMarket(lendingMarketV2.address);

    // set keeper for liquidation bot
    await lendingAddressRegistry.addKeeper(liquidationBot.address);

    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("1000000"));

    // grant MINTER_ROLE to lending market
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), lendingMarketV2.address);

    velodromeUsdcDaiLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/external/IERC20.sol:IERC20",
        VELODROME_USDC_DAI_LP
      )
    );
    usdc = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", USDC)
    );
    dai = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", DAI)
    );
    velo = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", VELO)
    );

    // velodrome lp swapper impl
    const VelodromeLPSwapper = await ethers.getContractFactory(
      "VelodromeLPSwapper"
    );
    const velodromeLPSwapper = await VelodromeLPSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      VELODROME_USDC_DAI_LP,
      airUSD.address
    );
    await velodromeLPSwapper.deployed();
    await swapper.addSwapperImpl(
      VELODROME_USDC_DAI_LP, // tokenIn
      airUSD.address, // tokenOut
      velodromeLPSwapper.address // airUSD swap impl
    );

    // usdc swapper impl
    const UniswapV2Swapper = await ethers.getContractFactory(
      "UniswapV2Swapper"
    );
    const usdcSwapperImpl = await UniswapV2Swapper.deploy(
      swapper.address,
      UNISWAP_V2_ROUTER,
      USDC,
      airUSD.address,
      [USDC, WETH, airUSD.address]
    );
    await usdcSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      USDC, // tokenIn
      airUSD.address, // tokenOut
      usdcSwapperImpl.address // airUSD swap impl
    );

    // dai swapper impl
    const daiSwapperImpl = await UniswapV2Swapper.deploy(
      swapper.address,
      UNISWAP_V2_ROUTER,
      DAI,
      airUSD.address,
      [DAI, WETH, airUSD.address]
    );
    await daiSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      DAI, // tokenIn
      airUSD.address, // tokenOut
      daiSwapperImpl.address // airUSD swap impl
    );

    // velo swapper impl
    const VelodromeSwapper = await ethers.getContractFactory(
      "VelodromeSwapper"
    );
    const veloSwapperImpl = await VelodromeSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      VELO,
      airUSD.address,
      [
        {
          from: VELO,
          to: USDC,
          stable: false,
        },
      ]
    );
    await veloSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      VELO, // tokenIn
      airUSD.address, // tokenOut
      veloSwapperImpl.address // airUSD swap impl
    );

    // set price aggregators
    velodromeLpOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(VELODROME_USDC_DAI_LP_PRICE, 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(
      VELODROME_USDC_DAI_LP,
      velodromeLpOracle.address
    );

    const daiOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits("1", 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(DAI, daiOracle.address);

    const usdcOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits("1", 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(USDC, usdcOracle.address);

    const usdtOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits("1", 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(USDT, usdtOracle.address);

    // prepare 10 velodromeUsdcDaiLp
    const whale = "0x9eE6f42531aDaC0bD443756F0120c6aEed354115";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await velodromeUsdcDaiLp
      .connect(whaleSigner)
      .transfer(user.address, parseUnits("0.0001"));

    // add collateral support on lending market
    await lendingMarketV2.enableCollateralToken(
      VELODROME_USDC_DAI_LP,
      lendingVault.address,
      {
        numerator: 70,
        denominator: 100,
      }, // 70%
      {
        numerator: 75,
        denominator: 100,
      }, // 75%
      parseUnits(VELODROME_USDC_DAI_LP_PRICE).div(30000)
    );

    // set slippage limit high
    await swapper.updateSlippageLimit(ethers.utils.parseUnits("50", 16));
  });

  let snapId: string;
  beforeEach(async () => {
    snapId = (await network.provider.request({
      method: "evm_snapshot",
      params: [],
    })) as string;
    await ethers.provider.send("evm_mine", []);
  });

  afterEach(async () => {
    await network.provider.request({
      method: "evm_revert",
      params: [snapId],
    });
    await ethers.provider.send("evm_mine", []);
  });

  describe("setAddressProvider", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingMarketV2
          .connect(user)
          .setAddressProvider(lendingAddressRegistry.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingMarketV2.setAddressProvider(lendingAddressRegistry.address);
      expect(await lendingMarketV2.addressProvider()).to.equal(
        lendingAddressRegistry.address
      );
    });
  });

  describe("enableCollateralToken", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingMarketV2.connect(user).enableCollateralToken(
          SETH,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          parseUnits("2000")
        )
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Revert: invalid credit limit rate", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          SETH,
          lendingVault.address,
          {
            numerator: 101,
            denominator: 100,
          }, // 70%
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          parseUnits("2000")
        )
      ).to.revertedWith("invalid rate");
    });

    it("Revert: invalid liquidation limit rate", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          SETH,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: 101,
            denominator: 100,
          }, // 75%
          parseUnits("2000")
        )
      ).to.revertedWith("invalid rate");
    });

    it("Revert: already enabled collateral token", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          VELODROME_USDC_DAI_LP,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          parseUnits("2000")
        )
      ).to.revertedWith("already enabled collateral token");
    });

    it("Success", async () => {
      await lendingMarketV2.enableCollateralToken(
        SETH,
        lendingVault.address,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        parseUnits("2000")
      );

      const setting = await lendingMarketV2.collateralSettings(SETH);
      expect(setting.status).to.equal(1);
      expect(setting.creditLimitRate.numerator).to.equal(70);
      expect(setting.creditLimitRate.denominator).to.equal(100);
      expect(setting.decimals).to.equal(18);
      expect(setting.totalBorrowCap).to.equal(parseUnits("2000"));
    });
  });

  describe("disableCollateralToken", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingMarketV2.connect(user).disableCollateralToken(SETH)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Revert: not enabled collateral token", async () => {
      await expect(
        lendingMarketV2.disableCollateralToken(SETH)
      ).to.revertedWith("not enabled collateral token");
    });

    it("Success", async () => {
      await lendingMarketV2.enableCollateralToken(
        SETH,
        lendingVault.address,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        parseUnits("2000")
      );

      expect((await lendingMarketV2.allCollateralTokens()).length).to.equal(2);

      await lendingMarketV2.disableCollateralToken(SETH);

      const setting = await lendingMarketV2.collateralSettings(SETH);
      expect(setting.status).to.equal(2);
      expect(setting.creditLimitRate.numerator).to.equal(70);
      expect(setting.creditLimitRate.denominator).to.equal(100);
      expect(setting.decimals).to.equal(18);
      expect(setting.totalBorrowCap).to.equal(parseUnits("2000"));
    });
  });

  describe("deposit", () => {
    it("Revert: not enabled", async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await expect(
        lendingMarketV2
          .connect(user)
          .deposit(SETH, parseUnits("1"), user.address)
      ).to.revertedWith("not enabled");
    });

    it("Success", async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);

      const position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.amount).to.equal(parseUnits("0.00001"));
      expect(position.amountUSD).to.equal(
        parseUnits("0.00001").mul(VELODROME_USDC_DAI_LP_PRICE)
      );
    });
  });

  describe("borrow", () => {
    beforeEach(async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);
    });

    it("Revert: not enabled", async () => {
      await expect(
        lendingMarketV2.connect(user).borrow(SETH, 0)
      ).to.revertedWith("not enabled");
    });

    it("Revert: insufficient collateral", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2
          .connect(user)
          .borrow(VELODROME_USDC_DAI_LP, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("Revert: borrow cap reached", async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00005"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00005"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2
          .connect(user)
          .borrow(VELODROME_USDC_DAI_LP, borrowAmount)
      ).to.revertedWith("borrow cap reached");
    });

    it("Success: borrow once", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);

      position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("Success: borrow twice", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);

      position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.debtPrincipal).to.equal(borrowAmount.mul(2));
      expect(position.liquidatable).to.equal(false);
    });
  });

  describe("repay", () => {
    let borrowAmount: BigNumber;

    beforeEach(async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      borrowAmount = position.creditLimitUSD;
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);

      await airUSD
        .connect(user)
        .approve(lendingMarketV2.address, borrowAmount.div(2));
    });

    it("Revert: invalid token", async () => {
      await expect(
        lendingMarketV2.connect(user).repay(SETH, borrowAmount.div(2))
      ).to.revertedWith("invalid token");
    });

    it("Revert: invalid amount", async () => {
      await expect(
        lendingMarketV2.connect(user).repay(VELODROME_USDC_DAI_LP, 0)
      ).to.revertedWith("invalid amount");
    });

    it("Success", async () => {
      await lendingMarketV2
        .connect(user)
        .repay(VELODROME_USDC_DAI_LP, borrowAmount.div(2));

      const position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);
    });

    it("Revert: invalid token", async () => {
      await expect(
        lendingMarketV2.connect(user).withdraw(SETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
    });

    it("Revert: insufficient collateral", async () => {
      await expect(
        lendingMarketV2
          .connect(user)
          .withdraw(VELODROME_USDC_DAI_LP, parseUnits("0.000011"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarketV2
          .connect(user)
          .withdraw(VELODROME_USDC_DAI_LP, parseUnits("0.0000075"))
      ).to.revertedWith("insufficient collateral");
    });

    it("Success", async () => {
      await lendingMarketV2
        .connect(user)
        .withdraw(VELODROME_USDC_DAI_LP, parseUnits("0.000005"));

      const position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.amount).to.equal(parseUnits("0.000005"));
    });
  });

  describe("liquidate", () => {
    beforeEach(async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);
    });

    it("Revert: not keeper", async () => {
      await expect(
        lendingMarketV2.liquidate(user.address, VELODROME_USDC_DAI_LP)
      ).to.revertedWith("not keeper");
    });

    it("Revert: invalid token", async () => {
      await lendingAddressRegistry.addKeeper(deployer.address);

      await expect(
        lendingMarketV2.liquidate(user.address, SETH)
      ).to.revertedWith("invalid token");
    });

    it("Revert: not liquidatable", async () => {
      await lendingAddressRegistry.addKeeper(deployer.address);

      await expect(
        lendingMarketV2.liquidate(user.address, VELODROME_USDC_DAI_LP)
      ).to.revertedWith("not liquidatable");
    });

    it("Success", async () => {
      // velodromeUsdcDaiLp/airUSD add_liquidity on uniswap v2
      const uniswapV2Router = <IUniswapV2Router>(
        await ethers.getContractAt("IUniswapV2Router", UNISWAP_V2_ROUTER)
      );
      await airUSD.approve(uniswapV2Router.address, parseUnits("1000000"));
      await uniswapV2Router.addLiquidityETH(
        airUSD.address,
        parseUnits("1000000"),
        parseUnits("1000000"),
        parseUnits("1000000").div(WETH_PRICE),
        deployer.address,
        ethers.constants.MaxUint256,
        {
          value: parseUnits("1000000").div(WETH_PRICE),
        }
      );

      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [velodromeUsdcDaiLp.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.false;

      // 10% velodromeUsdcDaiLp price dump
      await velodromeLpOracle.setViewPriceInUSD(
        parseUnits(VELODROME_USDC_DAI_LP_PRICE, 8).mul(90).div(100)
      );

      expect(
        await lendingMarketV2.liquidatable(user.address, VELODROME_USDC_DAI_LP)
      ).to.be.true;

      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [velodromeUsdcDaiLp.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.true;

      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await liquidationBot.connect(bot).performUpkeep(result.performData);

      const position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );
      expect(position.amount).to.equal(0);

      // take fees into stable pool
      expect(await airUSD.balanceOf(stablePool.address)).gt(
        stablePoolBalanceBefore
      );

      // take fees into treasury and staking address
      expect(await airUSD.balanceOf(treasury.address)).gt(0);
      expect(await airUSD.balanceOf(staking.address)).gt(0);
    });
  });

  describe("collectOrgFee", () => {
    beforeEach(async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("0.00001"));
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        VELODROME_USDC_DAI_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2
        .connect(user)
        .borrow(VELODROME_USDC_DAI_LP, borrowAmount);
    });

    it("Success", async () => {
      await lendingMarketV2.collectOrgFee();
    });
  });

  describe("claim", () => {
    beforeEach(async () => {
      await velodromeUsdcDaiLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("10"));
    });

    it("success", async () => {
      await lendingMarketV2
        .connect(user)
        .deposit(VELODROME_USDC_DAI_LP, parseUnits("0.00001"), user.address);
      await lendingMarketV2
        .connect(user)
        .deposit(
          VELODROME_USDC_DAI_LP,
          parseUnits("0.00001"),
          otherUser.address
        );

      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]); // 24 hour
      await ethers.provider.send("evm_mine", []);

      const gauge = IVelodromeGauge__factory.connect(
        VELODROME_USDC_DAI_GAUGE,
        user
      );
      expect(await gauge.earned(VELO, lendingVault.address)).to.gt(0);

      await lendingVault.claim(user.address);
      await lendingVault.claim(otherUser.address);

      expect(await velo.balanceOf(user.address)).to.closeTo(
        await velo.balanceOf(otherUser.address),
        (await velo.balanceOf(otherUser.address)).div(100) as any
      ); // 1% diff
    });
  });
});
