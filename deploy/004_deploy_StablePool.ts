import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { AirUSD, LendingAddressRegistry } from "../types";

const deployStablePool: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const airUSD = <AirUSD>await ethers.getContract("AirUSD");
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract("LendingAddressRegistry")
  );

  await deploy("StablePool", {
    from: deployer.address,
    args: [lendingAddressRegistry.address, airUSD.address],
    log: true,
  });
};

export default deployStablePool;
deployStablePool.tags = ["StablePool"];
deployStablePool.dependencies = ["AirUSD", "LendingAddressRegistry"];
