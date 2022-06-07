import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { AirUSD, LendingAddressRegistry } from '../types'
import { waitSeconds } from '../helper/utils'

const deployStablePool: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const airUSD = <AirUSD>await ethers.getContract('AirUSD')
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract('LendingAddressRegistry')
  )

  const stablePool = await deploy('StablePool', {
    from: deployer.address,
    args: [lendingAddressRegistry.address, airUSD.address],
    log: true,
  })

  await waitSeconds(10)
  console.log('=====> Verifing ....')
  try {
    await hre.run('verify:verify', {
      address: stablePool.address,
      contract: 'contracts/StablePool.sol:StablePool',
      constructorArguments: [lendingAddressRegistry.address, airUSD.address],
    })
  } catch (_) {}
}

export default deployStablePool
deployStablePool.tags = ['StablePool']
deployStablePool.dependencies = ['AirUSD', 'LendingAddressRegistry']
