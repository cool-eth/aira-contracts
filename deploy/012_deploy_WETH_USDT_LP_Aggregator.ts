import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { waitSeconds } from "../helper/utils";

const deployWethUsdtLpAggregator: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const wethUsdtLpAggregator = (
    await deploy("WETH/USDT", {
      from: deployer.address,
      contract: "UniswapV2LPOracle",
      args: [
        "0x95fc8737cc671868ea9a97285bf06d832ad8bbc9",
        "0x497A650820040c5aA238f22E2Fe272d4Ea3de60B",
      ],
      log: true,
    })
  ).address;
  console.log("WETH/USDT Aggregator deployed at", wethUsdtLpAggregator);
};

export default deployWethUsdtLpAggregator;
deployWethUsdtLpAggregator.tags = ["WethUsdtLpAggregator"];
deployWethUsdtLpAggregator.dependencies = [];
