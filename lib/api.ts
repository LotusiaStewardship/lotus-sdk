export type InstanceData = {
  instanceId: string
  runtimeId: string
  startTime: string
  nonce: number
}
export type AuthorizationData = {
  instanceId: string
  scriptPayload: string
  blockhash: string
  blockheight: string
}
/** */
export type PostMeta = {
  hasWalletUpvoted: boolean
  hasWalletDownvoted: boolean
  txidsUpvoted: string[]
  txidsDownvoted: string[]
}
/** */
export type RankAPIParams = {
  platform: string
  profileId: string
}
/** Profile ranking returned from RANK backend API */
export type IndexedProfileRanking = RankAPIParams & {
  ranking: string
  satsPositive: string
  satsNegative: string
  votesPositive: number
  votesNegative: number
}
/** Post ranking returned from RANK backend API */
export type IndexedPostRanking = IndexedProfileRanking & {
  profile: IndexedProfileRanking
  postId: string
  postMeta?: PostMeta
}

/** Authentication header parameters provided to client for authorization to API */
export const AuthenticateHeader = {
  scheme: 'BlockDataSig',
  param: ['blockhash', 'blockheight'],
}
