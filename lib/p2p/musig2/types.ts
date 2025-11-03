/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 P2P Message Types
 *
 * Defines message types for MuSig2 P2P coordination
 */

import { PublicKey } from '../../bitcore/publickey.js'
import { PrivateKey } from '../../bitcore/privatekey.js'
import {
  MuSigSession,
  MuSigSessionPhase,
} from '../../bitcore/musig2/session.js'

// ============================================================================
// Event Names
// ============================================================================

/**
 * MuSig2 P2P Coordinator Event Names
 *
 * All event names that can be emitted by the MuSig2P2PCoordinator
 */
export enum MuSig2Event {
  // Phase 0: Signer Advertisement Events
  SIGNER_ADVERTISED = 'signer:advertised',
  SIGNER_DISCOVERED = 'signer:discovered',
  SIGNER_UNAVAILABLE = 'signer:unavailable',
  SIGNER_WITHDRAWN = 'signer:withdrawn',

  // Phase 1-2: Signing Request Events
  SIGNING_REQUEST_CREATED = 'signing-request:created',
  SIGNING_REQUEST_RECEIVED = 'signing-request:received',
  SIGNING_REQUEST_JOINED = 'signing-request:joined',

  // Session Lifecycle Events
  SESSION_CREATED = 'session:created',
  SESSION_JOINED = 'session:joined',
  SESSION_READY = 'session:ready',
  SESSION_ANNOUNCED = 'session:announced',
  SESSION_CLOSED = 'session:closed',
  SESSION_ABORTED = 'session:aborted',
  SESSION_ERROR = 'session:error',
  SESSION_COMPLETE = 'session:complete',
  SESSION_NONCES_COMPLETE = 'session:nonces-complete',

  // Session Participants
  PARTICIPANT_JOINED = 'participant:joined',
  SESSION_PARTICIPANT_DISCONNECTED = 'session:participant-disconnected',

  // Coordinator Election & Failover Events
  SESSION_BROADCAST_CONFIRMED = 'session:broadcast-confirmed',
  SESSION_SHOULD_BROADCAST = 'session:should-broadcast',
  SESSION_COORDINATOR_FAILED = 'session:coordinator-failed',
  SESSION_FAILOVER_EXHAUSTED = 'session:failover-exhausted',

  // Peer Connection Events
  PEER_CONNECTED = 'peer:connected',
  PEER_DISCONNECTED = 'peer:disconnected',

  // MuSig2 Protocol Round Events
  ROUND1_COMPLETE = 'round1:complete',
  ROUND2_COMPLETE = 'round2:complete',
  SIGNATURE_FINALIZED = 'signature:finalized',
}

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * Event map for MuSig2P2PCoordinator events
 * Maps event names to their handler parameter types
 */
export type MuSig2EventMap = {
  // Phase 0: Signer Advertisement Events
  [MuSig2Event.SIGNER_ADVERTISED]: (advertisement: SignerAdvertisement) => void
  [MuSig2Event.SIGNER_DISCOVERED]: (advertisement: SignerAdvertisement) => void
  [MuSig2Event.SIGNER_UNAVAILABLE]: (data: {
    peerId: string
    publicKey: PublicKey
  }) => void
  [MuSig2Event.SIGNER_WITHDRAWN]: () => void

  // Phase 1-2: Signing Request Events
  [MuSig2Event.SIGNING_REQUEST_CREATED]: (request: SigningRequest) => void
  [MuSig2Event.SIGNING_REQUEST_RECEIVED]: (request: SigningRequest) => void
  [MuSig2Event.SIGNING_REQUEST_JOINED]: (requestId: string) => void

  // Session Lifecycle Events
  [MuSig2Event.SESSION_CREATED]: (sessionId: string) => void
  [MuSig2Event.SESSION_JOINED]: (sessionId: string) => void
  [MuSig2Event.SESSION_READY]: (sessionId: string) => void
  [MuSig2Event.SESSION_ANNOUNCED]: (data: {
    sessionId: string
    announcement: SessionAnnouncementData
  }) => void
  [MuSig2Event.SESSION_CLOSED]: (sessionId: string) => void
  [MuSig2Event.SESSION_ABORTED]: (sessionId: string, reason: string) => void
  [MuSig2Event.SESSION_ERROR]: (
    sessionId: string,
    error: string,
    code: string,
  ) => void
  [MuSig2Event.SESSION_COMPLETE]: (sessionId: string) => void
  [MuSig2Event.SESSION_NONCES_COMPLETE]: (sessionId: string) => void

  // Session Participants
  [MuSig2Event.PARTICIPANT_JOINED]: (data: {
    requestId: string
    participantIndex: number
    participantPeerId: string
    participantPublicKey: PublicKey
    timestamp: number
    signature: Buffer
  }) => void
  [MuSig2Event.SESSION_PARTICIPANT_DISCONNECTED]: (
    sessionId: string,
    peerId: string,
  ) => void

  // Coordinator Election & Failover Events
  [MuSig2Event.SESSION_BROADCAST_CONFIRMED]: (sessionId: string) => void
  [MuSig2Event.SESSION_SHOULD_BROADCAST]: (
    sessionId: string,
    coordinatorIndex: number,
  ) => void
  [MuSig2Event.SESSION_COORDINATOR_FAILED]: (
    sessionId: string,
    failedCoordinatorIndex: number,
    newCoordinatorIndex: number,
  ) => void
  [MuSig2Event.SESSION_FAILOVER_EXHAUSTED]: (
    sessionId: string,
    attempts: number,
  ) => void

  // Peer Connection Events
  [MuSig2Event.PEER_CONNECTED]: (peerId: string) => void
  [MuSig2Event.PEER_DISCONNECTED]: (peerId: string) => void

  // MuSig2 Protocol Round Events
  [MuSig2Event.ROUND1_COMPLETE]: (sessionId: string) => void
  [MuSig2Event.ROUND2_COMPLETE]: (sessionId: string) => void
  [MuSig2Event.SIGNATURE_FINALIZED]: (
    sessionId: string,
    signature: Buffer,
  ) => void
}

/**
 * MuSig2-specific message types
 */
export enum MuSig2MessageType {
  // Phase 0: Signer advertisement
  SIGNER_ADVERTISEMENT = 'musig2:signer-advertisement',
  SIGNER_UNAVAILABLE = 'musig2:signer-unavailable',

  // Phase 1-2: Signing request lifecycle
  SIGNING_REQUEST = 'musig2:signing-request',
  PARTICIPANT_JOINED = 'musig2:participant-joined',
  SESSION_READY = 'musig2:session-ready',
  SESSION_ABORT = 'musig2:session-abort',

  // Legacy: Session lifecycle (deprecated, kept for compatibility)
  SESSION_ANNOUNCE = 'musig2:session-announce',
  SESSION_JOIN = 'musig2:session-join',

  // Round 1: Nonce exchange
  NONCE_SHARE = 'musig2:nonce-share',
  NONCE_ACK = 'musig2:nonce-ack',
  NONCES_COMPLETE = 'musig2:nonces-complete',

  // Round 2: Partial signatures
  PARTIAL_SIG_SHARE = 'musig2:partial-sig-share',
  PARTIAL_SIG_ACK = 'musig2:partial-sig-ack',
  PARTIAL_SIGS_COMPLETE = 'musig2:partial-sigs-complete',

  // Finalization
  SIGNATURE_FINALIZED = 'musig2:signature-finalized',

  // Error handling
  VALIDATION_ERROR = 'musig2:validation-error',
}

/**
 * Session announcement payload
 */
export interface SessionAnnouncementPayload {
  sessionId: string
  signers: string[] // Public keys as hex strings (compressed)
  creatorIndex: number
  message: string // Message hash as hex string
  requiredSigners: number
  metadata?: Record<string, unknown>
  expiresAt?: number
  /** Coordinator election data (optional) */
  election?: {
    coordinatorIndex: number
    electionMethod?: string
    electionProof: string
  }
  /** Cryptographic signature by session creator to prevent DHT poisoning */
  creatorSignature?: string // Schnorr signature as hex
}

/**
 * Base interface for session-specific messages
 * Includes replay protection via sequence numbers
 */
export interface SessionMessage {
  sessionId: string
  signerIndex: number
  sequenceNumber: number // Strictly increasing per signer per session
  timestamp: number // Unix timestamp in milliseconds
}

/**
 * Session join payload
 */
export interface SessionJoinPayload extends SessionMessage {
  publicKey: string // This signer's public key as hex
}

/**
 * Nonce share payload
 * Public nonces are [Point, Point] where each Point is 33 bytes (compressed)
 */
export interface NonceSharePayload extends SessionMessage {
  publicNonce: {
    R1: string // Compressed point (33 bytes) as hex
    R2: string // Compressed point (33 bytes) as hex
  }
}

/**
 * Partial signature share payload
 */
export interface PartialSigSharePayload extends SessionMessage {
  partialSig: string // BN as hex string (32 bytes)
}

/**
 * Session status
 */
export interface SessionStatusPayload {
  sessionId: string
  phase: MuSigSessionPhase
  noncesCollected: number
  noncesTotal: number
  partialSigsCollected: number
  partialSigsTotal: number
}

/**
 * Error payload
 */
export interface ValidationErrorPayload {
  sessionId: string
  error: string
  code: string
  context?: Record<string, unknown>
}

/**
 * Security constants for GossipSub and P2P message validation
 *
 * These prevent DoS, spam, and timing attacks
 */
export const MUSIG2_SECURITY_LIMITS = {
  /** Maximum advertisement message size in bytes (prevents memory exhaustion) */
  MAX_ADVERTISEMENT_SIZE: 10_000, // 10KB

  /** Maximum timestamp skew allowed in milliseconds (prevents time-based attacks) */
  MAX_TIMESTAMP_SKEW: 300_000, // 5 minutes

  /** Minimum interval between advertisements from same peer (rate limiting) */
  MIN_ADVERTISEMENT_INTERVAL: 60_000, // 60 seconds

  /** Maximum invalid signatures per peer before potential ban */
  MAX_INVALID_SIGNATURES_PER_PEER: 10,
} as const

/**
 * MuSig2 P2P configuration (optional - used for customizing behavior)
 */
export interface MuSig2P2PConfig {
  /** Session timeout (ms) */
  sessionTimeout?: number

  /** Enable session announcement to DHT */
  enableSessionDiscovery?: boolean

  /** DHT resource type for sessions */
  sessionResourceType?: string

  /** Enable coordinator election (default: false) */
  enableCoordinatorElection?: boolean

  /** Coordinator election method (default: 'lexicographic') */
  electionMethod?:
    | 'lexicographic'
    | 'hash-based'
    | 'first-signer'
    | 'last-signer'

  /** Enable automatic coordinator failover (default: true if election enabled) */
  enableCoordinatorFailover?: boolean

  /** Broadcast timeout in milliseconds (default: 5 minutes) */
  broadcastTimeout?: number

  /** Enable message replay protection (default: true) */
  enableReplayProtection?: boolean

  /** Maximum allowed sequence number gap to detect suspicious activity (default: 100) */
  maxSequenceGap?: number

  /** Enable automatic session cleanup (default: true) */
  enableAutoCleanup?: boolean

  /** Session cleanup interval in milliseconds (default: 60000 = 1 minute) */
  cleanupInterval?: number

  /** Timeout for detecting stuck sessions in milliseconds (default: 600000 = 10 minutes) */
  stuckSessionTimeout?: number

  /**
   * Security limits for GossipSub/P2P message validation
   * Override defaults if needed (not recommended)
   */
  securityLimits?: Partial<typeof MUSIG2_SECURITY_LIMITS>
}

/**
 * Active session tracking
 */
export interface ActiveSession {
  sessionId: string
  session: MuSigSession // MuSigSession type
  participants: Map<number, string> // signerIndex -> peerId
  phase: MuSigSessionPhase
  createdAt: number
  updatedAt: number
  /** Last seen sequence number per signer (for replay protection) */
  lastSequenceNumbers: Map<number, number>
  /** Coordinator election data (optional) */
  election?: {
    coordinatorIndex: number
    coordinatorPeerId?: string
    electionProof: string
  }
  /** Coordinator failover tracking */
  failover?: {
    currentCoordinatorIndex: number
    broadcastDeadline: number // Timestamp when broadcast should occur
    broadcastTimeoutId?: NodeJS.Timeout // Timeout handle
    failoverAttempts: number // Number of failovers that have occurred
  }
}

/**
 * Session announcement metadata
 */
export interface SessionAnnouncementData {
  sessionId: string
  signers: PublicKey[]
  creatorPeerId: string
  creatorIndex: number
  message: Buffer
  requiredSigners: number
  createdAt: number
  expiresAt?: number
  metadata?: Record<string, unknown>
  /** Coordinator election data (optional) */
  election?: {
    coordinatorIndex: number
    electionMethod?: string
    electionProof: string
  }
  /** Cryptographic signature by session creator to prevent DHT poisoning */
  creatorSignature?: Buffer // Schnorr signature
}

// ============================================================================
// Signer Discovery & Directory Types
// ============================================================================

/**
 * Transaction types supported by the MuSig2 coordination layer
 *
 * These are used for signer discovery and advertisement
 */
export enum TransactionType {
  /** Standard spend transaction */
  SPEND = 'spend',
  /** Atomic swap transaction */
  SWAP = 'swap',
  /** CoinJoin privacy transaction */
  COINJOIN = 'coinjoin',
  /** Custody/multisig wallet transaction */
  CUSTODY = 'custody',
  /** Escrow transaction */
  ESCROW = 'escrow',
  /** Payment channel transaction */
  CHANNEL = 'channel',
}

/**
 * DHT resource types for MuSig2 coordination
 *
 * These define the well-known DHT keys used for discovery
 */
export enum DHTResourceType {
  /** Individual signer advertisement */
  SIGNER_ADVERTISEMENT = 'musig2-signer-advertisement',
  /** Signer directory entry (indexed by transaction type and pubkey) */
  SIGNER_DIRECTORY = 'musig2-signer-directory',
  /** Directory index (lists all signers for a transaction type) */
  SIGNER_DIRECTORY_INDEX = 'musig2-signer-directory-index',
  /** Session announcement */
  SESSION = 'musig2-session',
  /** Signing request */
  SIGNING_REQUEST = 'musig2-signing-request',
}

/**
 * Signer availability criteria
 * Defines what types of transactions a signer is willing to participate in
 */
export interface SignerCriteria {
  /** Types of transactions willing to sign */
  transactionTypes: TransactionType[]

  /** Minimum XPI amount (in satoshis) */
  minAmount?: number

  /** Maximum XPI amount (in satoshis) */
  maxAmount?: number

  /** Trust requirements */
  trustRequirements?: {
    /** Minimum reputation score (0-100) */
    reputation?: number
    /** Requires identity verification */
    requiresVerification?: boolean
  }
}

/**
 * Signer advertisement
 * Announces availability and public key to the network
 */
export interface SignerAdvertisement {
  /** Peer ID */
  peerId: string

  /** Peer multiaddrs (for direct connection) */
  multiaddrs: string[]

  /** Public key available for signing */
  publicKey: PublicKey

  /** Availability criteria */
  criteria: SignerCriteria

  /** Optional metadata */
  metadata?: {
    /** User-friendly nickname */
    nickname?: string
    /** Description of services */
    description?: string
    /** Fee for signing (satoshis) */
    fees?: number
    /** Average response time (milliseconds) */
    responseTime?: number
    /** Reputation data */
    reputation?: {
      score: number // 0-100
      completedSignings: number
      failedSignings: number
      averageResponseTime: number
      verifiedIdentity: boolean
    }
  }

  /** Creation timestamp */
  timestamp: number

  /** Expiration timestamp (advertisement TTL) */
  expiresAt: number

  /** Self-signed proof of public key ownership */
  signature: Buffer
}

/**
 * Signer advertisement payload (for P2P messages)
 */
export interface SignerAdvertisementPayload {
  peerId: string
  multiaddrs: string[] // Peer's network addresses
  publicKey: string // Hex-encoded
  criteria: SignerCriteria
  metadata?: SignerAdvertisement['metadata']
  timestamp: number
  expiresAt: number
  signature: string // Hex-encoded
}

/**
 * Signer search filters for discovering available signers
 *
 * Used with findAvailableSigners() to query the network/DHT
 */
export interface SignerSearchFilters {
  /** Transaction type to search for */
  transactionType?: TransactionType

  /** Minimum XPI amount (in satoshis) */
  minAmount?: number

  /** Maximum XPI amount (in satoshis) */
  maxAmount?: number

  /** Minimum reputation score (0-100) */
  minReputation?: number

  /** Maximum number of results to return */
  maxResults?: number
}

/**
 * Secure directory index entry
 *
 * Each entry is self-signed to prevent directory poisoning
 */
export interface DirectoryIndexEntry {
  /** Public key of the signer */
  publicKey: string

  /** Peer ID who added this entry */
  peerId: string

  /** Transaction type this entry is for */
  transactionType: TransactionType

  /** Timestamp when added */
  timestamp: number

  /** Self-signature proving ownership of publicKey */
  signature: string // Schnorr.sign(SHA256(publicKey || transactionType || timestamp), privateKey)
}

/**
 * Secure directory index
 *
 * Contains array of self-signed entries (append-only log)
 */
export interface SecureDirectoryIndex {
  /** Array of verified entries */
  entries: DirectoryIndexEntry[]

  /** Last update timestamp */
  lastUpdated: number

  /** Version number (for conflict resolution) */
  version: number
}

// ============================================================================
// Phase 1-2: Signing Request Types
// ============================================================================

/**
 * Signing request
 * Announces need for signatures from specific public keys
 *
 * Note: MuSig2 requires ALL participants (n-of-n signing)
 * For m-of-n threshold signatures, use FROST protocol or Taproot script paths
 */
export interface SigningRequest {
  /** Unique request ID */
  requestId: string

  /** Public keys that must sign (ALL required - MuSig2 is n-of-n) */
  requiredPublicKeys: PublicKey[]

  /** Message/transaction to sign */
  message: Buffer

  /** Creator's peer ID */
  creatorPeerId: string

  /** Creator's public key (should be in requiredPublicKeys) */
  creatorPublicKey: PublicKey

  /** Creation timestamp */
  createdAt: number

  /** Expiration timestamp */
  expiresAt: number

  /** Optional metadata */
  metadata?: {
    /** Full transaction hex (for context) */
    transactionHex?: string
    /** Transaction amount (satoshis) */
    amount?: number
    /** Transaction type */
    transactionType?: string
    /** Purpose description */
    purpose?: string
    /** Any additional context */
    [key: string]: unknown
  }

  /** Creator signature (proves legitimacy) */
  creatorSignature: Buffer

  /** Current participants (dynamically built) */
  joinedParticipants?: Map<number, string> // index -> peerId
}

/**
 * Signing request payload (for P2P messages)
 */
export interface SigningRequestPayload {
  requestId: string
  requiredPublicKeys: string[] // Hex-encoded (ALL must sign - n-of-n)
  message: string // Hex-encoded
  creatorPeerId: string
  creatorPublicKey: string // Hex-encoded
  createdAt: number
  expiresAt: number
  metadata?: SigningRequest['metadata']
  creatorSignature: string // Hex-encoded
}

/**
 * Participant joined payload
 */
export interface ParticipantJoinedPayload {
  requestId: string
  participantIndex: number
  participantPeerId: string
  participantPublicKey: string // Hex-encoded
  timestamp: number
  signature: string // Participant's signature proving ownership
}

// ============================================================================
// Updated Active Session (supports dynamic building)
// ============================================================================

/**
 * Active session tracking (updated for dynamic building)
 */
export interface ActiveSigningSession {
  /** Request/Session ID */
  sessionId: string

  /** Original signing request */
  request: SigningRequest

  /** Local MuSig session (created when threshold met) */
  session?: MuSigSession

  /** Participants who have joined (index -> peerId) */
  participants: Map<number, string>

  /** My index in the signers list */
  myIndex: number

  /** My private key */
  myPrivateKey?: PrivateKey

  /** Current phase */
  phase: 'waiting' | 'ready' | MuSigSessionPhase

  /** Creation timestamp */
  createdAt: number

  /** Last updated timestamp */
  updatedAt: number

  /** Last seen sequence number per signer (for replay protection) */
  lastSequenceNumbers: Map<number, number>

  /** Coordinator election data (optional) */
  election?: {
    coordinatorIndex: number
    coordinatorPeerId?: string
    electionProof: string
  }
}
