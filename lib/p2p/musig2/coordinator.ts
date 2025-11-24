/**
 * MuSig2 P2P Coordinator
 *
 * Coordinates MuSig2 multi-signature sessions over P2P networks
 * Uses GossipSub for session discovery and direct P2P for coordination
 */

import { EventEmitter } from 'events'
import { P2PCoordinator } from '../coordinator.js'
import type { P2PConfig, P2PMessage } from '../types.js'
import { P2PProtocol } from '../protocol.js'
import { MuSig2ProtocolHandler } from './protocol.js'
import {
  MuSig2SecurityValidator,
  type MuSig2SecurityConfig,
} from './security.js'
import {
  MuSig2MessageType,
  MuSig2Event,
  DEFAULT_MUSIG2_P2P_CONFIG,
  type MuSig2P2PConfig,
  type MuSig2P2PSession,
  type SessionAnnouncement,
  type SessionParticipant,
  type SessionJoinPayload,
  type SessionJoinAckPayload,
  type NonceCommitmentPayload,
  type NonceSharePayload,
  type PartialSigSharePayload,
  type SessionAbortPayload,
  type SessionCompletePayload,
} from './types.js'
import {
  electCoordinator,
  getBackupCoordinator,
  getCoordinatorPriorityList,
  ElectionMethod,
  type ElectionResult,
} from './election.js'
import {
  MuSigSessionManager,
  type MuSigSession,
  MuSigSessionPhase,
} from '../../bitcore/musig2/session.js'
import { PublicKey } from '../../bitcore/publickey.js'
import { PrivateKey } from '../../bitcore/privatekey.js'
import { Point, BN } from '../../bitcore/crypto/index.js'
import { Hash } from '../../bitcore/crypto/hash.js'

/**
 * MuSig2 P2P Coordinator
 *
 * Extends P2PCoordinator to provide MuSig2-specific session coordination
 *
 * Architecture:
 * - GossipSub: Session announcements and discovery
 * - Direct P2P: Nonce exchange, partial signature exchange
 * - Session Manager: Cryptographic operations and validation
 */
export class MuSig2P2PCoordinator extends EventEmitter {
  private coordinator: P2PCoordinator
  private protocolHandler: MuSig2ProtocolHandler
  private securityValidator: MuSig2SecurityValidator
  private sessionManager: MuSigSessionManager
  private protocol: P2PProtocol

  // Session management
  private sessions: Map<string, MuSig2P2PSession> = new Map()
  private config: Required<MuSig2P2PConfig>
  private cleanupInterval?: NodeJS.Timeout
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private broadcastTimeouts: Map<string, NodeJS.Timeout> = new Map()

  // Security: Track used nonces globally to prevent reuse
  private usedNonces: Set<string> = new Set()

  // Metrics
  private metrics = {
    sessionsCreated: 0,
    sessionsCompleted: 0,
    sessionsAborted: 0,
    sessionsTimedOut: 0,
  }

  constructor(
    p2pConfig: P2PConfig,
    musig2Config?: MuSig2P2PConfig,
    securityConfig?: MuSig2SecurityConfig,
  ) {
    super()

    // Initialize configuration
    this.config = {
      ...DEFAULT_MUSIG2_P2P_CONFIG,
      ...musig2Config,
    }

    // Initialize core components
    this.coordinator = new P2PCoordinator(p2pConfig)
    this.protocolHandler = new MuSig2ProtocolHandler()
    this.securityValidator = new MuSig2SecurityValidator(securityConfig)
    this.sessionManager = new MuSigSessionManager()
    this.protocol = new P2PProtocol()

    // Register protocol handler
    this.coordinator.registerProtocol(this.protocolHandler)

    // Register security validator
    this.coordinator
      .getCoreSecurityManager()
      .registerProtocolValidator('musig2', this.securityValidator)

    // Setup protocol event handlers
    this._setupProtocolHandlers()

    // Start cleanup if enabled
    if (this.config.enableAutoCleanup) {
      this.startCleanup()
    }
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Start the coordinator
   */
  async start(): Promise<void> {
    await this.coordinator.start()

    // Subscribe to session announcement topic
    await this.coordinator.subscribeToTopic(
      this.config.announcementTopic,
      this._handleSessionAnnouncement.bind(this),
    )

    console.log('[MuSig2] Coordinator started')
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }

    // Clear all session timeouts
    for (const sessionId of this.sessionTimeouts.keys()) {
      this._clearSessionTimeout(sessionId)
    }

    // Clear all broadcast timeouts
    for (const sessionId of this.broadcastTimeouts.keys()) {
      this._clearBroadcastTimeout(sessionId)
    }

    // Unsubscribe from topic
    await this.coordinator.unsubscribeFromTopic(this.config.announcementTopic)

    // Stop coordinator
    await this.coordinator.stop()

    // Clear sessions
    this.sessions.clear()

    // Clear nonce tracking
    this.usedNonces.clear()

    // Log final metrics
    console.log(
      '[MuSig2] Coordinator stopped. Final metrics:',
      this.getMetrics(),
    )
  }

  /**
   * Get peer ID
   */
  get peerId(): string {
    return this.coordinator.peerId
  }

  // ============================================================================
  // Session Creation and Management
  // ============================================================================

  /**
   * Create a new MuSig2 signing session
   *
   * @param signers - All participating signers' public keys (sorted)
   * @param myPrivateKey - This signer's private key
   * @param message - Message to sign
   * @param metadata - Optional session metadata
   * @returns Session ID
   */
  async createSession(
    signers: PublicKey[],
    myPrivateKey: PrivateKey,
    message: Buffer,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    // Check max concurrent sessions
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
      )
    }

    // Create base session using session manager
    const session = this.sessionManager.createSession(
      signers,
      myPrivateKey,
      message,
      metadata,
    )

    // Check if session already exists (prevent duplicates)
    if (this.sessions.has(session.sessionId)) {
      throw new Error(`Session already exists: ${session.sessionId}`)
    }

    // Create P2P session wrapper
    const p2pSession: MuSig2P2PSession = {
      session,
      coordinatorPeerId: this.peerId,
      participants: new Map(),
      isCoordinator: true,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }

    // Perform coordinator election if enabled
    if (this.config.enableCoordinatorElection) {
      const electionMethod = this._getElectionMethod()
      const election = electCoordinator(session.signers, electionMethod)

      // Store election results in session
      session.coordinatorIndex = election.coordinatorIndex
      session.electionMethod = this.config.electionMethod
      session.electionProof = election.electionProof

      // Generate backup coordinator priority list if failover enabled
      if (this.config.enableCoordinatorFailover) {
        session.backupCoordinators = getCoordinatorPriorityList(
          session.signers,
          electionMethod,
        )
      }

      console.log(
        `[MuSig2] Coordinator elected: index ${election.coordinatorIndex}, method: ${this.config.electionMethod}`,
      )
      this.emit(
        MuSig2Event.COORDINATOR_ELECTED,
        session.sessionId,
        election.coordinatorIndex,
        this.sessionManager.isCoordinator(session),
      )
    }

    // Store session
    this.sessions.set(session.sessionId, p2pSession)

    // Update metrics
    this.metrics.sessionsCreated++

    console.log(`[MuSig2] Created session: ${session.sessionId}`)
    this.emit(MuSig2Event.SESSION_CREATED, session.sessionId, session)

    return session.sessionId
  }

  /**
   * Announce session on GossipSub for peer discovery
   *
   * @param sessionId - Session ID
   */
  async announceSession(sessionId: string): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session

    // Create announcement
    const announcement: SessionAnnouncement = {
      sessionId: session.sessionId,
      requiredSigners: session.signers.length,
      coordinatorPeerId: this.peerId,
      signers: session.signers.map(pk => pk.toString()),
      messageHash: Hash.sha256(session.message).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.announcementTTL,
      metadata: session.metadata,
    }

    // Store announcement
    p2pSession.announcement = announcement

    // Publish to GossipSub
    await this.coordinator.publishToTopic(
      this.config.announcementTopic,
      announcement,
    )

    console.log(`[MuSig2] Announced session: ${sessionId}`)
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): MuSig2P2PSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): MuSig2P2PSession[] {
    return Array.from(this.sessions.values())
  }

  // ============================================================================
  // Nonce Exchange (Phase 1: Commit-then-Reveal)
  // ============================================================================

  /**
   * Share nonce commitment (Phase 1a)
   *
   * Per Blockchain Commons specification, parties must exchange commitments
   * before revealing nonces to prevent adaptive nonce attacks.
   *
   * Reference: https://developer.blockchaincommons.com/musig/sequence/
   * "Parties exchange nonce commitments before revealing their actual nonces to ensure fairness."
   *
   * @param sessionId - Session ID
   * @param privateKey - This signer's private key
   */
  async shareNonceCommitment(
    sessionId: string,
    privateKey: PrivateKey,
  ): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session

    // Validate phase
    if (session.phase !== MuSigSessionPhase.INIT) {
      throw new Error(
        `Cannot share commitment in phase ${session.phase}. Expected INIT`,
      )
    }

    // Check if we already have nonces (prevent re-sharing)
    if (session.myPublicNonce) {
      throw new Error('Nonces already generated for this session')
    }

    // Generate nonces first (but don't reveal yet!)
    const publicNonces = this.sessionManager.generateNonces(session, privateKey)

    // SECURITY: Track nonce to prevent reuse
    const nonceHash = this._hashNonce(publicNonces)
    if (this.usedNonces.has(nonceHash)) {
      throw new Error('Nonce reuse detected! Aborting for security.')
    }
    this.usedNonces.add(nonceHash)

    // Compute commitment to nonces
    const commitment = this.sessionManager.computeNonceCommitment(publicNonces)

    // Update session state
    p2pSession.lastActivity = Date.now()

    // Broadcast commitment to all other participants
    const payload: NonceCommitmentPayload = {
      sessionId,
      signerIndex: session.myIndex,
      commitment: commitment.toString('hex'),
      timestamp: Date.now(),
    }

    await this._broadcastToSessionParticipants(
      sessionId,
      MuSig2MessageType.NONCE_COMMITMENT,
      payload,
    )

    // Set timeout for commitment collection
    this._setCommitmentTimeout(sessionId)

    console.log(`[MuSig2] Shared nonce commitment for session: ${sessionId}`)
  }

  /**
   * Share nonces (Phase 1b)
   *
   * Only call this after all commitments have been collected.
   * This reveals the nonces that were previously committed to.
   *
   * @param sessionId - Session ID
   * @param privateKey - This signer's private key
   */
  async shareNonces(sessionId: string, privateKey: PrivateKey): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session

    // Validate phase
    if (
      session.phase !== MuSigSessionPhase.INIT &&
      session.phase !== MuSigSessionPhase.NONCE_EXCHANGE
    ) {
      throw new Error(
        `Cannot share nonces in phase ${session.phase}. Expected INIT or NONCE_EXCHANGE`,
      )
    }

    // Generate nonces using session manager
    const publicNonces = this.sessionManager.generateNonces(session, privateKey)

    // Transition to NONCE_EXCHANGE if needed
    if (session.phase === MuSigSessionPhase.INIT) {
      session.phase = MuSigSessionPhase.NONCE_EXCHANGE
      session.updatedAt = Date.now()
    }

    // Update session state
    p2pSession.lastActivity = Date.now()

    // Broadcast nonces to all other participants
    const payload: NonceSharePayload = {
      sessionId,
      signerIndex: session.myIndex,
      publicNonce: {
        r1: Point.pointToCompressed(publicNonces[0]).toString('hex'),
        r2: Point.pointToCompressed(publicNonces[1]).toString('hex'),
      },
      timestamp: Date.now(),
    }

    await this._broadcastToSessionParticipants(
      sessionId,
      MuSig2MessageType.NONCE_SHARE,
      payload,
    )

    // Set timeout for nonce collection
    this._setNonceTimeout(sessionId)

    console.log(`[MuSig2] Shared nonces for session: ${sessionId}`)
  }

  // ============================================================================

  /**
   * Create and share partial signature for a session
   *
   * @param sessionId - Session ID
   * @param privateKey - This signer's private key
   */
  async sharePartialSignature(
    sessionId: string,
    privateKey: PrivateKey,
  ): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session

    // Validate phase
    if (session.phase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) {
      throw new Error(
        `Cannot share partial signature in phase ${session.phase}. Expected PARTIAL_SIG_EXCHANGE`,
      )
    }

    // Create partial signature using session manager
    const partialSig = this.sessionManager.createPartialSignature(
      session,
      privateKey,
    )

    // Update session state
    p2pSession.lastActivity = Date.now()

    // Broadcast partial signature to all other participants
    const payload: PartialSigSharePayload = {
      sessionId,
      signerIndex: session.myIndex,
      partialSig: partialSig.toBuffer({ size: 32 }).toString('hex'),
      timestamp: Date.now(),
    }

    await this._broadcastToSessionParticipants(
      sessionId,
      MuSig2MessageType.PARTIAL_SIG_SHARE,
      payload,
    )

    // Set timeout for partial signature collection
    this._setPartialSigTimeout(sessionId)

    console.log(`[MuSig2] Shared partial signature for session: ${sessionId}`)
  }

  // ============================================================================
  // Session Finalization
  // ============================================================================

  /**
   * Check if session is ready to finalize
   */
  canFinalizeSession(sessionId: string): boolean {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      return false
    }

    return this.sessionManager.hasAllPartialSignatures(p2pSession.session)
  }

  /**
   * Finalize session and get final signature
   *
   * @param sessionId - Session ID
   * @returns Final aggregated signature
   */
  async finalizeSession(sessionId: string): Promise<Buffer> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session

    // Get final signature using session manager
    const signature = this.sessionManager.getFinalSignature(session)

    // Update session state
    p2pSession.lastActivity = Date.now()

    // Update metrics
    this.metrics.sessionsCompleted++

    // Clear timeouts
    this._clearSessionTimeout(sessionId)
    this._clearBroadcastTimeout(sessionId)

    // Broadcast completion to participants
    const sigBuffer = signature.toBuffer()
    const completionPayload: SessionCompletePayload = {
      sessionId,
      finalSignature: {
        r: sigBuffer.subarray(0, 32).toString('hex'),
        s: sigBuffer.subarray(32, 64).toString('hex'),
      },
      timestamp: Date.now(),
    }

    await this._broadcastToSessionParticipants(
      sessionId,
      MuSig2MessageType.SESSION_COMPLETE,
      completionPayload,
    ).catch(console.error)

    console.log(`[MuSig2] Finalized session: ${sessionId}`)
    this.emit(MuSig2Event.SESSION_COMPLETE, sessionId, signature)

    // Cleanup: Clear nonces from this session to free memory
    this._clearSessionNonces(p2pSession.session)

    return sigBuffer
  }

  // ============================================================================
  // Session Abort
  // ============================================================================

  /**
   * Abort a session
   *
   * @param sessionId - Session ID
   * @param reason - Abort reason
   */
  async abortSession(sessionId: string, reason: string): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Update session state
    p2pSession.session.phase = MuSigSessionPhase.ABORTED
    p2pSession.session.abortReason = reason
    p2pSession.lastActivity = Date.now()

    // Clear any pending timeouts
    this._clearSessionTimeout(sessionId)

    // Notify participants
    const payload: SessionAbortPayload = {
      sessionId,
      reason,
      timestamp: Date.now(),
    }

    await this._broadcastToSessionParticipants(
      sessionId,
      MuSig2MessageType.SESSION_ABORT,
      payload,
    )

    // Update metrics
    this.metrics.sessionsAborted++

    // Cleanup: Clear nonces from this session
    this._clearSessionNonces(p2pSession.session)

    console.log(`[MuSig2] Aborted session ${sessionId}: ${reason}`)
    this.emit(MuSig2Event.SESSION_ABORTED, sessionId, reason)

    // Remove session after abort
    this.sessions.delete(sessionId)
  }

  // ============================================================================
  // Protocol Event Handlers
  // ============================================================================

  /**
   * Setup protocol event handlers
   */
  private _setupProtocolHandlers(): void {
    // Nonce commitment received (Phase 1a)
    this.protocolHandler.on(
      'nonce:commitment',
      async (payload: NonceCommitmentPayload, from) => {
        await this._handleNonceCommitment(payload, from.peerId)
      },
    )

    // Nonce received (Phase 1b)
    this.protocolHandler.on(
      'nonce:share',
      async (payload: NonceSharePayload, from) => {
        await this._handleNonceShare(payload, from.peerId)
      },
    )

    // Partial signature received (Phase 2)
    this.protocolHandler.on(
      'partial-sig:share',
      async (payload: PartialSigSharePayload, from) => {
        await this._handlePartialSigShare(payload, from.peerId)
      },
    )

    // Session abort
    this.protocolHandler.on(
      'session:abort',
      async (payload: SessionAbortPayload, from) => {
        await this._handleSessionAbort(payload, from.peerId)
      },
    )

    // Peer disconnected
    this.protocolHandler.on('peer:disconnected', (peerId: string) => {
      this._handlePeerDisconnected(peerId)
    })
  }

  /**
   * Handle session announcement from GossipSub
   */
  private _handleSessionAnnouncement(data: Uint8Array): void {
    try {
      const json = Buffer.from(data).toString('utf8')
      const announcement = JSON.parse(json) as SessionAnnouncement

      console.log(
        `[MuSig2] Discovered session: ${announcement.sessionId} from ${announcement.coordinatorPeerId}`,
      )

      this.emit(MuSig2Event.SESSION_DISCOVERED, announcement)
    } catch (error) {
      console.error('[MuSig2] Error parsing session announcement:', error)
    }
  }

  /**
   * Handle nonce commitment from peer (Phase 1a)
   */
  private async _handleNonceCommitment(
    payload: NonceCommitmentPayload,
    fromPeerId: string,
  ): Promise<void> {
    const p2pSession = this.sessions.get(payload.sessionId)
    if (!p2pSession) {
      console.warn(
        `[MuSig2] Received commitment for unknown session: ${payload.sessionId}`,
      )
      return
    }

    try {
      // Deserialize commitment
      const commitment = Buffer.from(payload.commitment, 'hex')

      // Store commitment using session manager
      this.sessionManager.receiveNonceCommitment(
        p2pSession.session,
        payload.signerIndex,
        commitment,
      )

      // Update participant state
      const participant = p2pSession.participants.get(fromPeerId)
      if (participant) {
        participant.lastSeen = Date.now()
      }

      p2pSession.lastActivity = Date.now()

      console.log(
        `[MuSig2] Received commitment from peer ${fromPeerId} (index ${payload.signerIndex})`,
      )

      this.emit(
        MuSig2Event.COMMITMENT_RECEIVED,
        payload.sessionId,
        payload.signerIndex,
      )

      // Check if all commitments collected
      if (this.sessionManager.hasAllNonceCommitments(p2pSession.session)) {
        console.log(
          `[MuSig2] All commitments collected for ${payload.sessionId}`,
        )

        // Clear commitment timeout
        this._clearSessionTimeout(payload.sessionId)

        // Emit event - now safe to reveal nonces
        this.emit(MuSig2Event.COMMITMENTS_COMPLETE, payload.sessionId)
      }
    } catch (error) {
      console.error('[MuSig2] Error processing commitment:', error)
      this.emit(MuSig2Event.SESSION_ERROR, payload.sessionId, error)
    }
  }

  /**
   * Handle nonce share from peer (Phase 1b)
   */
  private async _handleNonceShare(
    payload: NonceSharePayload,
    fromPeerId: string,
  ): Promise<void> {
    const p2pSession = this.sessions.get(payload.sessionId)
    if (!p2pSession) {
      console.warn(
        `[MuSig2] Received nonce for unknown session: ${payload.sessionId}`,
      )
      return
    }

    try {
      // Deserialize nonce points (use PublicKey helper for decompression)
      const r1 = PublicKey.fromBuffer(
        Buffer.from(payload.publicNonce.r1, 'hex'),
      ).point
      const r2 = PublicKey.fromBuffer(
        Buffer.from(payload.publicNonce.r2, 'hex'),
      ).point
      const publicNonce: [Point, Point] = [r1, r2]

      // Add nonce to session using session manager
      this.sessionManager.receiveNonce(
        p2pSession.session,
        payload.signerIndex,
        publicNonce,
      )

      // Update participant state
      const participant = p2pSession.participants.get(fromPeerId)
      if (participant) {
        participant.hasNonce = true
        participant.lastSeen = Date.now()
      }

      p2pSession.lastActivity = Date.now()

      console.log(
        `[MuSig2] Received nonce from peer ${fromPeerId} (index ${payload.signerIndex})`,
      )

      this.emit(
        MuSig2Event.NONCE_RECEIVED,
        payload.sessionId,
        payload.signerIndex,
      )

      // Check if all nonces collected
      if (this.sessionManager.hasAllNonces(p2pSession.session)) {
        console.log(`[MuSig2] All nonces collected for ${payload.sessionId}`)

        // Clear nonce timeout
        this._clearSessionTimeout(payload.sessionId)

        // Auto-transition to PARTIAL_SIG_EXCHANGE
        p2pSession.session.phase = MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
        p2pSession.session.updatedAt = Date.now()

        this.emit(MuSig2Event.NONCES_COMPLETE, payload.sessionId)
      }
    } catch (error) {
      console.error('[MuSig2] Error processing nonce:', error)
      this.emit(MuSig2Event.SESSION_ERROR, payload.sessionId, error)
    }
  }

  /**
   * Handle partial signature share from peer
   */
  private async _handlePartialSigShare(
    payload: PartialSigSharePayload,
    fromPeerId: string,
  ): Promise<void> {
    const p2pSession = this.sessions.get(payload.sessionId)
    if (!p2pSession) {
      console.warn(
        `[MuSig2] Received partial sig for unknown session: ${payload.sessionId}`,
      )
      return
    }

    try {
      // Deserialize partial signature
      const partialSig = new BN(Buffer.from(payload.partialSig, 'hex'))

      // Add partial signature to session using session manager
      this.sessionManager.receivePartialSignature(
        p2pSession.session,
        payload.signerIndex,
        partialSig,
      )

      // Update participant state
      const participant = p2pSession.participants.get(fromPeerId)
      if (participant) {
        participant.hasPartialSig = true
        participant.lastSeen = Date.now()
      }

      p2pSession.lastActivity = Date.now()

      console.log(
        `[MuSig2] Received partial sig from peer ${fromPeerId} (index ${payload.signerIndex})`,
      )

      this.emit(
        MuSig2Event.PARTIAL_SIG_RECEIVED,
        payload.sessionId,
        payload.signerIndex,
      )

      // Check if all partial signatures collected
      if (this.sessionManager.hasAllPartialSignatures(p2pSession.session)) {
        console.log(
          `[MuSig2] All partial signatures collected for ${payload.sessionId}`,
        )

        // Clear partial sig timeout
        this._clearSessionTimeout(payload.sessionId)

        // Auto-transition to COMPLETE
        p2pSession.session.phase = MuSigSessionPhase.COMPLETE
        p2pSession.session.updatedAt = Date.now()

        this.emit(MuSig2Event.PARTIAL_SIGS_COMPLETE, payload.sessionId)

        // If election is enabled and I'm the coordinator, set broadcast timeout
        if (
          this.config.enableCoordinatorElection &&
          this.config.enableCoordinatorFailover &&
          this.sessionManager.isCoordinator(p2pSession.session)
        ) {
          this._setBroadcastTimeout(payload.sessionId)
          this.emit(
            MuSig2Event.SHOULD_BROADCAST,
            payload.sessionId,
            p2pSession.session.coordinatorIndex,
          )
        }
      }
    } catch (error) {
      console.error('[MuSig2] Error processing partial signature:', error)
      this.emit(MuSig2Event.SESSION_ERROR, payload.sessionId, error)
    }
  }

  /**
   * Handle session abort from peer
   */
  private async _handleSessionAbort(
    payload: SessionAbortPayload,
    fromPeerId: string,
  ): Promise<void> {
    const p2pSession = this.sessions.get(payload.sessionId)
    if (!p2pSession) {
      return
    }

    console.log(
      `[MuSig2] Session ${payload.sessionId} aborted by ${fromPeerId}: ${payload.reason}`,
    )

    // Mark session as aborted
    p2pSession.session.phase = MuSigSessionPhase.ABORTED
    p2pSession.session.abortReason = payload.reason

    this.emit(MuSig2Event.SESSION_ABORTED, payload.sessionId, payload.reason)

    // Remove session
    this.sessions.delete(payload.sessionId)
  }

  /**
   * Handle peer disconnection
   */
  private _handlePeerDisconnected(peerId: string): void {
    // Find sessions with this peer
    for (const [sessionId, p2pSession] of this.sessions) {
      if (p2pSession.participants.has(peerId)) {
        console.warn(
          `[MuSig2] Peer ${peerId} disconnected from session ${sessionId}`,
        )

        // If session is in progress, consider aborting
        if (
          p2pSession.session.phase === MuSigSessionPhase.NONCE_EXCHANGE ||
          p2pSession.session.phase === MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
        ) {
          this.abortSession(
            sessionId,
            `Participant ${peerId} disconnected`,
          ).catch(error => {
            console.error('[MuSig2] Error aborting session:', error)
          })
        }
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Broadcast message to all session participants
   */
  private async _broadcastToSessionParticipants(
    sessionId: string,
    messageType: MuSig2MessageType,
    payload: unknown,
  ): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Get all participant peer IDs
    const peerIds = Array.from(p2pSession.participants.keys())

    // Create P2P message
    const message = this.protocol.createMessage(
      messageType,
      payload,
      this.peerId,
      { protocol: 'musig2' },
    )

    // Send to all participants
    await this.coordinator.broadcast(message, {
      includedOnly: peerIds,
    })
  }

  /**
   * Start automatic session cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * Cleanup expired sessions
   */
  private cleanup(): void {
    const now = Date.now()
    const maxAge = 10 * 60 * 1000 // 10 minutes

    for (const [sessionId, p2pSession] of this.sessions) {
      // Remove old sessions
      if (now - p2pSession.lastActivity > maxAge) {
        console.log(`[MuSig2] Cleaning up expired session: ${sessionId}`)
        this._clearSessionTimeout(sessionId)
        this.sessions.delete(sessionId)
      }
    }
  }

  /**
   * Set timeout for commitment collection
   */
  private _setCommitmentTimeout(sessionId: string): void {
    // Clear existing timeout
    this._clearSessionTimeout(sessionId)

    // Set new timeout
    const timeout = setTimeout(() => {
      const p2pSession = this.sessions.get(sessionId)
      if (!p2pSession) return

      if (p2pSession.session.phase === MuSigSessionPhase.INIT) {
        console.warn(
          `[MuSig2] Commitment collection timeout for session: ${sessionId}`,
        )
        this.metrics.sessionsTimedOut++
        this.emit(
          MuSig2Event.SESSION_TIMEOUT,
          sessionId,
          'commitment-collection',
        )
        this.abortSession(sessionId, 'Timeout waiting for commitments').catch(
          console.error,
        )
      }
    }, this.config.nonceTimeout) // Use same timeout as nonce collection

    this.sessionTimeouts.set(sessionId, timeout)
  }

  /**
   * Set timeout for nonce collection
   */
  private _setNonceTimeout(sessionId: string): void {
    // Clear existing timeout
    this._clearSessionTimeout(sessionId)

    // Set new timeout
    const timeout = setTimeout(() => {
      const p2pSession = this.sessions.get(sessionId)
      if (!p2pSession) return

      if (p2pSession.session.phase === MuSigSessionPhase.NONCE_EXCHANGE) {
        console.warn(
          `[MuSig2] Nonce collection timeout for session: ${sessionId}`,
        )
        this.metrics.sessionsTimedOut++
        this.emit(MuSig2Event.SESSION_TIMEOUT, sessionId, 'nonce-collection')
        this.abortSession(sessionId, 'Timeout waiting for nonces').catch(
          console.error,
        )
      }
    }, this.config.nonceTimeout)

    this.sessionTimeouts.set(sessionId, timeout)
  }

  /**
   * Set timeout for partial signature collection
   */
  private _setPartialSigTimeout(sessionId: string): void {
    // Clear existing timeout
    this._clearSessionTimeout(sessionId)

    // Set new timeout
    const timeout = setTimeout(() => {
      const p2pSession = this.sessions.get(sessionId)
      if (!p2pSession) return

      if (p2pSession.session.phase === MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) {
        console.warn(
          `[MuSig2] Partial signature collection timeout for session: ${sessionId}`,
        )
        this.metrics.sessionsTimedOut++
        this.emit(
          MuSig2Event.SESSION_TIMEOUT,
          sessionId,
          'partial-sig-collection',
        )
        this.abortSession(
          sessionId,
          'Timeout waiting for partial signatures',
        ).catch(console.error)
      }
    }, this.config.partialSigTimeout)

    this.sessionTimeouts.set(sessionId, timeout)
  }

  /**
   * Clear session timeout
   */
  private _clearSessionTimeout(sessionId: string): void {
    const timeout = this.sessionTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.sessionTimeouts.delete(sessionId)
    }
  }

  /**
   * Hash nonce for reuse prevention
   */
  private _hashNonce(publicNonce: [Point, Point]): string {
    const r1Bytes = Point.pointToCompressed(publicNonce[0])
    const r2Bytes = Point.pointToCompressed(publicNonce[1])
    return Hash.sha256(Buffer.concat([r1Bytes, r2Bytes])).toString('hex')
  }

  /**
   * Get election method enum from config string
   */
  private _getElectionMethod(): ElectionMethod {
    switch (this.config.electionMethod) {
      case 'lexicographic':
        return ElectionMethod.LEXICOGRAPHIC
      case 'hash-based':
        return ElectionMethod.HASH_BASED
      case 'first-signer':
        return ElectionMethod.FIRST_SIGNER
      case 'last-signer':
        return ElectionMethod.LAST_SIGNER
      default:
        return ElectionMethod.LEXICOGRAPHIC
    }
  }

  /**
   * Set broadcast timeout for coordinator failover
   */
  private _setBroadcastTimeout(sessionId: string): void {
    // Clear existing timeout
    this._clearBroadcastTimeout(sessionId)

    // Set new timeout
    const timeout = setTimeout(() => {
      this._handleBroadcastTimeout(sessionId).catch(console.error)
    }, this.config.broadcastTimeout)

    this.broadcastTimeouts.set(sessionId, timeout)
  }

  /**
   * Clear broadcast timeout
   */
  private _clearBroadcastTimeout(sessionId: string): void {
    const timeout = this.broadcastTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.broadcastTimeouts.delete(sessionId)
    }
  }

  /**
   * Handle broadcast timeout (coordinator failover)
   */
  private async _handleBroadcastTimeout(sessionId: string): Promise<void> {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) return

    const session = p2pSession.session

    console.warn(
      `[MuSig2] Broadcast timeout for session ${sessionId}, initiating failover`,
    )

    // Get backup coordinator
    if (!session.coordinatorIndex || !session.electionMethod) {
      console.error('[MuSig2] Cannot failover: no election data')
      return
    }

    const backup = getBackupCoordinator(
      session.signers,
      session.coordinatorIndex,
      this._getElectionMethod(),
    )

    if (backup === null) {
      console.error(
        '[MuSig2] No backup coordinator available, failover exhausted',
      )
      this.emit(MuSig2Event.FAILOVER_EXHAUSTED, sessionId)
      return
    }

    // Update coordinator index
    const oldCoordinator = session.coordinatorIndex
    session.coordinatorIndex = backup
    session.updatedAt = Date.now()

    console.log(`[MuSig2] Failover: coordinator ${oldCoordinator} → ${backup}`)
    this.emit(MuSig2Event.COORDINATOR_FAILED, sessionId, oldCoordinator)

    // Check if I am the new coordinator
    if (this.sessionManager.isCoordinator(session)) {
      console.log(`[MuSig2] I am now coordinator for session ${sessionId}`)
      this.emit(MuSig2Event.SHOULD_BROADCAST, sessionId, backup)
    }

    // Set new broadcast timeout for backup coordinator
    this._setBroadcastTimeout(sessionId)
  }

  /**
   * Clear session nonces from tracking (memory management)
   */
  private _clearSessionNonces(session: MuSigSession): void {
    if (session.myPublicNonce) {
      const nonceHash = this._hashNonce(session.myPublicNonce)
      this.usedNonces.delete(nonceHash)
    }
  }

  /**
   * Get session participants
   */
  getParticipants(sessionId: string): SessionParticipant[] {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return Array.from(p2pSession.participants.values())
  }

  /**
   * Get specific participant
   */
  getParticipant(
    sessionId: string,
    peerId: string,
  ): SessionParticipant | undefined {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      return undefined
    }
    return p2pSession.participants.get(peerId)
  }

  /**
   * Remove participant from session
   */
  removeParticipant(sessionId: string, peerId: string): boolean {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      return false
    }

    const removed = p2pSession.participants.delete(peerId)
    if (removed) {
      console.log(
        `[MuSig2] Removed participant ${peerId} from session ${sessionId}`,
      )
      p2pSession.lastActivity = Date.now()
    }
    return removed
  }

  /**
   * Get coordinator metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeSessions: this.sessions.size,
      totalUsedNonces: this.usedNonces.size,
    }
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  // ============================================================================
  // Coordinator Election Methods
  // ============================================================================

  /**
   * Check if this participant is the coordinator for a session
   */
  isCoordinator(sessionId: string): boolean {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return this.sessionManager.isCoordinator(p2pSession.session)
  }

  /**
   * Get coordinator information for a session
   */
  getCoordinatorInfo(sessionId: string): {
    coordinatorIndex: number | undefined
    isCoordinator: boolean
    electionMethod: string | undefined
    electionProof: string | undefined
    backupCoordinators: number[] | undefined
  } {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session
    return {
      coordinatorIndex: session.coordinatorIndex,
      isCoordinator: this.sessionManager.isCoordinator(session),
      electionMethod: session.electionMethod,
      electionProof: session.electionProof,
      backupCoordinators: session.backupCoordinators,
    }
  }

  /**
   * Get backup coordinator for a session
   */
  getBackupCoordinator(sessionId: string): number | null {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session
    if (!session.coordinatorIndex || !session.electionMethod) {
      return null
    }

    return getBackupCoordinator(
      session.signers,
      session.coordinatorIndex,
      this._getElectionMethod(),
    )
  }

  /**
   * Get coordinator priority list for a session
   */
  getCoordinatorPriorityList(sessionId: string): number[] {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const session = p2pSession.session
    if (session.backupCoordinators) {
      return session.backupCoordinators
    }

    if (!session.electionMethod) {
      throw new Error('Session does not have election data')
    }

    return getCoordinatorPriorityList(
      session.signers,
      this._getElectionMethod(),
    )
  }

  /**
   * Notify that broadcast has been completed (cancels failover timeout)
   */
  notifyBroadcastComplete(sessionId: string): void {
    this._clearBroadcastTimeout(sessionId)
    console.log(`[MuSig2] Broadcast confirmed for session ${sessionId}`)
    this.emit(MuSig2Event.BROADCAST_CONFIRMED, sessionId)
  }

  /**
   * Add participant to session
   */
  addParticipant(
    sessionId: string,
    peerId: string,
    signerIndex: number,
    publicKey: PublicKey,
  ): void {
    const p2pSession = this.sessions.get(sessionId)
    if (!p2pSession) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Prevent duplicate participants
    if (p2pSession.participants.has(peerId)) {
      throw new Error(`Participant ${peerId} already in session ${sessionId}`)
    }

    // Validate signer index
    if (signerIndex < 0 || signerIndex >= p2pSession.session.signers.length) {
      throw new Error(`Invalid signer index: ${signerIndex}`)
    }

    // Verify public key matches signer index
    const expectedPubKey = p2pSession.session.signers[signerIndex]
    if (!expectedPubKey.toBuffer().equals(publicKey.toBuffer())) {
      throw new Error(`Public key mismatch for signer index ${signerIndex}`)
    }

    const participant: SessionParticipant = {
      peerId,
      signerIndex,
      publicKey,
      hasNonce: false,
      hasPartialSig: false,
      lastSeen: Date.now(),
    }

    p2pSession.participants.set(peerId, participant)
    p2pSession.lastActivity = Date.now()

    console.log(
      `[MuSig2] Added participant ${peerId} to session ${sessionId} (index ${signerIndex})`,
    )

    this.emit(MuSig2Event.PARTICIPANT_JOINED, sessionId, participant)

    // Check if all participants joined
    if (
      p2pSession.participants.size ===
      p2pSession.session.signers.length - 1
    ) {
      // -1 because we don't count ourselves
      console.log(`[MuSig2] All participants joined session ${sessionId}`)
      this.emit(MuSig2Event.SESSION_READY, sessionId)
    }
  }
}
