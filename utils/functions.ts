/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import {
  NODE_GEOIP_URL,
  PLATFORMS,
  PlatformURL,
  SCRIPT_CHUNK_PLATFORM,
  SCRIPT_CHUNK_SENTIMENT,
} from './constants'
import {
  GeoIPResponse,
  PlatformParameters,
  ScriptChunkPlatformUTF8,
  ScriptChunkSentimentUTF8,
} from './types'

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
  const json = await response.json()
  return (json.success ? json.data : {}) as GeoIPResponse
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
 * RANK script utilities
 */
export const RankScript = {
  /**
   * Convert the profile ID to a buffer
   * @param platform - The platform to convert the profile ID for
   * @param profileId - The profile ID to convert
   * @returns The profile ID buffer
   */
  toProfileIdBuf(
    platform: ScriptChunkPlatformUTF8,
    profileId: string,
  ): Buffer | null {
    const platformSpec = PLATFORMS[platform]
    if (!platformSpec) {
      return null
    }
    const profileIdSpec = platformSpec.profileId
    const profileBuf = Buffer.alloc(profileIdSpec.len)
    profileBuf.write(profileId, profileIdSpec.len - profileId.length, 'utf8')

    return profileBuf
  },
  /**
   * Convert the `OP_RETURN` profile name back to UTF-8 with null bytes removed
   * @param profileIdBuf - The profile ID buffer to convert, padded with null bytes
   * @returns The UTF-8 profile ID
   */
  toProfileIdUTF8(profileIdBuf: Buffer) {
    return new TextDecoder('utf-8').decode(
      profileIdBuf.filter(byte => byte != 0x00),
    )
  },
  /**
   * Convert the post ID to a buffer
   * @param platform - The platform to convert the post ID for
   * @param postId - The post ID to convert
   * @returns The post ID buffer
   */
  toPostIdBuf(
    platform: ScriptChunkPlatformUTF8,
    postId: string,
  ): Buffer | undefined {
    switch (PLATFORMS[platform]?.postId?.type) {
      case 'BigInt':
        return Buffer.from(BigInt(postId).toString(16), 'hex')
      case 'Number':
        return Buffer.from(Number(postId).toString(16), 'hex')
      case 'String':
        return Buffer.from(Buffer.from(postId).toString('hex'), 'hex')
    }
  },
  /**
   * Convert the UTF-8 platform name to the defined 1-byte platform hex code
   * @param platform
   * @returns
   */
  toPlatformBuf(platform: ScriptChunkPlatformUTF8): Buffer | undefined {
    for (const [byte, platformName] of SCRIPT_CHUNK_PLATFORM) {
      if (platformName == platform) {
        return Buffer.from([byte])
      }
    }
  },
  /**
   * Convert the defined 1-byte platform hex code to the UTF-8 platform name
   * @param platformBuf
   */
  toPlatformUTF8(platformBuf: Buffer): ScriptChunkPlatformUTF8 | undefined {
    return SCRIPT_CHUNK_PLATFORM.get(platformBuf.readUint8())
  },
  /**
   * Convert the UTF-8 sentiment name to the defined 1-byte OP code
   * @param sentiment
   * @returns
   */
  toSentimentOpCode(sentiment: ScriptChunkSentimentUTF8) {
    switch (sentiment) {
      case 'neutral':
        return 'OP_16'
      case 'positive':
        return 'OP_1'
      case 'negative':
        return 'OP_0'
    }
  },
  /**
   * Convert the defined 1-byte sentiment OP code to the UTF-8 sentiment name
   * @param sentimentBuf
   */
  toSentimentUTF8(sentimentBuf: Buffer): ScriptChunkSentimentUTF8 | undefined {
    return SCRIPT_CHUNK_SENTIMENT.get(sentimentBuf.readUInt8())
  },
  /**
   * Convert the comment buffer to a UTF-8 string
   * @param commentBuf - The comment buffer to convert
   * @returns The UTF-8 string
   */
  toCommentUTF8(commentBuf: Buffer): string | undefined {
    return new TextDecoder('utf-8').decode(commentBuf)
  },
}
