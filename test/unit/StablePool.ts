import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { AirUSD, LendingAddressRegistry, StablePool } from "../../types";

describe("StablePool", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    anotherUser: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let stablePool: StablePool;

  before(async () => {
    [deployer, user, anotherUser] = await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    lendingAddressRegistry = await ethers.getContract("LendingAddressRegistry");
    stablePool = await ethers.getContract("StablePool");

    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("10000"));
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

  describe("setAddressProvider", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        stablePool
          .connect(user)
          .setAddressProvider(lendingAddressRegistry.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await stablePool.setAddressProvider(lendingAddressRegistry.address);
      expect(await stablePool.addressProvider()).to.equal(
        lendingAddressRegistry.address
      );
    });
  });

  describe("deposit", () => {
    it("Success: deposit", async () => {
      await airUSD.approve(stablePool.address, parseUnits("1"));
      await stablePool.deposit(parseUnits("1"));

      expect(await stablePool.balanceOf(deployer.address)).to.equal(
        parseUnits("1")
      );
    });
    it("Success: depositFor", async () => {
      await airUSD.approve(stablePool.address, parseUnits("1"));
      await stablePool.depositFor(parseUnits("1"), anotherUser.address);

      expect(await stablePool.balanceOf(anotherUser.address)).to.equal(
        parseUnits("1")
      );

      await airUSD.approve(stablePool.address, parseUnits("1"));
      await stablePool.depositFor(parseUnits("1"), anotherUser.address);

      expect(await stablePool.balanceOf(anotherUser.address)).to.equal(
        parseUnits("2")
      );
    });
  });

  describe("withdraw", async () => {
    beforeEach(async () => {
      await airUSD.approve(stablePool.address, parseUnits("1"));
      await stablePool.deposit(parseUnits("1"));

      // increase pool balance 2x
      await airUSD.transfer(stablePool.address, parseUnits("1"));
    });

    it("Success: withdraw", async () => {
      const balanceBefore = await airUSD.balanceOf(deployer.address);

      await stablePool.withdraw(parseUnits("0.5"));

      expect(await airUSD.balanceOf(deployer.address)).to.equal(
        balanceBefore.add(parseUnits("1"))
      );
      expect(await stablePool.balanceOf(deployer.address)).to.equal(
        parseUnits("0.5")
      );

      await stablePool.withdraw(parseUnits("0.5"));

      expect(await airUSD.balanceOf(deployer.address)).to.equal(
        balanceBefore.add(parseUnits("2"))
      );
      expect(await stablePool.balanceOf(deployer.address)).to.equal(0);
    });

    it("Success: withdrawTo", async () => {
      const balanceBefore = await airUSD.balanceOf(anotherUser.address);

      await stablePool.withdrawTo(parseUnits("0.5"), anotherUser.address);

      expect(await airUSD.balanceOf(anotherUser.address)).to.equal(
        balanceBefore.add(parseUnits("1"))
      );
      expect(await stablePool.balanceOf(deployer.address)).to.equal(
        parseUnits("0.5")
      );
    });
  });
});
