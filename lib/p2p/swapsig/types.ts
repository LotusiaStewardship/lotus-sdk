/**
 * SwapSig Protocol Types
 *
 * Core type definitions for the SwapSig privacy protocol.
 * SwapSig achieves CoinJoin-equivalent privacy using MuSig2 multi-signatures.
 */

import type { PublicKey } from '../../bitcore/publickey.js'
import type { Address } from '../../bitcore/address.js'
import type { Script } from '../../bitcore/script.js'
import type { Transaction } from '../../bitcore/transaction/index.js'

/**
 * Swap pool phase state machine
 */
export enum SwapPhase {
  DISCOVERY = 'discovery', // Finding participants
  REGISTRATION = 'registration', // Registering inputs
  SETUP = 'setup', // Building Round 1 transactions
  SETUP_CONFIRM = 'setup-confirm', // Waiting for confirmations
  REVEAL = 'reveal', // Revealing final destinations
  SETTLEMENT = 'settlement', // Building Round 2 transactions (MuSig2)
  SETTLEMENT_CONFIRM = 'settlement-confirm', // Waiting for confirmations
  COMPLETE = 'complete', // All done
  ABORTED = 'aborted', // Failed
}

/**
 * Metadata for SwapSig MuSig2 signing requests
 *
 * Used to identify and filter SwapSig-specific signing requests
 * in the MuSig2 P2P layer.
 */
export interface SwapSigSigningMetadata {
  /** Transaction type (must be 'swap' for SwapSig) */
  transactionType: 'swap'

  /** SwapSig protocol phase */
  swapPhase: SwapPhase.SETTLEMENT // Only settlement uses MuSig2

  /** Pool identifier */
  swapPoolId: string

  /** Which shared output is being spent (for settlement) */
  outputIndex?: number

  /** Pre-built transaction hex */
  transactionHex?: string

  /** Whether this is a Taproot key-path spend */
  taprootKeyPath?: boolean

  /** Index signature for additional metadata */
  [key: string]: unknown
}

/**
 * Group size strategy for dynamic group sizing
 */
export interface GroupSizeStrategy {
  groupSize: number // 2, 3, 5, or 10
  groupCount: number // Number of groups
  anonymityPerGroup: number // Factorial of group size
  reasoning: string // Human-readable explanation
  recommendedRounds: number // Suggested number of rounds
}

/**
 * XPI burn configuration for Sybil defense
 */
export interface BurnConfig {
  burnPercentage: number // e.g., 0.001 = 0.1%
  minimumBurn: number // Min satoshis to burn (100 sats = 0.0001 XPI)
  maximumBurn: number // Max satoshis to burn (10,000 sats = 0.01 XPI)
  burnIdentifier: string // 'SWAPSIG_BURN'
  poolIdInBurn: boolean // Include pool ID in burn output
  version: number // Protocol version
}

/**
 * Default burn configuration
 */
export const DEFAULT_BURN_CONFIG: BurnConfig = {
  burnPercentage: 0.001, // 0.1%
  minimumBurn: 100, // 0.0001 XPI
  maximumBurn: 10000, // 0.01 XPI
  burnIdentifier: 'SWAPSIG_BURN',
  poolIdInBurn: true,
  version: 1,
}

/**
 * Participant input UTXO
 */
export interface ParticipantInput {
  txId: string
  outputIndex: number
  amount: number
  script: Script
  address: Address
}

/**
 * Swap participant data
 */
export interface SwapParticipant {
  // Identity
  peerId: string
  participantIndex: number
  publicKey: PublicKey

  // Input (public)
  input: ParticipantInput
  ownershipProof: Buffer // Schnorr signature over (poolId || txId || outputIndex)

  // Final destination (encrypted initially, revealed later)
  finalOutputEncrypted: Buffer
  finalOutputCommitment: Buffer // SHA256(encrypted)
  finalAddress?: Address // Revealed in Phase 4

  // Setup transaction (Round 1)
  setupTxId?: string
  setupConfirmed: boolean

  // Metadata
  joinedAt: number
}

/**
 * MuSig2 shared output from Round 1
 */
export interface SharedOutput {
  // Signers (n-of-n MuSig2)
  signers: PublicKey[] // 2, 3, 5, or 10 signers
  participantIndices?: number[] // Their indices

  // MuSig2 aggregation
  aggregatedKey: PublicKey // MuSig2 aggregated key
  taprootAddress: Address // Lotus Taproot address

  // Output details
  amount: number // Satoshis in this output
  txId?: string // Setup transaction ID
  outputIndex: number // Output index in setup tx
  confirmed?: boolean // Setup transaction confirmed

  // Settlement (Round 2)
  receiverIndex?: number // Who receives from this output
  receiverAddress?: Address // Receiver's final address
  settlementTxId?: string // Settlement transaction ID
  settlementConfirmed?: boolean
}

/**
 * Settlement mapping info
 */
export interface SettlementInfo {
  receiverIndex: number
  sourceOutputIndex: number
  sourceOutput: SharedOutput
  finalDestination: Address

  // MuSig2 session for this settlement
  requestId?: string // Three-phase MuSig2 request ID
  sessionId?: string // MuSig2 session ID (when ALL join)
  signers: PublicKey[]

  // Transaction
  transaction?: Transaction
  txId?: string
  confirmed: boolean
}

/**
 * Complete swap pool state
 */
export interface SwapPool {
  // ===== Identity =====
  poolId: string // 32-byte hex identifier
  creatorPeerId: string // P2P peer ID of creator

  // ===== Parameters =====
  denomination: number // Fixed swap amount (satoshis)
  minParticipants: number // Minimum required (e.g., 3)
  maxParticipants: number // Maximum allowed (e.g., 10)
  feeRate: number // Satoshis per byte
  feePerParticipant: number // Calculated fee per tx

  // ===== Sybil Defense =====
  burnConfig: BurnConfig // XPI burn configuration

  // ===== Dynamic Group Sizing =====
  groupSizeStrategy?: GroupSizeStrategy // Determined in setup phase

  // ===== Participants =====
  participants: SwapParticipant[] // All registered participants
  participantMap: Map<string, SwapParticipant> // peerId → participant

  // ===== Outputs =====
  outputGroups: number[][] // Groups of participant indices
  sharedOutputs: SharedOutput[] // MuSig2 shared outputs from Round 1
  settlementMapping: Map<number, SettlementInfo> // receiver → source output

  // ===== Transactions =====
  setupTransactions: (Transaction | undefined)[] // Round 1 transactions
  settlementTransactions: (Transaction | undefined)[] // Round 2 transactions
  settlementSessions: Map<string, string> // outputIndex → requestId

  // ===== State =====
  phase: SwapPhase // Current protocol phase
  createdAt: number // Unix timestamp
  startedAt?: number // When setup began
  completedAt?: number // When swap finished
  setupTimeout: number // Timeout for setup (ms)
  settlementTimeout: number // Timeout for settlement (ms)
  aborted: boolean // Whether pool failed
  abortReason?: string // Failure reason
}

/**
 * Pool announcement for DHT discovery
 */
export interface SwapPoolAnnouncement {
  poolId: string
  denomination: number
  minParticipants: number
  maxParticipants: number
  currentParticipants: number
  burnConfig: BurnConfig

  // Timing
  createdAt: number
  expiresAt: number
  setupTimeout: number
  settlementTimeout: number

  // Creator
  creatorPeerId: string
  creatorSignature: Buffer // Schnorr signature
}

/**
 * Pool creation parameters
 */
export interface CreatePoolParams {
  denomination: number
  minParticipants?: number // Default: 3
  maxParticipants?: number // Default: 10
  feeRate?: number // Default: 1 sat/byte
  burnPercentage?: number // Default: 0.001 (0.1%)
  setupTimeout?: number // Default: 600000 (10 min)
  settlementTimeout?: number // Default: 600000 (10 min)
}

/**
 * Pool discovery filters
 */
export interface PoolDiscoveryFilters {
  denomination?: number
  minParticipants?: number
  maxParticipants?: number
}

/**
 * SwapSig event types
 */
export enum SwapSigEvent {
  // Pool lifecycle
  POOL_CREATED = 'pool:created',
  POOL_JOINED = 'pool:joined',
  POOL_ABORTED = 'pool:aborted',
  POOL_COMPLETE = 'pool:complete',
  POOL_PHASE_CHANGED = 'pool:phase-changed',

  // Participant events
  PARTICIPANT_JOINED = 'participant:joined',
  PARTICIPANT_DROPPED = 'participant:dropped',

  // Setup round
  SETUP_TX_BROADCAST = 'setup:tx-broadcast',
  SETUP_CONFIRMED = 'setup:confirmed',
  SETUP_COMPLETE = 'setup:complete',

  // Destination reveal
  DESTINATION_REVEALED = 'destination:revealed',
  REVEAL_COMPLETE = 'reveal:complete',

  // Settlement round (integrates with MuSig2)
  SWAPSIG_REQUEST_JOINED = 'swapsig:request-joined',
  SWAPSIG_SESSION_READY = 'swapsig:session-ready',
  SWAPSIG_SESSION_COMPLETE = 'swapsig:session-complete',
  SETTLEMENT_TX_BROADCAST = 'settlement:tx-broadcast',
  SETTLEMENT_CONFIRMED = 'settlement:confirmed',
  SETTLEMENT_COMPLETE = 'settlement:complete',
}

/**
 * SwapSig event map
 * Extends MuSig2EventMap with SwapSig-specific events
 */
export type SwapSigEventMap = {
  // Pool lifecycle events
  [SwapSigEvent.POOL_CREATED]: (pool: SwapPool) => void
  [SwapSigEvent.POOL_JOINED]: (poolId: string, participantIndex: number) => void
  [SwapSigEvent.POOL_ABORTED]: (poolId: string, reason: string) => void
  [SwapSigEvent.POOL_COMPLETE]: (poolId: string) => void
  [SwapSigEvent.POOL_PHASE_CHANGED]: (
    poolId: string,
    newPhase: SwapPhase,
    oldPhase: SwapPhase,
  ) => void

  // Participant events
  [SwapSigEvent.PARTICIPANT_JOINED]: (
    poolId: string,
    participant: SwapParticipant,
  ) => void
  [SwapSigEvent.PARTICIPANT_DROPPED]: (poolId: string, peerId: string) => void

  // Setup round events
  [SwapSigEvent.SETUP_TX_BROADCAST]: (
    poolId: string,
    participantIndex: number,
    txId: string,
  ) => void
  [SwapSigEvent.SETUP_CONFIRMED]: (
    poolId: string,
    participantIndex: number,
  ) => void
  [SwapSigEvent.SETUP_COMPLETE]: (poolId: string) => void

  // Destination reveal events
  [SwapSigEvent.DESTINATION_REVEALED]: (
    poolId: string,
    participantIndex: number,
    address: Address,
  ) => void
  [SwapSigEvent.REVEAL_COMPLETE]: (poolId: string) => void

  // Settlement round events (MuSig2 integration)
  [SwapSigEvent.SWAPSIG_REQUEST_JOINED]: (
    requestId: string,
    poolId: string,
  ) => void
  [SwapSigEvent.SWAPSIG_SESSION_READY]: (
    sessionId: string,
    requestId: string,
  ) => void
  [SwapSigEvent.SWAPSIG_SESSION_COMPLETE]: (sessionId: string) => void
  [SwapSigEvent.SETTLEMENT_TX_BROADCAST]: (
    poolId: string,
    outputIndex: number,
    txId: string,
  ) => void
  [SwapSigEvent.SETTLEMENT_CONFIRMED]: (
    poolId: string,
    outputIndex: number,
  ) => void
  [SwapSigEvent.SETTLEMENT_COMPLETE]: (poolId: string) => void
}

/**
 * SwapSig message types (P2P protocol)
 */
export enum SwapSigMessageType {
  // Pool lifecycle
  POOL_ANNOUNCE = 'swapsig:pool-announce',
  POOL_JOIN = 'swapsig:pool-join',

  // Registration
  PARTICIPANT_REGISTERED = 'swapsig:participant-registered',
  REGISTRATION_ACK = 'swapsig:registration-ack',

  // Setup round
  SETUP_TX_BROADCAST = 'swapsig:setup-tx-broadcast',
  SETUP_CONFIRMED = 'swapsig:setup-confirmed',
  SETUP_COMPLETE = 'swapsig:setup-complete',

  // Destination reveal
  DESTINATION_REVEAL = 'swapsig:destination-reveal',
  REVEAL_COMPLETE = 'swapsig:reveal-complete',

  // Settlement round
  SETTLEMENT_TX_BROADCAST = 'swapsig:settlement-tx-broadcast',
  SETTLEMENT_CONFIRMED = 'swapsig:settlement-confirmed',
  SETTLEMENT_COMPLETE = 'swapsig:settlement-complete',

  // Errors
  POOL_ABORT = 'swapsig:pool-abort',
  PARTICIPANT_DROPPED = 'swapsig:participant-dropped',
}

/**
 * SwapSig P2P message payload
 */
export interface SwapSigMessage {
  type: SwapSigMessageType
  poolId: string
  from: string // peerId
  payload: unknown
  timestamp: number
  messageId: string
}

/**
 * Pool statistics
 */
export interface PoolStats {
  poolId: string
  phase: SwapPhase
  participants: number
  denomination: number
  totalBurned: number
  totalFees: number
  anonymitySet: number
  duration?: number
  setupDuration?: number
  settlementDuration?: number
}
