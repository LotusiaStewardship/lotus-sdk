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
import {
  MuSigSession,
  MuSigSessionPhase,
} from '../../bitcore/musig2/session.js'

/**
 * MuSig2-specific message types
 */
export enum MuSig2MessageType {
  // Session lifecycle
  SESSION_ANNOUNCE = 'musig2:session-announce',
  SESSION_JOIN = 'musig2:session-join',
  SESSION_READY = 'musig2:session-ready',
  SESSION_ABORT = 'musig2:session-abort',

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
