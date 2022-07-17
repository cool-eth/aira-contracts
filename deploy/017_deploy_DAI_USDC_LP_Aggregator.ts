import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployDaiUsdcLpAggregator: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const daiUsdcLpAggregator = (
    await deploy("DAI/USDC", {
      from: deployer.address,
      contract: "UniswapV2LPOracle",
      args: [
        "0x66d5daD4271FC87c0CF9070C03d53E25CBFab500",
        "0x497A650820040c5aA238f22E2Fe272d4Ea3de60B",
      ],
      log: true,
    })
  ).address;
  console.log("DAI/USDC Aggregator deployed at", daiUsdcLpAggregator);
};

export default deployDaiUsdcLpAggregator;
deployDaiUsdcLpAggregator.tags = ["DaiUsdcLpAggregator"];
deployDaiUsdcLpAggregator.dependencies = [];
