# MuSig2 P2P Implementation - Actionable Recommendations

**Author**: AI Technical Review  
**Date**: October 31, 2025  
**Priority Guide**: 🔴 Critical | 🟡 Important | 🟢 Enhancement  
**Version**: 1.0

---

## Overview

This document provides **specific, actionable recommendations** for enhancing the MuSig2 P2P implementation. Each recommendation includes:

- Priority level and risk assessment
- Code examples
- Implementation guidance
- Testing requirements

---

## Table of Contents

1. [Security Enhancements](#1-security-enhancements)
2. [Reliability Improvements](#2-reliability-improvements)
3. [Performance Optimizations](#3-performance-optimizations)
4. [Developer Experience](#4-developer-experience)
5. [Implementation Checklist](#5-implementation-checklist)

---

## 1. Security Enhancements

### 🔴 1.1 Add Session Announcement Signature Verification ✅ **IMPLEMENTED**

**Status**: ✅ **COMPLETE** (October 31, 2025)  
**Implementation**: `lib/p2p/musig2/coordinator.ts`  
**Tests**: `test/p2p/musig2/session-signatures.test.ts` (24 tests, all passing)  
**Documentation**: `docs/MUSIG2_SESSION_ANNOUNCEMENT_SIGNATURES.md`

**Risk**: HIGH - DHT poisoning could lead to participants joining malicious sessions

**Original State**: Session announcements included a `creatorSignature` field but it wasn't verified.

**Implementation Summary**: Cryptographic verification of session announcements has been fully implemented and tested.

**Implementation:**

```typescript
// In MuSig2P2PCoordinator class

/**
 * Sign a session announcement with creator's private key
 */
private _signSessionAnnouncement(
  announcement: SessionAnnouncementPayload,
  privateKey: PrivateKey,
): Buffer {
  // Create canonical serialization for signing
  const message = Buffer.concat([
    Buffer.from(announcement.sessionId),
    Buffer.concat(announcement.signers.map(s => Buffer.from(s, 'hex'))),
    Buffer.from(announcement.message, 'hex'),
    Buffer.from([announcement.creatorIndex]),
    Buffer.from([announcement.requiredSigners]),
  ])

  // Sign with Schnorr
  const signature = Schnorr.sign(message, privateKey)
  return signature.toBuffer()
}

/**
 * Verify session announcement signature
 */
private _verifySessionAnnouncement(
  announcement: SessionAnnouncementData,
): boolean {
  // Reconstruct message
  const message = Buffer.concat([
    Buffer.from(announcement.sessionId),
    Buffer.concat(announcement.signers.map(pk => pk.toBuffer())),
    announcement.message,
    Buffer.from([announcement.creatorIndex]),
    Buffer.from([announcement.requiredSigners]),
  ])

  // Get creator's public key
  const creatorPubKey = announcement.signers[announcement.creatorIndex]

  // Verify signature
  try {
    return Schnorr.verify(
      message,
      Signature.fromBuffer(announcement.creatorSignature),
      creatorPubKey,
    )
  } catch (error) {
    console.error('Invalid session announcement signature:', error)
    return false
  }
}

/**
 * Update _announceSessionToDHT to include signature
 */
private async _announceSessionToDHT(
  session: MuSigSession,
  creatorPeerId: string,
  creatorPrivateKey: PrivateKey, // Add this parameter
): Promise<void> {
  const data: SessionAnnouncementPayload = {
    sessionId: session.sessionId,
    signers: signersHex,
    creatorIndex: session.myIndex,
    message: messageHex,
    requiredSigners: session.signers.length,
    metadata: session.metadata,
    election: electionPayload,
  }

  // Sign the announcement
  const signature = this._signSessionAnnouncement(data, creatorPrivateKey)
  data.creatorSignature = signature.toString('hex')

  await this.announceResource(
    this.musig2Config.sessionResourceType,
    session.sessionId,
    data,
    { expiresAt: announcement.expiresAt }
  )
}

/**
 * Update _discoverSessionFromDHT to verify signature
 */
private async _discoverSessionFromDHT(
  sessionId: string,
): Promise<SessionAnnouncementData | null> {
  const resource = await this.discoverResource(
    this.musig2Config.sessionResourceType,
    sessionId,
  )

  if (!resource || !resource.data) {
    return null
  }

  const data = resource.data as SessionAnnouncementPayload

  // Deserialize
  const signers = data.signers.map(hex => new PublicKey(Buffer.from(hex, 'hex')))
  const message = Buffer.from(data.message, 'hex')
  const creatorSignature = data.creatorSignature
    ? Buffer.from(data.creatorSignature, 'hex')
    : undefined

  const announcement: SessionAnnouncementData = {
    sessionId: data.sessionId,
    signers,
    creatorPeerId: resource.creatorPeerId,
    creatorIndex: data.creatorIndex,
    message,
    requiredSigners: data.requiredSigners,
    createdAt: resource.createdAt,
    expiresAt: resource.expiresAt,
    metadata: data.metadata,
    election: data.election,
    creatorSignature, // Add to interface
  }

  // Verify signature
  if (!this._verifySessionAnnouncement(announcement)) {
    console.error('Session announcement signature verification failed:', sessionId)
    return null
  }

  return announcement
}
```

**Update Interface:**

```typescript
// In types.ts

export interface SessionAnnouncementPayload {
  sessionId: string
  signers: string[]
  creatorIndex: number
  message: string
  requiredSigners: number
  metadata?: Record<string, unknown>
  expiresAt?: number
  election?: { ... }
  creatorSignature?: string // Add this
}

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
  election?: { ... }
  creatorSignature?: Buffer // Add this
}
```

**Testing:**

```typescript
describe('Session Announcement Security', () => {
  it('should reject announcements with invalid signatures', async () => {
    const maliciousAnnouncement = {
      sessionId: 'fake-session',
      signers: [alice.publicKey.toString()],
      creatorIndex: 0,
      message: 'fake message',
      requiredSigners: 1,
      creatorSignature: 'invalid-signature',
    }

    await coordinator.announceResource(
      'musig2-session',
      'fake-session',
      maliciousAnnouncement,
    )

    const discovered = await coordinator.discoverResource(
      'musig2-session',
      'fake-session',
    )
    expect(discovered).toBeNull() // Should reject
  })

  it('should accept announcements with valid signatures', async () => {
    const sessionId = await coordinator.createSession(
      [alice.publicKey, bob.publicKey],
      alice.privateKey,
      message,
    )

    // Bob discovers the session
    const discovered = await bobCoordinator.discoverResource(
      'musig2-session',
      sessionId,
    )
    expect(discovered).not.toBeNull()
    expect(discovered.sessionId).toBe(sessionId)
  })
})
```

---

### 🟡 1.2 Implement Optional Nonce Commitment Phase

**Risk**: MEDIUM - Adaptive attacks in adversarial settings

**Current State**: Nonces are exchanged directly without commitment.

**BIP327 Reference**: Section on "Nonce Generation" mentions optional commitment phase.

**Recommendation**: Add configurable nonce commitment phase for high-security scenarios.

**Implementation:**

```typescript
// In types.ts - Add new message types

export enum MuSig2MessageType {
  // ... existing types ...

  // Optional nonce commitment phase
  NONCE_COMMIT = 'musig2:nonce-commit',
  NONCE_COMMIT_ACK = 'musig2:nonce-commit-ack',
  NONCE_COMMITS_COMPLETE = 'musig2:nonce-commits-complete',
  NONCE_REVEAL = 'musig2:nonce-reveal', // After all commitments
}

export interface NonceCommitPayload {
  sessionId: string
  signerIndex: number
  commitment: string // SHA256(R1 || R2) as hex
}

export interface NonceRevealPayload {
  sessionId: string
  signerIndex: number
  publicNonce: {
    R1: string
    R2: string
  }
}

// In MuSig2P2PConfig

export interface MuSig2P2PConfig {
  // ... existing config ...

  /** Enable nonce commitment phase (default: false) */
  enableNonceCommitment?: boolean
}

// In ActiveSession

export interface ActiveSession {
  // ... existing fields ...

  /** Nonce commitments (if commitment phase enabled) */
  nonceCommitments?: Map<number, string>
}
```

**Coordinator Implementation:**

```typescript
// In MuSig2P2PCoordinator

/**
 * Start Round 0.5: Nonce Commitment (if enabled)
 */
async startNonceCommitment(sessionId: string, privateKey: PrivateKey): Promise<void> {
  if (!this.musig2Config.enableNonceCommitment) {
    // Skip directly to Round 1
    return this.startRound1(sessionId, privateKey)
  }

  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) {
    throw new Error(`Session ${sessionId} not found`)
  }

  const { session } = activeSession

  // Generate nonces locally (but don't broadcast yet)
  const publicNonces = this.sessionManager.generateNonces(session, privateKey)

  // Compute commitment: H(R1 || R2)
  const commitment = Hash.sha256(
    Buffer.concat([
      Point.pointToCompressed(publicNonces[0]),
      Point.pointToCompressed(publicNonces[1]),
    ])
  ).toString('hex')

  // Broadcast commitment
  await this._broadcastNonceCommit(
    sessionId,
    session.myIndex,
    commitment,
    activeSession.participants,
  )

  // Store commitment locally
  if (!activeSession.nonceCommitments) {
    activeSession.nonceCommitments = new Map()
  }
  activeSession.nonceCommitments.set(session.myIndex, commitment)

  // Check if all commitments received
  if (this._hasAllNonceCommitments(activeSession)) {
    await this._handleAllNonceCommitsReceived(sessionId)
  }
}

/**
 * Handle nonce commitment from peer
 */
async _handleNonceCommit(
  sessionId: string,
  signerIndex: number,
  commitment: string,
  peerId: string,
): Promise<void> {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) {
    throw new Error(`Session ${sessionId} not found`)
  }

  // Store commitment
  if (!activeSession.nonceCommitments) {
    activeSession.nonceCommitments = new Map()
  }
  activeSession.nonceCommitments.set(signerIndex, commitment)

  // Check if all commitments received
  if (this._hasAllNonceCommitments(activeSession)) {
    await this._handleAllNonceCommitsReceived(sessionId)
  }
}

/**
 * After all commitments, reveal actual nonces
 */
private async _handleAllNonceCommitsReceived(sessionId: string): Promise<void> {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) return

  const { session } = activeSession

  // Now reveal the actual nonces
  await this._broadcastNonceShare(
    sessionId,
    session.myIndex,
    session.myPublicNonce!,
    activeSession.participants,
  )

  this.emit('session:nonce-commits-complete', sessionId)
}

/**
 * Verify revealed nonce matches commitment
 */
private _verifyNonceReveal(
  commitment: string,
  publicNonce: [Point, Point],
): boolean {
  const revealed = Hash.sha256(
    Buffer.concat([
      Point.pointToCompressed(publicNonce[0]),
      Point.pointToCompressed(publicNonce[1]),
    ])
  ).toString('hex')

  return commitment === revealed
}

/**
 * Update _handleNonceShare to verify commitment (if enabled)
 */
async _handleNonceShare(
  sessionId: string,
  signerIndex: number,
  publicNonce: [Point, Point],
  peerId: string,
): Promise<void> {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) {
    throw new Error(`Session ${sessionId} not found`)
  }

  // If commitment phase was used, verify
  if (this.musig2Config.enableNonceCommitment && activeSession.nonceCommitments) {
    const commitment = activeSession.nonceCommitments.get(signerIndex)
    if (!commitment) {
      throw new Error(`No commitment found for signer ${signerIndex}`)
    }

    if (!this._verifyNonceReveal(commitment, publicNonce)) {
      throw new Error(`Nonce reveal doesn't match commitment for signer ${signerIndex}`)
    }
  }

  // Rest of existing implementation...
  const { session } = activeSession
  this.sessionManager.receiveNonce(session, signerIndex, publicNonce)

  if (this.sessionManager.hasAllNonces(session)) {
    await this._handleAllNoncesReceived(sessionId)
  }
}

/**
 * Check if all nonce commitments received
 */
private _hasAllNonceCommitments(activeSession: ActiveSession): boolean {
  if (!activeSession.nonceCommitments) return false

  const { session } = activeSession
  return activeSession.nonceCommitments.size === session.signers.length
}
```

**Protocol Handler:**

```typescript
// In MuSig2P2PProtocolHandler

async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
  // ... existing code ...

  switch (message.type) {
    // ... existing cases ...

    case MuSig2MessageType.NONCE_COMMIT:
      await this._handleNonceCommit(
        message.payload as NonceCommitPayload,
        from,
      )
      break
  }
}

private async _handleNonceCommit(
  payload: NonceCommitPayload,
  from: PeerInfo,
): Promise<void> {
  if (!this.coordinator) return

  await this.coordinator._handleNonceCommit(
    payload.sessionId,
    payload.signerIndex,
    payload.commitment,
    from.peerId,
  )
}
```

**When to Use:**

```typescript
// High-security multi-party scenario
const coordinator = new MuSig2P2PCoordinator(p2pConfig, {
  enableNonceCommitment: true, // Enable for adversarial environments
  enableCoordinatorElection: true,
  enableCoordinatorFailover: true,
})

// Standard trusted-party scenario
const coordinator = new MuSig2P2PCoordinator(p2pConfig, {
  enableNonceCommitment: false, // Skip for performance
  enableCoordinatorElection: true,
})
```

---

### 🟡 1.3 Add Message Replay Protection ✅ **IMPLEMENTED**

**Status**: ✅ **COMPLETE** (October 31, 2025)  
**Implementation**: `lib/p2p/musig2/coordinator.ts`  
**Tests**: `test/p2p/musig2/replay-protection.test.ts` (13 tests, all passing)  
**Documentation**: `docs/MUSIG2_MESSAGE_REPLAY_PROTECTION.md`

**Risk**: MEDIUM - Replay attacks could cause protocol confusion

**Original State**: Base P2P has message deduplication by messageId, but no session-specific sequencing.

**Implementation Summary**: Session-specific message replay protection has been fully implemented and tested.

**Implementation:**

```typescript
// In types.ts - Extend message payloads

interface SessionMessage {
  sessionId: string
  signerIndex: number
  sequenceNumber: number // Add this
  timestamp: number      // Add this
}

export interface NonceSharePayload extends SessionMessage {
  publicNonce: {
    R1: string
    R2: string
  }
}

export interface PartialSigSharePayload extends SessionMessage {
  partialSig: string
}

// In ActiveSession - Track sequence numbers

export interface ActiveSession {
  // ... existing fields ...

  /** Last seen sequence number per signer */
  lastSequenceNumbers: Map<number, number>
}

// In MuSig2P2PCoordinator

/**
 * Validate message sequence
 */
private _validateMessageSequence(
  activeSession: ActiveSession,
  signerIndex: number,
  sequenceNumber: number,
): boolean {
  const lastSeq = activeSession.lastSequenceNumbers.get(signerIndex) || 0

  // Sequence must be strictly increasing
  if (sequenceNumber <= lastSeq) {
    console.error(
      `Replay attack detected: signer ${signerIndex} seq ${sequenceNumber} <= last ${lastSeq}`
    )
    return false
  }

  // Don't allow huge gaps (potential attack)
  if (sequenceNumber > lastSeq + 100) {
    console.error(
      `Suspicious sequence gap: signer ${signerIndex} seq ${sequenceNumber} >> last ${lastSeq}`
    )
    return false
  }

  // Update last seen
  activeSession.lastSequenceNumbers.set(signerIndex, sequenceNumber)
  return true
}

/**
 * Update message broadcasting to include sequence
 */
private async _broadcastNonceShare(
  sessionId: string,
  signerIndex: number,
  publicNonce: [Point, Point],
  participants: Map<number, string>,
): Promise<void> {
  const activeSession = this.activeSessions.get(sessionId)!

  // Get next sequence number
  const sequenceNumber = (activeSession.lastSequenceNumbers.get(signerIndex) || 0) + 1
  activeSession.lastSequenceNumbers.set(signerIndex, sequenceNumber)

  const payload: NonceSharePayload = {
    sessionId,
    signerIndex,
    sequenceNumber,
    timestamp: Date.now(),
    publicNonce: serializePublicNonce(publicNonce),
  }

  // Send to all participants
  const promises = Array.from(participants.entries())
    .filter(([idx, peerId]) => idx !== signerIndex && peerId !== this.peerId)
    .map(([, peerId]) =>
      this._sendMessageToPeer(peerId, MuSig2MessageType.NONCE_SHARE, payload),
    )

  await Promise.all(promises)
}

/**
 * Update message handling to validate sequence
 */
async _handleNonceShare(
  sessionId: string,
  signerIndex: number,
  sequenceNumber: number,
  publicNonce: [Point, Point],
  peerId: string,
): Promise<void> {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) {
    throw new Error(`Session ${sessionId} not found`)
  }

  // Validate sequence
  if (!this._validateMessageSequence(activeSession, signerIndex, sequenceNumber)) {
    throw new Error(`Invalid message sequence from signer ${signerIndex}`)
  }

  // Rest of existing implementation...
  const { session } = activeSession
  this.sessionManager.receiveNonce(session, signerIndex, publicNonce)

  if (this.sessionManager.hasAllNonces(session)) {
    await this._handleAllNoncesReceived(sessionId)
  }
}
```

---

## 2. Reliability Improvements

### 🟡 2.1 Automatic Session Cleanup

**Risk**: MEDIUM - Memory leaks from stale sessions

**Current State**: Sessions remain in memory indefinitely unless manually closed.

**Recommendation**: Add automatic cleanup of expired/stale sessions.

**Implementation:**

```typescript
// In MuSig2P2PCoordinator constructor

constructor(p2pConfig: P2PConfig, musig2Config?: Partial<MuSig2P2PConfig>) {
  super(p2pConfig)

  // ... existing initialization ...

  // Start session cleanup task
  this.startSessionCleanup()
}

/**
 * Start periodic session cleanup
 */
private startSessionCleanup(): void {
  this.cleanupInterval = setInterval(() => {
    this.cleanupExpiredSessions()
  }, 60000) // Every minute
}

/**
 * Clean up expired sessions
 */
private cleanupExpiredSessions(): void {
  const now = Date.now()
  const expirationTime = this.musig2Config.sessionTimeout

  for (const [sessionId, activeSession] of this.activeSessions.entries()) {
    // Check if session has expired
    const age = now - activeSession.updatedAt

    if (age > expirationTime) {
      console.log(`[MuSig2P2P] Cleaning up expired session: ${sessionId}`)
      this.closeSession(sessionId).catch(error => {
        console.error(`Failed to close expired session ${sessionId}:`, error)
      })
      continue
    }

    // Check if session is stuck in a phase
    if (this._isSessionStuck(activeSession, now)) {
      console.warn(`[MuSig2P2P] Session stuck in ${activeSession.phase}: ${sessionId}`)
      this.closeSession(sessionId).catch(error => {
        console.error(`Failed to close stuck session ${sessionId}:`, error)
      })
    }
  }
}

/**
 * Check if session is stuck in a phase
 */
private _isSessionStuck(activeSession: ActiveSession, now: number): boolean {
  const stuckTimeout = 10 * 60 * 1000 // 10 minutes
  const timeSinceUpdate = now - activeSession.updatedAt

  // If in nonce exchange or partial sig exchange for too long, it's stuck
  if (
    (activeSession.phase === MuSigSessionPhase.NONCE_EXCHANGE ||
     activeSession.phase === MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) &&
    timeSinceUpdate > stuckTimeout
  ) {
    return true
  }

  return false
}

/**
 * Stop cleanup on shutdown
 */
async cleanup(): Promise<void> {
  // Clear cleanup interval
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval)
    this.cleanupInterval = undefined
  }

  // Close all active sessions
  const sessionIds = Array.from(this.activeSessions.keys())
  await Promise.all(sessionIds.map(id => this.closeSession(id)))
}
```

**Add to interface:**

```typescript
// In MuSig2P2PCoordinator class

private cleanupInterval?: NodeJS.Timeout
```

---

### 🟡 2.2 Session Recovery Mechanism

**Risk**: MEDIUM - Loss of progress due to temporary disconnections

**Current State**: No recovery mechanism for interrupted sessions.

**Recommendation**: Add ability to resume sessions after disconnection.

**Implementation:**

```typescript
// In types.ts

export interface SessionSnapshot {
  sessionId: string
  phase: MuSigSessionPhase
  signers: string[] // PublicKeys as hex
  myIndex: number
  message: string // Message as hex
  receivedNonces: Array<{ signerIndex: number; nonce: { R1: string; R2: string } }>
  receivedPartialSigs: Array<{ signerIndex: number; partialSig: string }>
  createdAt: number
  updatedAt: number
}

// In MuSig2P2PCoordinator

/**
 * Create a snapshot of session state for recovery
 */
getSessionSnapshot(sessionId: string): SessionSnapshot | null {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) return null

  const { session } = activeSession

  return {
    sessionId,
    phase: activeSession.phase,
    signers: session.signers.map(pk => pk.toString()),
    myIndex: session.myIndex,
    message: session.message.toString('hex'),
    receivedNonces: Array.from(session.receivedPublicNonces.entries()).map(([idx, nonce]) => ({
      signerIndex: idx,
      nonce: serializePublicNonce(nonce),
    })),
    receivedPartialSigs: Array.from(session.receivedPartialSigs.entries()).map(([idx, sig]) => ({
      signerIndex: idx,
      partialSig: serializeBN(sig),
    })),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

/**
 * Restore session from snapshot
 */
async restoreSession(
  snapshot: SessionSnapshot,
  myPrivateKey: PrivateKey,
): Promise<string> {
  // Recreate session
  const signers = snapshot.signers.map(hex => new PublicKey(Buffer.from(hex, 'hex')))
  const message = Buffer.from(snapshot.message, 'hex')

  const session = this.sessionManager.createSession(
    signers,
    myPrivateKey,
    message,
  )

  // Restore received nonces
  for (const { signerIndex, nonce } of snapshot.receivedNonces) {
    const publicNonce = deserializePublicNonce(nonce)
    this.sessionManager.receiveNonce(session, signerIndex, publicNonce)
  }

  // Restore received partial signatures
  for (const { signerIndex, partialSig } of snapshot.receivedPartialSigs) {
    const bn = deserializeBN(partialSig)
    this.sessionManager.receivePartialSignature(session, signerIndex, bn)
  }

  // Create active session
  const activeSession: ActiveSession = {
    sessionId: session.sessionId,
    session,
    participants: new Map(),
    phase: snapshot.phase,
    createdAt: snapshot.createdAt,
    updatedAt: Date.now(),
  }

  this.activeSessions.set(session.sessionId, activeSession)

  // Reconnect to participants via DHT
  if (this.musig2Config.enableSessionDiscovery) {
    const announcement = await this._discoverSessionFromDHT(session.sessionId)
    if (announcement) {
      // Re-establish connections
      // Implementation depends on P2P layer
    }
  }

  this.emit('session:restored', session.sessionId)
  return session.sessionId
}

/**
 * Export session for persistence
 */
exportSession(sessionId: string): string {
  const snapshot = this.getSessionSnapshot(sessionId)
  if (!snapshot) {
    throw new Error(`Session ${sessionId} not found`)
  }
  return JSON.stringify(snapshot)
}

/**
 * Import session from persistence
 */
async importSession(data: string, myPrivateKey: PrivateKey): Promise<string> {
  const snapshot = JSON.parse(data) as SessionSnapshot
  return this.restoreSession(snapshot, myPrivateKey)
}
```

**Usage:**

```typescript
// Save session before shutdown
const snapshot = coordinator.exportSession(sessionId)
localStorage.setItem('musig2-session', snapshot)

// Restore after restart
const snapshot = localStorage.getItem('musig2-session')
if (snapshot) {
  const sessionId = await coordinator.importSession(snapshot, myPrivateKey)
  console.log('Session restored:', sessionId)
}
```

---

### 🟢 2.3 Enhanced Error Recovery

**Risk**: LOW - Better user experience during errors

**Recommendation**: Add retry logic for transient failures.

**Implementation:**

```typescript
/**
 * Retry wrapper for transient failures
 */
private async _withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      console.warn(`Operation failed (attempt ${attempt + 1}/${maxRetries}):`, error)

      if (attempt < maxRetries - 1) {
        // Exponential backoff
        const delay = delayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Operation failed after retries')
}

/**
 * Update DHT operations to use retry
 */
private async _discoverSessionFromDHT(
  sessionId: string,
): Promise<SessionAnnouncementData | null> {
  return this._withRetry(async () => {
    const resource = await this.discoverResource(
      this.musig2Config.sessionResourceType,
      sessionId,
    )

    if (!resource || !resource.data) {
      return null
    }

    // ... rest of implementation
  }, 3, 2000) // 3 retries, 2 second initial delay
}
```

---

## 3. Performance Optimizations

### 🟢 3.1 Message Batching

**Benefit**: Reduce P2P overhead for multiple simultaneous sessions

**Implementation:**

```typescript
/**
 * Batch multiple messages to same peer
 */
private messageBatch: Map<string, P2PMessage[]> = new Map()
private batchTimeout?: NodeJS.Timeout

private _queueMessage(peerId: string, message: P2PMessage): void {
  if (!this.messageBatch.has(peerId)) {
    this.messageBatch.set(peerId, [])
  }

  this.messageBatch.get(peerId)!.push(message)

  // Schedule batch send
  if (!this.batchTimeout) {
    this.batchTimeout = setTimeout(() => this._flushBatches(), 100)
  }
}

private async _flushBatches(): Promise<void> {
  this.batchTimeout = undefined

  const batches = Array.from(this.messageBatch.entries())
  this.messageBatch.clear()

  await Promise.all(
    batches.map(async ([peerId, messages]) => {
      try {
        // Send all messages in single batch
        for (const message of messages) {
          await this.sendTo(peerId, message)
        }
      } catch (error) {
        console.error(`Failed to send batch to ${peerId}:`, error)
      }
    })
  )
}
```

---

### 🟢 3.2 Configurable Timeouts

**Benefit**: Adapt to different network conditions

**Implementation:**

```typescript
export interface MuSig2P2PConfig {
  /** Session timeout (ms) */
  sessionTimeout?: number                    // Existing ✅

  /** Enable session announcement to DHT */
  enableSessionDiscovery?: boolean           // Existing ✅

  /** DHT resource type for sessions */
  sessionResourceType?: string               // Existing ✅

  /** Enable coordinator election */
  enableCoordinatorElection?: boolean        // Existing ✅

  /** Coordinator election method */
  electionMethod?: 'lexicographic' | ...     // Existing ✅

  /** Enable automatic coordinator failover */
  enableCoordinatorFailover?: boolean        // Existing ✅

  /** Broadcast timeout in milliseconds */
  broadcastTimeout?: number                  // Existing ✅

  // NEW ADDITIONS:

  /** DHT query timeout (ms) - default: 5000 */
  dhtQueryTimeout?: number

  /** Message send timeout (ms) - default: 10000 */
  messageSendTimeout?: number

  /** Nonce exchange timeout (ms) - default: 5 minutes */
  nonceExchangeTimeout?: number

  /** Partial signature exchange timeout (ms) - default: 5 minutes */
  partialSigExchangeTimeout?: number

  /** Enable automatic session cleanup - default: true */
  enableAutoCleanup?: boolean

  /** Session cleanup interval (ms) - default: 60000 */
  cleanupInterval?: number
}
```

---

## 4. Developer Experience

### 🟢 4.1 Enhanced Debugging

**Recommendation**: Add comprehensive debug logging.

**Implementation:**

```typescript
// Add debug logger

private debugLog(category: string, message: string, data?: unknown): void {
  if (this.musig2Config.enableDebugLogging) {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [MuSig2P2P:${category}] ${message}`, data || '')
  }
}

// Use throughout:

async startRound1(sessionId: string, privateKey: PrivateKey): Promise<void> {
  this.debugLog('round1', `Starting Round 1 for session ${sessionId}`)

  const activeSession = this.activeSessions.get(sessionId)
  this.debugLog('round1', 'Active session:', {
    sessionId,
    phase: activeSession?.phase,
    participants: activeSession?.participants.size,
  })

  // ... rest of implementation

  this.debugLog('round1', `Round 1 complete for session ${sessionId}`)
}
```

---

### 🟢 4.2 Health Check API

**Recommendation**: Add session health monitoring.

**Implementation:**

```typescript
/**
 * Get detailed session health status
 */
getSessionHealth(sessionId: string): SessionHealth | null {
  const activeSession = this.activeSessions.get(sessionId)
  if (!activeSession) return null

  const { session } = activeSession

  return {
    sessionId,
    phase: activeSession.phase,
    age: Date.now() - activeSession.createdAt,
    lastActivity: Date.now() - activeSession.updatedAt,
    participants: {
      total: session.signers.length,
      connected: activeSession.participants.size,
      list: Array.from(activeSession.participants.entries()).map(([idx, peerId]) => ({
        signerIndex: idx,
        peerId,
        publicKey: session.signers[idx].toString(),
      })),
    },
    nonces: {
      total: session.signers.length,
      received: session.receivedPublicNonces.size,
      complete: this.sessionManager.hasAllNonces(session),
    },
    partialSignatures: {
      total: session.signers.length,
      received: session.receivedPartialSigs.size,
      complete: this.sessionManager.hasAllPartialSignatures(session),
    },
    coordinator: activeSession.election ? {
      index: activeSession.election.coordinatorIndex,
      peerId: activeSession.election.coordinatorPeerId,
      isMe: activeSession.election.coordinatorIndex === session.myIndex,
    } : undefined,
    failover: activeSession.failover ? {
      currentCoordinatorIndex: activeSession.failover.currentCoordinatorIndex,
      attempts: activeSession.failover.failoverAttempts,
      deadline: activeSession.failover.broadcastDeadline,
      timeRemaining: activeSession.failover.broadcastDeadline - Date.now(),
    } : undefined,
  }
}

interface SessionHealth {
  sessionId: string
  phase: MuSigSessionPhase
  age: number
  lastActivity: number
  participants: {
    total: number
    connected: number
    list: Array<{ signerIndex: number; peerId: string; publicKey: string }>
  }
  nonces: {
    total: number
    received: number
    complete: boolean
  }
  partialSignatures: {
    total: number
    received: number
    complete: boolean
  }
  coordinator?: {
    index: number
    peerId?: string
    isMe: boolean
  }
  failover?: {
    currentCoordinatorIndex: number
    attempts: number
    deadline: number
    timeRemaining: number
  }
}
```

---

## 5. Implementation Checklist

### Phase 1: Security (2-3 weeks)

- [x] **Implement session announcement signatures** ✅ **COMPLETE**
  - [x] Add signing logic
  - [x] Add verification logic
  - [x] Update types
  - [x] Write tests (24 tests, all passing)
- [x] **Implement message replay protection** ✅ **COMPLETE**
  - [x] Add sequence numbers
  - [x] Add validation logic
  - [x] Update message handlers
  - [x] Write tests (13 tests, all passing)
- [ ] (Optional) Implement nonce commitment phase
  - [ ] Add commitment messages
  - [ ] Add commitment validation
  - [ ] Add configuration flag
  - [ ] Write tests

### Phase 2: Reliability (1-2 weeks)

- [ ] Implement automatic session cleanup
  - [ ] Add cleanup logic
  - [ ] Add stale session detection
  - [ ] Add configuration options
  - [ ] Write tests
- [ ] Implement session recovery
  - [ ] Add snapshot creation
  - [ ] Add restoration logic
  - [ ] Add import/export
  - [ ] Write tests
- [ ] Implement retry logic
  - [ ] Add retry wrapper
  - [ ] Update DHT operations
  - [ ] Add exponential backoff
  - [ ] Write tests

### Phase 3: Performance & DX (1 week)

- [ ] Add message batching (optional)
- [ ] Add configurable timeouts
- [ ] Add debug logging
- [ ] Add health check API
- [ ] Update documentation

### Testing Requirements

For each implementation:

1. **Unit Tests**
   - Test core logic in isolation
   - Test error cases
   - Test edge cases
2. **Integration Tests**
   - Test with multiple coordinators
   - Test network scenarios
   - Test recovery scenarios
3. **Security Tests**
   - Test attack scenarios
   - Test invalid inputs
   - Test boundary conditions

---

## Priority Matrix

| Recommendation                  | Priority        | Security Impact | Effort | Status      |
| ------------------------------- | --------------- | --------------- | ------ | ----------- |
| Session announcement signatures | 🔴 Critical     | HIGH            | Medium | ✅ Complete |
| Message replay protection       | 🟡 Important    | MEDIUM          | Low    | ✅ Complete |
| Nonce commitment phase          | 🟡 Important    | LOW             | Medium | None        |
| Session cleanup                 | 🟡 Important    | MEDIUM          | Low    | None        |
| Session recovery                | 🟡 Important    | LOW             | Medium | None        |
| Retry logic                     | 🟢 Nice-to-have | LOW             | Low    | None        |
| Message batching                | 🟢 Nice-to-have | NONE            | Medium | None        |
| Configurable timeouts           | 🟢 Nice-to-have | NONE            | Low    | None        |
| Debug logging                   | 🟢 Nice-to-have | NONE            | Low    | None        |
| Health check API                | 🟢 Nice-to-have | NONE            | Medium | None        |

**Recommended Implementation Order:**

1. ~~Session announcement signatures (security)~~ ✅ **COMPLETE**
2. ~~Message replay protection (security)~~ ✅ **COMPLETE**
3. Session cleanup (reliability)
4. Configurable timeouts (usability)
5. Debug logging (developer experience)
6. Session recovery (advanced feature)
7. Nonce commitment phase (optional security)
8. Health check API (monitoring)
9. Message batching (optimization)
10. Retry logic (reliability enhancement)

---

**End of Recommendations**

**Implementation Status:**

- ✅ **Session Announcement Signatures** - COMPLETE (October 31, 2025)
  - Implementation: `lib/p2p/musig2/coordinator.ts`
  - Tests: `test/p2p/musig2/session-signatures.test.ts` (24/24 passing)
  - Documentation: `docs/MUSIG2_SESSION_ANNOUNCEMENT_SIGNATURES.md`

- ✅ **Message Replay Protection** - COMPLETE (October 31, 2025)
  - Implementation: `lib/p2p/musig2/coordinator.ts` (sequence validation)
  - Tests: `test/p2p/musig2/replay-protection.test.ts` (13/13 passing)
  - Documentation: `docs/MUSIG2_MESSAGE_REPLAY_PROTECTION.md`

**Next Steps:**

1. ✅ ~~Session announcement signatures~~ **COMPLETE**
2. ✅ ~~Message replay protection~~ **COMPLETE**
3. Session cleanup (reliability) - RECOMMENDED NEXT
4. Review and prioritize remaining recommendations with team
5. Create GitHub issues for remaining items

**Questions?** Refer to the main analysis document: `MUSIG2_P2P_ANALYSIS.md`
