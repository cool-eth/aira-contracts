import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployAirUSD: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  await deploy("AirUSD", {
    from: deployer.address,
    args: [],
    log: true,
  });
};

export default deployAirUSD;
deployAirUSD.tags = ["AirUSD"];
deployAirUSD.dependencies = [];
