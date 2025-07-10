/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
/** */
type Block = {
  hash: string
  height: number
  timestamp: bigint
  ranksLength: number // default is 0 if a block is cringe
  prevhash?: string // for reorg checks only; does not get saved to database
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

export type {
  // Indexer types
  Block,
  // Dashboard types
  GeoIPData,
  GeoIPResponse,
}
