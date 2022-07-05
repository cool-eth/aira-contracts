import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { waitSeconds } from "../helper/utils";

const deployUsdt: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const usdt = (
    await deploy("USDT", {
      from: deployer.address,
      contract: "MockUSDT",
      args: ["Mocked USDT", "USDT"],
      log: true,
    })
  ).address;
  console.log("USDT deployed at", usdt);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10);
    console.log("=====> Verifing ....");
    try {
      await hre.run("verify:verify", {
        address: usdt,
        contract: "contracts/mock/MockUSDT.sol:MockUSDT",
        constructorArguments: ["Mocked USDT", "USDT"],
      });
    } catch (_) {}
  }

  const usdtPriceAdapter = (
    await deploy("USDTMockChainlinkUSDAdapter", {
      from: deployer.address,
      contract: "MockChainlinkUSDAdapter",
      args: [ethers.utils.parseUnits("1", 8)],
      log: true,
    })
  ).address;
  console.log("USDT price adapter deployed at", usdtPriceAdapter);
};

export default deployUsdt;
deployUsdt.tags = ["MockUSDT"];
deployUsdt.dependencies = [];
