/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { config } from 'dotenv'

config()

export const RPC = {
  user: process.env.RPC_USER,
  password: process.env.RPC_PASSWORD,
  address: process.env.RPC_ADDRESS,
  port: process.env.RPC_PORT,
}
