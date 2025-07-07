/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { RPC as config } from '../utils/settings'

type NetworkInfo = {
  /** Subversion string */
  subversion: string
  /** Whether local relay is enabled */
  localrelay: boolean
  /** Number of connections */
  connections: number
  /** Number of inbound connections */
  connections_in: number
  /** Network warnings if any */
  warnings: string
}

/**
 * Mining information returned by the RPC daemon
 */
type MiningInfo = {
  /** Current block height */
  blocks: number
  /** Current network difficulty */
  difficulty: number
  /** Network hash rate in hashes per second */
  networkhashps: number
  /** Number of transactions in the mempool */
  pooledtx: number
  /** Blockchain name (e.g., "main", "test", "regtest") */
  chain: string
  /** Network warnings if any */
  warnings: string
}

/**
 * Mempool information returned by the RPC daemon
 */
type MempoolInfo = {
  /** Whether the mempool is loaded */
  loaded: boolean
  /** Number of transactions in mempool */
  size: number
  /** Total size of mempool in bytes */
  bytes: number
  /** Memory usage in bytes */
  usage: number
  /** Maximum mempool size in bytes */
  maxmempool: number
  /** Minimum fee rate for mempool transactions */
  mempoolminfee: number
  /** Minimum relay fee rate */
  minrelaytxfee: number
  /** Number of unbroadcast transactions */
  unbroadcastcount: number
}

/**
 * Peer connection information returned by the RPC daemon
 */
type PeerInfo = {
  /** Peer address and port */
  addr: string
  /** Peer services as hex string */
  services: string
  /** Array of service names */
  servicesnames: Array<string>
  /** Whether peer relays transactions */
  relaytxes: boolean
  /** Timestamp of last sent message */
  lastsend: number
  /** Timestamp of last received message */
  lastrecv: number
  /** Timestamp of last transaction */
  last_transaction: number
  /** Timestamp of last proof */
  last_proof: number
  /** Timestamp of last block */
  last_block: number
  /** Total bytes sent to peer */
  bytessent: number
  /** Total bytes received from peer */
  bytesrecv: number
  /** Connection time timestamp */
  conntime: number
  /** Time offset in seconds */
  timeoffset: number
  /** Current ping time in seconds */
  pingtime: number
  /** Minimum ping time in seconds */
  minping: number
  /** Protocol version */
  version: number
  /** User agent string */
  subver: string
  /** Whether connection is inbound */
  inbound: boolean
  /** Starting block height */
  startingheight: number
  /** Number of synced headers */
  synced_headers: number
  /** Number of synced blocks */
  synced_blocks: number
  /** GeoIP data */
  geoip?: {
    country: string
    city: string
  }
}

/**
 * Block statistics returned by the RPC daemon
 */
type BlockStats = {
  /** Average fee in the block */
  avgfee: number
  /** Average fee rate in the block */
  avgfeerate: number
  /** Average transaction size in the block */
  avgtxsize: number
  /** Block hash */
  blockhash: string
  /** Fee rate percentiles */
  feerate_percentiles: Array<number>
  /** Block height */
  height: number
  /** Number of inputs */
  ins: number
  /** Maximum fee in the block */
  maxfee: number
  /** Maximum fee rate in the block */
  maxfeerate: number
  /** Maximum transaction size in the block */
  maxtxsize: number
  /** Median fee in the block */
  medianfee: number
  /** Median fee rate in the block */
  medianfeerate: number
  /** Median transaction size in the block */
  mediantxsize: number
  /** Minimum fee rate in the block */
  minfeerate: number
  /** Minimum transaction size in the block */
  mintxsize: number
  /** Number of outputs */
  notx: number
  /** Number of outputs */
  outs: number
  /** Block subsidy */
  subsidy: number
  /** Block timestamp */
  time: number
  /** Total output value */
  total_out: number
  /** Total block size */
  total_size: number
  /** Total fees in the block */
  totalfee: number
  /** Number of transactions */
  txs: number
  /** UTXO increase count */
  utxo_increase: number
  /** UTXO size increase */
  utxo_size_inc: number
}

/**
 * Block information returned by the RPC daemon
 */
type BlockInfo = {
  /** Block hash */
  hash: string
  /** Number of confirmations */
  confirmations: number
  /** Block size in bytes */
  size: number
  /** Block height */
  height: number
  /** Array of transaction IDs */
  tx: Array<string>
  /** Block timestamp */
  time: number
  /** Block difficulty */
  difficulty: number
  /** Number of transactions */
  nTx: number
  /** Previous block hash */
  previousblockhash: string
  /** Next block hash */
  nextblockhash: string
}

/**
 * Transaction input information
 */
type TransactionInput = {
  /** Transaction ID */
  txid: string
  /** Output index */
  vout: number
  /** Coinbase transaction data (for coinbase inputs) */
  coinbase?: string
}

/**
 * Transaction output information
 */
type TransactionOutput = {
  /** Output value in coins */
  value: number
  /** Script public key information */
  scriptPubKey: {
    /** Array of addresses */
    addresses: Array<string>
    /** Script type */
    type: string
    /** Assembly representation */
    asm: string
  }
}

/**
 * Raw transaction information returned by the RPC daemon
 */
type RawTransaction = {
  /** Transaction ID */
  txid: string
  /** Transaction size in bytes */
  size: number
  /** Array of transaction inputs */
  vin: TransactionInput[]
  /** Array of transaction outputs */
  vout: TransactionOutput[]
  /** Transaction timestamp */
  time?: number
  /** Block timestamp */
  blocktime?: number
  /** Block hash containing this transaction */
  blockhash?: string
  /** Number of confirmations */
  confirmations?: number
}

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
