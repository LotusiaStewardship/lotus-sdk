/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { RPC as settings } from '../utils/settings'
import type {
  NetworkInfo,
  MiningInfo,
  MempoolInfo,
  PeerInfo,
  BlockStats,
  BlockInfo,
  RawTransaction,
  JSONRPCResponse,
  JSONRPCResult,
} from '../utils/types'

const { user, password, address, port } = settings
const rpcUrl = `http://${address}:${port}`

/**
 * Sends an RPC request to the Lotus daemon
 * @param method - The RPC method to call
 * @param params - Array of parameters to pass to the RPC method
 * @returns Promise that resolves to the JSON response from the RPC daemon
 */
async function sendRPCRequest(
  method: string,
  params: unknown[],
): Promise<JSONRPCResult> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    body: JSON.stringify({ method, params }),
    credentials: 'include',
    headers: new Headers({
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString(
        'base64',
      )}`,
    }),
  })
  const json = (await response.json()) as JSONRPCResponse
  if (json.error) {
    throw new Error(json.error)
  }
  return json.result
}

/**
 * RPC command - `getmininginfo`
 * @returns {Promise<MiningInfo>} Raw mining information
 */
async function getMiningInfo(): Promise<MiningInfo> {
  const result = await sendRPCRequest('getmininginfo', [])
  return result as MiningInfo
}

/**
 * RPC command - `getnetworkinfo`
 * @returns {Promise<NetworkInfo>} Network information
 */
async function getNetworkInfo(): Promise<NetworkInfo> {
  const result = await sendRPCRequest('getnetworkinfo', [])
  return result as NetworkInfo
}

/**
 * RPC command - `getpeerinfo`
 * @returns {Promise<PeerInfo[]>} Array of peer connection information
 */
async function getPeerInfo(): Promise<PeerInfo[]> {
  const result = await sendRPCRequest('getpeerinfo', [])
  return result as PeerInfo[]
}

/**
 * RPC command - `getblockcount`
 * @returns {Promise<number>} Current block count
 */
async function getBlockCount(): Promise<number> {
  const result = await sendRPCRequest('getblockcount', [])
  return result as number
}

/**
 * RPC command - `getblockhash`
 * @param {number} height - Block height
 * @returns {Promise<string>} Block hash for the given height
 */
async function getBlockHash(height: number): Promise<string> {
  const result = await sendRPCRequest('getblockhash', [height])
  return result as string
}

/**
 * RPC command - `getblockstats`
 * @param {string} hash - Block hash
 * @returns {Promise<BlockStats>} Block statistics
 */
async function getBlockStats(hash: string): Promise<BlockStats> {
  const result = await sendRPCRequest('getblockstats', [hash])
  return result as BlockStats
}

/**
 * RPC command - `getblock`
 * @param {string} hash - Block hash
 * @returns {Promise<Block>} Block information
 */
async function getBlock(hash: string): Promise<BlockInfo> {
  const result = await sendRPCRequest('getblock', [hash])
  return result as BlockInfo
}

/**
 * RPC command - `getrawtransaction`
 * @param {string} txid - Transaction ID
 * @returns {Promise<RawTransaction>} Raw transaction information
 */
async function getRawTransaction(txid: string): Promise<RawTransaction> {
  const result = await sendRPCRequest('getrawtransaction', [txid, true])
  return result as RawTransaction
}

/**
 * RPC command - `getrawmempool`
 * @returns {Promise<string[]>} Array of transaction IDs in mempool
 */
async function getRawMemPool(): Promise<string[]> {
  const result = await sendRPCRequest('getrawmempool', [])
  return result as string[]
}

/**
 * RPC command - `getmempoolinfo`
 * @returns {Promise<MempoolInfo>} Mempool information
 */
async function getMempoolInfo(): Promise<MempoolInfo> {
  const result = await sendRPCRequest('getmempoolinfo', [])
  return result as MempoolInfo
}

export {
  getMiningInfo,
  getNetworkInfo,
  getPeerInfo,
  getBlockCount,
  getBlockHash,
  getBlockStats,
  getBlock,
  getRawTransaction,
  getRawMemPool,
  getMempoolInfo,
}
