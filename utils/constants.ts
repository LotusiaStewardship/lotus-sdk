/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { Block, ScriptChunkPlatformUTF8 } from './types'

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
  // Platform configuration
  PlatformURL,
}
