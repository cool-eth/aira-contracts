import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import {
  deployContract,
  deployEthUsdtLPSwapper,
  deployStethAirUSDSwapper,
  deployUniswapV2Swapper,
} from "../../helper/contracts";
import {
  AirUSD,
  IERC20,
  IUniswapV2Router,
  LendingAddressRegistry,
  LendingMarketV2,
  LendingVaultERC20,
  LiquidationBot,
  MockChainlinkUSDAdapter,
  PriceOracleAggregator,
  StablePool,
  Swapper,
} from "../../types";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const ETH_USDT_LP = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
const WETH_PRICE = "2000";

describe("LendingMarketV2", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    bot: SignerWithAddress,
    treasury: SignerWithAddress,
    staking: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let liquidationBot: LiquidationBot;
  let stablePool: StablePool;
  let lendingMarketV2: LendingMarketV2;
  let lendingVault: LendingVaultERC20;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;
  let wethOracle: MockChainlinkUSDAdapter;
  let weth: IERC20;

  before(async () => {
    [deployer, user, bot, treasury, staking] = await ethers.getSigners();

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

    // deploy lending vault
    const lendingVaultAddress = (
      await deployments.deploy("LendingVaultERC20", {
        from: deployer.address,
        args: [],
        log: true,
        proxy: {
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            methodName: "initialize",
            args: [lendingAddressRegistry.address, WETH],
          },
        },
      })
    ).address;

    lendingVault = await ethers.getContractAt(
      "LendingVaultERC20",
      lendingVaultAddress
    );

    // set treasury and staking address
    await lendingAddressRegistry.setTreasury(treasury.address);
    await lendingAddressRegistry.setStaking(staking.address);
    await lendingAddressRegistry.setLendingMarket(lendingMarketV2.address);

    // set keeper for liquidation bot
    await lendingAddressRegistry.addKeeper(liquidationBot.address);

    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("10000"));

    // grant MINTER_ROLE to lending market
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), lendingMarketV2.address);

    weth = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", WETH)
    );

    // weth swapper impl
    const wethSwapperImpl = await deployUniswapV2Swapper(
      swapper.address,
      UNISWAP_V2_ROUTER,
      WETH,
      airUSD.address,
      [WETH, airUSD.address]
    );
    await swapper.addSwapperImpl(
      WETH, // tokenIn
      airUSD.address, // tokenOut
      wethSwapperImpl.address // airUSD swap impl
    );

    // stETH swapper impl
    const stethSwapperImpl = await deployStethAirUSDSwapper(
      UNISWAP_V2_ROUTER,
      airUSD.address
    );
    await swapper.addSwapperImpl(
      STETH, // tokenIn
      airUSD.address, // tokenOut
      stethSwapperImpl.address // airUSD swap impl
    );

    // eth/usdt swapper impl
    const ethUsdtLPSwapperImpl = await deployEthUsdtLPSwapper(
      UNISWAP_V2_ROUTER,
      airUSD.address
    );
    await swapper.addSwapperImpl(
      ETH_USDT_LP, // tokenIn
      airUSD.address, // tokenOut
      ethUsdtLPSwapperImpl.address // airUSD swap impl
    );

    // set price aggregators
    wethOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(WETH_PRICE, 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(WETH, wethOracle.address);

    // prepare 10 weth
    await user.sendTransaction({
      from: user.address,
      to: WETH,
      value: parseUnits("10"),
    });

    // add collateral support on lending market
    await lendingMarketV2.enableCollateralToken(
      WETH,
      lendingVault.address,
      {
        numerator: 70,
        denominator: 100,
      }, // 70%
      {
        numerator: "10",
        denominator: "1000",
      }, // 1% interest APR,
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
          }, // 1% interest APR,
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
          }, // 1% interest APR,
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
          }, // 1% interest APR,
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
          WETH,
          lendingVault.address,
          {
            numerator: 70,
            denominator: 100,
          }, // 70%
          {
            numerator: "10",
            denominator: "1000",
          }, // 1% interest APR,
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
        }, // 1% interest APR,
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
        }, // 1% interest APR,
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
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await expect(
        lendingMarketV2
          .connect(user)
          .deposit(STETH, parseUnits("1"), user.address)
      ).to.revertedWith("not enabled");
    });

    it("Success", async () => {
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      const position = await lendingMarketV2.positionView(user.address, WETH);
      expect(position.amount).to.equal(parseUnits("1"));
      expect(position.amountUSD).to.equal(parseUnits("1").mul(WETH_PRICE));
    });
  });

  describe("borrow", () => {
    beforeEach(async () => {
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);
    });

    it("Revert: not enabled", async () => {
      await expect(
        lendingMarketV2.connect(user).borrow(STETH, 0)
      ).to.revertedWith("not enabled");
    });

    it("Revert: insufficient collateral", async () => {
      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2.connect(user).borrow(WETH, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("Revert: borrow cap reached", async () => {
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("3"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("3"), user.address);

      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarketV2.connect(user).borrow(WETH, borrowAmount)
      ).to.revertedWith("borrow cap reached");
    });

    it("Success: borrow once", async () => {
      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarketV2.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("Success: borrow twice", async () => {
      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarketV2.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount.mul(2));
      expect(position.liquidatable).to.equal(false);
    });
  });

  describe("repay", () => {
    let borrowAmount: BigNumber;

    beforeEach(async () => {
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(user.address, WETH);

      borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);

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
        lendingMarketV2.connect(user).repay(WETH, 0)
      ).to.revertedWith("invalid amount");
    });

    it("Success", async () => {
      await lendingMarketV2.connect(user).repay(WETH, borrowAmount.div(2));

      const position = await lendingMarketV2.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);
    });

    it("Revert: invalid token", async () => {
      await expect(
        lendingMarketV2.connect(user).withdraw(STETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
    });

    it("Revert: insufficient collateral", async () => {
      await expect(
        lendingMarketV2.connect(user).withdraw(WETH, parseUnits("1.1"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarketV2.connect(user).withdraw(WETH, parseUnits("0.75"))
      ).to.revertedWith("insufficient collateral");
    });

    it("Success", async () => {
      await lendingMarketV2.connect(user).withdraw(WETH, parseUnits("0.5"));

      const position = await lendingMarketV2.positionView(user.address, WETH);
      expect(position.amount).to.equal(parseUnits("0.5"));
    });
  });

  describe("liquidate", () => {
    beforeEach(async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);
    });

    it("Revert: not keeper", async () => {
      await expect(
        lendingMarketV2.liquidate(user.address, WETH)
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
        lendingMarketV2.liquidate(user.address, WETH)
      ).to.revertedWith("not liquidatable");
    });

    it("Success", async () => {
      // weth/airUSD add_liquidity on uniswap v2
      const uniswapV2Router = <IUniswapV2Router>(
        await ethers.getContractAt("IUniswapV2Router", UNISWAP_V2_ROUTER)
      );
      await airUSD.approve(uniswapV2Router.address, parseUnits("10000"));
      await uniswapV2Router.addLiquidityETH(
        airUSD.address,
        parseUnits("10000"),
        parseUnits("10000"),
        parseUnits("10000").div(WETH_PRICE),
        deployer.address,
        ethers.constants.MaxUint256,
        {
          value: parseUnits("10000").div(WETH_PRICE),
        }
      );

      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [weth.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.false;

      // 10% weth price dump
      await wethOracle.setViewPriceInUSD(
        parseUnits(WETH_PRICE, 8).mul(90).div(100)
      );

      expect(await lendingMarketV2.liquidatable(user.address, WETH)).to.be.true;

      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [weth.address, 0, 100]
        )
      );
      expect(result.upkeepNeeded).to.true;

      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await liquidationBot.connect(bot).performUpkeep(result.performData);

      const position = await lendingMarketV2.positionView(user.address, WETH);
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

      await weth
        .connect(user)
        .approve(lendingMarketV2.address, parseUnits("1"));
      await lendingMarketV2
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarketV2.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarketV2.connect(user).borrow(WETH, borrowAmount);
    });

    it("Success", async () => {
      await lendingMarketV2.collectOrgFee();
    });
  });
});
