import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import {
  deployContract,
  deployEthUsdtLPSwapper,
  deployStethAirUSDSwapper,
  deployUniswapV2Swapper,
} from "../helper/contracts";
import {
  AirUSD,
  IERC20,
  ILidoOracle,
  ILidoToken,
  IUniswapV2Router,
  LendingAddressRegistry,
  LendingMarket,
  LiquidationBot,
  MockChainlinkUSDAdapter,
  PriceOracleAggregator,
  StablePool,
  Swapper,
} from "../types";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const ETH_USDT_LP = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
const WETH_PRICE = "2000";
const STETH_PRICE = "2100";
const ETH_USDT_LP_PRICE = "20000000";
const LIDO_ORACLE_ADDRESS = "0x442af784a788a5bd6f42a01ebe9f287a871243fb";

const rebaseLido = async () => {
  const lidoToken = <ILidoToken>await ethers.getContractAt("ILidoToken", STETH);
  const lidoOracle = <ILidoOracle>(
    await ethers.getContractAt("ILidoOracle", LIDO_ORACLE_ADDRESS)
  );
  const steth = <IERC20>(
    await ethers.getContractAt("contracts/interfaces/IERC20.sol:IERC20", STETH)
  );

  console.log(
    "totalSupply before rebase =",
    (await steth.totalSupply()).toString()
  );

  const beaconStat = await lidoToken.getBeaconStat();
  const expectedEpochId = await lidoOracle.getExpectedEpochId();
  const quorum = await lidoOracle.getQuorum();
  const oracleMembers = await lidoOracle.getOracleMembers();

  // prepare beacon report
  const epochId = expectedEpochId;
  const beaconBalance = beaconStat.beaconBalance
    .add(ethers.utils.parseUnits("1000", 18))
    .div(ethers.utils.parseUnits("1", 9));
  const beaconValidators = beaconStat.beaconValidators.add(10);

  const signer = (await ethers.getSigners())[0];

  for (let i = 0; i < quorum.toNumber(); i++) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [oracleMembers[i]],
    });
    const member = await ethers.getSigner(oracleMembers[i]);

    await signer.sendTransaction({
      from: signer.address,
      to: member.address,
      value: ethers.utils.parseEther("0.1"),
    });
    await lidoOracle
      .connect(member)
      .reportBeacon(epochId, beaconBalance, beaconValidators);
  }

  console.log(
    "totalSupply after rebase =",
    (await steth.totalSupply()).toString()
  );
};

describe("LendingMarket", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    bot: SignerWithAddress,
    treasury: SignerWithAddress,
    staking: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let liquidationBot: LiquidationBot;
  let stablePool: StablePool;
  let lendingMarket: LendingMarket;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;
  let wethOracle: MockChainlinkUSDAdapter,
    stethOracle: MockChainlinkUSDAdapter,
    ethUsdtOracle: MockChainlinkUSDAdapter;
  let weth: IERC20, steth: IERC20, ethUsdtLp: IERC20;

  before(async () => {
    [deployer, user, bot, treasury, staking] = await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    lendingAddressRegistry = await ethers.getContract("LendingAddressRegistry");
    liquidationBot = await ethers.getContract("LiquidationBot");
    stablePool = await ethers.getContract("StablePool");
    lendingMarket = await ethers.getContract("LendingMarket");
    swapper = await ethers.getContract("Swapper");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");

    // set treasury and staking address
    await lendingAddressRegistry.setTreasury(treasury.address);
    await lendingAddressRegistry.setStaking(staking.address);

    // set keeper for liquidation bot
    await lendingAddressRegistry.addKeeper(liquidationBot.address);

    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("100000"));

    // grant MINTER_ROLE to lending market
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), lendingMarket.address);

    // weth/airUSD add_liquidity on uniswap v2
    const uniswapV2Router = <IUniswapV2Router>(
      await ethers.getContractAt("IUniswapV2Router", UNISWAP_V2_ROUTER)
    );
    weth = <IERC20>(
      await ethers.getContractAt("contracts/interfaces/IERC20.sol:IERC20", WETH)
    );
    steth = <IERC20>(
      await ethers.getContractAt(
        "contracts/interfaces/IERC20.sol:IERC20",
        STETH
      )
    );
    ethUsdtLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/interfaces/IERC20.sol:IERC20",
        ETH_USDT_LP
      )
    );
    await airUSD.approve(uniswapV2Router.address, parseUnits("100000"));
    await uniswapV2Router.addLiquidityETH(
      airUSD.address,
      parseUnits("100000"),
      parseUnits("100000"),
      parseUnits("100000").div(WETH_PRICE),
      deployer.address,
      ethers.constants.MaxUint256,
      {
        value: parseUnits("100000").div(WETH_PRICE),
      }
    );

    // weth swapper impl
    const wethSwapperImpl = await deployUniswapV2Swapper(
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
    stethOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(STETH_PRICE, 8)]
    );
    ethUsdtOracle = await deployContract<MockChainlinkUSDAdapter>(
      "MockChainlinkUSDAdapter",
      [parseUnits(ETH_USDT_LP_PRICE, 8)]
    );
    await priceOracleAggregator.updateOracleForAsset(WETH, wethOracle.address);
    await priceOracleAggregator.updateOracleForAsset(
      STETH,
      stethOracle.address
    );
    await priceOracleAggregator.updateOracleForAsset(
      ETH_USDT_LP,
      ethUsdtOracle.address
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

  describe("weth market", () => {
    beforeEach(async () => {
      // prepare 10 weth
      await user.sendTransaction({
        from: user.address,
        to: WETH,
        value: parseUnits("10"),
      });

      // add collateral support on lending market
      await lendingMarket.addCollateralToken(
        WETH,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        parseUnits("1000000")
      );
    });

    it("should be able to deposit collateral", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await expect(
        lendingMarket
          .connect(user)
          .deposit(STETH, parseUnits("1"), user.address)
      ).to.revertedWith("invalid token");
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      const position = await lendingMarket.positionView(user.address, WETH);
      expect(position.amount).to.equal(parseUnits("1"));
      expect(position.amountUSD).to.equal(parseUnits("1").mul(WETH_PRICE));
    });

    it("can't borrow more than collateral limit", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarket.connect(user).borrow(STETH, borrowAmount.add(1))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).borrow(WETH, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("should be able to borrow airUSD", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("should be able to repay", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);

      await airUSD
        .connect(user)
        .approve(lendingMarket.address, borrowAmount.div(2));
      await expect(
        lendingMarket.connect(user).repay(STETH, borrowAmount.div(2))
      ).to.revertedWith("invalid token");
      await expect(lendingMarket.connect(user).repay(WETH, 0)).to.revertedWith(
        "invalid amount"
      );
      await lendingMarket.connect(user).repay(WETH, borrowAmount.div(2));

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });

    it("should be able to withdraw", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarket.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);

      await expect(
        lendingMarket.connect(user).withdraw(STETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).withdraw(WETH, parseUnits("1.1"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarket.connect(user).withdraw(WETH, parseUnits("0.75"))
      ).to.revertedWith("insufficient collateral");
      await lendingMarket.connect(user).withdraw(WETH, parseUnits("0.5"));

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.amount).to.equal(parseUnits("0.5"));
    });

    it("should be able to liquidate", async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);

      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [weth.address])
      );
      expect(result.upkeepNeeded).to.false;

      // 10% weth price dump
      await wethOracle.setViewPriceInUSD(
        parseUnits(WETH_PRICE, 8).mul(90).div(100)
      );

      expect(await lendingMarket.liquidatable(user.address, WETH)).to.be.true;

      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [weth.address])
      );
      expect(result.upkeepNeeded).to.true;

      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await liquidationBot.connect(bot).performUpkeep(result.performData);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.amount).to.equal(0);

      // take fees into stable pool
      expect(await airUSD.balanceOf(stablePool.address)).gt(
        stablePoolBalanceBefore
      );

      // take fees into treasury and staking address
      expect(await airUSD.balanceOf(treasury.address)).gt(0);
      expect(await airUSD.balanceOf(staking.address)).gt(0);
    });

    it("should be able to liquidate (without enough liquidity in stable pool)", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, WETH);

      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(WETH, borrowAmount);

      position = await lendingMarket.positionView(user.address, WETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);

      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [weth.address])
      );
      expect(result.upkeepNeeded).to.false;

      // 10% weth price dump
      await wethOracle.setViewPriceInUSD(
        parseUnits(WETH_PRICE, 8).mul(90).div(100)
      );

      expect(await lendingMarket.liquidatable(user.address, WETH)).to.be.true;

      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [weth.address])
      );
      expect(result.upkeepNeeded).to.true;

      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await expect(
        liquidationBot.connect(bot).performUpkeep(result.performData)
      ).revertedWith("missing role");
      await airUSD.grantRole(await airUSD.MINTER_ROLE(), stablePool.address);
      await liquidationBot.connect(bot).performUpkeep(result.performData);

      position = await lendingMarket.positionView(user.address, WETH);
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

  describe("steth market", () => {
    beforeEach(async () => {
      // prepare 10 steth
      const whale = "0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2";
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whale],
      });
      const whaleSigner = await ethers.getSigner(whale);
      await steth.connect(whaleSigner).transfer(user.address, parseUnits("10"));
      // add collateral support on lending market
      await lendingMarket.addCollateralToken(
        STETH,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        parseUnits("1000000")
      );
    });

    it("should be able to deposit collateral", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await expect(
        lendingMarket.connect(user).deposit(WETH, parseUnits("1"), user.address)
      ).to.revertedWith("invalid token");
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      const position = await lendingMarket.positionView(user.address, STETH);
      expect(position.amount).to.closeTo(parseUnits("1"), 1);
      expect(position.amountUSD).to.closeTo(
        parseUnits("1").mul(STETH_PRICE),
        3000
      );
    });

    it("can't borrow more than collateral limit", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarket.connect(user).borrow(WETH, borrowAmount.add(1))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).borrow(STETH, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("should be able to borrow airUSD", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(STETH, borrowAmount);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("should be able to repay", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(STETH, borrowAmount);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      await airUSD
        .connect(user)
        .approve(lendingMarket.address, borrowAmount.div(2));
      await expect(
        lendingMarket.connect(user).repay(WETH, borrowAmount.div(2))
      ).to.revertedWith("invalid token");
      await expect(lendingMarket.connect(user).repay(STETH, 0)).to.revertedWith(
        "invalid amount"
      );
      await lendingMarket.connect(user).repay(STETH, borrowAmount.div(2));
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });

    it("should be able to withdraw", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarket.connect(user).borrow(STETH, borrowAmount);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      await expect(
        lendingMarket.connect(user).withdraw(WETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).withdraw(STETH, parseUnits("1.1"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarket.connect(user).withdraw(STETH, parseUnits("0.75"))
      ).to.revertedWith("insufficient collateral");
      await lendingMarket.connect(user).withdraw(STETH, parseUnits("0.5"));
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.amount).to.closeTo(parseUnits("0.5"), 1);
    });

    it("should be able to withdraw (will get more than deposit if rebase happens)", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);

      let position = await lendingMarket.positionView(user.address, STETH);
      console.log(
        "collateral amount before rebase = ",
        position.amount.toString()
      );
      expect(position.amount).to.closeTo(parseUnits("1"), 1);

      await rebaseLido();

      position = await lendingMarket.positionView(user.address, STETH);
      console.log(
        "collateral amount after rebase = ",
        position.amount.toString()
      );
      expect(position.amount).to.gt(parseUnits("1"));

      await lendingMarket.connect(user).withdraw(STETH, parseUnits("0.5"));
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.amount).to.gt(parseUnits("0.5"));
    });

    it("should be able to liquidate", async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(STETH, borrowAmount);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [steth.address])
      );
      expect(result.upkeepNeeded).to.false;
      // 10% steth price dump
      await stethOracle.setViewPriceInUSD(
        parseUnits(STETH_PRICE, 8).mul(90).div(100)
      );
      expect(await lendingMarket.liquidatable(user.address, STETH)).to.be.true;
      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [steth.address])
      );
      expect(result.upkeepNeeded).to.true;
      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );
      await liquidationBot.connect(bot).performUpkeep(result.performData);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.amount).to.equal(0);
      // take fees into stable pool
      expect(await airUSD.balanceOf(stablePool.address)).gt(
        stablePoolBalanceBefore
      );
      // take fees into treasury and staking address
      expect(await airUSD.balanceOf(treasury.address)).gt(0);
      expect(await airUSD.balanceOf(staking.address)).gt(0);
    });

    it("should be able to liquidate (without enough liquidity in stable pool)", async () => {
      await steth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(STETH, parseUnits("1"), user.address);
      let position = await lendingMarket.positionView(user.address, STETH);
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(STETH, borrowAmount);
      position = await lendingMarket.positionView(user.address, STETH);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [steth.address])
      );
      expect(result.upkeepNeeded).to.false;
      // 10% steth price dump
      await stethOracle.setViewPriceInUSD(
        parseUnits(STETH_PRICE, 8).mul(90).div(100)
      );
      expect(await lendingMarket.liquidatable(user.address, STETH)).to.be.true;
      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [steth.address])
      );
      expect(result.upkeepNeeded).to.true;
      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await expect(
        liquidationBot.connect(bot).performUpkeep(result.performData)
      ).revertedWith("missing role");
      await airUSD.grantRole(await airUSD.MINTER_ROLE(), stablePool.address);
      await liquidationBot.connect(bot).performUpkeep(result.performData);

      position = await lendingMarket.positionView(user.address, STETH);
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

  describe("eth-usdt market", () => {
    beforeEach(async () => {
      // prepare 0.01 eth-usdt lp
      const whale = "0xeC08867a12546ccf53b32efB8C23bb26bE0C04f1";
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whale],
      });
      const whaleSigner = await ethers.getSigner(whale);
      await ethUsdtLp
        .connect(whaleSigner)
        .transfer(user.address, parseUnits("0.01"));
      // add collateral support on lending market
      await lendingMarket.addCollateralToken(
        ETH_USDT_LP,
        {
          numerator: 70,
          denominator: 100,
        }, // 70%
        {
          numerator: 75,
          denominator: 100,
        }, // 75%
        parseUnits("1000000")
      );
    });

    it("should be able to deposit collateral", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await expect(
        lendingMarket
          .connect(user)
          .deposit(WETH, parseUnits("0.001"), user.address)
      ).to.revertedWith("invalid token");
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      const position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      expect(position.amount).to.equal(parseUnits("0.001"));
      expect(position.amountUSD).to.equal(
        parseUnits("0.001").mul(ETH_USDT_LP_PRICE)
      );
    });

    it("can't borrow more than collateral limit", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD;
      await expect(
        lendingMarket.connect(user).borrow(WETH, borrowAmount.add(1))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount.add(1))
      ).to.revertedWith("insufficient collateral");
    });

    it("should be able to borrow airUSD", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
    });

    it("should be able to repay", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      await airUSD
        .connect(user)
        .approve(lendingMarket.address, borrowAmount.div(2));
      await expect(
        lendingMarket.connect(user).repay(WETH, borrowAmount.div(2))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).repay(ETH_USDT_LP, 0)
      ).to.revertedWith("invalid amount");
      await lendingMarket.connect(user).repay(ETH_USDT_LP, borrowAmount.div(2));
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.closeTo(
        borrowAmount.div(2),
        parseUnits("1") as any
      );
    });

    it("should be able to withdraw", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD.div(3);
      await lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      await expect(
        lendingMarket.connect(user).withdraw(WETH, parseUnits("0.5"))
      ).to.revertedWith("invalid token");
      await expect(
        lendingMarket.connect(user).withdraw(ETH_USDT_LP, parseUnits("0.0011"))
      ).to.revertedWith("insufficient collateral");
      await expect(
        lendingMarket.connect(user).withdraw(ETH_USDT_LP, parseUnits("0.00075"))
      ).to.revertedWith("insufficient collateral");
      await lendingMarket
        .connect(user)
        .withdraw(ETH_USDT_LP, parseUnits("0.0005"));
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.amount).to.equal(parseUnits("0.0005"));
    });

    it("should be able to liquidate", async () => {
      // prepare 1M airUSD in stable pool for liquidation
      await airUSD.mint(stablePool.address, parseUnits("1000000"));

      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [ethUsdtLp.address])
      );
      expect(result.upkeepNeeded).to.false;
      // 10% eth-usdt price dump
      await ethUsdtOracle.setViewPriceInUSD(
        parseUnits(ETH_USDT_LP_PRICE, 8).mul(90).div(100)
      );
      expect(await lendingMarket.liquidatable(user.address, ETH_USDT_LP)).to.be
        .true;
      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [ethUsdtLp.address])
      );
      expect(result.upkeepNeeded).to.true;
      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );
      await liquidationBot.connect(bot).performUpkeep(result.performData);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.amount).to.equal(0);
      // take fees into stable pool
      expect(await airUSD.balanceOf(stablePool.address)).gt(
        stablePoolBalanceBefore
      );
      // take fees into treasury and staking address
      expect(await airUSD.balanceOf(treasury.address)).gt(0);
      expect(await airUSD.balanceOf(staking.address)).gt(0);
    });

    it("should be able to liquidate (without enough liquidity in stable pool)", async () => {
      await ethUsdtLp
        .connect(user)
        .approve(lendingMarket.address, parseUnits("0.001"));
      await lendingMarket
        .connect(user)
        .deposit(ETH_USDT_LP, parseUnits("0.001"), user.address);
      let position = await lendingMarket.positionView(
        user.address,
        ETH_USDT_LP
      );
      const borrowAmount = position.creditLimitUSD;
      await lendingMarket.connect(user).borrow(ETH_USDT_LP, borrowAmount);
      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
      expect(position.debtPrincipal).to.equal(borrowAmount);
      expect(position.liquidatable).to.equal(false);
      // check liquidatable from liquidation bot
      let result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [ethUsdtLp.address])
      );
      expect(result.upkeepNeeded).to.false;
      // 10% eth-usdt price dump
      await ethUsdtOracle.setViewPriceInUSD(
        parseUnits(ETH_USDT_LP_PRICE, 8).mul(90).div(100)
      );
      expect(await lendingMarket.liquidatable(user.address, ETH_USDT_LP)).to.be
        .true;
      // check liquidatable from liquidation bot
      result = await liquidationBot.checkUpkeep(
        ethers.utils.defaultAbiCoder.encode(["address"], [ethUsdtLp.address])
      );
      expect(result.upkeepNeeded).to.true;
      const stablePoolBalanceBefore = await airUSD.balanceOf(
        stablePool.address
      );

      await expect(
        liquidationBot.connect(bot).performUpkeep(result.performData)
      ).revertedWith("missing role");
      await airUSD.grantRole(await airUSD.MINTER_ROLE(), stablePool.address);
      await liquidationBot.connect(bot).performUpkeep(result.performData);

      position = await lendingMarket.positionView(user.address, ETH_USDT_LP);
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
});
