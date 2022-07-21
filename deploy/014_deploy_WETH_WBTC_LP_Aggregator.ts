import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployWethWbtcLpAggregator: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const wethWbtcLpAggregator = (
    await deploy("WETH/WBTC", {
      from: deployer.address,
      contract: "UniswapV2LPOracle",
      args: [
        "0xfD1f3e82D7dB3647D9806e951f143c9B05586F89",
        "0x497A650820040c5aA238f22E2Fe272d4Ea3de60B",
      ],
      log: true,
    })
  ).address;
  console.log("WETH/WBTC Aggregator deployed at", wethWbtcLpAggregator);
};

export default deployWethWbtcLpAggregator;
deployWethWbtcLpAggregator.tags = ["WethWbtcLpAggregator"];
deployWethWbtcLpAggregator.dependencies = [];
