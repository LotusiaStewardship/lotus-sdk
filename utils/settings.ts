/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { config } from 'dotenv'
import {
  NNG_SUB_SOCKET_PATH_DEFAULT,
  NNG_REQ_SOCKET_PATH_DEFAULT,
  RNKC_MIN_DATA_LENGTH,
  RNKC_MIN_FEE_RATE,
} from '../utils/constants'

const parsed = config({ path: '.env' }).parsed

if (!parsed) {
  throw new Error('Failed to load .env file')
}

export const RPC = {
  user: parsed.NODE_RPC_USER,
  password: parsed.NODE_RPC_PASS,
  address: parsed.NODE_RPC_HOST,
  port: parsed.NODE_RPC_PORT,
}

export const NNG = {
  subSocketPath: parsed.NNG_SUB_SOCKET_PATH || NNG_SUB_SOCKET_PATH_DEFAULT,
  reqSocketPath: parsed.NNG_REQ_SOCKET_PATH || NNG_REQ_SOCKET_PATH_DEFAULT,
}

export const RNKC = {
  minFeeRate: Number(parsed.RNKC_MIN_FEE_RATE) || RNKC_MIN_FEE_RATE,
  minDataLength: Number(parsed.RNKC_MIN_DATA_LENGTH) || RNKC_MIN_DATA_LENGTH,
}
