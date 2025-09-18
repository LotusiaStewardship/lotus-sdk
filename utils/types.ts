/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

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
