/**
 * MuSig2 P2P Coordination Types
 *
 * Type definitions for coordinating MuSig2 multi-signature sessions over P2P networks
 */

import type { PublicKey } from '../../bitcore/publickey.js'
import type { MuSigSession } from '../../bitcore/musig2/session.js'

// ============================================================================
// Message Types
// ============================================================================

/**
 * MuSig2 protocol message types
 */
export enum MuSig2MessageType {
  /** Announce a new session on GossipSub (discovery) */
  SESSION_ANNOUNCEMENT = 'musig2:session-announcement',

  /** Request to join a session (direct P2P) */
  SESSION_JOIN = 'musig2:session-join',

  /** Accept join request (direct P2P) */
  SESSION_JOIN_ACK = 'musig2:session-join-ack',

  /** Share nonce commitment (Phase 1a - direct P2P) */
  NONCE_COMMITMENT = 'musig2:nonce-commitment',

  /** Share public nonce (Phase 1b - direct P2P) */
  NONCE_SHARE = 'musig2:nonce-share',

  /** Share partial signature (Phase 2 - direct P2P) */
  PARTIAL_SIG_SHARE = 'musig2:partial-sig-share',

  /** Session abort notification (direct P2P) */
  SESSION_ABORT = 'musig2:session-abort',

  /** Session complete notification (direct P2P) */
  SESSION_COMPLETE = 'musig2:session-complete',
}

// ============================================================================
// Session Announcement (GossipSub)
// ============================================================================

/**
 * Session announcement data (published to GossipSub)
 * Used for session discovery by potential participants
 */
export interface SessionAnnouncement {
  /** Unique session ID */
  sessionId: string

  /** Required number of signers */
  requiredSigners: number

  /** Coordinator peer ID */
  coordinatorPeerId: string

  /** Sorted list of participant public keys (if predetermined) */
  signers?: string[]

  /** Message hash being signed (for verification) */
  messageHash: string

  /** Creation timestamp */
  createdAt: number

  /** Expiration timestamp */
  expiresAt: number

  /** Optional metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Direct P2P Message Payloads
// ============================================================================

/**
 * Join request payload
 */
export interface SessionJoinPayload {
  sessionId: string
  signerPublicKey: string
  timestamp: number
}

/**
 * Join acknowledgment payload
 */
export interface SessionJoinAckPayload {
  sessionId: string
  accepted: boolean
  signerIndex?: number
  reason?: string
  timestamp: number
}

/**
 * Nonce commitment payload (Phase 1a)
 *
 * Per Blockchain Commons specification:
 * "Parties exchange nonce commitments before revealing their actual nonces to ensure fairness."
 */
export interface NonceCommitmentPayload {
  sessionId: string
  signerIndex: number
  commitment: string // 32-byte hash serialized to hex
  timestamp: number
}

/**
 * Nonce share payload (Phase 1b)
 *
 * Revealed after all commitments are collected
 */
export interface NonceSharePayload {
  sessionId: string
  signerIndex: number
  publicNonce: {
    r1: string // Point serialized to hex
    r2: string // Point serialized to hex
  }
  timestamp: number
}

/**
 * Partial signature share payload
 */
export interface PartialSigSharePayload {
  sessionId: string
  signerIndex: number
  partialSig: string // BN serialized to hex
  timestamp: number
}

/**
 * Session abort payload
 */
export interface SessionAbortPayload {
  sessionId: string
  reason: string
  timestamp: number
}

/**
 * Session complete payload
 */
export interface SessionCompletePayload {
  sessionId: string
  finalSignature?: {
    r: string
    s: string
  }
  timestamp: number
}

// ============================================================================
// Session State Management
// ============================================================================

/**
 * P2P session participant info
 */
export interface SessionParticipant {
  /** Peer ID */
  peerId: string

  /** Signer index in session */
  signerIndex: number

  /** Public key */
  publicKey: PublicKey

  /** Whether nonce has been received */
  hasNonce: boolean

  /** Whether partial signature has been received */
  hasPartialSig: boolean

  /** Last seen timestamp */
  lastSeen: number
}

/**
 * P2P-enhanced MuSig2 session
 * Extends the base session with P2P coordination data
 */
export interface MuSig2P2PSession {
  /** Base session state */
  session: MuSigSession

  /** Coordinator peer ID (who created/manages session) */
  coordinatorPeerId: string

  /** Map of peer IDs to participants */
  participants: Map<string, SessionParticipant>

  /** Whether we are the coordinator */
  isCoordinator: boolean

  /** Session announcement (if published) */
  announcement?: SessionAnnouncement

  /** Creation timestamp */
  createdAt: number

  /** Last activity timestamp */
  lastActivity: number
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * MuSig2 P2P configuration
 */
export interface MuSig2P2PConfig {
  /** GossipSub topic for session announcements */
  announcementTopic?: string

  /** Session announcement TTL in milliseconds */
  announcementTTL?: number

  /** Timeout for nonce collection in milliseconds */
  nonceTimeout?: number

  /** Timeout for partial signature collection in milliseconds */
  partialSigTimeout?: number

  /** Maximum concurrent sessions */
  maxConcurrentSessions?: number

  /** Enable automatic session cleanup */
  enableAutoCleanup?: boolean

  /** Session cleanup interval in milliseconds */
  cleanupInterval?: number

  /** Enable coordinator election */
  enableCoordinatorElection?: boolean

  /** Election method (lexicographic, hash-based, first-signer, last-signer) */
  electionMethod?:
    | 'lexicographic'
    | 'hash-based'
    | 'first-signer'
    | 'last-signer'

  /** Enable automatic coordinator failover */
  enableCoordinatorFailover?: boolean

  /** Timeout for coordinator to broadcast (milliseconds) */
  broadcastTimeout?: number
}

/**
 * Default MuSig2 P2P configuration
 */
export const DEFAULT_MUSIG2_P2P_CONFIG: Required<MuSig2P2PConfig> = {
  announcementTopic: 'lotus/musig2/sessions',
  announcementTTL: 5 * 60 * 1000, // 5 minutes
  nonceTimeout: 60 * 1000, // 1 minute
  partialSigTimeout: 60 * 1000, // 1 minute
  maxConcurrentSessions: 10,
  enableAutoCleanup: true,
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  enableCoordinatorElection: true,
  electionMethod: 'lexicographic',
  enableCoordinatorFailover: true,
  broadcastTimeout: 5 * 60 * 1000, // 5 minutes
}

// ============================================================================
// Events
// ============================================================================

/**
 * MuSig2 coordination events
 */
export enum MuSig2Event {
  /** New session announced on network */
  SESSION_DISCOVERED = 'musig2:session-discovered',

  /** Session created locally */
  SESSION_CREATED = 'musig2:session-created',

  /** Participant joined session */
  PARTICIPANT_JOINED = 'musig2:participant-joined',

  /** All participants joined */
  SESSION_READY = 'musig2:session-ready',

  /** Nonce commitment received from participant */
  COMMITMENT_RECEIVED = 'musig2:commitment-received',

  /** All nonce commitments collected (Phase 1a complete) */
  COMMITMENTS_COMPLETE = 'musig2:commitments-complete',

  /** Nonce received from participant */
  NONCE_RECEIVED = 'musig2:nonce-received',

  /** All nonces collected (Phase 1b complete) */
  NONCES_COMPLETE = 'musig2:nonces-complete',

  /** Partial signature received */
  PARTIAL_SIG_RECEIVED = 'musig2:partial-sig-received',

  /** All partial signatures collected */
  PARTIAL_SIGS_COMPLETE = 'musig2:partial-sigs-complete',

  /** Session signing complete */
  SESSION_COMPLETE = 'musig2:session-complete',

  /** Session aborted */
  SESSION_ABORTED = 'musig2:session-aborted',

  /** Session timeout */
  SESSION_TIMEOUT = 'musig2:session-timeout',

  /** Error in session */
  SESSION_ERROR = 'musig2:session-error',

  /** Coordinator elected */
  COORDINATOR_ELECTED = 'musig2:coordinator-elected',

  /** You should broadcast (you are coordinator) */
  SHOULD_BROADCAST = 'musig2:should-broadcast',

  /** Coordinator failed, failover initiated */
  COORDINATOR_FAILED = 'musig2:coordinator-failed',

  /** All coordinators failed */
  FAILOVER_EXHAUSTED = 'musig2:failover-exhausted',

  /** Broadcast confirmed */
  BROADCAST_CONFIRMED = 'musig2:broadcast-confirmed',
}
