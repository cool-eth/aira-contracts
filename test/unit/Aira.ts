import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { Aira, AirUSD, LendingAddressRegistry, StablePool } from "../../types";

describe("Aira", () => {
  let deployer: SignerWithAddress, user: SignerWithAddress;
  let aira: Aira;

  before(async () => {
    [deployer, user] = await ethers.getSigners();

    await deployments.fixture("Aira");

    aira = await ethers.getContract("Aira");
  });

  let snapId: string;
  beforeEach(async () => {
    snapId = (await network.provider.request({
      method: "evm_snapshot",
      params: [],
    })) as string;
    await ethers.provider.send("evm_mine", []);
  });

  afterEach(async () => {
    await network.provider.request({
      method: "evm_revert",
      params: [snapId],
    });
    await ethers.provider.send("evm_mine", []);
  });

  it("Revert: mint caller is not the owner", async () => {
    await expect(
      aira.connect(user).mint(user.address, parseUnits("1"))
    ).to.revertedWith("Ownable: caller is not the owner");
  });

  it("Revert: Can't mint more than the cap", async () => {
    await expect(
      aira.mint(user.address, parseUnits("1000000001"))
    ).to.revertedWith("ERC20Capped: cap exceeded");
  });

  it("Success: owner can mint Aira", async () => {
    await aira.mint(user.address, parseUnits("1"));

    expect(await aira.balanceOf(user.address)).to.equal(parseUnits("1"));
  });
});
