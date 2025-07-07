/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { RPC as config } from '../utils/settings'
import type {
  NetworkInfo,
  MiningInfo,
  MempoolInfo,
  PeerInfo,
  BlockStats,
  BlockInfo,
  TransactionInput,
  TransactionOutput,
  RawTransaction,
} from '../utils/types'

const { user, password, address, port } = config
const rpcUrl = `http://${address}:${port}`

/**
 * Sends an RPC request to the Lotus daemon
 * @param method - The RPC method to call
 * @param params - Array of parameters to pass to the RPC method
 * @returns Promise that resolves to the JSON response from the RPC daemon
 */
async function sendRPCRequest(method: string, params: any[]) {
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
  const json = await response.json()
  if (json.error) {
    throw new Error(json.error)
  }
  return json.result
}

/**
 * RPC command - `getmininginfo`
 * @returns {Promise<MiningInfo>} Raw mining information
 */
const getMiningInfo = async (): Promise<MiningInfo> =>
  sendRPCRequest('getmininginfo', [])

/**
 * RPC command - `getpeerinfo`
 * @returns {Promise<PeerInfo[]>} Array of peer connection information
 */
const getPeerInfo = async (): Promise<PeerInfo[]> =>
  sendRPCRequest('getpeerinfo', [])

/**
 * RPC command - `getblockcount`
 * @returns {Promise<number>} Current block count
 */
const getBlockCount = async (): Promise<number> =>
  sendRPCRequest('getblockcount', [])

/**
 * RPC command - `getblockhash`
 * @param {number} height - Block height
 * @returns {Promise<string>} Block hash for the given height
 */
const getBlockHash = async (height: number): Promise<string> =>
  sendRPCRequest('getblockhash', [height])

/**
 * RPC command - `getblockstats`
 * @param {string} hash - Block hash
 * @returns {Promise<BlockStats>} Block statistics
 */
const getBlockStats = async (hash: string): Promise<BlockStats> =>
  sendRPCRequest('getblockstats', [hash])

/**
 * RPC command - `getblock`
 * @param {string} hash - Block hash
 * @returns {Promise<Block>} Block information
 */
const getBlock = async (hash: string): Promise<BlockInfo> =>
  sendRPCRequest('getblock', [hash])

/**
 * RPC command - `getrawtransaction`
 * @param {string} txid - Transaction ID
 * @returns {Promise<RawTransaction>} Raw transaction information
 */
const getRawTransaction = async (txid: string): Promise<RawTransaction> =>
  sendRPCRequest('getrawtransaction', [txid, true])

/**
 * RPC command - `getrawmempool`
 * @returns {Promise<string[]>} Array of transaction IDs in mempool
 */
const getRawMemPool = async (): Promise<string[]> =>
  sendRPCRequest('getrawmempool', [])

/**
 * RPC command - `getmempoolinfo`
 * @returns {Promise<MempoolInfo>} Mempool information
 */
const getMempoolInfo = async (): Promise<MempoolInfo> =>
  sendRPCRequest('getmempoolinfo', [])

export type {
  NetworkInfo,
  MiningInfo,
  MempoolInfo,
  PeerInfo,
  BlockStats,
  BlockInfo,
  TransactionInput,
  TransactionOutput,
  RawTransaction,
}

export {
  getMiningInfo,
  getPeerInfo,
  getBlockCount,
  getBlockHash,
  getBlockStats,
  getBlock,
  getRawTransaction,
  getRawMemPool,
  getMempoolInfo,
}
