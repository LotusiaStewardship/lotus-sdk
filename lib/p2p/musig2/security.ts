/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 Security Utilities
 *
 * Provides security mechanisms for MuSig2 P2P coordination:
 * - Rate limiting for advertisements
 * - Public key limits per peer
 * - Invalid signature tracking
 * - Peer reputation management
 * - Blacklist/graylist functionality
 */

import { EventEmitter } from 'events'
import { PublicKey } from '../../bitcore/publickey.js'
import { MUSIG2_SECURITY_LIMITS } from './types.js'

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate limiter for peer advertisements
 * Prevents spam attacks by limiting advertisement frequency per peer
 */
export class AdvertisementRateLimiter {
  private lastAdvertisement: Map<string, number> = new Map()
  private violationCount: Map<string, number> = new Map()
  private emitter: EventEmitter

  constructor(emitter: EventEmitter) {
    this.emitter = emitter
  }

  /**
   * Check if peer can advertise
   * @param peerId - Peer ID
   * @param minInterval - Minimum interval in milliseconds (default: 60 seconds)
   * @returns true if allowed, false if rate limited
   */
  canAdvertise(peerId: string, minInterval: number = 60_000): boolean {
    const now = Date.now()
    const lastTime = this.lastAdvertisement.get(peerId)

    if (!lastTime) {
      this.lastAdvertisement.set(peerId, now)
      return true
    }

    const elapsed = now - lastTime
    if (elapsed < minInterval) {
      // Rate limit violation
      this.recordViolation(peerId)
      return false
    }

    this.lastAdvertisement.set(peerId, now)
    return true
  }

  /**
   * Record rate limit violation
   */
  private recordViolation(peerId: string): void {
    const count = (this.violationCount.get(peerId) || 0) + 1
    this.violationCount.set(peerId, count)

    // Auto-ban after 10 violations
    if (count >= 10) {
      this.emitter.emit('peer:should-ban', peerId, 'rate-limit-violations')
    }
  }

  /**
   * Clean up old entries (run periodically)
   */
  cleanup(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [peerId, timestamp] of this.lastAdvertisement) {
      if (now - timestamp > maxAge) {
        this.lastAdvertisement.delete(peerId)
        this.violationCount.delete(peerId)
      }
    }
  }

  /**
   * Get total violations across all peers
   */
  getTotalViolations(): number {
    let total = 0
    for (const count of this.violationCount.values()) {
      total += count
    }
    return total
  }
}

// ============================================================================
// Public Key Tracking
// ============================================================================

/**
 * Track and limit public keys per peer
 * Prevents Sybil attacks by limiting how many keys a single peer can advertise
 */
export class PeerKeyTracker {
  private peerKeys: Map<string, Set<string>> = new Map()
  private keyToPeer: Map<string, string> = new Map()

  /**
   * Check if peer can advertise another key
   * @param peerId - Peer ID
   * @param publicKey - Public key to advertise
   * @param maxKeysPerPeer - Maximum keys per peer (default: 10)
   * @returns true if allowed, false if limit exceeded
   */
  canAdvertiseKey(
    peerId: string,
    publicKey: PublicKey,
    maxKeysPerPeer: number = 10,
  ): boolean {
    const pubKeyStr = publicKey.toString()

    // Check if key already registered to different peer
    // 11/6/25: Disable this, because peers generate new peerIds at every startup
    // More important is that the signature is valid for the advertisement, which
    // is already done in the MuSig2 protocol handler
    /* const existingPeer = this.keyToPeer.get(pubKeyStr)
    if (existingPeer && existingPeer !== peerId) {
      console.warn(
        `[Security] Key ${pubKeyStr.slice(0, 20)}... already owned by ${existingPeer}`,
      )
      return false
    } */

    // Get peer's current keys
    let peerKeySet = this.peerKeys.get(peerId)
    if (!peerKeySet) {
      peerKeySet = new Set()
      this.peerKeys.set(peerId, peerKeySet)
    }

    // Check limit (allow if key is already in set - re-advertisement)
    if (peerKeySet.size >= maxKeysPerPeer && !peerKeySet.has(pubKeyStr)) {
      console.warn(
        `[Security] Peer ${peerId} exceeded key limit (${maxKeysPerPeer})`,
      )
      return false
    }

    // Add key
    peerKeySet.add(pubKeyStr)
    this.keyToPeer.set(pubKeyStr, peerId)
    return true
  }

  /**
   * Remove key (when advertisement expires)
   */
  removeKey(publicKey: PublicKey): void {
    const pubKeyStr = publicKey.toString()
    const peerId = this.keyToPeer.get(pubKeyStr)

    if (peerId) {
      const peerKeySet = this.peerKeys.get(peerId)
      peerKeySet?.delete(pubKeyStr)
      this.keyToPeer.delete(pubKeyStr)

      // Clean up empty set
      if (peerKeySet && peerKeySet.size === 0) {
        this.peerKeys.delete(peerId)
      }
    }
  }

  /**
   * Get key count for peer
   */
  getKeyCount(peerId: string): number {
    return this.peerKeys.get(peerId)?.size || 0
  }

  /**
   * Get all keys for peer
   */
  getPeerKeys(peerId: string): string[] {
    const keySet = this.peerKeys.get(peerId)
    return keySet ? Array.from(keySet) : []
  }
}

// ============================================================================
// Invalid Signature Tracking
// ============================================================================

/**
 * Track invalid signatures per peer
 * Identifies and penalizes peers sending invalid cryptographic data
 */
export class InvalidSignatureTracker {
  private invalidCounts: Map<string, number> = new Map()
  private firstViolation: Map<string, number> = new Map()
  private emitter: EventEmitter

  constructor(emitter: EventEmitter) {
    this.emitter = emitter
  }

  /**
   * Record invalid signature from peer
   */
  recordInvalidSignature(peerId: string): void {
    const count = (this.invalidCounts.get(peerId) || 0) + 1
    this.invalidCounts.set(peerId, count)

    if (!this.firstViolation.has(peerId)) {
      this.firstViolation.set(peerId, Date.now())
    }

    // Ban after threshold
    if (count >= MUSIG2_SECURITY_LIMITS.MAX_INVALID_SIGNATURES_PER_PEER) {
      this.emitter.emit('peer:should-ban', peerId, 'invalid-signatures')
    }
  }

  /**
   * Get invalid signature count
   */
  getCount(peerId: string): number {
    return this.invalidCounts.get(peerId) || 0
  }

  /**
   * Reset count (e.g., after 24 hours)
   */
  resetIfExpired(peerId: string, expiryMs: number = 24 * 60 * 60 * 1000): void {
    const firstTime = this.firstViolation.get(peerId)
    if (firstTime && Date.now() - firstTime > expiryMs) {
      this.invalidCounts.delete(peerId)
      this.firstViolation.delete(peerId)
    }
  }

  /**
   * Get total invalid signatures across all peers
   */
  getTotalInvalidSignatures(): number {
    let total = 0
    for (const count of this.invalidCounts.values()) {
      total += count
    }
    return total
  }
}

// ============================================================================
// Peer Reputation Management
// ============================================================================

/**
 * Peer score tracking
 */
export interface PeerScore {
  invalidSignatures: number
  spamCount: number
  rateLimitViolations: number
  lastViolation: number
  joinedSessions: number
  completedSessions: number
  advertisementCount: number
  publicKeysAdvertised: Set<string>
}

/**
 * Comprehensive peer reputation system
 * Tracks peer behavior and manages blacklist/graylist
 */
export class PeerReputationManager extends EventEmitter {
  private peerScores: Map<string, PeerScore> = new Map()
  private blacklist: Set<string> = new Set()
  private graylist: Map<string, number> = new Map() // peerId -> until timestamp

  /**
   * Record invalid signature
   */
  recordInvalidSignature(peerId: string): void {
    const score = this._getOrCreateScore(peerId)
    score.invalidSignatures++
    score.lastViolation = Date.now()

    if (
      score.invalidSignatures >=
      MUSIG2_SECURITY_LIMITS.MAX_INVALID_SIGNATURES_PER_PEER
    ) {
      this.blacklistPeer(peerId, 'invalid-signatures')
    }
  }

  /**
   * Record spam violation
   */
  recordSpam(peerId: string): void {
    const score = this._getOrCreateScore(peerId)
    score.spamCount++
    score.lastViolation = Date.now()

    if (score.spamCount >= 50) {
      this.blacklistPeer(peerId, 'spam')
    }
  }

  /**
   * Record rate limit violation
   */
  recordRateLimitViolation(peerId: string): void {
    const score = this._getOrCreateScore(peerId)
    score.rateLimitViolations++

    if (score.rateLimitViolations >= 10) {
      this.graylistPeer(peerId, 60 * 60 * 1000) // 1 hour
    }
  }

  /**
   * Blacklist peer permanently
   */
  blacklistPeer(peerId: string, reason: string): void {
    this.blacklist.add(peerId)
    console.warn(`[P2P] ⛔ Blacklisted peer: ${peerId} (${reason})`)
    this.emit('peer:blacklisted', peerId, reason)
  }

  /**
   * Graylist peer temporarily
   */
  graylistPeer(peerId: string, durationMs: number): void {
    const until = Date.now() + durationMs
    this.graylist.set(peerId, until)
    console.warn(
      `[P2P] ⚠️  Graylisted peer: ${peerId} (${Math.round(durationMs / 1000)}s)`,
    )
    this.emit('peer:graylisted', peerId, durationMs)
  }

  /**
   * Check if peer is allowed
   */
  isAllowed(peerId: string): boolean {
    // Check blacklist
    if (this.blacklist.has(peerId)) {
      return false
    }

    // Check graylist
    const graylistUntil = this.graylist.get(peerId)
    if (graylistUntil && Date.now() < graylistUntil) {
      return false
    }

    // Remove expired graylist
    if (graylistUntil && Date.now() >= graylistUntil) {
      this.graylist.delete(peerId)
    }

    return true
  }

  /**
   * Get peer reputation score
   */
  getScore(peerId: string): PeerScore {
    return this._getOrCreateScore(peerId)
  }

  /**
   * Get or create peer score
   */
  private _getOrCreateScore(peerId: string): PeerScore {
    let score = this.peerScores.get(peerId)
    if (!score) {
      score = {
        invalidSignatures: 0,
        spamCount: 0,
        rateLimitViolations: 0,
        lastViolation: 0,
        joinedSessions: 0,
        completedSessions: 0,
        advertisementCount: 0,
        publicKeysAdvertised: new Set(),
      }
      this.peerScores.set(peerId, score)
    }
    return score
  }

  /**
   * Get blacklist size
   */
  getBlacklistSize(): number {
    return this.blacklist.size
  }

  /**
   * Get graylist size
   */
  getGraylistSize(): number {
    // Count only active graylists
    const now = Date.now()
    let count = 0
    for (const until of this.graylist.values()) {
      if (until > now) {
        count++
      }
    }
    return count
  }

  /**
   * Check if peer is blacklisted
   */
  isBlacklisted(peerId: string): boolean {
    return this.blacklist.has(peerId)
  }

  /**
   * Check if peer is graylisted
   */
  isGraylisted(peerId: string): boolean {
    const until = this.graylist.get(peerId)
    return until ? Date.now() < until : false
  }

  /**
   * Remove peer from blacklist (admin override)
   */
  unblacklistPeer(peerId: string): void {
    this.blacklist.delete(peerId)
    console.log(`[P2P] Removed peer from blacklist: ${peerId}`)
    this.emit('peer:unblacklisted', peerId)
  }

  /**
   * Get all blacklisted peers
   */
  getBlacklistedPeers(): string[] {
    return Array.from(this.blacklist)
  }

  /**
   * Get all graylisted peers with expiry times
   */
  getGraylistedPeers(): Array<{ peerId: string; until: number }> {
    const now = Date.now()
    const result: Array<{ peerId: string; until: number }> = []

    for (const [peerId, until] of this.graylist) {
      if (until > now) {
        result.push({ peerId, until })
      }
    }

    return result
  }
}

// ============================================================================
// Peer Key Limits Configuration
// ============================================================================

/**
 * Configuration for key limits per peer tier
 */
export const PEER_KEY_LIMITS = {
  DEFAULT: 10, // 10 keys per peer (default)
  VERIFIED: 50, // 50 keys if identity verified
  INSTITUTIONAL: 100, // 100 keys for institutional users
} as const

// ============================================================================
// Security Manager (Facade)
// ============================================================================

/**
 * Security manager that coordinates all security mechanisms
 * Provides a single interface for security checks and enforcement
 */
export class SecurityManager extends EventEmitter {
  public rateLimiter: AdvertisementRateLimiter
  public keyTracker: PeerKeyTracker
  public invalidSigTracker: InvalidSignatureTracker
  public peerReputation: PeerReputationManager
  private disableRateLimiting: boolean

  constructor(config?: { disableRateLimiting?: boolean }) {
    super()

    this.disableRateLimiting = config?.disableRateLimiting ?? false

    // Initialize security components
    this.rateLimiter = new AdvertisementRateLimiter(this)
    this.keyTracker = new PeerKeyTracker()
    this.invalidSigTracker = new InvalidSignatureTracker(this)
    this.peerReputation = new PeerReputationManager()

    // Forward ban events to peer reputation
    this.on('peer:should-ban', (peerId: string, reason: string) => {
      this.peerReputation.blacklistPeer(peerId, reason)
    })

    if (this.disableRateLimiting) {
      console.warn(
        '[MuSig2 Security] ⚠️  RATE LIMITING DISABLED (testing mode)',
      )
    }
  }

  /**
   * Check if peer can advertise a key
   * Combines rate limiting and key count checks
   */
  canAdvertiseKey(peerId: string, publicKey: PublicKey): boolean {
    // Skip all security checks if disabled (testing only)
    if (this.disableRateLimiting) {
      return true
    }

    // Check if peer is allowed at all
    if (!this.peerReputation.isAllowed(peerId)) {
      console.warn(`[Security] Peer ${peerId} is blacklisted/graylisted`)
      return false
    }

    // Check rate limit
    if (!this.rateLimiter.canAdvertise(peerId)) {
      console.warn(`[Security] Peer ${peerId} rate limited`)
      this.peerReputation.recordRateLimitViolation(peerId)
      return false
    }

    // Check key count limit
    if (!this.keyTracker.canAdvertiseKey(peerId, publicKey)) {
      console.warn(`[Security] Peer ${peerId} exceeded key limit`)
      this.peerReputation.recordSpam(peerId)
      return false
    }

    return true
  }

  /**
   * Record invalid signature from peer
   */
  recordInvalidSignature(peerId: string): void {
    this.invalidSigTracker.recordInvalidSignature(peerId)
    this.peerReputation.recordInvalidSignature(peerId)
  }

  /**
   * Cleanup old security data
   */
  cleanup(): void {
    this.rateLimiter.cleanup()
  }

  /**
   * Get security metrics
   */
  getMetrics() {
    return {
      rateLimitViolations: this.rateLimiter.getTotalViolations(),
      invalidSignatures: this.invalidSigTracker.getTotalInvalidSignatures(),
      blacklistedPeers: this.peerReputation.getBlacklistSize(),
      graylistedPeers: this.peerReputation.getGraylistSize(),
    }
  }
}
