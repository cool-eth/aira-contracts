import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { waitSeconds } from '../helper/utils'

const deployAira: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, ethers } = hre
  const { deploy } = deployments
  const [deployer] = await ethers.getSigners()

  const aira = await deploy('Aira', {
    from: deployer.address,
    args: [],
    log: true,
  })

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    await waitSeconds(10)
    console.log('=====> Verifing ....')
    try {
      await hre.run('verify:verify', {
        address: aira.address,
        contract: 'contracts/Aira.sol:Aira',
        constructorArguments: [],
      })
    } catch (_) {}
  }
}

export default deployAira
deployAira.tags = ['Aira']
deployAira.dependencies = []
