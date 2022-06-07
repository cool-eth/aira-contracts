import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  LendingAddressRegistry,
  LendingMarket,
  PriceOracleAggregator,
  StablePool,
  Swapper,
} from "../types";

const deploySetRegistry: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract("LendingAddressRegistry")
  );
  const lendingMarket = <LendingMarket>(
    await ethers.getContract("LendingMarket")
  );
  const priceOracleAggregator = <PriceOracleAggregator>(
    await ethers.getContract("PriceOracleAggregator")
  );
  const stablePool = <StablePool>await ethers.getContract("StablePool");
  const swapper = <Swapper>await ethers.getContract("Swapper");

  await (
    await lendingAddressRegistry.initialize(
      lendingMarket.address,
      priceOracleAggregator.address,
      deployer.address,
      deployer.address,
      stablePool.address,
      swapper.address
    )
  ).wait();
};

export default deploySetRegistry;
deploySetRegistry.tags = ["SetRegistry"];
deploySetRegistry.dependencies = [
  "AirUSD",
  "LeningAddressRegistry",
  "LiquidationBot",
  "StablePool",
  "LendingMarket",
  "Swapper",
  "PriceOracleAggregator",
];
