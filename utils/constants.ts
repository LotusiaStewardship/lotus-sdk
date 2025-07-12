/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import os from 'node:os'
import { Block } from './types'
import type { ScriptChunkPlatformUTF8 } from '../lib/rank'

/**
 * API URLs
 */
const CHRONIK_API_URL = 'http://172.16.11.102:7123'
// export const NODE_API_URL = 'https://explorer.lotusia.org/api'
const NODE_GEOIP_URL = 'https://api.sefinek.net/api/v2/geoip'
const RANK_API_URL = 'https://rank.lotusia.org/api/v1'
/**
 * NNG configuration
 */
const NNG_SUB_SOCKET_PATH_DEFAULT = `${os.homedir()}/.lotus/pub.pipe`
const NNG_REQ_SOCKET_PATH_DEFAULT = `${os.homedir()}/.lotus/rpc.pipe`
/** Max block size in bytes for requests to RPC socket (32 MiB, i.e. 2^20 * 32) */
const NNG_RPC_RCVMAXSIZE_POLICY = 33_554_432
/** Max number of blocks to request in a single block range request (20) */
const NNG_RPC_BLOCKRANGE_SIZE = 20
/** Time (ms) between reconnect attempts */
const NNG_SOCKET_RECONN = 300
/** Max time (ms) before giving up reconnect */
const NNG_SOCKET_MAXRECONN = 3_000
/** Max time (ms) before aborting a Socket.send() */
const NNG_REQUEST_TIMEOUT_LENGTH = 2_000
/** Number of messages to process in each batch */
const NNG_MESSAGE_BATCH_SIZE = 10
/** Valid socket types */
const NNG_SOCKET_TYPES = ['sub', 'req']

/**
 * Lotus constants
 */
/** Maximum relay size of an OP_RETURN payload, in bytes (OP_RETURN + OP_PUSHDATA1 + data) */
const MAX_OP_RETURN_RELAY = 223
/** Maximum data size of the OP_RETURN payload, in bytes (OP_PUSHDATA1 + data) */
const MAX_OP_RETURN_DATA = 220
/** Maximum number of OP_RETURN outputs allowed in a transaction by consensus */
const MAX_OP_RETURN_OUTPUTS = 3

/**
 * RANK script configuration
 */
/** Minimum RANK burn value in sats */
const RANK_OUTPUT_MIN_VALID_SATS = 1_000_000 // minimum RANK burn value in sats
/** First block with a RANK transaction */
const RANK_BLOCK_GENESIS_V1: Partial<Block> = {
  hash: '0000000000c974cb635064bec0db8cc64a75526871f581ea5dbeca7a98551546',
  height: 952169,
}

/**
 * Dashboard configuration
 */
/** Platform URL configuration */
const PlatformURL: {
  [key in ScriptChunkPlatformUTF8]?: {
    /** Root URL for the platform */
    root: string
    /** URL for the profile */
    profile(profileId: string): string
    /** URL for the post */
    post(profileId: string, postId: string): string
  }
} = {
  twitter: {
    root: 'https://x.com',
    profile(profileId: string) {
      return `${this.root}/${profileId}`
    },
    post(profileId: string, postId: string) {
      return `${this.root}/${profileId}/status/${postId}`
    },
  },
}

/**
 * Opcode constants
 */
enum OpCodes {
  OP_RETURN = 0x6a,
  OP_PUSHDATA1 = 0x4c,
  // RANK sentiments
  OP_0 = 0x00, // negative
  OP_1 = 0x51, // positive
  OP_2 = 0x52,
  OP_3 = 0x53,
  OP_4 = 0x54,
  OP_5 = 0x55,
  OP_6 = 0x56,
  OP_7 = 0x57,
  OP_8 = 0x58,
  OP_9 = 0x59,
  OP_10 = 0x5a,
  OP_11 = 0x5b,
  OP_12 = 0x5c,
  OP_13 = 0x5d,
  OP_14 = 0x5e,
  OP_15 = 0x5f,
  OP_16 = 0x60, // neutral
}

export {
  // API URLs
  CHRONIK_API_URL,
  NODE_GEOIP_URL,
  RANK_API_URL,
  // NNG configuration
  NNG_SUB_SOCKET_PATH_DEFAULT,
  NNG_REQ_SOCKET_PATH_DEFAULT,
  NNG_RPC_RCVMAXSIZE_POLICY,
  NNG_RPC_BLOCKRANGE_SIZE,
  NNG_SOCKET_RECONN,
  NNG_SOCKET_MAXRECONN,
  NNG_REQUEST_TIMEOUT_LENGTH,
  NNG_MESSAGE_BATCH_SIZE,
  NNG_SOCKET_TYPES,
  // Lotus constants
  MAX_OP_RETURN_RELAY,
  MAX_OP_RETURN_DATA,
  MAX_OP_RETURN_OUTPUTS,
  OpCodes,
  // RANK script configuration
  RANK_OUTPUT_MIN_VALID_SATS,
  RANK_BLOCK_GENESIS_V1,
  // Platform configuration
  PlatformURL,
}
