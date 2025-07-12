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

/** Authentication header parameters provided to client for authorization to API */
const AuthenticateHeader = {
  scheme: 'BlockDataSig',
  param: ['blockhash', 'blockheight'],
}

export type {
  InstanceData,
  AuthorizationData,
  PostMeta,
  RankAPIParams,
  IndexedProfileRanking,
  IndexedPostRanking,
  // Authentication headers
  AuthenticateHeader,
}
