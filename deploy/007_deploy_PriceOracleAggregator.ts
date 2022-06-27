import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { PriceOracleAggregator } from '../types'
import { waitSeconds } from '../helper/utils'

const ETH_PRICE = "1200";

const deployPriceOracleAggregator: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers, network } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  await deploy('PriceOracleAggregator', {
    from: deployer.address,
    args: [],
    log: true,
  })

  const priceOracleAggregator = <PriceOracleAggregator>(
    await ethers.getContract('PriceOracleAggregator')
  )

  {
    // WETH
    let weth = '',
    wethPriceAdapter = ''
    if (network.name == 'mainnet') {
      weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
      const priceFeed = '0x9326BFA02ADD2366b30bacB125260Af641031331'

      wethPriceAdapter = (
        await deploy('WETHChainlinkUSDAdapter', {
          from: deployer.address,
          contract: 'ChainlinkUSDAdapter',
          args: [weth, priceFeed, ethers.constants.AddressZero,  priceOracleAggregator.address],
          log: true,
        })
      ).address
    } else {
      weth = (await ethers.getContract('WETH')).address
      
      wethPriceAdapter = (
        await deploy('WETHMockChainlinkUSDAdapter', {
          from: deployer.address,
          contract: 'MockChainlinkUSDAdapter',
          args: [ethers.utils.parseUnits(ETH_PRICE, 18)],
          log: true,
        })
      ).address
    }

    await (
      await priceOracleAggregator.updateOracleForAsset(weth, wethPriceAdapter)
    ).wait()

    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
      await waitSeconds(10)
      console.log('=====> Verifing ....')
      try {
        await hre.run('verify:verify', {
          address: priceOracleAggregator.address,
          contract:
            'contracts/external/oracle/PriceOracleAggregator.sol:PriceOracleAggregator',
          constructorArguments: [],
        })
      } catch (_) {}
    }
  }
}

export default deployPriceOracleAggregator
deployPriceOracleAggregator.tags = ['PriceOracleAggregator']
deployPriceOracleAggregator.dependencies = []
