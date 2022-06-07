import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { AirUSD, LendingAddressRegistry } from "../types";

const deployLendingMarket: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const airUSD = <AirUSD>await ethers.getContract("AirUSD");
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract("LendingAddressRegistry")
  );

  const args = [
    lendingAddressRegistry.address,
    airUSD.address,
    {
      interestApr: {
        numerator: "10",
        denominator: "1000",
      }, // 1% interest APR
      orgFeeRate: {
        numerator: "3",
        denominator: "1000",
      }, // 0.3% org fee rate
      liquidationPenalty: {
        numerator: "50",
        denominator: "1000",
      }, // 5% liquidation penalty
    },
  ];

  await deploy("LendingMarket", {
    from: deployer.address,
    args: [],
    log: true,
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        methodName: "initialize",
        args,
      },
    },
  });
};

export default deployLendingMarket;
deployLendingMarket.tags = ["LendingMarket"];
deployLendingMarket.dependencies = ["AirUSD", "LendingAddressRegistry"];
