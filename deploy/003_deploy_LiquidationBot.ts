import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { AirUSD, LendingAddressRegistry } from '../types'
import { waitSeconds } from '../helper/utils'

const deployLiquidationBot: DeployFunction = async (
  hre: HardhatRuntimeEnvironment
) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const airUSD = <AirUSD>await ethers.getContract('AirUSD')
  const lendingAddressRegistry = <LendingAddressRegistry>(
    await ethers.getContract('LendingAddressRegistry')
  )

  const liquidationBot = await deploy('LiquidationBot', {
    from: deployer.address,
    args: [lendingAddressRegistry.address, airUSD.address],
    log: true,
  })

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10)
    console.log('=====> Verifing ....')
    try {
      await hre.run('verify:verify', {
        address: liquidationBot.address,
        contract: 'contracts/LiquidationBot.sol:LiquidationBot',
        constructorArguments: [lendingAddressRegistry.address, airUSD.address],
      })
    } catch (_) {}
  }
}

export default deployLiquidationBot
deployLiquidationBot.tags = ['LiquidationBot']
deployLiquidationBot.dependencies = ['AirUSD', 'LendingAddressRegistry']
