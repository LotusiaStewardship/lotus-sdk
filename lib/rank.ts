/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
// RANK script types
type ScriptChunkLokadUTF8 = 'RANK' | 'RNKC'
type ScriptChunkPlatformUTF8 = 'lotusia' | 'twitter'
type ScriptChunkSentimentUTF8 = 'positive' | 'negative' | 'neutral'
type ScriptChunkLokadMap = Map<number, ScriptChunkLokadUTF8>
type ScriptChunkPlatformMap = Map<number, ScriptChunkPlatformUTF8>
type ScriptChunkSentimentMap = Map<number, ScriptChunkSentimentUTF8>
type ScriptChunkField =
  | 'lokad'
  | 'sentiment'
  | 'platform'
  | 'profileId'
  | 'postId'
  | 'postHash'
  | 'instanceId'
type ScriptChunk = {
  /** Byte offset of the chunk in the output script */
  offset: number | null
  /** Byte length of the chunk in the output script */
  len: number | null
  /** Map of supported RANK script chunks */
  map?: ScriptChunkLokadMap | ScriptChunkPlatformMap | ScriptChunkSentimentMap
}
/** Required RANK script chunks */
type ScriptChunksRequired = {
  [name in Exclude<
    ScriptChunkField,
    'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** Optional RANK script chunks */
type ScriptChunksOptional = {
  [name in Extract<
    ScriptChunkField,
    'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** OP_RETURN \<RANK\> \<sentiment\> \<profileId\> [\<postId\> \<postHash\> [\<instanceId\>]] */
type RankOutput = {
  sentiment: ScriptChunkSentimentUTF8 // positive or negative sentiment (can support more)
  platform: ScriptChunkPlatformUTF8 // e.g. Twitter/X.com, etc.
  profileId: string // who the ranking is for
  postId?: string // optional post ID if ranking specific content
  postHash?: string // optional hash of the post content (required if postId is provided)
  instanceId?: string // ID of the registered extension instance
}
/**  */
type RankTransaction = RankOutput & {
  txid: string
  firstSeen: bigint // time first seen by indexer, only for new mempool transactions
  scriptPayload: string
  height?: number // undefined if mempool
  sats: bigint
  timestamp: bigint // unix timestamp
}
type RankTarget = {
  id: string // profileId, postId, etc
  platform: string
  ranking: bigint
  ranks: Omit<RankTransaction, 'profileId' | 'platform'>[] // omit the database relation fields
  satsPositive: bigint
  satsNegative: bigint
  votesPositive: number
  votesNegative: number
}
/**
 * `RankTransaction` objects are converted to a `ProfileMap` for database ops
 *
 * `string` is `profileId`
 */
type ProfileMap = Map<string, Profile>
type PostMap = Map<string, Post>
/**  */
type Profile = RankTarget & {
  posts?: PostMap
}
/**  */
type Post = RankTarget & {
  profileId: string
  /** The hash of the post content (i.e. RankOutput['postHash']) */
  hash: string
}

/** Platform parameters */
type PlatformParameters = {
  profileId: {
    len: number
  }
  postId: {
    len: number
    regex: RegExp
    reader: 'readBigUInt64BE' // additional Buffer reader methods if needed
    type: 'BigInt' | 'Number' | 'String'
  }
}

/** LOKAD chunk map */
const LOKAD_PREFIX_RANK = 0x52414e4b // RANK v1
const LOKAD_PREFIX_RNKC = 0x524e4b43 // RANK Comment
const SCRIPT_CHUNK_LOKAD: ScriptChunkLokadMap = new Map()
SCRIPT_CHUNK_LOKAD.set(LOKAD_PREFIX_RANK, 'RANK') // RANK v1
SCRIPT_CHUNK_LOKAD.set(LOKAD_PREFIX_RNKC, 'RNKC') // RANK Comment
// SCRIPT_CHUNK_LOKAD.set(0x524e4b32, 'RNK2') // RANK v2
const RANK_SENTIMENT_NEUTRAL = 0x60 // OP_16
const RANK_SENTIMENT_POSITIVE = 0x51 // OP_1 | OP_TRUE
const RANK_SENTIMENT_NEGATIVE = 0x00 // OP_0 | OP_FALSE
/** Sentiment chunk map */
const SCRIPT_CHUNK_SENTIMENT: ScriptChunkSentimentMap = new Map()
SCRIPT_CHUNK_SENTIMENT.set(RANK_SENTIMENT_NEUTRAL, 'neutral')
SCRIPT_CHUNK_SENTIMENT.set(RANK_SENTIMENT_POSITIVE, 'positive')
SCRIPT_CHUNK_SENTIMENT.set(RANK_SENTIMENT_NEGATIVE, 'negative')
/** Platform chunk map */
const SCRIPT_CHUNK_PLATFORM: ScriptChunkPlatformMap = new Map()
//SCRIPT_CHUNK_PLATFORM.set(0x00, 'web_url') // any URL; the PROFILE script chunk is not necessary
SCRIPT_CHUNK_PLATFORM.set(0x00, 'lotusia') // Lotusia Explorer/dashboard
SCRIPT_CHUNK_PLATFORM.set(0x01, 'twitter') // twitter.com/x.com
/** Length of the required RANK script chunks in bytes */
const RANK_SCRIPT_REQUIRED_LENGTH = 10
/** Required RANK script chunks */
const RANK_SCRIPT_CHUNKS_REQUIRED: Record<
  keyof ScriptChunksRequired,
  ScriptChunk
> = {
  lokad: {
    offset: 2,
    len: 4,
    map: SCRIPT_CHUNK_LOKAD,
  },
  sentiment: {
    offset: 6, // 0x60 | 0x51 | 0x00 (OP_16 | OP_1 | OP_0)
    len: 1,
    map: SCRIPT_CHUNK_SENTIMENT,
  },
  platform: {
    offset: 8, // 0x01 push op at offset 7, then 1-byte platform begins at offset 8
    len: 1,
    map: SCRIPT_CHUNK_PLATFORM,
  },
  profileId: {
    offset: 10, // variable-length push op, then profileId begins at offset 10
    len: null, // specified in PlatformParameters
  },
}
/** Optional RANK script chunks */
const RANK_SCRIPT_CHUNKS_OPTIONAL: {
  [key in keyof ScriptChunksOptional]: ScriptChunk
} = {
  postId: {
    offset: null,
    len: null,
  },
  postHash: {
    offset: null,
    len: null,
  },
  instanceId: {
    offset: null,
    len: null,
  },
}
/** Platform configuration */
const PLATFORMS: {
  [name in ScriptChunkPlatformUTF8]: Partial<PlatformParameters>
} = {
  lotusia: {},
  twitter: {
    profileId: {
      len: 16,
    },
    postId: {
      len: 8, // 64-bit uint: https://developer.x.com/en/docs/x-ids
      regex: /^[0-9]+$/,
      reader: 'readBigUInt64BE',
      type: 'BigInt',
    },
  },
}

/**
 * RANK script utilities
 */

/**
 * Convert the profile ID to a buffer
 * @param platform - The platform to convert the profile ID for
 * @param profileId - The profile ID to convert
 * @returns The profile ID buffer
 */
function toProfileIdBuf(
  platform: ScriptChunkPlatformUTF8,
  profileId: string,
): Buffer | null {
  const platformSpec = PLATFORMS[platform]
  if (!platformSpec) {
    return null
  }
  const profileIdSpec = platformSpec.profileId
  if (!profileIdSpec) {
    return null
  }
  const profileBuf = Buffer.alloc(profileIdSpec.len)
  profileBuf.write(profileId, profileIdSpec.len - profileId.length, 'utf8')

  return profileBuf
}
/**
 * Convert the `OP_RETURN` profile name back to UTF-8 with null bytes removed
 * @param profileIdBuf - The profile ID buffer to convert, padded with null bytes
 * @returns The UTF-8 profile ID
 */
function toProfileIdUTF8(profileIdBuf: Buffer) {
  return new TextDecoder('utf-8').decode(
    profileIdBuf.filter(byte => byte != 0x00),
  )
}
/**
 * Convert the post ID to a buffer
 * @param platform - The platform to convert the post ID for
 * @param postId - The post ID to convert
 * @returns The post ID buffer
 */
function toPostIdBuf(
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
}
/**
 * Convert the UTF-8 platform name to the defined 1-byte platform hex code
 * @param platform
 * @returns
 */
function toPlatformBuf(platform: ScriptChunkPlatformUTF8): Buffer | undefined {
  for (const [byte, platformName] of SCRIPT_CHUNK_PLATFORM) {
    if (platformName == platform) {
      return Buffer.from([byte])
    }
  }
}
/**
 * Convert the defined 1-byte platform hex code to the UTF-8 platform name
 * @param platformBuf
 */
function toPlatformUTF8(
  platformBuf: Buffer,
): ScriptChunkPlatformUTF8 | undefined {
  return SCRIPT_CHUNK_PLATFORM.get(platformBuf.readUint8())
}
/**
 * Convert the UTF-8 sentiment name to the defined 1-byte OP code
 * @param sentiment
 * @returns
 */
function toSentimentOpCode(sentiment: ScriptChunkSentimentUTF8) {
  switch (sentiment) {
    case 'neutral':
      return 'OP_16'
    case 'positive':
      return 'OP_1'
    case 'negative':
      return 'OP_0'
  }
}
/**
 * Convert the defined 1-byte sentiment OP code to the UTF-8 sentiment name
 * @param sentimentBuf
 */
function toSentimentUTF8(
  sentimentBuf: Buffer,
): ScriptChunkSentimentUTF8 | undefined {
  return SCRIPT_CHUNK_SENTIMENT.get(sentimentBuf.readUInt8())
}
/**
 * Convert the comment buffer to a UTF-8 string
 * @param commentBuf - The comment buffer to convert
 * @returns The UTF-8 string
 */
function toCommentUTF8(commentBuf: Buffer): string | undefined {
  return new TextDecoder('utf-8').decode(commentBuf)
}
/**
 * API operations
 */
const API = {
  auth: {
    scheme: 'BlockDataSig',
    param: ['blockhash', 'blockheight'],
  },
}

/**
 * A class to handle dynamic processing of script chunks with varying offsets and lengths
 */
class RankScriptProcessor {
  private chunks: Map<string, ScriptChunk> = new Map()
  private buffer: Buffer
  private platform: ScriptChunkPlatformUTF8 | undefined
  private currentOffset: number
  private processedOutput: RankOutput | null = null

  constructor(buffer: Buffer) {
    this.buffer = buffer
    this.currentOffset = 0
    this.registerRequiredChunks(RANK_SCRIPT_CHUNKS_REQUIRED)
  }

  /**
   * Get the current offset in the buffer
   * @returns The current offset
   */
  getCurrentOffset(): number {
    return this.currentOffset
  }

  /**
   * Set the current offset in the buffer
   * @param offset The offset to set
   */
  setCurrentOffset(offset: number): void {
    if (offset < 0 || offset > this.buffer.length) {
      throw new Error(
        `Invalid offset: ${offset}. Buffer length: ${this.buffer.length}`,
      )
    }
    this.currentOffset = offset
  }

  /**
   * Advance the current offset by the specified amount
   * @param amount The amount to advance by
   */
  advanceOffset(amount: number): void {
    const newOffset = this.currentOffset + amount
    if (newOffset > this.buffer.length) {
      throw new Error(
        `Cannot advance offset by ${amount}. Would exceed buffer length: ${this.buffer.length}`,
      )
    }
    this.currentOffset = newOffset
  }

  /**
   * Reset the current offset to the beginning of the buffer
   */
  resetOffset(): void {
    this.currentOffset = 0
  }

  /**
   * Register all required RANK script chunks
   * @param rankScriptChunksRequired The required script chunks configuration
   */
  private registerRequiredChunks(
    rankScriptChunksRequired: ScriptChunksRequired,
  ): void {
    // Register all required chunks from rankScriptChunksRequired
    Object.entries(rankScriptChunksRequired).forEach(([name, config]) => {
      this.chunks.set(name, config)
    })
  }

  /**
   * Register an optional chunk with its configuration
   * @param name The name of the chunk
   * @param config The chunk configuration
   */
  registerOptionalChunk(name: ScriptChunkField, config: ScriptChunk): void {
    // Verify this is an optional chunk
    if (name in this.chunks) {
      throw new Error(`Cannot register required chunk '${name}' as optional`)
    }
    this.chunks.set(name, config)
  }

  /**
   * Set the platform for postId processing
   * @param platform The platform to use for postId processing
   */
  setPlatform(platform: ScriptChunkPlatformUTF8): void {
    this.platform = platform
  }

  /**
   * Process the LOKAD chunk (RANK)
   * @returns The LOKAD value or undefined if invalid
   */
  processLokad(): ScriptChunkLokadUTF8 | undefined {
    const chunk = this.chunks.get('lokad')
    if (!chunk || chunk.offset === null || chunk.len === null) {
      return undefined
    }

    const lokadBuf = this.buffer.subarray(
      chunk.offset,
      chunk.offset + chunk.len,
    )
    return SCRIPT_CHUNK_LOKAD.get(lokadBuf.readUInt32BE(0))
  }

  /**
   * Process the sentiment chunk
   * @returns The sentiment value or undefined if invalid
   */
  processSentiment(): ScriptChunkSentimentUTF8 | undefined {
    const chunk = this.chunks.get('sentiment')
    if (!chunk || chunk.offset === null || chunk.len === null) {
      return undefined
    }
    const sentimentBuf = this.buffer.subarray(
      chunk.offset,
      chunk.offset + chunk.len,
    )
    return SCRIPT_CHUNK_SENTIMENT.get(sentimentBuf.readUInt8())
  }

  /**
   * Process the platform chunk
   * @returns The platform value or undefined if invalid
   */
  processPlatform(): ScriptChunkPlatformUTF8 | undefined {
    const chunk = this.chunks.get('platform')
    if (!chunk || chunk.offset === null || chunk.len === null) {
      return undefined
    }
    const platformBuf = this.buffer.subarray(
      chunk.offset,
      chunk.offset + chunk.len,
    )
    const platform = SCRIPT_CHUNK_PLATFORM.get(platformBuf.readUInt8())
    if (platform) {
      this.platform = platform
    }
    return platform
  }

  /**
   * Process the profileId chunk
   * @returns The profileId value or undefined if invalid
   */
  processProfileId(): string | undefined {
    const chunk = this.chunks.get('profileId')
    if (!chunk || chunk.offset === null || !this.platform) {
      return undefined
    }

    const platformSpec = PLATFORMS[this.platform]
    if (!platformSpec?.profileId) {
      return undefined
    }

    const profileIdSpec = platformSpec.profileId
    const profileIdBuf = this.buffer.subarray(
      chunk.offset,
      chunk.offset + profileIdSpec.len,
    )

    // profileId chunk must be padded to required length
    if (profileIdBuf.length < profileIdSpec.len) {
      return undefined
    }

    return toProfileIdUTF8(profileIdBuf)
  }

  /**
   * Process the postId chunk
   * @returns The postId value or undefined if invalid
   */
  processPostId(): string | null {
    if (!this.platform) {
      return null
    }

    const platformSpec = PLATFORMS[this.platform]
    if (!platformSpec.postId || !platformSpec.profileId) {
      return null
    }

    const profileIdChunk = this.chunks.get('profileId')
    if (!profileIdChunk?.offset) {
      return null
    }

    // Calculate postId offset: profileId offset + profileId length + push opcode (1 byte)
    const postIdSpec = platformSpec.postId
    const postIdOffset = profileIdChunk.offset + platformSpec.profileId.len + 1
    const postIdBuf = this.buffer.subarray(
      postIdOffset,
      postIdOffset + postIdSpec.len,
    )

    try {
      switch (postIdSpec.type) {
        case 'BigInt':
          return postIdBuf[postIdSpec.reader](0).toString()
        case 'Number':
          return postIdBuf.readUInt32BE(0).toString()
        case 'String':
          return postIdBuf.toString('utf8').replace(/\0/g, '')
        default:
          return null
      }
    } catch (e) {
      return null
    }
  }

  /**
   * Process the postHash chunk
   * @returns The postHash value or undefined if invalid
   */
  processPostHash(): string | null {
    if (!this.platform) {
      return null
    }

    const platformSpec = PLATFORMS[this.platform]
    if (!platformSpec.postId || !platformSpec.profileId) {
      return null
    }

    const profileIdChunk = this.chunks.get('profileId')
    if (!profileIdChunk?.offset) {
      return null
    }

    // Calculate postHash offset: profileId offset + profileId length + push opcode (1 byte) + postId length + push opcode (1 byte)
    const postHashOffset =
      profileIdChunk.offset +
      platformSpec.profileId.len +
      1 +
      platformSpec.postId.len +
      1
    const postHashBuf = this.buffer.subarray(
      postHashOffset,
      postHashOffset + 32, // SHA-256 hash is 32 bytes
    )

    return postHashBuf.toString('hex')
  }

  /**
   * Process the instanceId chunk
   * @returns The instanceId value or undefined if invalid
   */
  processInstanceId(): string | null {
    if (!this.platform) {
      return null
    }

    const platformSpec = PLATFORMS[this.platform]
    if (!platformSpec.postId || !platformSpec.profileId) {
      return null
    }

    const profileIdChunk = this.chunks.get('profileId')
    if (!profileIdChunk?.offset) {
      return null
    }

    // Calculate instanceId offset: profileId offset + profileId length + push opcode (1 byte) + postId length + push opcode (1 byte) + postHash length + push opcode (1 byte)
    const instanceIdOffset =
      profileIdChunk.offset +
      platformSpec.profileId.len +
      1 +
      platformSpec.postId.len +
      1 +
      32 +
      1
    const instanceIdBuf = this.buffer.subarray(
      instanceIdOffset,
      instanceIdOffset + 36, // UUID is 36 bytes
    )

    return instanceIdBuf.toString('utf8').replace(/\0/g, '')
  }

  /**
   * Process all required chunks and validate them
   * @returns true if all required chunks are valid, false otherwise
   */
  validateRequiredChunks(): boolean {
    // Check LOKAD (RANK)
    const lokad = this.processLokad()
    if (!lokad) {
      return false
    }

    // Check sentiment (positive/negative)
    const sentiment = this.processSentiment()
    if (!sentiment) {
      return false
    }

    // Check platform (twitter, etc)
    const platform = this.processPlatform()
    if (!platform) {
      return false
    }

    // Check profileId (must exist and be valid for the platform)
    const profileId = this.processProfileId()
    if (!profileId || !platform || !PLATFORMS[platform]?.profileId) {
      return false
    }

    // Store the processed output for future use
    this.processedOutput = {
      sentiment,
      platform,
      profileId,
    }

    return true
  }

  /**
   * Process all chunks and return a RankOutput object
   * @returns RankOutput object or null if required chunks are invalid
   */
  processRankOutput(): RankOutput | null {
    // If we already have processed output, return it
    if (this.processedOutput) {
      return this.processedOutput
    }

    if (!this.validateRequiredChunks()) {
      return null
    }

    // At this point, processedOutput is guaranteed to exist due to validateRequiredChunks
    const rankOutput = this.processedOutput!

    // Process optional chunks if they exist
    const platformSpec = PLATFORMS[rankOutput.platform]
    const profileIdChunk = this.chunks.get('profileId')
    if (!platformSpec?.profileId || !profileIdChunk?.offset) {
      return rankOutput
    }

    // Process postId if it exists
    const postId = this.processPostId()
    if (postId) {
      rankOutput.postId = postId

      // Process postHash if postId exists
      const postHash = this.processPostHash()
      if (postHash) {
        rankOutput.postHash = postHash

        // Process instanceId if postHash exists
        const instanceId = this.processInstanceId()
        if (instanceId) {
          rankOutput.instanceId = instanceId
        }
      }
    }

    return rankOutput
  }

  /**
   * Update the buffer being processed
   * @param newBuffer The new buffer to process
   */
  updateBuffer(newBuffer: Buffer): void {
    this.buffer = newBuffer
    this.processedOutput = null // Reset processed output when buffer changes
  }
}

export type {
  PlatformParameters,
  ScriptChunkField,
  ScriptChunkLokadUTF8,
  ScriptChunkLokadMap,
  ScriptChunkPlatformMap,
  ScriptChunkPlatformUTF8,
  ScriptChunkSentimentUTF8,
  ScriptChunkSentimentMap,
  ScriptChunksRequired,
  ScriptChunksOptional,
  ScriptChunk,
  RankOutput,
  RankTransaction,
  ProfileMap,
  PostMap,
  Profile,
  Post,
}

export {
  // Constants
  PLATFORMS,
  SCRIPT_CHUNK_LOKAD,
  SCRIPT_CHUNK_PLATFORM,
  SCRIPT_CHUNK_SENTIMENT,
  // LOKAD constants
  LOKAD_PREFIX_RANK,
  LOKAD_PREFIX_RNKC,
  // RANK sentiment constants
  RANK_SENTIMENT_NEUTRAL,
  RANK_SENTIMENT_POSITIVE,
  RANK_SENTIMENT_NEGATIVE,
  // RANK script parameters
  RANK_SCRIPT_REQUIRED_LENGTH,
  RANK_SCRIPT_CHUNKS_REQUIRED,
  RANK_SCRIPT_CHUNKS_OPTIONAL,
  // Functions
  toProfileIdBuf,
  toProfileIdUTF8,
  toPostIdBuf,
  toPlatformBuf,
  toPlatformUTF8,
  toSentimentOpCode,
  toSentimentUTF8,
  toCommentUTF8,
  // API
  API,
  // Classes
  RankScriptProcessor,
}
