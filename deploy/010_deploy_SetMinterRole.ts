import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { AirUSD, LendingMarket, StablePool } from "../types";

const deploySetMinterRole: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { ethers } = hre;

  const airUSD = <AirUSD>await ethers.getContract("AirUSD");
  const minterRole = await airUSD.MINTER_ROLE();

  const stablePool = <StablePool>await ethers.getContract("StablePool");
  await airUSD.grantRole(minterRole, stablePool.address);

  const lendingMarket = <LendingMarket>(
    await ethers.getContract("LendingMarket")
  );
  await airUSD.grantRole(minterRole, lendingMarket.address);
};

export default deploySetMinterRole;
deploySetMinterRole.tags = ["SetMinterRole"];
deploySetMinterRole.dependencies = [
  "AirUSD",
  "LeningAddressRegistry",
  "LiquidationBot",
  "StablePool",
  "LendingMarket",
  "Swapper",
  "PriceOracleAggregator",
  "SetRegistry",
];
