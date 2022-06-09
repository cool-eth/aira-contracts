import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import {
  deployContract,
  deployEthUsdtLPSwapper,
  deployStethAirUSDSwapper,
  deployUniswapV2Oracle,
  deployUniswapV2Swapper,
} from "../helper/contracts";
import {
  AirUSD,
  IERC20,
  IUniswapV2Router,
  LendingAddressRegistry,
  LendingMarket,
  LiquidationBot,
  MockChainlinkUSDAdapter,
  PriceOracleAggregator,
  StablePool,
  Swapper,
  UniswapV2Oracle,
} from "../types";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const ETH_USDT_LP = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
const WETH_PRICE = "2000";
const STETH_PRICE = "2100";

describe("LendingMarket", () => {
  let deployer: SignerWithAddress, user: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let liquidationBot: LiquidationBot;
  let stablePool: StablePool;
  let lendingMarket: LendingMarket;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;
  let wethOracle: MockChainlinkUSDAdapter,
    stethOracle: MockChainlinkUSDAdapter,
    ethUsdtOracle: UniswapV2Oracle;
  let weth: IERC20;

  before(async () => {
    [deployer, user] = await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    lendingAddressRegistry = await ethers.getContract("LendingAddressRegistry");
    liquidationBot = await ethers.getContract("LiquidationBot");
    stablePool = await ethers.getContract("StablePool");
    lendingMarket = await ethers.getContract("LendingMarket");
    swapper = await ethers.getContract("Swapper");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");

    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("10000"));

    // grant MINTER_ROLE to lending market
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), lendingMarket.address);

    // weth/airUSD add_liquidity on uniswap v2
    const uniswapV2Router = <IUniswapV2Router>(
      await ethers.getContractAt("IUniswapV2Router", UNISWAP_V2_ROUTER)
    );
    weth = <IERC20>(
      await ethers.getContractAt("contracts/interfaces/IERC20.sol:IERC20", WETH)
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
    ethUsdtOracle = await deployUniswapV2Oracle(
      await uniswapV2Router.factory(),
      WETH,
      USDT,
      priceOracleAggregator.address
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
        } // 75%
      );
    });

    it("should be able to deposit collateral", async () => {
      await weth.connect(user).approve(lendingMarket.address, parseUnits("1"));
      await lendingMarket
        .connect(user)
        .deposit(WETH, parseUnits("1"), user.address);
    });
  });
});
