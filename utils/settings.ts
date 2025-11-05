/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { config } from 'dotenv'
import { RNKC_MIN_DATA_LENGTH, RNKC_MIN_FEE_RATE } from '../utils/constants.js'

// Load .env file if it exists (optional for P2P settings)
const parsed = config({ path: '.env' }).parsed || {}

export const RPC = {
  user: parsed.NODE_RPC_USER,
  password: parsed.NODE_RPC_PASS,
  address: parsed.NODE_RPC_HOST,
  port: parsed.NODE_RPC_PORT,
}

export const RNKC = {
  minFeeRate: Number(parsed.RNKC_MIN_FEE_RATE) || RNKC_MIN_FEE_RATE,
  minDataLength: Number(parsed.RNKC_MIN_DATA_LENGTH) || RNKC_MIN_DATA_LENGTH,
}

/**
 * P2P Network Configuration
 *
 * These limits apply to general P2P network connections (DHT, GossipSub, discovery).
 * MuSig2 session-specific connections are managed separately and are not counted
 * against these limits.
 *
 * Sane Defaults:
 * - maxConnections: 50 (adequate for most client nodes)
 * - minConnections: 10 (maintains network health)
 *
 * Recommended Ranges:
 * - Client nodes: 20-100 max, 5-20 min
 * - Bootstrap nodes: 100-500 max, 20-50 min
 *
 * Environment Variables:
 * - P2P_MAX_CONNECTIONS: Maximum general P2P connections (default: 50)
 * - P2P_MIN_CONNECTIONS: Minimum connections to maintain (default: 10)
 */
export const P2P = {
  /**
   * Maximum number of general P2P connections
   * This is separate from MuSig2 session-specific connections
   */
  maxConnections: Number(parsed?.P2P_MAX_CONNECTIONS) || 50,

  /**
   * Minimum number of P2P connections to maintain
   * libp2p will try to keep at least this many connections
   */
  minConnections: Number(parsed?.P2P_MIN_CONNECTIONS) || 10,
}
