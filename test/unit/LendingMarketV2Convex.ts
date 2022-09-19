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
  LendingVaultConvex,
  LendingVaultRewarder,
  LiquidationBot,
  MockChainlinkUSDAdapter,
  PriceOracleAggregator,
  StablePool,
  Swapper,
} from "../../types";

const WETH_PRICE = "2000";
const CURVE_MIM_LP_PRICE = "1";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_V2_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const CURVE_MIM_LP = "0x5a6A4D54456819380173272A5E8E9B9904BdF41B";
const CONVEX_MIM_POOL_ID = "40";
const CONVEX_MIM_REWARDS = "0xFd5AbF66b003881b88567EB9Ed9c651F14Dc4771";
const CURVE_3POOL_LP = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490";
const CURVE_3POOL_LP_MINTER = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const MIM = "0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const CURVE = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const CONVEX = "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B";

describe("LendingMarketV2 with Convex", () => {
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
  let lendingVault: LendingVaultConvex;
  let lendingVaultRewarder: LendingVaultRewarder;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;
  let curveMimOracle: MockChainlinkUSDAdapter;
  let mimLp: IERC20, curve: IERC20, convex: IERC20;

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
            args: [lendingAddressRegistry.address, airUSD.address],
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
      await deployments.deploy("LendingVaultConvex", {
        from: deployer.address,
        args: [],
        log: true,
        proxy: {
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            methodName: "initialize",
            args: [
              lendingAddressRegistry.address,
              CURVE_MIM_LP,
              CONVEX_MIM_POOL_ID,
              CONVEX_MIM_REWARDS,
              lendingVaultRewarder.address,
            ],
          },
        },
      })
    ).address;

    lendingVault = await ethers.getContractAt(
      "LendingVaultConvex",
      lendingVaultAddress
    );

    await lendingVaultRewarder.initialize(lendingVault.address);
    await lendingVaultRewarder.addRewardToken(CURVE);
    await lendingVaultRewarder.addRewardToken(CONVEX);

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

    mimLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/external/IERC20.sol:IERC20",
        CURVE_MIM_LP
      )
    );
    curve = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", CURVE)
    );
    convex = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", CONVEX)
    );

    // curve mim lp swapper impl
    const CurveLPSwapperV1 = await ethers.getContractFactory(
      "CurveLPSwapperV1"
    );
    const curveMimLPSwapperImpl = await CurveLPSwapperV1.deploy(
      swapper.address,
      CURVE_MIM_LP,
      airUSD.address,
      CURVE_MIM_LP,
      2
    );
    await curveMimLPSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      CURVE_MIM_LP, // tokenIn
      airUSD.address, // tokenOut
      curveMimLPSwapperImpl.address // airUSD swap impl
    );

    // curve 3pool lp swapper impl
    const curve3poolLPSwapperImpl = await CurveLPSwapperV1.deploy(
      swapper.address,
      CURVE_3POOL_LP,
      airUSD.address,
      CURVE_3POOL_LP_MINTER,
      3
    );
    await curve3poolLPSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      CURVE_3POOL_LP, // tokenIn
      airUSD.address, // tokenOut
      curve3poolLPSwapperImpl.address // airUSD swap impl
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

    // usdt swapper impl
    const usdtSwapperImpl = await UniswapV2Swapper.deploy(
      swapper.address,
      UNISWAP_V2_ROUTER,
      USDT,
      airUSD.address,
      [USDT, WETH, airUSD.address]
    );
    await usdtSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      USDT, // tokenIn
      airUSD.address, // tokenOut
      usdtSwapperImpl.address // airUSD swap impl
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

    // mim swapper impl
    const mimSwapperImpl = await UniswapV2Swapper.deploy(
      swapper.address,
      SUSHISWAP_V2_ROUTER,
      MIM,
      airUSD.address,
      [MIM, WETH]
    );
    await mimSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      MIM, // tokenIn
      airUSD.address, // tokenOut
      mimSwapperImpl.address // airUSD swap impl
    );

    // weth swapper impl
    const wethSwapperImpl = await UniswapV2Swapper.deploy(
      swapper.address,
      UNISWAP_V2_ROUTER,
      WETH,
      airUSD.address,
      [WETH, airUSD.address]
    );
    await wethSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      WETH, // tokenIn
      airUSD.address, // tokenOut
      wethSwapperImpl.address // airUSD swap impl
    );

    // set price aggregators
    curveMimOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(CURVE_MIM_LP_PRICE, 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(
      CURVE_MIM_LP,
      curveMimOracle.address
    );

    const curve3PoolOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits("1", 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(
      CURVE_3POOL_LP,
      curve3PoolOracle.address
    );

    const wethPoolOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(WETH_PRICE, 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(
      WETH,
      wethPoolOracle.address
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

    const mimOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits("1", 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(MIM, mimOracle.address);

    // prepare 10 mimLp
    const whale = "0xcA436e14855323927d6e6264470DeD36455fC8bD";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await mimLp.connect(whaleSigner).transfer(user.address, parseUnits("10"));

    // add collateral support on lending market
    await lendingMarketV2.enableCollateralToken(
      CURVE_MIM_LP,
      lendingVault.address,
      {
        numerator: 70,
        denominator: 100,
      }, // 70%
      {
        numerator: "10",
        denominator: "1000",
      }, // 1% interest APR
      {
        numerator: "3",
        denominator: "1000",
      }, // 0.3% org fee rate
      {
        numerator: 75,
        denominator: 100,
      }, // 75%
      {
        numerator: "50",
        denominator: "1000",
      }, // 5% liquidation penalty
      parseUnits(CURVE_MIM_LP_PRICE)
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
          STETH,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: "10",
            denominator: "1000",
          }, // 1% interest APR
          {
            numerator: "3",
            denominator: "1000",
          }, // 0.3% org fee rate
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          {
            numerator: "50",
            denominator: "1000",
          }, // 5% liquidation penalty
          parseUnits("2000")
        )
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Revert: invalid credit limit rate", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          STETH,
          lendingVault.address,
          {
            numerator: 101,
            denominator: 100,
          }, // 70%
          {
            numerator: "10",
            denominator: "1000",
          }, // 1% interest APR
          {
            numerator: "3",
            denominator: "1000",
          }, // 0.3% org fee rate
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          {
            numerator: "50",
            denominator: "1000",
          }, // 5% liquidation penalty
          parseUnits("2000")
        )
      ).to.revertedWith("invalid rate");
    });

    it("Revert: invalid liquidation limit rate", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          STETH,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: "10",
            denominator: "1000",
          }, // 1% interest APR
          {
            numerator: "3",
            denominator: "1000",
          }, // 0.3% org fee rate
          {
            numerator: 101,
            denominator: 100,
          }, // 75%
          {
            numerator: "50",
            denominator: "1000",
          }, // 5% liquidation penalty
          parseUnits("2000")
        )
      ).to.revertedWith("invalid rate");
    });

    it("Revert: already enabled collateral token", async () => {
      await expect(
        lendingMarketV2.enableCollateralToken(
          CURVE_MIM_LP,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: "10",
            denominator: "1000",
          }, // 1% interest APR
          {
            numerator: "3",
            denominator: "1000",
          }, // 0.3% org fee rate
          {
            numerator: 75,
            denominator: 100,
          }, // 75%
          {
            numerator: "50",
            denominator: "1000",
          }, // 5% liquidation penalty
          parseUnits("2000")
        )
      ).to.revertedWith("already enabled collateral token");
    });

    it("Success", async () => {
      await lendingMarketV2.enableCollateralToken(
        STETH,
        lendingVault.address,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: "10",
          denominator: "1000",
        }, // 1% interest APR
        {
          numerator: "3",
          denominator: "1000",
        }, // 0.3% org fee rate
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        {
          numerator: "50",
          denominator: "1000",
        }, // 5% liquidation penalty
        parseUnits("2000")
      );

      const setting = await lendingMarketV2.collateralSettings(STETH);
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
        lendingMarketV2.connect(user).disableCollateralToken(STETH)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Revert: not enabled collateral token", async () => {
      await expect(
        lendingMarketV2.disableCollateralToken(STETH)
      ).to.revertedWith("not enabled collateral token");
    });

    it("Success", async () => {
      await lendingMarketV2.enableCollateralToken(
        STETH,
        lendingVault.address,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: "10",
          denominator: "1000",
        }, // 1% interest APR
        {
          numerator: "3",
          denominator: "1000",
        }, // 0.3% org fee rate
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        {
          numerator: "50",
          denominator: "1000",
        }, // 5% liquidation penalty
        parseUnits("2000")
      );

      expect((await lendingMarketV2.allCollateralTokens()).length).to.equal(2);

      await lendingMarketV2.disableCollateralToken(STETH);

      const setting = await lendingMarketV2.collateralSettings(STETH);
      expect(setting.status).to.equal(2);
      expect(setting.creditLimitRate.numerator).to.equal(70);
      expect(setting.creditLimitRate.denominator).to.equal(100);
      expect(setting.decimals).to.equal(18);
      expect(setting.totalBorrowCap).to.equal(parseUnits("2000"));
    });
  });

  describe("deposit", () => {
    it("Revert: not enabled", async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await expect(
        lendingMarketV2
          .connect(user)
          .deposit(STETH, parseUnits("1"), user.address)
      ).to.revertedWith("not enabled");
    });

    it("Success", async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);

      const position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );
      expect(position.amount).to.equal(parseUnits("1"));
      expect(position.amountUSD).to.equal(
        parseUnits("1").mul(CURVE_MIM_LP_PRICE)
      );
    });
  });

  describe("borrow", () => {
    beforeEach(async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);
    });

    it("Revert: not enabled", async () => {
      await expect(
        lendingMarketV2.connect(user).borrow(STETH, 0)
      ).to.revertedWith("not enabled");
    });

    it("Revert: insufficient collateral", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("Revert: borrow cap reached", async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("3"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("3"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount)
      ).to.revertedWith("borrow cap reached");
    });

    it("Success: borrow once", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);

      position = await lendingMarketV2.positionView(user.address, CURVE_MIM_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("Success: borrow twice", async () => {
      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);

      position = await lendingMarketV2.positionView(user.address, CURVE_MIM_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount.mul(2));
      expect(position.liquidatable).to.equal(false);
    });
  });

  describe("repay", () => {
    let borrowAmount: BigNumber;

    beforeEach(async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);

      await airUSD
        .connect(user)
        .approve(lendingMarketV2.address, borrowAmount.div(2));
    });

    it("Revert: invalid token", async () => {
      await expect(
        lendingMarketV2.connect(user).repay(STETH, borrowAmount.div(2))
      ).to.revertedWith("invalid token");
    });

    it("Revert: invalid amount", async () => {
      await expect(
        lendingMarketV2.connect(user).repay(CURVE_MIM_LP, 0)
      ).to.revertedWith("invalid amount");
    });

    it("Success", async () => {
      await lendingMarketV2
        .connect(user)
        .repay(CURVE_MIM_LP, borrowAmount.div(2));

      const position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);
    });

    it("Revert: invalid token", async () => {
      await expect(
        lendingMarketV2.connect(user).withdraw(STETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
    });

    it("Revert: insufficient collateral", async () => {
      await expect(
        lendingMarketV2.connect(user).withdraw(CURVE_MIM_LP, parseUnits("1.1"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarketV2.connect(user).withdraw(CURVE_MIM_LP, parseUnits("0.75"))
      ).to.revertedWith("insufficient collateral");
    });

    it("Success", async () => {
      await lendingMarketV2
        .connect(user)
        .withdraw(CURVE_MIM_LP, parseUnits("0.5"));

      const position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );
      expect(position.amount).to.equal(parseUnits("0.5"));
    });
  });

  describe("liquidate", () => {
    beforeEach(async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);
    });

    it("Revert: not keeper", async () => {
      await expect(
        lendingMarketV2.liquidate(user.address, CURVE_MIM_LP)
      ).to.revertedWith("not keeper");
    });

    it("Revert: invalid token", async () => {
      await lendingAddressRegistry.addKeeper(deployer.address);

      await expect(
        lendingMarketV2.liquidate(user.address, STETH)
      ).to.revertedWith("invalid token");
    });

    it("Revert: not liquidatable", async () => {
      await lendingAddressRegistry.addKeeper(deployer.address);

      await expect(
        lendingMarketV2.liquidate(user.address, CURVE_MIM_LP)
      ).to.revertedWith("not liquidatable");
    });

    it("Success", async () => {
      // mimLp/airUSD add_liquidity on uniswap v2
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
          [mimLp.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.false;

      // 10% mimLp price dump
      await curveMimOracle.setViewPriceInUSD(
        parseUnits(CURVE_MIM_LP_PRICE, 8).mul(90).div(100)
      );

      expect(await lendingMarketV2.liquidatable(user.address, CURVE_MIM_LP)).to
        .be.true;

      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [mimLp.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.true;

      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await liquidationBot.connect(bot).performUpkeep(result.performData);

      const position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
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

      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(
        user.address,
        CURVE_MIM_LP
      );

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(CURVE_MIM_LP, borrowAmount);
    });

    it("Success", async () => {
      await lendingMarketV2.collectOrgFee();
    });
  });

  describe("claim", () => {
    beforeEach(async () => {
      await mimLp
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("10"));
    });

    it("success", async () => {
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), user.address);
      await lendingMarketV2
        .connect(user)
        .deposit(CURVE_MIM_LP, parseUnits("1"), otherUser.address);

      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]); // 24 hour
      await ethers.provider.send("evm_mine", []);

      const convexRewards = IBaseRewardPool__factory.connect(
        CONVEX_MIM_REWARDS,
        user
      );
      expect(await convexRewards.earned(lendingVault.address)).to.gt(0);

      await lendingVault.claim(user.address);
      await lendingVault.claim(otherUser.address);

      expect(await curve.balanceOf(user.address)).to.closeTo(
        await curve.balanceOf(otherUser.address),
        (await curve.balanceOf(otherUser.address)).div(100) as any
      ); // 1% diff
      expect(await convex.balanceOf(user.address)).to.closeTo(
        await convex.balanceOf(otherUser.address),
        (await convex.balanceOf(otherUser.address)).div(100) as any
      ); // 1% diff
    });
  });
});
