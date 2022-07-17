import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { waitSeconds } from "../helper/utils";

const deployUsdc: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const usdc = (
    await deploy("USDC", {
      from: deployer.address,
      contract: "MockToken",
      args: ["Mocked USDC", "USDC", 6],
      log: true,
    })
  ).address;
  console.log("USDC deployed at", usdc);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10);
    console.log("=====> Verifing ....");
    try {
      await hre.run("verify:verify", {
        address: usdc,
        contract: "contracts/mock/MockToken.sol:MockToken",
        constructorArguments: ["Mocked USDC", "USDC", 6],
      });
    } catch (_) {}
  }

  const usdcPriceAdapter = (
    await deploy("USDCMockChainlinkUSDAdapter", {
      from: deployer.address,
      contract: "MockChainlinkUSDAdapter",
      args: [ethers.utils.parseUnits("1", 8)],
      log: true,
    })
  ).address;
  console.log("USDC price adapter deployed at", usdcPriceAdapter);
};

export default deployUsdc;
deployUsdc.tags = ["MockUSDC"];
deployUsdc.dependencies = [];
