import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { waitSeconds } from '../helper/utils'

const deployLendingAddressRegistry: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const lendingAddressRegistry = await deploy('LendingAddressRegistry', {
    from: deployer.address,
    args: [],
    log: true,
  })

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10)
    console.log('=====> Verifing ....')
    try {
      await hre.run('verify:verify', {
        address: lendingAddressRegistry.address,
        contract: 'contracts/LendingAddressRegistry.sol:LendingAddressRegistry',
        constructorArguments: [],
      })
    } catch (_) {}
  }
}

export default deployLendingAddressRegistry
deployLendingAddressRegistry.tags = ['LendingAddressRegistry']
deployLendingAddressRegistry.dependencies = []
