/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

import type { Address, Script, ScriptType } from '../lib/bitcore/index.js'

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

export type Wallet = {
  hdPrivateKey: string
  privateKey: string
  publicKey: string
  address: Address
  script: Script
  scriptPayload: string
  scriptType: ScriptType
}
