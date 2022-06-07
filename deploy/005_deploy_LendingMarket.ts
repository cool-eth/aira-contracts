import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { AirUSD, LendingAddressRegistry } from '../types'
import { waitSeconds } from '../helper/utils'
import { ethers } from 'hardhat'

async function getImplementationAddress(proxyAddress: string) {
  const implHex = await ethers.provider.getStorageAt(
    proxyAddress,
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
  )
  return ethers.utils.hexStripZeros(implHex)
}

const deployLendingMarket: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const airUSD = <AirUSD>await ethers.getContract('AirUSD')
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract('LendingAddressRegistry')
  )

  const args = [
    lendingAddressRegistry.address,
    airUSD.address,
    {
      interestApr: {
        numerator: '10',
        denominator: '1000',
      }, // 1% interest APR
      orgFeeRate: {
        numerator: '3',
        denominator: '1000',
      }, // 0.3% org fee rate
      liquidationPenalty: {
        numerator: '50',
        denominator: '1000',
      }, // 5% liquidation penalty
    },
  ]

  const lendingMarket = await deploy('LendingMarket', {
    from: deployer.address,
    args: [],
    log: true,
    proxy: {
      proxyContract: 'OpenZeppelinTransparentProxy',
      execute: {
        methodName: 'initialize',
        args,
      },
    },
  })

  await waitSeconds(10)
  console.log('=====> Verifing ....')
  try {
    await hre.run('verify:verify', {
      address: await getImplementationAddress(lendingMarket.address),
      contract: 'contracts/LendingMarket.sol:LendingMarket',
      constructorArguments: [],
    })
  } catch (_) {}
}

export default deployLendingMarket
deployLendingMarket.tags = ['LendingMarket']
deployLendingMarket.dependencies = ['AirUSD', 'LendingAddressRegistry']
