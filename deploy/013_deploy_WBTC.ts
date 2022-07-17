import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { waitSeconds } from "../helper/utils";

const deployWbtc: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const wbtc = (
    await deploy("WBTC", {
      from: deployer.address,
      contract: "MockToken",
      args: ["Mocked WBTC", "WBTC", 8],
      log: true,
    })
  ).address;
  console.log("WBTC deployed at", wbtc);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10);
    console.log("=====> Verifing ....");
    try {
      await hre.run("verify:verify", {
        address: wbtc,
        contract: "contracts/mock/MockToken.sol:MockToken",
        constructorArguments: ["Mocked WBTC", "WBTC", 8],
      });
    } catch (_) {}
  }

  const wbtcPriceAdapter = (
    await deploy("WBTCMockChainlinkUSDAdapter", {
      from: deployer.address,
      contract: "MockChainlinkUSDAdapter",
      args: [ethers.utils.parseUnits("20000", 8)],
      log: true,
    })
  ).address;
  console.log("WBTC price adapter deployed at", wbtcPriceAdapter);
};

export default deployWbtc;
deployWbtc.tags = ["MockWBTC"];
deployWbtc.dependencies = [];
