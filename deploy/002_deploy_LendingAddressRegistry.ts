import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployLendingAddressRegistry: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  await deploy("LendingAddressRegistry", {
    from: deployer.address,
    args: [],
    log: true,
  });
};

export default deployLendingAddressRegistry;
deployLendingAddressRegistry.tags = ["LendingAddressRegistry"];
deployLendingAddressRegistry.dependencies = [];
