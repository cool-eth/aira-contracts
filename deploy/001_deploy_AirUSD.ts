import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { waitSeconds } from '../helper/utils'

const deployAirUSD: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const airUSD = await deploy('AirUSD', {
    from: deployer.address,
    args: [],
    log: true,
  })

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10)
    console.log('=====> Verifing ....')
    try {
      await hre.run('verify:verify', {
        address: airUSD.address,
        contract: 'contracts/AirUSD.sol:AirUSD',
        constructorArguments: [],
      })
    } catch (_) {}
  }
}

export default deployAirUSD
deployAirUSD.tags = ['AirUSD']
deployAirUSD.dependencies = []
