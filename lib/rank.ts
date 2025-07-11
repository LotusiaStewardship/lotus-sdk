/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { MAX_OP_RETURN_DATA } from '../utils/constants'
// RANK script types
type ScriptChunkLokadUTF8 = 'RANK' | 'RNKC'
type ScriptChunkPlatformUTF8 = 'lotusia' | 'twitter'
type ScriptChunkSentimentUTF8 = 'positive' | 'negative' | 'neutral'
type ScriptChunkLokadMap = Map<number, ScriptChunkLokadUTF8>
type ScriptChunkPlatformMap = Map<number, ScriptChunkPlatformUTF8>
type ScriptChunkSentimentMap = Map<number, ScriptChunkSentimentUTF8>
type ScriptChunkField =
  | 'sentiment'
  | 'platform'
  | 'profileId'
  | 'postId'
  | 'comment'
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
/** Required RNKC script chunks */
type ScriptChunksRNKC = {
  [name in Exclude<
    ScriptChunkField,
    'sentiment' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** Required RANK script chunks */
type ScriptChunksRANK = {
  [name in Exclude<
    ScriptChunkField,
    'comment' | 'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** Optional RANK script chunks */
type ScriptChunksOptionalRANK = {
  [name in Extract<
    ScriptChunkField,
    'postId' | 'postHash' | 'instanceId'
  >]: ScriptChunk
}
/** OP_RETURN \<RANK\> \<sentiment\> \<profileId\> [\<postId\> \<postHash\> [\<instanceId\>]] */
type TransactionOutputRANK = {
  sentiment: ScriptChunkSentimentUTF8 // positive or negative sentiment (can support more)
  platform: ScriptChunkPlatformUTF8 // e.g. Twitter/X.com, etc.
  profileId: string // who the ranking is for
  postId?: string // optional post ID if ranking specific content
  // postHash?: string // optional hash of the post content (required if postId is provided)
  // instanceId?: string // ID of the registered extension instance
}
/** OP_RETURN \<RNKC\> \<platform\> \<profileId\> \<postId\> \<comment\> */
type TransactionOutputRNKC = {
  platform: ScriptChunkPlatformUTF8 // e.g. Twitter/X.com, etc.
  profileId: string // who the ranking is for
  postId: string // post ID if ranking specific content
  comment: string // outIdx 1 and 2 concatenated
}
/**  */
type RankTransaction = TransactionOutputRANK & {
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
/** Sentiment OP code map */
const RANK_SENTIMENT_OP_CODES: Map<ScriptChunkSentimentUTF8, string> = new Map()
RANK_SENTIMENT_OP_CODES.set('neutral', 'OP_16')
RANK_SENTIMENT_OP_CODES.set('positive', 'OP_1')
RANK_SENTIMENT_OP_CODES.set('negative', 'OP_0')
/** Platform chunk map */
const SCRIPT_CHUNK_PLATFORM: ScriptChunkPlatformMap = new Map()
//SCRIPT_CHUNK_PLATFORM.set(0x00, 'web_url') // any URL; the PROFILE script chunk is not necessary
SCRIPT_CHUNK_PLATFORM.set(0x00, 'lotusia') // Lotusia Explorer/dashboard
SCRIPT_CHUNK_PLATFORM.set(0x01, 'twitter') // twitter.com/x.com
/** Required RANK Comment script chunks */
const ScriptChunksRNKCMap: Map<keyof ScriptChunksRNKC, ScriptChunk> = new Map()
ScriptChunksRNKCMap.set('platform', {
  offset: 7, // 0x01 push op at offset 6, then 1-byte platform begins at offset 7
  len: 1,
  map: SCRIPT_CHUNK_PLATFORM,
})
ScriptChunksRNKCMap.set('profileId', {
  offset: 9, // variable-length push op, then profileId begins at offset 9
  len: null, // specified in PlatformParameters
})
ScriptChunksRNKCMap.set('postId', {
  offset: null, // Comment data begins after OP_RETURN byte
  len: null, // specified in PlatformParameters
})
ScriptChunksRNKCMap.set('comment', {
  offset: null, // Comment data begins after OP_RETURN byte in outIdx 1 and 2
  len: null, // specified in PlatformParameters
})
/** Length of the required RANK script chunks in bytes */
const RANK_SCRIPT_REQUIRED_LENGTH = 10
/** Required RANK script chunks */
const ScriptChunksRANKMap: Map<keyof ScriptChunksRANK, ScriptChunk> = new Map()
ScriptChunksRANKMap.set('sentiment', {
  offset: 6, // OP_0 through OP_16 push number directly to stack; no push op
  len: 1,
  map: SCRIPT_CHUNK_SENTIMENT,
})
ScriptChunksRANKMap.set('platform', {
  offset: 8, // 0x01 push op at offset 7, then 1-byte platform begins at offset 8
  len: 1,
  map: SCRIPT_CHUNK_PLATFORM,
})
ScriptChunksRANKMap.set('profileId', {
  offset: 10, // variable-length push op, then profileId begins at offset 10
  len: null, // specified in PlatformParameters
})
const ScriptChunksOptionalRANKMap: Map<
  keyof ScriptChunksOptionalRANK,
  ScriptChunk
> = new Map()
ScriptChunksOptionalRANKMap.set('postId', {
  offset: null,
  len: null,
})
ScriptChunksOptionalRANKMap.set('postHash', {
  offset: null,
  len: null,
})
ScriptChunksOptionalRANKMap.set('instanceId', {
  offset: null,
  len: null,
})
/** Platform configuration */
const PLATFORMS: {
  [name in ScriptChunkPlatformUTF8]: Partial<PlatformParameters>
} = {
  lotusia: {
    profileId: {
      len: 20, // 20-byte P2PKH address
    },
    postId: {
      len: 32, // 32-byte sha256 hash
      regex: /^[0-9a-f]{64}$/,
      type: 'String',
    },
  },
  twitter: {
    profileId: {
      len: 16,
    },
    postId: {
      len: 8, // 64-bit uint: https://developer.x.com/en/docs/x-ids
      regex: /^[0-9]+$/,
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
  switch (platform) {
    case 'lotusia':
      return Buffer.from(postId, 'hex')
    case 'twitter':
      return Buffer.from(BigInt(postId).toString(16), 'hex')
    default:
      return undefined
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
  return RANK_SENTIMENT_OP_CODES.get(sentiment)
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
 * Create a hex-encoded RANK script from the given parameters
 * @param sentiment - The sentiment to use
 * @param platform - The platform to use
 * @param profileId - The profile ID to use
 * @param postId - The post ID to use
 * @returns The hex-encoded RANK script, as `Buffer`
 */
function toScriptRANK(
  sentiment: ScriptChunkSentimentUTF8,
  platform: ScriptChunkPlatformUTF8,
  profileId: string,
  postId?: string,
): Buffer {
  // validate sentiment and platform
  if (!sentiment || !platform || !profileId) {
    throw new Error('Must specify sentiment, platform, and profileId')
  }
  if (!PLATFORMS[platform]) {
    throw new Error('Invalid platform specified')
  }
  const platformSpec = PLATFORMS[platform]
  if (!platformSpec.profileId) {
    throw new Error('No platform profileId specification defined')
  }
  // create the script (OP_RETURN + push op + LOKAD prefix)
  let script = '6a' + '04' + LOKAD_PREFIX_RANK.toString(16)
  // Append the sentiment op code
  switch (sentiment) {
    case 'neutral':
      script += RANK_SENTIMENT_NEUTRAL.toString(16)
      break
    case 'positive':
      script += RANK_SENTIMENT_POSITIVE.toString(16)
      break
    case 'negative':
      script += RANK_SENTIMENT_NEGATIVE.toString(16)
      break
  }
  // Append the push op and platform byte
  script += '01' + toPlatformBuf(platform)!.toString('hex')
  // Append the push op for profileId length
  script += platformSpec.profileId.len.toString(16).padStart(2, '0')
  // Append the padded profileId
  script += toProfileIdBuf(platform, profileId)!.toString('hex') // push profileId
  // If postId is provided, append the postId according to the platform specification
  if (postId) {
    if (!platformSpec.postId) {
      throw new Error(
        'Post ID provided, but no platform post specification defined',
      )
    }
    // Append the push op for postId length
    script += platformSpec.postId.len.toString(16).padStart(2, '0')
    // Append the postId
    script += toPostIdBuf(platform, postId)!.toString('hex')
  }
  return script
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
 * Processor for defined LOKAD protocols (RANK, RNKC, etc.)
 * @param scripts - The scripts to process
 * @returns The output of the script or null if required chunks are invalid
 */
class ScriptProcessor {
  private chunks: Map<string, ScriptChunk>
  private platform: ScriptChunkPlatformUTF8 | undefined
  /** The LOKAD type */
  private type: ScriptChunkLokadUTF8 | undefined
  // Scripts for each output index
  private scripts: Buffer[]
  private processedOutput:
    | TransactionOutputRNKC
    | TransactionOutputRANK
    | null = null

  constructor(scripts: Buffer[]) {
    this.scripts = scripts
    this.type = this.processLokad()
    if (!this.type) {
      throw new Error('Invalid LOKAD type')
    }
    switch (this.type) {
      case 'RANK':
        this.chunks = ScriptChunksRANKMap
        break
      case 'RNKC':
        this.chunks = ScriptChunksRNKCMap
    }
  }

  /**
   * Check if the output is an OP_RETURN
   * @param outIdx - The output index to check
   * @returns true if the output is an OP_RETURN, false otherwise
   */
  isOpReturn(outIdx: number): boolean {
    return this.scripts[outIdx].readUInt8(0) === 0x6a // OP_RETURN
  }

  /**
   * Process the LOKAD chunk
   * @returns The LOKAD value or undefined if invalid
   */
  processLokad(): ScriptChunkLokadUTF8 | undefined {
    // Always check the first output index for OP_RETURN
    if (!this.isOpReturn(0)) {
      return undefined
    }
    // LOKAD is 4 bytes at offset 2 (OP_RETURN <PUSH OP> <4-byte LOKAD>)
    const lokadBuf = this.scripts[0].subarray(2, 6)
    const lokad = SCRIPT_CHUNK_LOKAD.get(lokadBuf.readUInt32BE(0))
    if (!lokad) {
      return undefined
    }
    return lokad
  }

  /**
   * Process the sentiment chunk (RANK)
   * @returns The sentiment value or undefined if invalid
   */
  processSentiment(): ScriptChunkSentimentUTF8 | undefined {
    const chunk = this.chunks.get('sentiment') as ScriptChunk
    const sentimentBuf = this.scripts[0].subarray(
      chunk.offset!,
      chunk.offset! + chunk.len!,
    )
    return SCRIPT_CHUNK_SENTIMENT.get(sentimentBuf.readUInt8())
  }

  /**
   * Process the platform chunk
   * @returns The platform value or undefined if invalid
   */
  processPlatform(): ScriptChunkPlatformUTF8 | undefined {
    const chunk = this.chunks.get('platform') as ScriptChunk
    const platformBuf = this.scripts[0].subarray(
      chunk.offset!,
      chunk.offset! + chunk.len!,
    )
    const platform = SCRIPT_CHUNK_PLATFORM.get(platformBuf.readUInt8())
    if (!platform) {
      return undefined
    }
    this.platform = platform
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
    const profileIdBuf = this.scripts[0].subarray(
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
    const postIdBuf = this.scripts[0].subarray(
      postIdOffset,
      postIdOffset + postIdSpec.len,
    )

    try {
      switch (this.platform) {
        case 'lotusia':
          return postIdBuf.toString('hex')
        case 'twitter':
          return postIdBuf.readBigUInt64BE(0).toString()
        default:
          return null
      }
    } catch (e) {
      return null
    }
  }

  /**
   * Process the RNKC comment chunks (outIdx 1 and 2)
   * @returns The comment value or null if invalid
   */
  processComment(): string | null {
    // If there are 3 scripts, concatenate outIdx 1 and 2, otherwise just use outIdx 1
    let commentBuf: Buffer = Buffer.alloc(0)
    for (let i = 1; i < this.scripts.length; i++) {
      commentBuf = Buffer.concat([commentBuf, this.scripts[i].subarray(3)])
    }
    if (!commentBuf) {
      return null
    }
    return toCommentUTF8(commentBuf) || null
  }

  /**
   * Validate the required RANK chunks and store the processed output
   * @returns true if all required chunks are valid, false otherwise
   */
  validateRequiredChunksRANK(): boolean {
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
    if (!profileId) {
      return false
    }

    // Store the processed output for future use
    this.processedOutput = {
      sentiment,
      platform,
      profileId,
    } as TransactionOutputRANK

    return true
  }
  /**
   * Validate the required RNKC chunks and store the processed output
   * @returns true if all required chunks are valid, false otherwise
   */
  validateRequiredChunksRNKC(): boolean {
    // Check platform (twitter, etc)
    const platform = this.processPlatform()
    if (!platform) {
      return false
    }

    // Check profileId (must exist and be valid for the platform)
    const profileId = this.processProfileId()
    if (!profileId) {
      return false
    }

    // Check postId (must exist and be valid for the platform)
    const postId = this.processPostId()
    if (!postId) {
      return false
    }

    // Process comment and set it in the output if it exists
    const comment = this.processComment()
    if (!comment) {
      return false
    }

    // Store the processed output for future use
    this.processedOutput = {
      platform,
      profileId,
      postId,
      comment,
    } as TransactionOutputRNKC

    return true
  }
  /**
   * Process the output of the script
   * @param type - The type of script to process
   * @returns The output of the script or null if required chunks are invalid
   */
  processOutput(): TransactionOutputRNKC | TransactionOutputRANK | null {
    // If we already have processed output, return it
    if (this.processedOutput) {
      return this.processedOutput
    }
    let output: TransactionOutputRNKC | TransactionOutputRANK | null = null

    switch (this.type) {
      case 'RANK': {
        if (!this.validateRequiredChunksRANK()) {
          return null
        }
        output = this.processedOutput! as TransactionOutputRANK

        // Process postId and set it in the output if it exists
        const postId = this.processPostId()
        if (postId) {
          output.postId = postId
        }
        break
      }
      case 'RNKC': {
        if (!this.validateRequiredChunksRNKC()) {
          return null
        }
        output = this.processedOutput! as TransactionOutputRNKC
        break
      }
    }

    return output
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
  ScriptChunksRNKC,
  ScriptChunksRANK,
  ScriptChunksOptionalRANK,
  ScriptChunk,
  TransactionOutputRANK,
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
  RANK_SENTIMENT_OP_CODES,
  // RANK script parameters
  RANK_SCRIPT_REQUIRED_LENGTH,
  ScriptChunksRANKMap,
  ScriptChunksRNKCMap,
  ScriptChunksOptionalRANKMap,
  // Functions
  toProfileIdBuf,
  toProfileIdUTF8,
  toPostIdBuf,
  toPlatformBuf,
  toPlatformUTF8,
  toSentimentOpCode,
  toSentimentUTF8,
  toCommentUTF8,
  toScriptRANK,
  // API
  API,
  // Classes
  ScriptProcessor,
}
