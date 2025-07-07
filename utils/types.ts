/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
type InstanceData = {
  instanceId: string
  runtimeId: string
  startTime: string
  nonce: number
}
type AuthorizationData = {
  instanceId: string
  scriptPayload: string
  blockhash: string
  blockheight: string
}
/** */
type PostMeta = {
  hasWalletUpvoted: boolean
  hasWalletDownvoted: boolean
  txidsUpvoted: string[]
  txidsDownvoted: string[]
}
/** */
type RankAPIParams = {
  platform: string
  profileId: string
}
/** Profile ranking returned from RANK backend API */
type IndexedProfileRanking = RankAPIParams & {
  ranking: string
  satsPositive: string
  satsNegative: string
  votesPositive: number
  votesNegative: number
}
/** Post ranking returned from RANK backend API */
type IndexedPostRanking = IndexedProfileRanking & {
  profile: IndexedProfileRanking
  postId: string
  postMeta?: PostMeta
}
// RANK script types
type ScriptChunkLokadUTF8 = 'RANK' | 'RNK2' | 'RNKC'
type ScriptChunkPlatformUTF8 = 'lotusia' | 'twitter' | 'telegram'
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
/** */
type Block = {
  hash: string
  height: number
  timestamp: bigint
  ranksLength: number // default is 0 if a block is cringe
  prevhash?: string // for reorg checks only; does not get saved to database
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
/**
 * `RankTransaction` objects are converted to a `ProfileMap` for database ops
 *
 * `string` is `profileId`
 */
type ProfileMap = Map<string, Profile>
type PostMap = Map<string, Post>

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

type GeoIPData = {
  country: string
  city: string
}

type GeoIPResponse = {
  success: boolean
  status: string
  ip: string
  data: GeoIPData
  type: 'unicast'
}

export type {
  // API types
  InstanceData,
  AuthorizationData,
  PostMeta,
  RankAPIParams,
  IndexedProfileRanking,
  IndexedPostRanking,
  // Indexer types
  Block,
  // RANK script types
  ScriptChunkLokadUTF8,
  ScriptChunkPlatformUTF8,
  ScriptChunkSentimentUTF8,
  ScriptChunkLokadMap,
  ScriptChunkPlatformMap,
  ScriptChunkSentimentMap,
  ScriptChunkField,
  ScriptChunk,
  ScriptChunksRequired,
  ScriptChunksOptional,
  // RANK transaction types
  RankOutput,
  RankTransaction,
  RankTarget,
  Profile,
  Post,
  ProfileMap,
  PostMap,
  PlatformParameters,
  // Dashboard types
  GeoIPData,
  GeoIPResponse,
}
