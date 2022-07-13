import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import {
  AirUSD,
  LendingAddressRegistry,
  LendingMarket,
  LiquidationBot,
  PriceOracleAggregator,
  StablePool,
  Swapper,
} from "../../types";

describe("LendingAddressRegistry", () => {
  let deployer: SignerWithAddress,
    user: SignerWithAddress,
    bot: SignerWithAddress,
    treasury: SignerWithAddress,
    staking: SignerWithAddress;
  let airUSD: AirUSD;
  let lendingAddressRegistry: LendingAddressRegistry;
  let liquidationBot: LiquidationBot;
  let stablePool: StablePool;
  let lendingMarket: LendingMarket;
  let swapper: Swapper;
  let priceOracleAggregator: PriceOracleAggregator;

  before(async () => {
    [deployer, user, bot, treasury, staking] = await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    lendingAddressRegistry = await ethers.getContract("LendingAddressRegistry");
    liquidationBot = await ethers.getContract("LiquidationBot");
    stablePool = await ethers.getContract("StablePool");
    lendingMarket = await ethers.getContract("LendingMarket");
    swapper = await ethers.getContract("Swapper");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");

    // set keeper for liquidation bot
    await lendingAddressRegistry.addKeeper(liquidationBot.address);
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

  describe("setLendingMarket", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry
          .connect(user)
          .setLendingMarket(lendingMarket.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setLendingMarket(lendingMarket.address);
      expect(await lendingAddressRegistry.getLendingMarket()).to.equal(
        lendingMarket.address
      );
    });
  });

  describe("setPriceOracleAggregator", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry
          .connect(user)
          .setPriceOracleAggregator(priceOracleAggregator.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setPriceOracleAggregator(
        priceOracleAggregator.address
      );
      expect(await lendingAddressRegistry.getPriceOracleAggregator()).to.equal(
        priceOracleAggregator.address
      );
    });
  });

  describe("setTreasury", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry.connect(user).setTreasury(treasury.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setTreasury(treasury.address);
      expect(await lendingAddressRegistry.getTreasury()).to.equal(
        treasury.address
      );
    });
  });

  describe("setStaking", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry.connect(user).setStaking(staking.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setStaking(staking.address);
      expect(await lendingAddressRegistry.getStaking()).to.equal(
        staking.address
      );
    });
  });

  describe("setStablePool", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry.connect(user).setStablePool(stablePool.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setStablePool(stablePool.address);
      expect(await lendingAddressRegistry.getStablePool()).to.equal(
        stablePool.address
      );
    });
  });

  describe("setSwapper", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry.connect(user).setSwapper(swapper.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Success", async () => {
      await lendingAddressRegistry.setSwapper(swapper.address);
      expect(await lendingAddressRegistry.getSwapper()).to.equal(
        swapper.address
      );
    });
  });

  describe("addKeeper", () => {
    it("Revert: caller is not the owner", async () => {
      await expect(
        lendingAddressRegistry.connect(user).addKeeper(liquidationBot.address)
      ).to.revertedWith("Ownable: caller is not the owner");
    });

    it("Revert: already exists", async () => {
      await expect(
        lendingAddressRegistry.addKeeper(liquidationBot.address)
      ).to.revertedWith("already exists");
    });

    it("Success", async () => {
      expect(await lendingAddressRegistry.getKeepers()).to.deep.equal([
        liquidationBot.address,
      ]);
      expect(await lendingAddressRegistry.isKeeper(bot.address)).to.equal(
        false
      );

      await lendingAddressRegistry.addKeeper(bot.address);

      expect(await lendingAddressRegistry.getKeepers()).to.deep.equal([
        liquidationBot.address,
        bot.address,
      ]);
      expect(await lendingAddressRegistry.isKeeper(bot.address)).to.equal(true);
    });
  });

  it("getAddress", async () => {
    expect(
      await lendingAddressRegistry.getAddress(
        await lendingAddressRegistry.LENDING_MARKET()
      )
    ).to.equal(lendingMarket.address);
  });
});
