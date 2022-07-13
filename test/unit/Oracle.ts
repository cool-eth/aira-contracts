import { deployments, ethers } from "hardhat";
import { deployContract } from "../../helper/contracts";
import {
  ChainlinkUSDAdapter,
  PriceOracleAggregator,
  UniswapV2LPOracle,
} from "../../types";

const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const ETH_USDT_LP = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
const USDT_CHAINLINK_FEED = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D"; // in usd
const WETH_CHAINLINK_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // in usd
const STETH_CHAINLINK_FEED = "0x86392dC19c0b719886221c78AB11eb8Cf5c52812"; // in eth

describe("Oracle", () => {
  let usdtOracle: ChainlinkUSDAdapter,
    wethOracle: ChainlinkUSDAdapter,
    stethOracle: ChainlinkUSDAdapter,
    ethUsdtOracle: UniswapV2LPOracle,
    priceOracleAggregator: PriceOracleAggregator;

  before(async () => {
    await deployments.fixture("SetRegistry");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");

    // set price aggregators
    usdtOracle = await deployContract<ChainlinkUSDAdapter>(
      "ChainlinkUSDAdapter",
      [
        USDT,
        USDT_CHAINLINK_FEED,
        ethers.constants.AddressZero,
        priceOracleAggregator.address,
      ]
    );
    wethOracle = await deployContract<ChainlinkUSDAdapter>(
      "ChainlinkUSDAdapter",
      [
        WETH,
        WETH_CHAINLINK_FEED,
        ethers.constants.AddressZero,
        priceOracleAggregator.address,
      ]
    );
    stethOracle = await deployContract<ChainlinkUSDAdapter>(
      "ChainlinkUSDAdapter",
      [STETH, STETH_CHAINLINK_FEED, WETH, priceOracleAggregator.address]
    );
    ethUsdtOracle = await deployContract<UniswapV2LPOracle>(
      "UniswapV2LPOracle",
      [ETH_USDT_LP, priceOracleAggregator.address]
    );

    await priceOracleAggregator.updateOracleForAsset(USDT, usdtOracle.address);
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

  it("weth price", async () => {
    console.log(
      "weth price = ",
      (await priceOracleAggregator.viewPriceInUSD(WETH)).toString()
    );
  });

  it("steth price", async () => {
    console.log(
      "steth price = ",
      (await priceOracleAggregator.viewPriceInUSD(STETH)).toString()
    );
  });

  it("eth/usdt lp price", async () => {
    console.log(
      "eth/usdt lp price = ",
      (await priceOracleAggregator.viewPriceInUSD(ETH_USDT_LP)).toString()
    );
  });
});
