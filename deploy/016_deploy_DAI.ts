import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { waitSeconds } from "../helper/utils";

const deployDai: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre;
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const dai = (
    await deploy("DAI", {
      from: deployer.address,
      contract: "MockToken",
      args: ["Mocked DAI", "DAI", 18],
      log: true,
    })
  ).address;
  console.log("DAI deployed at", dai);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10);
    console.log("=====> Verifing ....");
    try {
      await hre.run("verify:verify", {
        address: dai,
        contract: "contracts/mock/MockToken.sol:MockToken",
        constructorArguments: ["Mocked DAI", "DAI", 18],
      });
    } catch (_) {}
  }

  const daiPriceAdapter = (
    await deploy("DAIMockChainlinkUSDAdapter", {
      from: deployer.address,
      contract: "MockChainlinkUSDAdapter",
      args: [ethers.utils.parseUnits("1", 8)],
      log: true,
    })
  ).address;
  console.log("DAI price adapter deployed at", daiPriceAdapter);
};

export default deployDai;
deployDai.tags = ["MockDAI"];
deployDai.dependencies = [];
