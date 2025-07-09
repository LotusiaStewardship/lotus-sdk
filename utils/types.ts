/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { ByteBuffer } from 'flatbuffers'
type InstanceData = {
  instanceId: string
  runtimeId: string
  startTime: string
  nonce: number
}
type AuthorizationData = {
  instanceId: string
  scriptPayload: string
  blockhash: string
  blockheight: string
}
/** */
type PostMeta = {
  hasWalletUpvoted: boolean
  hasWalletDownvoted: boolean
  txidsUpvoted: string[]
  txidsDownvoted: string[]
}
/** */
type RankAPIParams = {
  platform: string
  profileId: string
}
/** Profile ranking returned from RANK backend API */
type IndexedProfileRanking = RankAPIParams & {
  ranking: string
  satsPositive: string
  satsNegative: string
  votesPositive: number
  votesNegative: number
}
/** Post ranking returned from RANK backend API */
type IndexedPostRanking = IndexedProfileRanking & {
  profile: IndexedProfileRanking
  postId: string
  postMeta?: PostMeta
}
// RANK script types
type ScriptChunkLokadUTF8 = 'RANK' | 'RNKC'
type ScriptChunkPlatformUTF8 = 'lotusia' | 'twitter'
type ScriptChunkSentimentUTF8 = 'positive' | 'negative' | 'neutral'
type ScriptChunkLokadMap = Map<number, ScriptChunkLokadUTF8>
type ScriptChunkPlatformMap = Map<number, ScriptChunkPlatformUTF8>
type ScriptChunkSentimentMap = Map<number, ScriptChunkSentimentUTF8>
type ScriptChunkField =
  | 'lokad'
  | 'sentiment'
  | 'platform'
  | 'profileId'
  | 'postId'
  | 'postHash'
  | 'instanceId'
type ScriptChunk = {
  /** Byte offset of the chunk in the output script */
  offset: number | null
  /** Byte length of the chunk in the output script */
  len: number | null
  /** Map of supported RANK script chunks */
  map?: ScriptChunkLokadMap | ScriptChunkPlatformMap | ScriptChunkSentimentMap
}
/** Required RANK script chunks */
type ScriptChunksRequired = {
  [name in Exclude<
    ScriptChunkField,
    'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** Optional RANK script chunks */
type ScriptChunksOptional = {
  [name in Extract<
    ScriptChunkField,
    'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}

/** OP_RETURN \<RANK\> \<sentiment\> \<profileId\> [\<postId\> \<postHash\> [\<instanceId\>]] */
type RankOutput = {
  sentiment: ScriptChunkSentimentUTF8 // positive or negative sentiment (can support more)
  platform: ScriptChunkPlatformUTF8 // e.g. Twitter/X.com, etc.
  profileId: string // who the ranking is for
  postId?: string // optional post ID if ranking specific content
  postHash?: string // optional hash of the post content (required if postId is provided)
  instanceId?: string // ID of the registered extension instance
}
/**  */
type RankTransaction = RankOutput & {
  txid: string
  firstSeen: bigint // time first seen by indexer, only for new mempool transactions
  scriptPayload: string
  height?: number // undefined if mempool
  sats: bigint
  timestamp: bigint // unix timestamp
}
/** */
type Block = {
  hash: string
  height: number
  timestamp: bigint
  ranksLength: number // default is 0 if a block is cringe
  prevhash?: string // for reorg checks only; does not get saved to database
}
type RankTarget = {
  id: string // profileId, postId, etc
  platform: string
  ranking: bigint
  ranks: Omit<RankTransaction, 'profileId' | 'platform'>[] // omit the database relation fields
  satsPositive: bigint
  satsNegative: bigint
  votesPositive: number
  votesNegative: number
}
/**  */
type Profile = RankTarget & {
  posts?: PostMap
}
/**  */
type Post = RankTarget & {
  profileId: string
  /** The hash of the post content (i.e. RankOutput['postHash']) */
  hash: string
}
/**
 * `RankTransaction` objects are converted to a `ProfileMap` for database ops
 *
 * `string` is `profileId`
 */
type ProfileMap = Map<string, Profile>
type PostMap = Map<string, Post>

/** Platform parameters */
type PlatformParameters = {
  profileId: {
    len: number
  }
  postId: {
    len: number
    regex: RegExp
    reader: 'readBigUInt64BE' // additional Buffer reader methods if needed
    type: 'BigInt' | 'Number' | 'String'
  }
}

type GeoIPData = {
  country: string
  city: string
}

type GeoIPResponse = {
  success: boolean
  status: string
  ip: string
  data: GeoIPData
  type: 'unicast'
}

/**
 * RPC types
 */
/**
 * Individual JSON-RPC result types
 */
type JSONRPCResult =
  | string
  | string[]
  | number
  | NetworkInfo
  | MiningInfo
  | MempoolInfo
  | PeerInfo[]
  | BlockStats
  | BlockInfo
  | RawTransaction
/**
 * Raw JSON-RPC response from the RPC daemon
 */
type JSONRPCResponse = {
  result: JSONRPCResult
  error: null | {
    code: number
    message: string
  }
  id: number
}
/**
 * Network information returned by the RPC daemon
 */
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

/** NNG types */
type NNGSocketParameters = {
  type: NNGSocketType
  path?: string
  channels?: Array<NNGMessageType>
}
type NNGSocketType = 'pub' | 'sub' | 'req' | 'rep'
type NNGMessageType =
  | 'mempooltxadd'
  | 'mempooltxrem'
  | 'blkconnected'
  | 'blkdisconctd'
type NNGMessageProcessor = (bb: ByteBuffer) => Promise<void>
type NNGPendingMessage = [NNGMessageType, ByteBuffer]
type NNGQueue = {
  busy: boolean
  pending: NNGPendingMessage[]
}

export type {
  // API types
  InstanceData,
  AuthorizationData,
  PostMeta,
  RankAPIParams,
  IndexedProfileRanking,
  IndexedPostRanking,
  // Indexer types
  Block,
  // RANK script types
  ScriptChunkLokadUTF8,
  ScriptChunkPlatformUTF8,
  ScriptChunkSentimentUTF8,
  ScriptChunkLokadMap,
  ScriptChunkPlatformMap,
  ScriptChunkSentimentMap,
  ScriptChunkField,
  ScriptChunk,
  ScriptChunksRequired,
  ScriptChunksOptional,
  // RANK transaction types
  RankOutput,
  RankTransaction,
  RankTarget,
  Profile,
  Post,
  ProfileMap,
  PostMap,
  PlatformParameters,
  // RPC types
  NetworkInfo,
  MiningInfo,
  MempoolInfo,
  PeerInfo,
  BlockStats,
  BlockInfo,
  RawTransaction,
  TransactionInput,
  TransactionOutput,
  JSONRPCResponse,
  JSONRPCResult,
  // NNG types
  NNGSocketParameters,
  NNGSocketType,
  NNGMessageType,
  NNGMessageProcessor,
  NNGPendingMessage,
  NNGQueue,
  // Dashboard types
  GeoIPData,
  GeoIPResponse,
}
