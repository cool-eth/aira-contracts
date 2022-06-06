import { Contract } from 'ethers'

import { AirUSD } from '../types/AirUSD'
import { LendingAddressRegistry } from '../types/LendingAddressRegistry'
import { LiquidationBot } from '../types/LiquidationBot'
import { StablePool } from '../types/StablePool'
import { LendingMarket } from '../types/LendingMarket'
import { Swapper } from '../types/Swapper'
import { EthUsdtLPSwapper } from '../types/EthUsdtLPSwapper'
import { StethAirUSDSwapper } from '../types/StethAirUSDSwapper'
import { UniswapV2Swapper } from '../types/UniswapV2Swapper'
import { ChainlinkUSDAdapter } from '../types/ChainlinkUSDAdapter'
import { UniswapV2Oracle } from '../types/UniswapV2Oracle'
import { PriceOracleAggregator } from '../types/PriceOracleAggregator'

const hre = require('hardhat')

export const deployContract = async <ContractType extends Contract>(
  contractName: string,
  args: any[],
  libraries?: {}
) => {
  const signers = await hre.ethers.getSigners()
  const contract = (await (
    await hre.ethers.getContractFactory(contractName, signers[0], {
      libraries: {
        ...libraries,
      },
    })
  ).deploy(...args)) as ContractType

  return contract
}

export const deployAirUSD = async () => {
  return await deployContract<AirUSD>('AirUSD', [])
}

export const deployLendingAddressRegistry = async () => {
  return await deployContract<LendingAddressRegistry>(
    'LendingAddressRegistry',
    []
  )
}

export const deployLiquidationBot = async (provider: any, airUSD: any) => {
  return await deployContract<LiquidationBot>('LiquidationBot', [
    provider,
    airUSD,
  ])
}

export const deployStablePool = async (provider: any, airUSD: any) => {
  return await deployContract<StablePool>('StablePool', [provider, airUSD])
}

export const deployLendingMarket = async (
  provider: any,
  airUSD: any,
  settings: any
) => {
  return await deployContract<LendingMarket>('LendingMarket', [
    provider,
    airUSD,
    settings,
  ])
}

export const deploySwapper = async () => {
  return await deployContract<Swapper>('Swapper', [])
}

export const deployEthUsdtLPSwapper = async (
  uniswapV2Router: any,
  airUSD: any
) => {
  return await deployContract<EthUsdtLPSwapper>('EthUsdtLPSwapper', [
    uniswapV2Router,
    airUSD,
  ])
}

export const deployStethAirUSDSwapper = async (
  uniswapV2Router: any,
  airUSD: any
) => {
  return await deployContract<StethAirUSDSwapper>('StethAirUSDSwapper', [
    uniswapV2Router,
    airUSD,
  ])
}

export const deployUniswapV2Swapper = async (
  uniswapV2Router: any,
  tokenIn: any,
  tokenOut: any,
  path: any
) => {
  return await deployContract<UniswapV2Swapper>('UniswapV2Swapper', [
    uniswapV2Router,
    tokenIn,
    tokenOut,
    path,
  ])
}

export const deployChainlinkUSDAdapter = async (
  asset: any,
  aggregator: any
) => {
  return await deployContract<ChainlinkUSDAdapter>('ChainlinkUSDAdapter', [
    asset,
    aggregator,
  ])
}

export const deployUniswapV2Oracle = async (
  factory: any,
  tokenA: any,
  tokenB: any,
  priceOracleAggregator: any
) => {
  return await deployContract<UniswapV2Oracle>('UniswapV2Oracle', [
    factory,
    tokenA,
    tokenB,
    priceOracleAggregator,
  ])
}

export const deployPriceOracleAggregator = async () => {
  return await deployContract<PriceOracleAggregator>(
    'PriceOracleAggregator',
    []
  )
}
