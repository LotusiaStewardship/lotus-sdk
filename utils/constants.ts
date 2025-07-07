/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import {
  Block,
  ScriptChunkLokadMap,
  ScriptChunkSentimentMap,
  ScriptChunkPlatformUTF8,
  ScriptChunkPlatformMap,
  ScriptChunk,
  ScriptChunksRequired,
  ScriptChunksOptional,
  PlatformParameters,
} from './types'

/**
 * API URLs
 */
const CHRONIK_API_URL = 'http://172.16.11.102:7123'
// export const NODE_API_URL = 'https://explorer.lotusia.org/api'
const NODE_GEOIP_URL = 'https://api.sefinek.net/api/v2/geoip'
const RANK_API_URL = 'https://rank.lotusia.org/api/v1'
/**
 * RANK script configuration
 */
const RANK_OUTPUT_MIN_VALID_SATS = 1_000_000 // minimum RANK burn value in sats
/** First block with a RANK transaction */
const RANK_BLOCK_GENESIS_V1: Partial<Block> = {
  hash: '0000000000c974cb635064bec0db8cc64a75526871f581ea5dbeca7a98551546',
  height: 952169,
}
/** LOKAD chunk map */
const SCRIPT_CHUNK_LOKAD: ScriptChunkLokadMap = new Map()
SCRIPT_CHUNK_LOKAD.set(0x52414e4b, 'RANK') // RANK v1
// SCRIPT_CHUNK_LOKAD.set(0x524e4b32, 'RNK2') // RANK v2
/** Sentiment chunk map */
const SCRIPT_CHUNK_SENTIMENT: ScriptChunkSentimentMap = new Map()
SCRIPT_CHUNK_SENTIMENT.set(0x60, 'neutral') // OP_16
SCRIPT_CHUNK_SENTIMENT.set(0x51, 'positive') // OP_1 | OP_TRUE
SCRIPT_CHUNK_SENTIMENT.set(0x00, 'negative') // OP_0 | OP_FALSE
/** Platform chunk map */
const SCRIPT_CHUNK_PLATFORM: ScriptChunkPlatformMap = new Map()
//SCRIPT_CHUNK_PLATFORM.set(0x00, 'web_url') // any URL; the PROFILE script chunk is not necessary
SCRIPT_CHUNK_PLATFORM.set(0x00, 'lotusia') // Lotusia Explorer/dashboard
SCRIPT_CHUNK_PLATFORM.set(0x01, 'twitter') // twitter.com/x.com
/** Length of the required RANK script chunks in bytes */
const RANK_SCRIPT_REQUIRED_LENGTH = 10
/** Required RANK script chunks */
const RANK_SCRIPT_CHUNKS_REQUIRED: {
  [key in keyof ScriptChunksRequired]: ScriptChunk
} = {
  lokad: {
    offset: 2,
    len: 4,
    map: SCRIPT_CHUNK_LOKAD,
  },
  sentiment: {
    offset: 6, // 0x51 | 0x00 (OP_TRUE | OP_FALSE)
    len: 1,
    map: SCRIPT_CHUNK_SENTIMENT,
  },
  platform: {
    offset: 8, // 0x01 push op at offset 7, then 1-byte platform begins at offset 8
    len: 1,
    map: SCRIPT_CHUNK_PLATFORM,
  },
  profileId: {
    offset: 10, // variable-length push op, then profileId begins at offset 10
    len: null, // specified in PlatformParameters
  },
}
/** Optional RANK script chunks */
const RANK_SCRIPT_CHUNKS_OPTIONAL: {
  [key in keyof ScriptChunksOptional]: ScriptChunk
} = {
  postId: {
    offset: null,
    len: null,
  },
  postHash: {
    offset: null,
    len: null,
  },
  instanceId: {
    offset: null,
    len: null,
  },
}
/** Platform configuration */
const PLATFORMS: {
  [name in ScriptChunkPlatformUTF8]: PlatformParameters | null
} = {
  lotusia: null,
  telegram: null,
  twitter: {
    profileId: {
      len: 16,
    },
    postId: {
      len: 8, // 64-bit uint: https://developer.x.com/en/docs/x-ids
      regex: /^[0-9]+$/,
      reader: 'readBigUInt64BE',
      type: 'BigInt',
    },
  },
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

export {
  // API URLs
  CHRONIK_API_URL,
  NODE_GEOIP_URL,
  RANK_API_URL,
  // RANK constants
  RANK_OUTPUT_MIN_VALID_SATS,
  RANK_BLOCK_GENESIS_V1,
  RANK_SCRIPT_REQUIRED_LENGTH,
  RANK_SCRIPT_CHUNKS_REQUIRED,
  RANK_SCRIPT_CHUNKS_OPTIONAL,
  // RANK script chunk maps
  SCRIPT_CHUNK_LOKAD,
  SCRIPT_CHUNK_SENTIMENT,
  SCRIPT_CHUNK_PLATFORM,
  // Platform configuration
  PLATFORMS,
  PlatformURL,
}
