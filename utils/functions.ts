/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { NODE_GEOIP_URL, PlatformURL } from './constants.js'
import * as RPC from '../lib/rpc.js'
import * as Bitcore from '../lib/bitcore/index.js'
import type { GeoIPResponse } from './types.js'
import {
  ScriptChunkPlatformUTF8,
  ScriptChunkSentimentUTF8,
} from '../lib/rank/index.js'

/**
 * Convert an iterable to an async iterable
 * @param collection - The collection to convert
 * @returns The async iterable
 */
export async function* toAsyncIterable<T>(collection: Iterable<T>) {
  for (const item of collection) {
    yield item
  }
}

/**
 * Get the GeoIP data for an IP address
 * @param ip - The IP address to get the GeoIP data for
 * @returns The GeoIP data for the IP address
 */
export async function getGeoIP(ip: string) {
  const response = await fetch(`${NODE_GEOIP_URL}/${ip}`)
  const json = (await response.json()) as GeoIPResponse
  return json.success ? json.data : {}
}

/**
 * Validate a sha256 hash
 * @param str - The sha256 hash to validate
 * @returns Whether the sha256 hash is valid
 */
export function isSha256(str: string) {
  return isHex(str, 64)
}

/**
 * Convert a number or UTF-8 string to a hex string
 * @param data - The data to convert
 * @returns The hex string
 */
export function toHex(data: number | string | Buffer) {
  switch (typeof data) {
    case 'number':
      return data.toString(16).padStart(2, '0')
    case 'string':
      return Buffer.from(data, 'utf8').toString('hex')
    case 'object':
      if (data instanceof Buffer) {
        return data.toString('hex')
      }
  }
  throw new Error('Invalid data type')
}

/**
 * Check if a string is hex-encoded, with optional `length` limit
 * @param str The string to check
 * @param length The length of the hex string to check. If not defined, checks the full string
 * @returns `true` if the string is hex-encoded, `false` otherwise
 */
export function isHex(str: string, length?: number): boolean {
  const regexStr = length ? `^[a-fA-F0-9]{${length}}$` : '^[a-fA-F0-9]+$'
  return new RegExp(regexStr).test(str)
}

/**
 * Check if a string is base64 encoded
 * @param str The string to check
 * @returns `true` if the string is base64 encoded, `false` otherwise
 */
export function isBase64(str: string): boolean {
  return new RegExp('^[a-zA-Z0-9+/]+={0,2}$').test(str)
}

/**
 * Decode a base64-encoded string
 * @param str The base64 encoded string to decode
 * @returns The decoded string
 */
export function decodeBase64(str: string) {
  if (!isBase64(str)) {
    throw new Error('Invalid base64 string')
  }
  return Buffer.from(str, 'base64').toString('utf8')
}

/**
 * Encode a UTF-8 string to a base64-encoded string. Optionally provide a different
 * encoding scheme for the input string
 * @param str The string to encode
 * @returns The base64 encoded string
 */
export function encodeBase64(str: string, encoding: BufferEncoding = 'utf8') {
  if (!new TextDecoder('utf8').decode(Buffer.from(str, encoding))) {
    throw new Error('Not a valid UTF-8 string')
  }
  return Buffer.from(str, encoding).toString('base64')
}

/**
 * Convert sats to XPI
 * @param sats - The number of sats to convert
 * @returns The number of XPI
 */
export function toXPIFromSats(sats: number | string) {
  return Number(sats) / 1_000_000
}

/**
 * Convert XPI to sats
 * @param xpi - The number of XPI to convert
 * @returns The number of sats
 */
export function toSatsFromXPI(xpi: number | string) {
  return Number(xpi) * 1_000_000
}

/**
 * Truncate a sha256 hash to 16 + 6 characters
 * @param sha256 - The sha256 hash to truncate
 * @returns The truncated sha256 hash
 */
export function truncateSha256(sha256: string) {
  return sha256.slice(0, 16) + '...' + sha256.slice(-6)
}

/**
 * Truncate a transaction id to 16 + 6 characters
 * @param txid - The transaction id to truncate
 * @returns The truncated transaction id
 */
export function truncateTxid(txid: string) {
  return txid.slice(0, 16) + '...' + txid.slice(-6)
}

/**
 * Truncate an address to 17 + 6 characters
 * @param address - The address to truncate
 * @returns The truncated address
 */
export function truncateAddress(address: string) {
  return address.slice(0, 17) + '...' + address.slice(-6)
}

/**
 * Truncate a block hash to 1 + 16 characters
 * @param blockHash - The block hash to truncate
 * @returns The truncated block hash
 */
export function truncateBlockHash(blockHash: string) {
  return blockHash.slice(0, 1) + '...' + blockHash.slice(-16)
}

/**
 * Calculate the number of blocks from the tip to the block height
 * @param tipHeight - The height of the tip
 * @param blockHeight - The height of the block
 * @returns The number of blocks from the tip to the block height
 */
export function numBlocksFromTip(tipHeight: number, blockHeight: number) {
  return tipHeight - blockHeight + 1
}

/**
 * Format a timestamp to a human readable string
 * @param timestamp - The timestamp to format
 * @returns The formatted timestamp
 */
export function formatTimestamp(timestamp: number | string) {
  const date = new Date(Number(timestamp) * 1000)
  return (
    date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC'
  )
}

/**
 * Convert a positive and negative vote count to a minified percentage
 * @param positive - The number of positive votes, in sats
 * @param negative - The number of negative votes, in sats
 * @returns The minified percentage
 */
export function toMinifiedPercent(positive: string, negative: string): string {
  const positiveNum = BigInt(positive)
  const negativeNum = BigInt(negative)
  if (positiveNum === 0n && negativeNum === 0n) {
    return '0'
  }
  if (positiveNum === 0n && negativeNum > 0n) {
    return '0'
  }
  if (positiveNum > 0n && negativeNum === 0n) {
    return '100'
  }
  const total = positiveNum + negativeNum
  const percent = (Number(positiveNum) / Number(total)) * 100
  return percent.toFixed(1)
}

/**
 * Convert a percentage to a color for profile vote ratio badge
 * @param percentage - The percentage to convert
 * @returns The color
 */
export function toPercentColor(percentage: string): string {
  const num = parseFloat(percentage)
  if (num <= 100 && num >= 90) {
    return 'green'
  } else if (num < 90 && num >= 80) {
    return 'lime'
  } else if (num < 80 && num >= 70) {
    return 'yellow'
  } else if (num < 70 && num >= 60) {
    return 'amber'
  } else if (num < 60 && num >= 50) {
    return 'orange'
  } else {
    return 'red'
  }
}

/**
 * Convert networkhashps to a minified hashrate
 * @param number - The networkhashps to convert
 * @returns The minified hashrate
 */
export function toMinifiedNumber(
  type: 'hashrate' | 'blocksize',
  number: number | string,
): string {
  let unit: string
  switch (type) {
    case 'hashrate':
      unit = 'H'
      break
    case 'blocksize':
      unit = 'B'
      break
  }
  // make sure we have a number
  const num = Number(number)
  if (isNaN(num)) {
    return number.toString()
  }
  switch (true) {
    case num >= 1_000_000_000_000_000:
      return `${(num / 1_000_000_000_000_000).toFixed(1)} P${unit}`
    case num >= 1_000_000_000_000:
      return `${(num / 1_000_000_000_000).toFixed(1)} T${unit}`
    case num >= 1_000_000_000:
      return `${(num / 1_000_000_000).toFixed(1)} G${unit}`
    case num >= 1_000_000:
      return `${(num / 1_000_000).toFixed(1)} M${unit}`
    case num >= 1_000:
      return `${(num / 1000).toFixed(1)} K${unit}`
    default:
      return `${num} ${unit}`
  }
}

/**
 * Convert a time to a minified time
 * @param time - The time to convert
 * @returns The minified time
 */
export function toMinifiedTime(seconds: number | string): string {
  const num = Number(seconds)
  if (isNaN(num)) {
    return seconds.toString()
  }
  switch (true) {
    case num >= 3600:
      return `${(num / 3600).toFixed(1)} hours`
    case num >= 60:
      return `${(num / 60).toFixed(1)} minutes`
    default:
      return `${num.toFixed(1)} seconds`
  }
}

/**
 * Determine trend color based on ranking change
 * @param change - The change to determine the color for
 * @returns The color
 */
export function getRankingColor(change: number): string {
  return change > 0 ? 'green' : change < 0 ? 'red' : 'gray'
}

/**
 * Get the sentiment color
 * @param sentiment - The sentiment to get the color for
 * @returns The color
 */
export function getSentimentColor(sentiment: ScriptChunkSentimentUTF8): string {
  switch (sentiment) {
    case 'positive':
      return 'green'
    case 'negative':
      return 'red'
    case 'neutral':
      return 'gray'
  }
}

/**
 * Calculate the rate
 * @param current - The current value
 * @param previous - The previous value
 * @param divisor - The divisor to use
 * @returns The rate
 */
export function calculateRate(
  current: number,
  previous: number,
  divisor: number = 1_000_000,
) {
  return ((current - previous) / divisor) * 100
}

/**
 * Format ranking change rate as percentage
 * @param rate - The rate to format
 * @returns The formatted rate
 */
export function formatRate(rate: number) {
  if (!isFinite(rate)) return 'New'
  return `${Math.abs(rate).toFixed(1)}%`
}

/**
 * Convert the first letter of a string to uppercase
 * @param str - The string to convert
 * @returns The string with the first letter converted to uppercase
 */
export function toUppercaseFirstLetter(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Convert the sentiment to a trending icon
 * @param sentiment - The sentiment to convert
 * @returns The trending icon
 */
export function toTrendingIcon(sentiment: ScriptChunkSentimentUTF8) {
  return sentiment === 'positive'
    ? 'i-mdi-arrow-up-thin'
    : 'i-mdi-arrow-down-thin'
}

/**
 * Convert the platform and profile ID to a profile URL
 * @param platform - The platform to convert
 * @param profileId - The profile ID to convert
 * @returns The profile URL
 */
export function toProfileUrl(platform: string, profileId: string) {
  return `/${platform}/${profileId}`
}

/**
 * Convert the platform, profile ID, and post ID to a post URL
 * @param platform - The platform to convert
 * @param profileId - The profile ID to convert
 * @param postId - The post ID to convert
 * @returns The post URL
 */
export function toPostUrl(
  platform: ScriptChunkPlatformUTF8,
  profileId: string,
  postId: string,
) {
  return `/${platform}/${profileId}/${postId}`
}

/**
 * Convert the platform, profile ID, and post ID to an external post URL
 * @param platform - The platform to convert
 * @param profileId - The profile ID to convert
 * @param postId - The post ID to convert
 * @returns The external post URL
 */
export function toExternalPostUrl(
  platform: ScriptChunkPlatformUTF8,
  profileId: string,
  postId: string,
) {
  return PlatformURL[platform]?.post(profileId, postId)
}

/**
 * Convert a number to a minified stat count
 * @param number - The number to convert
 * @param divisor - The divisor to use
 * @returns The minified stat count
 */
export function toMinifiedStatCount(
  number: number | string,
  divisor: number = 1_000_000,
) {
  number = Math.floor(Number(number) / divisor)
  if (number >= 1e9) {
    return `${(number / 1e9).toFixed(1)}B`
  } else if (number >= 1e6) {
    return `${(number / 1e6).toFixed(1)}M`
  } else if (number >= 1e3) {
    return `${(number / 1e3).toFixed(1)}K`
  } else if (number <= -1e3) {
    return `${(number / 1e3).toFixed(1)}K`
  } else if (number <= -1e6) {
    return `${(number / 1e6).toFixed(1)}M`
  } else if (number <= -1e9) {
    return `${(number / 1e9).toFixed(1)}B`
  }
  return `${number}`
}

/**
 * Truncate post ID for display
 * @param postId - The post ID to truncate
 * @returns The truncated post ID
 */
export function truncatePostId(postId: string) {
  return postId.length > 8 ? `${postId.substring(0, 8)}...` : postId
}

/**
 * Utility functions
 */
export const Util = {
  /** Sha256 operations */
  sha256: {
    /**
     * Validate a sha256 hash
     * @param str - The sha256 hash to validate
     * @returns Whether the sha256 hash is valid
     */
    validate(str: string) {
      return str.match(/^[a-f0-9]{64}$/)
    },
  },
  /** Base64 operations */
  base64: {
    /**
     * Encodes a string to a base64 encoded string
     * @param str The string to encode
     * @returns The base64 encoded string
     */
    encode(str: string) {
      return Buffer.from(str).toString('base64')
    },
    /**
     * Decodes a base64 encoded string
     * @param str The base64 encoded string to decode
     * @returns The decoded string
     */
    decode(str: string) {
      if (!isBase64(str)) {
        throw new Error('Invalid base64 string')
      }
      return Buffer.from(str, 'base64').toString('utf8')
    },
  },
  /** Crypto operations */
  crypto: {
    /**
     * Generates a random UUID
     * @returns The random UUID
     */
    randomUUID(): string {
      return crypto.randomUUID()
    },
  },
}
