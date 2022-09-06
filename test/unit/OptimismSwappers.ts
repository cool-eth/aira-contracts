import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { deployments, ethers, network } from "hardhat";
import { AirUSD, IERC20, PriceOracleAggregator, Swapper } from "../../types";

const VELODROME_ROUTER = "0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9";
const VELODROME_USDC_DAI_LP = "0x4F7ebc19844259386DBdDB7b2eB759eeFc6F8353";
const VELODROME_USDC_DAI_GAUGE = "0xc4ff55a961bc04b880e60219ccbbdd139c6451a4";
const VELODROME_OP_USDC_LP = "0x47029bc8f5cbe3b464004e87ef9c9419a48018cd";
const VELODROME_OP_USDC_GAUGE = "0x0299d40E99F2a5a1390261f5A71d13C3932E214C";
const VELODROME_WETH_USDC_LP = "0x79c912fef520be002c2b6e57ec4324e260f38e50";
const VELODROME_WETH_USDC_GAUGE = "0xE2CEc8aB811B648bA7B1691Ce08d5E800Dd0a60a";
const USDC = "0x7f5c764cbc14f9669b88837ca1490cca17c31607";
const DAI = "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1";
const WETH = "0x4200000000000000000000000000000000000006";
const OP = "0x4200000000000000000000000000000000000042";
const USDC_CHAINLINK = "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3";
const DAI_CHAINLINK = "0x8dBa75e83DA73cc766A7e5a0ee71F656BAb470d6";
const ETH_CHAINLINK = "0x13e3Ee699D1909E989722E753853AE30b17e08c5";
const OP_CHAINLINK = "0x0D276FC14719f9292D5C1eA2198673d1f4269246";

describe("Optimism swappers", () => {
  let deployer: SignerWithAddress;
  let airUSD: AirUSD;
  let swapper: Swapper, priceOracleAggregator: PriceOracleAggregator;
  let usdc: IERC20, dai: IERC20, op: IERC20, weth: IERC20;
  let velodromeUsdcDaiLp: IERC20,
    velodromeEthUsdcLp: IERC20,
    velodromeOpUsdcLp: IERC20;

  before(async () => {
    [deployer] = await ethers.getSigners();

    await deployments.fixture("SetRegistry");

    airUSD = await ethers.getContract("AirUSD");
    swapper = await ethers.getContract("Swapper");
    priceOracleAggregator = await ethers.getContract("PriceOracleAggregator");
    // grant MINTER_ROLE to deployer for testing purpose
    await airUSD.grantRole(await airUSD.MINTER_ROLE(), deployer.address);
    await airUSD.mint(deployer.address, parseUnits("1000000"));

    velodromeUsdcDaiLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/external/IERC20.sol:IERC20",
        VELODROME_USDC_DAI_LP
      )
    );
    velodromeEthUsdcLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/external/IERC20.sol:IERC20",
        VELODROME_WETH_USDC_LP
      )
    );
    velodromeOpUsdcLp = <IERC20>(
      await ethers.getContractAt(
        "contracts/external/IERC20.sol:IERC20",
        VELODROME_OP_USDC_LP
      )
    );
    usdc = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", USDC)
    );
    dai = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", DAI)
    );
    op = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", OP)
    );
    weth = <IERC20>(
      await ethers.getContractAt("contracts/external/IERC20.sol:IERC20", WETH)
    );

    const VelodromeLPSwapper = await ethers.getContractFactory(
      "VelodromeLPSwapper"
    );

    // usdc/dai -> airUSD
    const velodromeUsdcDaiLpSwapper = await VelodromeLPSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      VELODROME_USDC_DAI_LP,
      airUSD.address
    );
    await velodromeUsdcDaiLpSwapper.deployed();
    await swapper.addSwapperImpl(
      VELODROME_USDC_DAI_LP, // tokenIn
      airUSD.address, // tokenOut
      velodromeUsdcDaiLpSwapper.address // airUSD swap impl
    );

    // weth/usdc -> airUSD
    const velodromeWethUsdcLpSwapper = await VelodromeLPSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      VELODROME_WETH_USDC_LP,
      airUSD.address
    );
    await velodromeWethUsdcLpSwapper.deployed();
    await swapper.addSwapperImpl(
      VELODROME_WETH_USDC_LP, // tokenIn
      airUSD.address, // tokenOut
      velodromeWethUsdcLpSwapper.address // airUSD swap impl
    );

    // op/usdc -> airUSD
    const velodromeOpUsdcLpSwapper = await VelodromeLPSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      VELODROME_OP_USDC_LP,
      airUSD.address
    );
    await velodromeOpUsdcLpSwapper.deployed();
    await swapper.addSwapperImpl(
      VELODROME_OP_USDC_LP, // tokenIn
      airUSD.address, // tokenOut
      velodromeOpUsdcLpSwapper.address // airUSD swap impl
    );

    // usdc -> airUSD
    const VelodromeSwapper = await ethers.getContractFactory(
      "VelodromeSwapper"
    );
    const usdcSwapperImpl = await VelodromeSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      USDC,
      airUSD.address,
      [
        {
          from: USDC,
          to: airUSD.address,
          stable: true,
        },
      ]
    );
    await usdcSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      USDC, // tokenIn
      airUSD.address, // tokenOut
      usdcSwapperImpl.address // airUSD swap impl
    );

    // dai -> airUSD
    const daiSwapperImpl = await VelodromeSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      DAI,
      airUSD.address,
      [
        {
          from: DAI,
          to: USDC,
          stable: true,
        },
        {
          from: USDC,
          to: airUSD.address,
          stable: true,
        },
      ]
    );
    await daiSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      DAI, // tokenIn
      airUSD.address, // tokenOut
      daiSwapperImpl.address // airUSD swap impl
    );

    // weth -> airUSD
    const wethSwapperImpl = await VelodromeSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      WETH,
      airUSD.address,
      [
        {
          from: WETH,
          to: USDC,
          stable: false,
        },
        {
          from: USDC,
          to: airUSD.address,
          stable: true,
        },
      ]
    );
    await wethSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      WETH, // tokenIn
      airUSD.address, // tokenOut
      wethSwapperImpl.address // airUSD swap impl
    );

    // op -> airUSD
    const opSwapperImpl = await VelodromeSwapper.deploy(
      swapper.address,
      VELODROME_ROUTER,
      OP,
      airUSD.address,
      [
        {
          from: OP,
          to: USDC,
          stable: false,
        },
        {
          from: USDC,
          to: airUSD.address,
          stable: true,
        },
      ]
    );
    await opSwapperImpl.deployed();
    await swapper.addSwapperImpl(
      OP, // tokenIn
      airUSD.address, // tokenOut
      opSwapperImpl.address // airUSD swap impl
    );

    // usdc oracle
    const ChainlinkUSDAdapter = await ethers.getContractFactory(
      "ChainlinkUSDAdapter"
    );
    const usdcOracle = await ChainlinkUSDAdapter.deploy(
      USDC,
      USDC_CHAINLINK,
      ethers.constants.AddressZero,
      priceOracleAggregator.address
    );
    await usdcOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(USDC, usdcOracle.address);

    // dai oracle
    const daiOracle = await ChainlinkUSDAdapter.deploy(
      DAI,
      DAI_CHAINLINK,
      ethers.constants.AddressZero,
      priceOracleAggregator.address
    );
    await daiOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(DAI, daiOracle.address);

    // eth oracle
    const ethOracle = await ChainlinkUSDAdapter.deploy(
      WETH,
      ETH_CHAINLINK,
      ethers.constants.AddressZero,
      priceOracleAggregator.address
    );
    await ethOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(WETH, ethOracle.address);

    // op oracle
    const opOracle = await ChainlinkUSDAdapter.deploy(
      OP,
      OP_CHAINLINK,
      ethers.constants.AddressZero,
      priceOracleAggregator.address
    );
    await opOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(OP, opOracle.address);

    // usdc/dai oracle
    const VelodromeStableLPAggregator = await ethers.getContractFactory(
      "VelodromeStableLPAggregator"
    );
    const velodromeUsdcDaiOracle = await VelodromeStableLPAggregator.deploy(
      VELODROME_USDC_DAI_LP,
      priceOracleAggregator.address
    );
    await velodromeUsdcDaiOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(
      VELODROME_USDC_DAI_LP,
      velodromeUsdcDaiOracle.address
    );

    // eth/usdc oracle
    const VelodromeVariableLPAggregator = await ethers.getContractFactory(
      "VelodromeVariableLPAggregator"
    );
    const velodromeEthUsdcOracle = await VelodromeVariableLPAggregator.deploy(
      VELODROME_WETH_USDC_LP,
      priceOracleAggregator.address
    );
    await velodromeEthUsdcOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(
      VELODROME_WETH_USDC_LP,
      velodromeEthUsdcOracle.address
    );

    // op/usdc oracle
    const velodromeOpUsdcOracle = await VelodromeVariableLPAggregator.deploy(
      VELODROME_OP_USDC_LP,
      priceOracleAggregator.address
    );
    await velodromeOpUsdcOracle.deployed();
    await priceOracleAggregator.updateOracleForAsset(
      VELODROME_OP_USDC_LP,
      velodromeOpUsdcOracle.address
    );

    // prepare 1M usdc
    const whale = "0xEbe80f029b1c02862B9E8a70a7e5317C06F62Cae";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await usdc
      .connect(whaleSigner)
      .transfer(deployer.address, parseUnits("1000000", 6));

    // add usdc/airUSD liquidity
    await usdc.approve(VELODROME_ROUTER, parseUnits("1000000", 6));
    await airUSD.approve(VELODROME_ROUTER, parseUnits("1000000"));
    const velodromeRouter = await ethers.getContractAt(
      "IVelodromeRouter",
      VELODROME_ROUTER
    );
    await velodromeRouter.addLiquidity(
      airUSD.address,
      USDC,
      true,
      parseUnits("1000000"),
      parseUnits("1000000", 6),
      0,
      0,
      deployer.address,
      ethers.constants.MaxUint256
    );
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

  it("usdc/dai -> airUSD", async () => {
    const whale = "0x885341187ba7164481c13916d4023e9b50b38bea";
    const amount = parseUnits("0.0001");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await velodromeUsdcDaiLp
      .connect(whaleSigner)
      .transfer(deployer.address, amount);

    await velodromeUsdcDaiLp.approve(swapper.address, amount);
    await swapper.swap(
      VELODROME_USDC_DAI_LP,
      airUSD.address,
      amount,
      deployer.address
    );

    expect(await velodromeUsdcDaiLp.balanceOf(deployer.address)).to.equal(0);
    expect(await airUSD.balanceOf(deployer.address)).to.gt(0);
  });

  it("eth/usdc -> airUSD", async () => {
    const whale = "0x5c0ed0a799c7025D3C9F10c561249A996502a62F";
    const amount = parseUnits("0.000001");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await velodromeEthUsdcLp
      .connect(whaleSigner)
      .transfer(deployer.address, amount);

    await velodromeEthUsdcLp.approve(swapper.address, amount);
    await swapper.swap(
      VELODROME_WETH_USDC_LP,
      airUSD.address,
      amount,
      deployer.address
    );

    expect(await velodromeEthUsdcLp.balanceOf(deployer.address)).to.equal(0);
    expect(await airUSD.balanceOf(deployer.address)).to.gt(0);
  });

  it("op/usdc -> airUSD", async () => {
    const whale = "0x29964b7C46144D79457473661F99F725d4Fdf0e3";
    const amount = parseUnits("0.0001");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale],
    });
    const whaleSigner = await ethers.getSigner(whale);
    await velodromeOpUsdcLp
      .connect(whaleSigner)
      .transfer(deployer.address, amount);

    await velodromeOpUsdcLp.approve(swapper.address, amount);
    await swapper.swap(
      VELODROME_OP_USDC_LP,
      airUSD.address,
      amount,
      deployer.address
    );

    expect(await velodromeOpUsdcLp.balanceOf(deployer.address)).to.equal(0);
    expect(await airUSD.balanceOf(deployer.address)).to.gt(0);
  });
});
