/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { config } from 'dotenv'

config()

export const RPC = {
  user: process.env.NODE_RPC_USER,
  password: process.env.NODE_RPC_PASS,
  address: process.env.NODE_RPC_HOST,
  port: process.env.NODE_RPC_PORT,
}
