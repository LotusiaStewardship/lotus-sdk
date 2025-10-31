/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 P2P Coordinator
 *
 * High-level API for P2P-coordinated MuSig2 multi-signature sessions
 */

import { P2PCoordinator } from '../coordinator.js'
import { P2PConfig } from '../types.js'
import { P2PProtocol } from '../protocol.js'
import { P2PMessage } from '../types.js'
import {
  MuSig2MessageType,
  MuSig2P2PConfig,
  ActiveSession,
  SessionAnnouncementData,
  SessionJoinPayload,
  NonceSharePayload,
  PartialSigSharePayload,
  SessionAnnouncementPayload,
} from './types.js'
import {
  serializePublicNonce,
  serializeBN,
  serializePublicKey,
  serializeMessage,
} from './serialization.js'
import { MuSig2P2PProtocolHandler } from './protocol-handler.js'
import {
  MuSigSessionManager,
  MuSigSession,
  MuSigSessionPhase,
} from '../../bitcore/musig2/session.js'
import { PublicKey } from '../../bitcore/publickey.js'
import { PrivateKey } from '../../bitcore/privatekey.js'
import { Signature } from '../../bitcore/crypto/signature.js'
import { Point } from '../../bitcore/crypto/point.js'
import { BN } from '../../bitcore/crypto/bn.js'
import {
  electCoordinator,
  ElectionMethod,
  ElectionResult,
  getBackupCoordinator,
  getCoordinatorPriorityList,
} from './election.js'

/**
 * MuSig2 P2P Coordinator
 *
 * Extends P2PCoordinator to add MuSig2-specific functionality
 * Manages MuSig2 signing sessions over P2P network
 */
export class MuSig2P2PCoordinator extends P2PCoordinator {
  private sessionManager: MuSigSessionManager
  private protocolHandler: MuSig2P2PProtocolHandler
  private messageProtocol: P2PProtocol // Renamed to avoid conflict with parent's private 'protocol'
  private activeSessions: Map<string, ActiveSession> = new Map()
  private peerIdToSignerIndex: Map<string, Map<string, number>> = new Map() // sessionId -> peerId -> signerIndex
  private musig2Config: {
    sessionTimeout: number
    enableSessionDiscovery: boolean
    sessionResourceType: string
    enableCoordinatorElection: boolean
    electionMethod:
      | 'lexicographic'
      | 'hash-based'
      | 'first-signer'
      | 'last-signer'
    enableCoordinatorFailover: boolean
    broadcastTimeout: number
  }

  constructor(p2pConfig: P2PConfig, musig2Config?: Partial<MuSig2P2PConfig>) {
    // Call parent constructor with P2P config
    super(p2pConfig)

    this.sessionManager = new MuSigSessionManager()
    this.protocolHandler = new MuSig2P2PProtocolHandler()
    this.messageProtocol = new P2PProtocol()
    this.protocolHandler.setCoordinator(this)

    this.musig2Config = {
      sessionTimeout: musig2Config?.sessionTimeout || 2 * 60 * 60 * 1000, // 2 hours
      enableSessionDiscovery: musig2Config?.enableSessionDiscovery ?? true,
      sessionResourceType:
        musig2Config?.sessionResourceType || 'musig2-session',
      enableCoordinatorElection:
        musig2Config?.enableCoordinatorElection ?? false,
      electionMethod: musig2Config?.electionMethod || 'lexicographic',
      enableCoordinatorFailover:
        musig2Config?.enableCoordinatorFailover ??
        musig2Config?.enableCoordinatorElection ??
        false,
      broadcastTimeout: musig2Config?.broadcastTimeout || 5 * 60 * 1000, // 5 minutes
    }

    // Register protocol handler with parent P2PCoordinator
    this.registerProtocol(this.protocolHandler)
  }

  /**
   * Create and announce a new MuSig2 session
   *
   * @param signers - All participating signers' public keys (in order)
   * @param myPrivateKey - This signer's private key
   * @param message - Message to be signed
   * @param metadata - Optional session metadata
   * @returns Session ID
   */
  async createSession(
    signers: PublicKey[],
    myPrivateKey: PrivateKey,
    message: Buffer,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    // Create session locally
    const session = this.sessionManager.createSession(
      signers,
      myPrivateKey,
      message,
      metadata,
    )

    // Perform coordinator election if enabled
    let election: ElectionResult | undefined
    if (this.musig2Config.enableCoordinatorElection) {
      const electionMethod = this._getElectionMethod()
      election = electCoordinator(signers, electionMethod)
    }

    // Create active session tracking
    const activeSession: ActiveSession = {
      sessionId: session.sessionId,
      session,
      participants: new Map(),
      phase: session.phase,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }

    // Add election data if enabled
    if (election) {
      activeSession.election = {
        coordinatorIndex: election.coordinatorIndex,
        coordinatorPeerId:
          election.coordinatorIndex === session.myIndex
            ? this.peerId
            : undefined,
        electionProof: election.electionProof,
      }
    }

    // Add myself to participants
    activeSession.participants.set(session.myIndex, this.peerId)

    this.activeSessions.set(session.sessionId, activeSession)

    // Announce session to DHT if enabled
    if (this.musig2Config.enableSessionDiscovery) {
      await this._announceSessionToDHT(session, this.peerId)
    }

    // Emit event
    this.emit('session:created', session.sessionId)

    return session.sessionId
  }

  /**
   * Join an existing session discovered via DHT or direct invitation
   *
   * @param sessionId - Session ID to join
   * @param myPrivateKey - This signer's private key
   */
  async joinSession(
    sessionId: string,
    myPrivateKey: PrivateKey,
  ): Promise<void> {
    // First, try to discover session from DHT
    let announcement: SessionAnnouncementData | null = null

    if (this.musig2Config.enableSessionDiscovery) {
      announcement = await this._discoverSessionFromDHT(sessionId)
    }

    if (!announcement) {
      throw new Error(`Session ${sessionId} not found. Cannot join.`)
    }

    // Find my index in signers
    const myPubKey = myPrivateKey.publicKey
    const myIndex = announcement.signers.findIndex(
      signer => signer.toString() === myPubKey.toString(),
    )

    if (myIndex === -1) {
      throw new Error(
        'Your public key is not in the session signers list. Cannot join.',
      )
    }

    // Create local session
    const session = this.sessionManager.createSession(
      announcement.signers,
      myPrivateKey,
      announcement.message,
      announcement.metadata,
    )

    // Perform coordinator election if enabled (from announcement data)
    let electionData: ActiveSession['election'] | undefined
    if (this.musig2Config.enableCoordinatorElection && announcement.election) {
      electionData = {
        coordinatorIndex: announcement.election.coordinatorIndex,
        electionProof: announcement.election.electionProof,
      }
    }

    // Create active session tracking
    const activeSession: ActiveSession = {
      sessionId: session.sessionId,
      session,
      participants: new Map(),
      phase: session.phase,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      election: electionData,
    }

    // Add myself
    activeSession.participants.set(session.myIndex, this.peerId)

    // Add the session creator to participants
    // Find the creator's signer index by matching their peer ID from announcement
    const creatorPeerId = announcement.creatorPeerId
    if (creatorPeerId !== this.peerId) {
      // The creator should be at a different signer index than mine
      // For now, add the creator - their exact signer index will be determined when they send messages
      // We'll add them to all indices except mine, and the protocol handler will update correctly
      for (let i = 0; i < session.signers.length; i++) {
        if (i !== session.myIndex) {
          // Assume other signers might be the creator or will be added via SESSION_JOIN handling
          activeSession.participants.set(i, creatorPeerId)
        }
      }
    }

    // Send join message to creator
    await this._sendSessionJoin(sessionId, myIndex, myPubKey, creatorPeerId)

    this.activeSessions.set(sessionId, activeSession)

    // Emit event
    this.emit('session:joined', sessionId)

    // Wait a bit for the creator to send us session state, then start Round 1
    // For now, we'll let the creator initiate Round 1
  }

  /**
   * Start Round 1: Generate and share nonces
   *
   * @param sessionId - Session ID
   * @param privateKey - This signer's private key
   */
  async startRound1(sessionId: string, privateKey: PrivateKey): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const { session } = activeSession

    // Generate nonces locally
    const publicNonces = this.sessionManager.generateNonces(session, privateKey)

    // Broadcast nonces to all participants
    await this._broadcastNonceShare(
      sessionId,
      session.myIndex,
      publicNonces,
      activeSession.participants,
    )

    // Check if we already have all nonces (if others sent first)
    if (this.sessionManager.hasAllNonces(session)) {
      await this._handleAllNoncesReceived(sessionId)
    }
  }

  /**
   * Start Round 2: Create and share partial signatures
   *
   * @param sessionId - Session ID
   * @param privateKey - This signer's private key
   */
  async startRound2(sessionId: string, privateKey: PrivateKey): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const { session } = activeSession

    // Create partial signature
    const partialSig = this.sessionManager.createPartialSignature(
      session,
      privateKey,
    )

    // Broadcast partial signature to all participants
    await this._broadcastPartialSigShare(
      sessionId,
      session.myIndex,
      partialSig,
      activeSession.participants,
    )

    // Check if we already have all partial signatures
    if (this.sessionManager.hasAllPartialSignatures(session)) {
      await this._handleAllPartialSigsReceived(sessionId)
    }
  }

  /**
   * Get final aggregated signature
   *
   * @param sessionId - Session ID
   * @returns Final signature
   */
  getFinalSignature(sessionId: string): Signature {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    return this.sessionManager.getFinalSignature(activeSession.session)
  }

  /**
   * Get session status
   *
   * @param sessionId - Session ID
   * @returns Session status
   */
  getSessionStatus(sessionId: string) {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return null
    }

    return this.sessionManager.getSessionStatus(activeSession.session)
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys())
  }

  /**
   * Get session data
   *
   * @param sessionId - Session ID
   * @returns Session data or undefined if not found
   */
  getSession(sessionId: string): MuSigSession | undefined {
    const activeSession = this.activeSessions.get(sessionId)
    return activeSession?.session
  }

  /**
   * Register a participant in a session
   *
   * This is used for testing and manual coordination.
   * In production, this happens automatically via SESSION_JOIN messages.
   *
   * @warning
   *    ⚠️ NOT FOR PRODUCTION USE! This method is only for testing and manual demos.
   *    In real production code, never use `registerParticipant` directly—participants
   *    must join sessions via authenticated SESSION_JOIN messages over P2P.
   *
   * @param sessionId - Session ID
   * @param signerIndex - Index of the signer
   * @param peerId - Peer ID of the participant
   */
  async registerParticipant(
    sessionId: string,
    signerIndex: number,
    peerId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    activeSession.participants.set(signerIndex, peerId)

    // Track peer mapping
    let peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (!peerMap) {
      peerMap = new Map()
      this.peerIdToSignerIndex.set(sessionId, peerMap)
    }
    peerMap.set(peerId, signerIndex)
  }

  /**
   * Close a session
   *
   * @param sessionId - Session ID
   */
  async closeSession(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }

    // Clear any active failover timeout
    if (activeSession.failover?.broadcastTimeoutId) {
      clearTimeout(activeSession.failover.broadcastTimeoutId)
    }

    // Send abort to all participants
    await this._broadcastSessionAbort(
      sessionId,
      'Session closed',
      activeSession.participants,
    )

    // Remove session
    this.activeSessions.delete(sessionId)

    // Clean up peer mapping
    const peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (peerMap) {
      this.peerIdToSignerIndex.delete(sessionId)
    }

    this.emit('session:closed', sessionId)
  }

  // Internal methods for handling incoming messages

  /**
   * Handle session announcement from peer
   */
  async _handleSessionAnnouncement(
    sessionId: string,
    signers: PublicKey[],
    creatorIndex: number,
    message: Buffer,
    creatorPeerId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Store announcement for potential joining
    // In a full implementation, we'd verify the announcement signature
    this.emit('session:announced', {
      sessionId,
      signers,
      creatorIndex,
      message,
      creatorPeerId,
      metadata,
    })
  }

  /**
   * Handle session join from peer
   */
  async _handleSessionJoin(
    sessionId: string,
    signerIndex: number,
    publicKey: PublicKey,
    peerId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Verify public key matches expected signer
    const expectedKey = activeSession.session.signers[signerIndex]
    if (expectedKey.toString() !== publicKey.toString()) {
      throw new Error(
        `Public key mismatch for signer ${signerIndex} in session ${sessionId}`,
      )
    }

    // Add participant
    activeSession.participants.set(signerIndex, peerId)

    // Track peer mapping
    let peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (!peerMap) {
      peerMap = new Map()
      this.peerIdToSignerIndex.set(sessionId, peerMap)
    }
    peerMap.set(peerId, signerIndex)

    // If we're the creator and all participants have joined, start Round 1
    if (
      activeSession.session.myIndex === 0 && // Assuming creator is index 0
      activeSession.participants.size === activeSession.session.signers.length
    ) {
      // All participants joined - could auto-start Round 1 here
      this.emit('session:ready', sessionId)
    }
  }

  /**
   * Handle nonce share from peer
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

    const { session } = activeSession

    // Receive and validate nonce
    this.sessionManager.receiveNonce(session, signerIndex, publicNonce)

    // Update participant mapping if needed
    let peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (!peerMap) {
      peerMap = new Map()
      this.peerIdToSignerIndex.set(sessionId, peerMap)
    }
    peerMap.set(peerId, signerIndex)

    // Check if all nonces received
    if (this.sessionManager.hasAllNonces(session)) {
      await this._handleAllNoncesReceived(sessionId)
    }
  }

  /**
   * Handle all nonces received
   */
  private async _handleAllNoncesReceived(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }

    const { session } = activeSession

    // Nonces are automatically aggregated by session manager
    // Now we can start Round 2 (partial signatures)
    // For now, we'll emit an event and let the caller decide when to start Round 2
    this.emit('session:nonces-complete', sessionId)

    // Update phase tracking
    activeSession.phase = session.phase
    activeSession.updatedAt = Date.now()
  }

  /**
   * Handle partial signature share from peer
   */
  async _handlePartialSigShare(
    sessionId: string,
    signerIndex: number,
    partialSig: BN,
    peerId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const { session } = activeSession

    // Receive and verify partial signature
    this.sessionManager.receivePartialSignature(
      session,
      signerIndex,
      partialSig,
    )

    // Check if all partial signatures received
    if (this.sessionManager.hasAllPartialSignatures(session)) {
      await this._handleAllPartialSigsReceived(sessionId)
    }
  }

  /**
   * Handle all partial signatures received
   */
  private async _handleAllPartialSigsReceived(
    sessionId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }

    const { session } = activeSession

    // Signature is automatically finalized by session manager
    this.emit('session:complete', sessionId)

    // Update phase tracking
    activeSession.phase = session.phase
    activeSession.updatedAt = Date.now()

    // Initialize coordinator failover if enabled and election is active
    if (this.musig2Config.enableCoordinatorFailover && activeSession.election) {
      await this._initializeCoordinatorFailover(sessionId)
    }
  }

  /**
   * Handle session abort
   */
  async _handleSessionAbort(
    sessionId: string,
    reason: string,
    peerId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }

    const { session } = activeSession

    // Abort session
    this.sessionManager.abortSession(session, reason)

    this.emit('session:aborted', sessionId, reason)

    // Clean up
    this.activeSessions.delete(sessionId)
    this.peerIdToSignerIndex.delete(sessionId)
  }

  /**
   * Handle validation error
   */
  async _handleValidationError(
    sessionId: string,
    error: string,
    code: string,
    peerId: string,
  ): Promise<void> {
    console.error(
      `[MuSig2P2P] Validation error in session ${sessionId}:`,
      error,
    )

    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }

    this.emit('session:error', sessionId, error, code)
  }

  /**
   * Handle peer connection
   */
  _onPeerConnected(peerId: string): void {
    // Could notify active sessions
    this.emit('peer:connected', peerId)
  }

  /**
   * Handle peer disconnection
   */
  _onPeerDisconnected(peerId: string): void {
    // Check if any active sessions depend on this peer
    for (const [sessionId, activeSession] of this.activeSessions.entries()) {
      for (const [
        signerIndex,
        participantPeerId,
      ] of activeSession.participants.entries()) {
        if (participantPeerId === peerId) {
          // Participant disconnected - abort session?
          // For now, just emit event
          this.emit(
            'session:participant-disconnected',
            sessionId,
            signerIndex,
            peerId,
          )
        }
      }
    }

    this.emit('peer:disconnected', peerId)
  }

  // Private helper methods for messaging

  /**
   * Announce session to DHT
   */
  private async _announceSessionToDHT(
    session: MuSigSession,
    creatorPeerId: string,
  ): Promise<void> {
    // Get election data from active session if enabled
    const activeSession = this.activeSessions.get(session.sessionId)
    let electionPayload: SessionAnnouncementPayload['election'] | undefined

    if (activeSession?.election) {
      electionPayload = {
        coordinatorIndex: activeSession.election.coordinatorIndex,
        electionMethod: this.musig2Config.electionMethod,
        electionProof: activeSession.election.electionProof,
      }
    }

    const announcement: SessionAnnouncementData = {
      sessionId: session.sessionId,
      signers: session.signers,
      creatorPeerId,
      creatorIndex: session.myIndex,
      message: session.message,
      requiredSigners: session.signers.length,
      createdAt: session.createdAt,
      expiresAt: session.createdAt + this.musig2Config.sessionTimeout,
      metadata: session.metadata,
    }

    // Serialize signers and message for DHT storage
    const signersHex = session.signers.map(pk => serializePublicKey(pk))
    const messageHex = serializeMessage(session.message)

    const data: SessionAnnouncementPayload = {
      sessionId: session.sessionId,
      signers: signersHex,
      creatorIndex: session.myIndex,
      message: messageHex,
      requiredSigners: session.signers.length,
      metadata: session.metadata,
      election: electionPayload,
    }

    await this.announceResource(
      this.musig2Config.sessionResourceType,
      session.sessionId,
      data,
      {
        expiresAt: announcement.expiresAt,
      },
    )
  }

  /**
   * Discover session from DHT
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

    // Deserialize signers and message
    const signers = data.signers.map(hex => {
      const buffer = Buffer.from(hex, 'hex')
      return new PublicKey(buffer)
    })
    const message = Buffer.from(data.message, 'hex')

    return {
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
    }
  }

  /**
   * Send session join message
   */
  private async _sendSessionJoin(
    sessionId: string,
    signerIndex: number,
    publicKey: PublicKey,
    peerId: string,
  ): Promise<void> {
    const payload: SessionJoinPayload = {
      sessionId,
      signerIndex,
      publicKey: serializePublicKey(publicKey),
    }

    await this._sendMessageToPeer(
      peerId,
      MuSig2MessageType.SESSION_JOIN,
      payload,
    )
  }

  /**
   * Broadcast nonce share to all participants
   */
  private async _broadcastNonceShare(
    sessionId: string,
    signerIndex: number,
    publicNonce: [Point, Point],
    participants: Map<number, string>,
  ): Promise<void> {
    const payload: NonceSharePayload = {
      sessionId,
      signerIndex,
      publicNonce: serializePublicNonce(publicNonce),
    }

    // Send to all participants except self
    const promises = Array.from(participants.entries())
      .filter(([idx, peerId]) => idx !== signerIndex && peerId !== this.peerId)
      .map(([, peerId]) =>
        this._sendMessageToPeer(peerId, MuSig2MessageType.NONCE_SHARE, payload),
      )

    await Promise.all(promises)
  }

  /**
   * Broadcast partial signature share to all participants
   */
  private async _broadcastPartialSigShare(
    sessionId: string,
    signerIndex: number,
    partialSig: BN,
    participants: Map<number, string>,
  ): Promise<void> {
    const payload: PartialSigSharePayload = {
      sessionId,
      signerIndex,
      partialSig: serializeBN(partialSig),
    }

    // Send to all participants except self
    const promises = Array.from(participants.entries())
      .filter(([idx, peerId]) => idx !== signerIndex && peerId !== this.peerId)
      .map(([, peerId]) =>
        this._sendMessageToPeer(
          peerId,
          MuSig2MessageType.PARTIAL_SIG_SHARE,
          payload,
        ),
      )

    await Promise.all(promises)
  }

  /**
   * Broadcast session abort
   */
  private async _broadcastSessionAbort(
    sessionId: string,
    reason: string,
    participants: Map<number, string>,
  ): Promise<void> {
    const payload = {
      sessionId,
      reason,
    }

    const promises = Array.from(participants.values())
      .filter(peerId => peerId !== this.peerId)
      .map(peerId =>
        this._sendMessageToPeer(
          peerId,
          MuSig2MessageType.SESSION_ABORT,
          payload,
        ),
      )

    await Promise.all(promises)
  }

  /**
   * Send message to specific peer
   */
  async _sendMessageToPeer(
    peerId: string,
    messageType: MuSig2MessageType,
    payload: unknown,
  ): Promise<void> {
    const message = this.messageProtocol.createMessage(
      messageType,
      payload,
      this.peerId,
      {
        protocol: 'musig2',
      },
    )

    await this.sendTo(peerId, message)
  }

  /**
   * Cleanup: close all sessions
   */
  async cleanup(): Promise<void> {
    const sessionIds = Array.from(this.activeSessions.keys())
    await Promise.all(sessionIds.map(id => this.closeSession(id)))
  }

  /**
   * Notify that transaction has been broadcast (cancel failover timeout)
   *
   * Call this after successfully broadcasting the transaction to prevent
   * backup coordinators from attempting broadcast.
   *
   * @param sessionId - Session ID
   */
  notifyBroadcastComplete(sessionId: string): void {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession?.failover) {
      return
    }

    // Clear the timeout
    if (activeSession.failover.broadcastTimeoutId) {
      clearTimeout(activeSession.failover.broadcastTimeoutId)
      activeSession.failover.broadcastTimeoutId = undefined
    }

    this.emit('session:broadcast-confirmed', sessionId)
  }

  // ============================================================================
  // Coordinator Failover Methods
  // ============================================================================

  /**
   * Initialize coordinator failover mechanism
   *
   * After all partial signatures are collected, start a timeout for the
   * coordinator to broadcast. If timeout expires, next coordinator takes over.
   *
   * @param sessionId - Session ID
   */
  private async _initializeCoordinatorFailover(
    sessionId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession?.election) {
      return
    }

    const { session, election } = activeSession
    const electionMethod = this._getElectionMethod()

    // Initialize failover tracking
    activeSession.failover = {
      currentCoordinatorIndex: election.coordinatorIndex,
      broadcastDeadline: Date.now() + this.musig2Config.broadcastTimeout,
      failoverAttempts: 0,
    }

    // Check if I'm the current coordinator
    const isCurrentCoordinator =
      activeSession.failover.currentCoordinatorIndex === session.myIndex

    if (isCurrentCoordinator) {
      // I'm the coordinator - emit event to signal I should broadcast
      this.emit(
        'session:should-broadcast',
        sessionId,
        election.coordinatorIndex,
      )

      // Set timeout in case I fail to broadcast
      const timeoutId = setTimeout(() => {
        this._handleCoordinatorTimeout(sessionId)
      }, this.musig2Config.broadcastTimeout)

      activeSession.failover.broadcastTimeoutId = timeoutId
    } else {
      // I'm not the coordinator - check if I'm a backup
      const backup = getBackupCoordinator(
        session.signers,
        activeSession.failover.currentCoordinatorIndex,
        electionMethod,
      )

      if (backup === session.myIndex) {
        // I'm the next backup - set timeout to take over if coordinator fails
        const timeoutId = setTimeout(() => {
          this._handleCoordinatorTimeout(sessionId)
        }, this.musig2Config.broadcastTimeout)

        activeSession.failover.broadcastTimeoutId = timeoutId
      }
    }
  }

  /**
   * Handle coordinator timeout (failover triggered)
   *
   * Called when coordinator fails to broadcast within timeout period.
   * Next backup coordinator takes over.
   *
   * @param sessionId - Session ID
   */
  private async _handleCoordinatorTimeout(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession?.failover || !activeSession.election) {
      return
    }

    const { session, failover } = activeSession
    const electionMethod = this._getElectionMethod()

    // Get next backup coordinator
    const nextCoordinator = getBackupCoordinator(
      session.signers,
      failover.currentCoordinatorIndex,
      electionMethod,
    )

    if (nextCoordinator === null) {
      // No more backups available
      this.emit(
        'session:failover-exhausted',
        sessionId,
        failover.failoverAttempts,
      )
      return
    }

    // Update current coordinator
    failover.currentCoordinatorIndex = nextCoordinator
    failover.failoverAttempts++
    failover.broadcastDeadline = Date.now() + this.musig2Config.broadcastTimeout

    this.emit(
      'session:coordinator-failed',
      sessionId,
      failover.failoverAttempts,
    )

    // Check if I'm the new coordinator
    if (nextCoordinator === session.myIndex) {
      // I'm now the coordinator - emit event to signal I should broadcast
      this.emit('session:should-broadcast', sessionId, nextCoordinator)

      // Set new timeout in case I also fail
      const timeoutId = setTimeout(() => {
        this._handleCoordinatorTimeout(sessionId)
      }, this.musig2Config.broadcastTimeout)

      failover.broadcastTimeoutId = timeoutId
    } else {
      // Check if I'm the next backup after the new coordinator
      const nextBackup = getBackupCoordinator(
        session.signers,
        nextCoordinator,
        electionMethod,
      )

      if (nextBackup === session.myIndex) {
        // I'm the next backup - set timeout
        const timeoutId = setTimeout(() => {
          this._handleCoordinatorTimeout(sessionId)
        }, this.musig2Config.broadcastTimeout)

        failover.broadcastTimeoutId = timeoutId
      }
    }
  }

  // ============================================================================
  // Coordinator Election Methods
  // ============================================================================

  /**
   * Check if this peer is the elected coordinator for a session
   *
   * Note: With failover enabled, this checks if you're the ORIGINAL elected
   * coordinator. Use `isCurrentCoordinator()` to check if you're the
   * coordinator after potential failovers.
   *
   * @param sessionId - Session ID
   * @returns True if this peer is the originally elected coordinator
   */
  isCoordinator(sessionId: string): boolean {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession || !activeSession.election) {
      return false
    }

    return (
      activeSession.election.coordinatorIndex === activeSession.session.myIndex
    )
  }

  /**
   * Check if this peer is the CURRENT coordinator (accounting for failover)
   *
   * @param sessionId - Session ID
   * @returns True if this peer is the current coordinator
   */
  isCurrentCoordinator(sessionId: string): boolean {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return false
    }

    // If failover is active, check failover coordinator
    if (activeSession.failover) {
      return (
        activeSession.failover.currentCoordinatorIndex ===
        activeSession.session.myIndex
      )
    }

    // If no failover, fall back to original election
    if (activeSession.election) {
      return (
        activeSession.election.coordinatorIndex ===
        activeSession.session.myIndex
      )
    }

    return false
  }

  /**
   * Get the coordinator peer ID for a session
   *
   * @param sessionId - Session ID
   * @returns Coordinator peer ID or null if not known
   */
  getCoordinatorPeerId(sessionId: string): string | null {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession || !activeSession.election) {
      return null
    }

    // If we're the coordinator, return our peer ID
    if (this.isCoordinator(sessionId)) {
      return this.peerId
    }

    // Otherwise, try to find the coordinator's peer ID from participants
    const coordinatorPeerId = activeSession.participants.get(
      activeSession.election.coordinatorIndex,
    )
    return coordinatorPeerId || null
  }

  /**
   * Get election info for a session
   *
   * @param sessionId - Session ID
   * @returns Election info or null if not available
   */
  getElectionInfo(sessionId: string): {
    coordinatorIndex: number
    electionProof: string
    isCoordinator: boolean
  } | null {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession || !activeSession.election) {
      return null
    }

    return {
      coordinatorIndex: activeSession.election.coordinatorIndex,
      electionProof: activeSession.election.electionProof,
      isCoordinator: this.isCoordinator(sessionId),
    }
  }

  /**
   * Convert election method string to enum
   */
  private _getElectionMethod(): ElectionMethod {
    switch (this.musig2Config.electionMethod) {
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
}
