import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { AirUSD, LendingAddressRegistry, Swapper } from "../types";
import { waitSeconds } from "../helper/utils";

const deploySwapper: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers, network } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const airUSD = <AirUSD>await ethers.getContract("AirUSD");
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract("LendingAddressRegistry")
  );

  await deploy("Swapper", {
    from: deployer.address,
    args: [lendingAddressRegistry.address, ethers.utils.parseUnits("5", 16)], // 5% slippage limit
    log: true,
  });

  const swapper = <Swapper>await ethers.getContract("Swapper");

  let weth = "";
  if (network.name == "mainnet") {
    weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  } else {
    weth = (await ethers.getContract("WETH")).address;

    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
      await waitSeconds(10);
      console.log("=====> Verifing ....");
      try {
        await hre.run("verify:verify", {
          address: weth,
          contract: "contracts/mock/MockToken.sol:MockToken",
          constructorArguments: ["Mocked WETH", "WETH", 18],
        });
      } catch (_) {}
    }
  }

  const wethSwapImpl = (
    await deploy("UniswapV2Swapper", {
      from: deployer.address,
      args: [
        swapper.address,
        "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // router
        weth, // tokenIn
        airUSD.address, // tokenOut
        [weth, airUSD.address], // path
      ],
      log: true,
    })
  ).address;

  await (
    await swapper.addSwapperImpl(
      weth, // tokenIn
      airUSD.address, // tokenOut
      wethSwapImpl // airUSD swap impl
    )
  ).wait();

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10);
    console.log("=====> Verifing ....");
    try {
      await hre.run("verify:verify", {
        address: swapper.address,
        contract: "contracts/Swapper.sol:Swapper",
        constructorArguments: [],
      });
    } catch (_) {}
  }
};

export default deploySwapper;
deploySwapper.tags = ["Swapper"];
deploySwapper.dependencies = ["PriceOracleAggregator"];
