/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import type { ScriptChunkPlatformUTF8 } from '../lib/rank/index.js'

/**
 * API URLs
 */
export const CHRONIK_API_URL = 'http://172.16.11.102:7123'
// export const NODE_API_URL = 'https://explorer.lotusia.org/api'
export const NODE_GEOIP_URL = 'https://api.sefinek.net/api/v2/geoip'
export const RANK_API_URL = 'https://rank.lotusia.org/api/v1'

/**
 * Lotus constants
 */
/** Maximum relay size of an OP_RETURN payload, in bytes (OP_RETURN + OP_PUSHDATA1 + data) */
export const MAX_OP_RETURN_RELAY = 223
/** Maximum data size of the OP_RETURN payload, in bytes (OP_PUSHDATA1 + data) */
export const MAX_OP_RETURN_DATA = 220
/** Maximum number of OP_RETURN outputs allowed in a transaction by consensus */
export const MAX_OP_RETURN_OUTPUTS = 3

/**
 * RANK script configuration
 */
/** Minimum RANK burn value in sats */
export const RANK_OUTPUT_MIN_VALID_SATS = 1_000_000 // minimum RANK burn value in sats
/** Minimum RNKC burn value in sats */
export const RNKC_MIN_FEE_RATE = 10_000_000 // minimum RNKC burn value in sats
/** Minimum RNKC comment length in bytes */
export const RNKC_MIN_DATA_LENGTH = 1 // minimum RNKC comment length in bytes

/**
 * Dashboard configuration
 */
/** Platform URL configuration */
export const PlatformURL: {
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
