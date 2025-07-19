/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
/** */
export type Block = {
  hash: string
  height: number
  timestamp: bigint
  ranksLength: number // default is 0 if a block is cringe
  rnkcsLength: number // default is 0 if a block is cringe
  prevhash?: string // for reorg checks only; does not get saved to database
}

export type GeoIPData = {
  country: string
  city: string
}

export type GeoIPResponse = {
  success: boolean
  status: string
  ip: string
  data: GeoIPData
  type: 'unicast'
}
