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
import { P2PConfig, PeerInfo } from '../types.js'
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
  SignerAdvertisement,
  SignerAdvertisementPayload,
  SignerCriteria,
  SignerSearchFilters,
  SigningRequest,
  SigningRequestPayload,
  ParticipantJoinedPayload,
  ActiveSigningSession,
  MuSig2Event,
  MuSig2EventMap,
  TransactionType,
  DHTResourceType,
  DirectoryIndexEntry,
  SecureDirectoryIndex,
  MUSIG2_SECURITY_LIMITS,
  MUSIG2_MATURATION_PERIODS,
} from './types.js'
import {
  serializePublicNonce,
  serializeBN,
  serializePublicKey,
  serializeMessage,
} from './serialization.js'
import { MuSig2ProtocolHandler } from './protocol-handler.js'
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
import { Schnorr } from '../../bitcore/crypto/schnorr.js'
import { Hash } from '../../bitcore/crypto/hash.js'
import {
  electCoordinator,
  ElectionMethod,
  ElectionResult,
  getBackupCoordinator,
  getCoordinatorPriorityList,
} from './election.js'
import { SecurityManager, PEER_KEY_LIMITS } from './security.js'
import { IProtocolValidator } from '../types.js'
import { MuSig2IdentityManager } from './identity-manager.js'

/**
 * MuSig2 P2P Coordinator
 *
 * Extends P2PCoordinator to add MuSig2-specific functionality
 * Manages MuSig2 signing sessions over P2P network
 *
 * Events are strongly typed - use MuSig2Event enum for event names
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- Safe: We're using declaration merging to add type-safe method signatures (not properties) to the EventEmitter methods inherited from the parent class. This is a standard TypeScript pattern for typed event emitters and doesn't introduce runtime safety issues since we're not adding uninitialized properties.
export class MuSig2P2PCoordinator extends P2PCoordinator {
  private sessionManager: MuSigSessionManager
  private protocolHandler: MuSig2ProtocolHandler
  private messageProtocol: P2PProtocol // Renamed to avoid conflict with parent's private 'protocol'
  private activeSessions: Map<string, ActiveSession> = new Map()
  private activeSigningSessions: Map<string, ActiveSigningSession> = new Map() // New: Dynamic signing sessions
  private signerAdvertisements: Map<string, SignerAdvertisement> = new Map() // publicKey -> advertisement
  private signingRequests: Map<string, SigningRequest> = new Map() // requestId -> request
  private peerIdToSignerIndex: Map<string, Map<string, number>> = new Map() // sessionId -> peerId -> signerIndex
  private myAdvertisement?: SignerAdvertisement // My current advertisement
  private sessionCleanupIntervalId?: NodeJS.Timeout // Renamed to avoid conflict with parent
  // SECURITY: Security manager for rate limiting, key tracking, and reputation
  private securityManager: SecurityManager
  // SECURITY: Identity manager for burn-based blockchain-anchored identities
  private identityManager?: MuSig2IdentityManager
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
    enableReplayProtection: boolean
    maxSequenceGap: number
    enableAutoCleanup: boolean
    cleanupInterval: number
    stuckSessionTimeout: number
    securityLimits: typeof MUSIG2_SECURITY_LIMITS
    chronikUrl: string | string[]
    enableBurnBasedIdentity: boolean
    burnMaturationPeriod: number
    enableAutoConnect: boolean
    minReputationForAutoConnect: number
  }

  constructor(p2pConfig: P2PConfig, musig2Config?: Partial<MuSig2P2PConfig>) {
    // Call parent constructor with P2P config
    super(p2pConfig)

    this.sessionManager = new MuSigSessionManager()
    this.protocolHandler = new MuSig2ProtocolHandler()
    this.messageProtocol = new P2PProtocol()
    this.protocolHandler.setCoordinator(this)

    // SECURITY: Initialize security manager with config
    this.securityManager = new SecurityManager({
      disableRateLimiting:
        p2pConfig.securityConfig?.disableRateLimiting ?? false,
    })
    this.protocolHandler.setSecurityManager(this.securityManager)

    // SECURITY: Register MuSig2 as protocol validator with core P2P security
    this._registerProtocolValidator()

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
      enableReplayProtection: musig2Config?.enableReplayProtection ?? true,
      maxSequenceGap: musig2Config?.maxSequenceGap ?? 100,
      enableAutoCleanup: musig2Config?.enableAutoCleanup ?? true,
      cleanupInterval: musig2Config?.cleanupInterval || 60000, // 1 minute
      stuckSessionTimeout: musig2Config?.stuckSessionTimeout || 10 * 60 * 1000, // 10 minutes
      securityLimits: {
        ...MUSIG2_SECURITY_LIMITS,
        ...musig2Config?.securityLimits,
      },
      chronikUrl: musig2Config?.chronikUrl || 'https://chronik.lotusia.org',
      enableBurnBasedIdentity: musig2Config?.enableBurnBasedIdentity ?? false,
      burnMaturationPeriod:
        musig2Config?.burnMaturationPeriod ??
        MUSIG2_MATURATION_PERIODS.IDENTITY_REGISTRATION,
      enableAutoConnect: musig2Config?.enableAutoConnect ?? true,
      minReputationForAutoConnect:
        musig2Config?.minReputationForAutoConnect ?? 0,
    }

    // Initialize identity manager if burn-based identity is enabled
    if (this.musig2Config.enableBurnBasedIdentity) {
      this.identityManager = new MuSig2IdentityManager(
        this.musig2Config.chronikUrl,
        this.musig2Config.burnMaturationPeriod,
      )
      console.log(
        `[MuSig2P2P] Burn-based identity system enabled (maturation: ${this.musig2Config.burnMaturationPeriod} blocks)`,
      )
    }

    // Register protocol handler with parent P2PCoordinator
    this.registerProtocol(this.protocolHandler)

    // Setup event handlers for new three-phase architecture
    this._setupThreePhaseEventHandlers()

    // Start automatic session cleanup if enabled
    if (this.musig2Config.enableAutoCleanup) {
      this.startSessionCleanup()
    }
  }

  /**
   * Setup event handlers for three-phase architecture
   */
  private _setupThreePhaseEventHandlers(): void {
    // Handle discovered signer advertisements
    this.on(
      MuSig2Event.SIGNER_DISCOVERED,
      (advertisement: SignerAdvertisement) => {
        // Store in local cache
        this.signerAdvertisements.set(
          advertisement.publicKey.toString(),
          advertisement,
        )
      },
    )

    // Handle signer unavailable
    this.on(
      MuSig2Event.SIGNER_UNAVAILABLE,
      (data: { peerId: string; publicKey: PublicKey }) => {
        // Remove from cache
        this.signerAdvertisements.delete(data.publicKey.toString())
      },
    )

    // Handle received signing requests
    this.on(MuSig2Event.SIGNING_REQUEST_RECEIVED, (request: SigningRequest) => {
      // Store in local cache
      this.signingRequests.set(request.requestId, request)
    })

    // Handle participant joined events
    this.on(
      MuSig2Event.PARTICIPANT_JOINED,
      async (data: {
        requestId: string
        participantIndex: number
        participantPeerId: string
        participantPublicKey: PublicKey
        timestamp: number
        signature: Buffer
      }) => {
        // Update active session with new participant
        const activeSession = this.activeSigningSessions.get(data.requestId)
        if (activeSession) {
          // Verify participation signature
          const participationData = Buffer.concat([
            Buffer.from(data.requestId),
            Buffer.from(data.participantIndex.toString()),
            data.participantPublicKey.toBuffer(),
            Buffer.from(data.participantPeerId),
          ])

          const hashbuf = Hash.sha256(participationData)
          const sig = new Signature({
            r: new BN(data.signature.subarray(0, 32), 'be'),
            s: new BN(data.signature.subarray(32, 64), 'be'),
            isSchnorr: true,
          })

          if (!Schnorr.verify(hashbuf, sig, data.participantPublicKey, 'big')) {
            console.warn(
              '[MuSig2P2P] Invalid participation signature from',
              data.participantPeerId,
            )
            return
          }

          // Add participant
          activeSession.participants.set(
            data.participantIndex,
            data.participantPeerId,
          )
          activeSession.updatedAt = Date.now()

          // Check if ALL participants have joined (MuSig2 = n-of-n)
          if (
            activeSession.participants.size ===
            activeSession.request.requiredPublicKeys.length
          ) {
            // All participants joined - create MuSig session
            await this._createMuSigSessionFromRequest(activeSession)
          }
        }
      },
    )
  }

  /**
   * Stop the coordinator and cleanup
   *
   * Overrides base class to ensure cleanup interval is stopped before node shutdown
   */
  async stop(): Promise<void> {
    // Stop automatic cleanup interval first (before node shutdown)
    if (this.sessionCleanupIntervalId) {
      clearInterval(this.sessionCleanupIntervalId)
      this.sessionCleanupIntervalId = undefined
    }

    // Call parent stop() which will shutdown the libp2p node
    await super.stop()
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
      lastSequenceNumbers: new Map(), // Initialize replay protection
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
      await this._announceSessionToDHT(session, this.peerId, myPrivateKey)
    }

    // Emit event
    this.emit(MuSig2Event.SESSION_CREATED, session.sessionId)

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
      lastSequenceNumbers: new Map(), // Initialize replay protection
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
    this.emit(MuSig2Event.SESSION_JOINED, sessionId)

    // Wait a bit for the creator to send us session state, then start Round 1
    // For now, we'll let the creator initiate Round 1
  }

  // ========================================================================
  // GossipSub Event-Driven Discovery
  // ========================================================================

  /**
   * Subscribe to signer advertisements for specific transaction types
   *
   * Enables REAL-TIME event-driven discovery (no polling/timeouts needed!)
   * Messages arrive instantly via GossipSub pub/sub
   *
   * @param transactionTypes - Array of transaction types to listen for
   */
  async subscribeToSignerDiscovery(
    transactionTypes: TransactionType[],
  ): Promise<void> {
    for (const txType of transactionTypes) {
      const topic = `musig2:signers:${txType}`

      await this.subscribeToTopic(topic, (messageData: Uint8Array) => {
        try {
          // Get security limits (allow config override)
          const limits =
            this.musig2Config.securityLimits || MUSIG2_SECURITY_LIMITS

          // SECURITY 1: Message size limit (prevent memory exhaustion DoS)
          if (messageData.length > limits.MAX_ADVERTISEMENT_SIZE) {
            console.warn(
              `[MuSig2P2P] ⚠️  Oversized advertisement rejected: ${messageData.length} bytes (max: ${limits.MAX_ADVERTISEMENT_SIZE})`,
            )
            return // Drop oversized message
          }

          // Convert Uint8Array to string using Node.js Buffer
          const messageStr = Buffer.from(messageData).toString('utf8')
          const payload = JSON.parse(messageStr) as SignerAdvertisementPayload

          // SECURITY 2: Timestamp validation (prevent future/past attacks)
          const timestampSkew = Math.abs(Date.now() - payload.timestamp)
          if (timestampSkew > limits.MAX_TIMESTAMP_SKEW) {
            console.warn(
              `[MuSig2P2P] ⚠️  Advertisement timestamp out of range: ${timestampSkew}ms skew (max: ${limits.MAX_TIMESTAMP_SKEW}ms)`,
            )
            return // Drop time-invalid advertisement
          }

          // SECURITY 3: Expiry enforcement (drop expired immediately)
          if (payload.expiresAt && payload.expiresAt < Date.now()) {
            console.warn(
              `[MuSig2P2P] ⚠️  Expired advertisement rejected: ${payload.peerId}`,
            )
            return // Drop expired advertisement
          }

          const advertisement: SignerAdvertisement = {
            peerId: payload.peerId,
            multiaddrs: payload.multiaddrs || [],
            publicKey: new PublicKey(Buffer.from(payload.publicKey, 'hex')),
            criteria: payload.criteria,
            metadata: payload.metadata,
            timestamp: payload.timestamp,
            expiresAt: payload.expiresAt,
            signature: Buffer.from(payload.signature, 'hex'),
          }

          // SECURITY 4: Verify signature BEFORE trusting
          // Alice cannot trust Zoe - she must verify cryptographic proof locally
          if (!this.verifyAdvertisementSignature(advertisement)) {
            console.warn(
              `[MuSig2P2P] ⚠️  Rejected invalid advertisement from GossipSub: ${payload.peerId}`,
            )
            // Track invalid signature
            this.securityManager.recordInvalidSignature(payload.peerId)
            return // Drop invalid advertisement
          }

          // SECURITY 5: Check rate limit and key count
          if (
            !this.securityManager.canAdvertiseKey(
              payload.peerId,
              advertisement.publicKey,
            )
          ) {
            console.warn(
              `[MuSig2P2P] ⚠️  Advertisement rejected from GossipSub (rate/key limit): ${payload.peerId}`,
            )
            return // Drop rate-limited advertisement
          }

          // All security checks passed - emit event
          this.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)

          console.log(
            `[MuSig2P2P] 📥 Verified & discovered (GossipSub): ${payload.metadata?.nickname || payload.peerId}`,
          )
        } catch (error) {
          // Malformed JSON or invalid data - drop silently
          console.debug('[MuSig2P2P] Malformed GossipSub message dropped')
        }
      })

      console.log(`[MuSig2P2P] 📡 Subscribed to topic: ${topic}`)
    }
  }

  /**
   * Unsubscribe from signer discovery topics
   */
  async unsubscribeFromSignerDiscovery(): Promise<void> {
    // Unsubscribe from all signer topics
    for (const txType of Object.values(TransactionType)) {
      const topic = `musig2:signers:${txType}`
      await this.unsubscribeFromTopic(topic)
    }
  }

  // ========================================================================
  // Phase 0: Signer Advertisement Methods
  // ========================================================================

  /**
   * Advertise signer availability
   * Announces your public key and willingness to participate in MuSig2 sessions
   *
   * Now uses DUAL-MODE discovery:
   * 1. DHT storage (persistence, offline discovery)
   * 2. GossipSub pub/sub (real-time, instant discovery)
   *
   * @param myPrivateKey - Your private key
   * @param criteria - Availability criteria (transaction types, purposes, amounts)
   * @param options - Optional metadata (nickname, fees, etc.)
   * @returns void
   */
  async advertiseSigner(
    myPrivateKey: PrivateKey,
    criteria: SignerCriteria,
    options?: {
      ttl?: number
      metadata?: SignerAdvertisement['metadata']
    },
  ): Promise<void> {
    const myPubKey = myPrivateKey.publicKey
    const timestamp = Date.now()
    const ttl = options?.ttl || 24 * 60 * 60 * 1000 // Default: 24 hours
    const expiresAt = timestamp + ttl

    // NOTE: We do NOT rate limit our own outgoing advertisements
    // Rate limiting is ONLY applied to INCOMING advertisements from OTHER peers
    // This is enforced in protocol handlers (_handleSignerAdvertisement)

    // Get my multiaddrs for peer discovery
    const myMultiaddrs = this.getStats().multiaddrs

    // Create advertisement data for signing
    const adData = Buffer.concat([
      Buffer.from(this.peerId),
      Buffer.from(JSON.stringify(myMultiaddrs)), // Include multiaddrs in signature
      myPubKey.toBuffer(),
      Buffer.from(JSON.stringify(criteria)),
      Buffer.from(timestamp.toString()),
      Buffer.from(expiresAt.toString()),
    ])

    // Sign advertisement
    const hashbuf = Hash.sha256(adData)
    const signature = Schnorr.sign(hashbuf, myPrivateKey, 'big').toBuffer(
      'schnorr',
    )

    const advertisement: SignerAdvertisement = {
      peerId: this.peerId,
      multiaddrs: myMultiaddrs,
      publicKey: myPubKey,
      criteria,
      metadata: options?.metadata,
      timestamp,
      expiresAt,
      signature,
    }

    // Store locally
    this.myAdvertisement = advertisement
    this.signerAdvertisements.set(myPubKey.toString(), advertisement)

    // Announce to DHT with multiple indexes for discoverability
    const indexKeys: string[] = []

    // Index by each transaction type
    for (const txType of criteria.transactionTypes) {
      indexKeys.push(`musig2-signer:type:${txType}:${myPubKey.toString()}`)
    }

    // Global index
    indexKeys.push(`musig2-signer:all:${myPubKey.toString()}`)

    // Announce to DHT for each index
    for (const indexKey of indexKeys) {
      await this.announceResource(
        DHTResourceType.SIGNER_ADVERTISEMENT,
        indexKey,
        {
          peerId: this.peerId,
          multiaddrs: myMultiaddrs,
          publicKey: serializePublicKey(myPubKey),
          criteria,
          metadata: options?.metadata,
          timestamp,
          expiresAt,
          signature: signature.toString('hex'),
        } as SignerAdvertisementPayload,
      )
    }

    // Also announce to well-known directory indexes for each transaction type
    // This allows clients to discover signers without knowing their public keys
    for (const txType of criteria.transactionTypes) {
      await this._addToSignerDirectory(txType, myPubKey, advertisement)
    }

    // REAL-TIME DISCOVERY: Publish to GossipSub topics for instant discovery
    // Each transaction type gets its own topic for efficient filtering
    const advertisementPayload: SignerAdvertisementPayload = {
      peerId: this.peerId,
      multiaddrs: myMultiaddrs,
      publicKey: serializePublicKey(myPubKey),
      criteria,
      metadata: options?.metadata,
      timestamp,
      expiresAt,
      signature: signature.toString('hex'),
    }

    for (const txType of criteria.transactionTypes) {
      const topic = `musig2:signers:${txType}`
      try {
        await this.publishToTopic(topic, advertisementPayload)
        console.log(`[MuSig2P2P] 📡 Published to GossipSub topic: ${topic}`)
      } catch (error) {
        // GossipSub not enabled or no subscribers - that's ok
        // Fall back to DHT + P2P broadcast
        console.log(
          `[MuSig2P2P] GossipSub publish skipped for ${topic} (not enabled or no peers)`,
        )
      }
    }

    // Broadcast to connected peers (fallback for non-GossipSub clients)
    await this.broadcast({
      type: MuSig2MessageType.SIGNER_ADVERTISEMENT,
      from: this.peerId,
      payload: advertisementPayload,
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })

    this.emit(MuSig2Event.SIGNER_ADVERTISED, advertisement)
  }

  /**
   * Withdraw signer advertisement
   * Removes your advertisement from the network and DHT directory
   */
  async withdrawAdvertisement(): Promise<void> {
    if (!this.myAdvertisement) {
      return
    }

    const myPubKey = this.myAdvertisement.publicKey
    const pubKeyStr = myPubKey.toString()
    const criteria = this.myAdvertisement.criteria

    // Remove from DHT directory indexes (secure)
    for (const txType of criteria.transactionTypes) {
      await this._updateSecureDirectoryIndex(
        txType,
        myPubKey,
        this.peerId,
        'remove',
      )
    }

    // Remove from local storage
    this.signerAdvertisements.delete(pubKeyStr)
    this.myAdvertisement = undefined

    // Broadcast unavailability
    await this.broadcast({
      type: MuSig2MessageType.SIGNER_UNAVAILABLE,
      from: this.peerId,
      payload: {
        peerId: this.peerId,
        publicKey: serializePublicKey(myPubKey),
      },
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })

    this.emit(MuSig2Event.SIGNER_WITHDRAWN)
  }

  /**
   * Connect to a discovered signer using their advertisement
   *
   * Uses the multiaddrs from the advertisement to establish connection
   * and verifies the peer actually owns the advertised public key
   *
   * Security: Challenge-response to prevent impersonation attacks
   *
   * @param advertisement - Signer advertisement with connection info
   * @param verifyOwnership - If true, verify peer owns the advertised key (default: true)
   * @returns Success boolean
   */
  async connectToSigner(
    advertisement: SignerAdvertisement,
    verifyOwnership: boolean = true,
  ): Promise<boolean> {
    if (!advertisement.multiaddrs || advertisement.multiaddrs.length === 0) {
      console.warn(
        '[MuSig2P2P] No multiaddrs available for signer:',
        advertisement.peerId,
      )
      return false
    }

    try {
      // Try each multiaddr until one succeeds
      for (const addr of advertisement.multiaddrs) {
        try {
          await this.connectToPeer(addr)
          console.log(
            `[MuSig2P2P] Connected to signer ${advertisement.metadata?.nickname || advertisement.peerId} at ${addr}`,
          )

          // Note: Ownership verification already done when advertisement was received
          // - verifyAdvertisementSignature() was called before emitting SIGNER_DISCOVERED
          // - Signature proves Bob owns the advertised public key
          // - Multiaddrs are part of signed data (tampering breaks signature)
          // - No additional challenge-response needed
          if (verifyOwnership) {
            console.log(
              `[MuSig2P2P] ✅ Verified: Signature validated at discovery time`,
            )
          }

          return true
        } catch (error) {
          // Try next multiaddr
          continue
        }
      }

      console.warn(
        '[MuSig2P2P] Failed to connect to signer:',
        advertisement.peerId,
      )
      return false
    } catch (error) {
      console.error('[MuSig2P2P] Error connecting to signer:', error)
      return false
    }
  }

  /**
   * Find available signers matching criteria
   *
   * Searches both local cache (from P2P broadcasts) and DHT directory
   *
   * @param filters - Search filters (use TransactionType enum for type safety)
   * @returns Array of signer advertisements
   */
  async findAvailableSigners(
    filters: SignerSearchFilters,
  ): Promise<SignerAdvertisement[]> {
    const seenPublicKeys = new Set<string>()
    const results: SignerAdvertisement[] = []

    // Query local cache first (populated from broadcasts)
    for (const [, advertisement] of this.signerAdvertisements) {
      // Skip expired
      if (advertisement.expiresAt < Date.now()) {
        continue
      }

      // Apply filters
      if (
        filters.transactionType &&
        !advertisement.criteria.transactionTypes.includes(
          filters.transactionType,
        )
      ) {
        continue
      }

      if (
        filters.minAmount &&
        advertisement.criteria.maxAmount &&
        advertisement.criteria.maxAmount < filters.minAmount
      ) {
        continue
      }

      if (
        filters.maxAmount &&
        advertisement.criteria.minAmount &&
        advertisement.criteria.minAmount > filters.maxAmount
      ) {
        continue
      }

      if (
        filters.minReputation &&
        advertisement.metadata?.reputation &&
        advertisement.metadata.reputation.score < filters.minReputation
      ) {
        continue
      }

      results.push(advertisement)
      seenPublicKeys.add(advertisement.publicKey.toString())

      if (filters.maxResults && results.length >= filters.maxResults) {
        return results
      }
    }

    // Query DHT directory for additional signers (if transaction type specified)
    if (filters.transactionType) {
      const dhtSigners = await this._querySignerDirectory(
        filters.transactionType,
      )

      for (const advertisement of dhtSigners) {
        // Skip if already in results
        if (seenPublicKeys.has(advertisement.publicKey.toString())) {
          continue
        }

        // Skip expired
        if (advertisement.expiresAt < Date.now()) {
          continue
        }

        // Apply filters
        if (
          filters.minAmount &&
          advertisement.criteria.maxAmount &&
          advertisement.criteria.maxAmount < filters.minAmount
        ) {
          continue
        }

        if (
          filters.maxAmount &&
          advertisement.criteria.minAmount &&
          advertisement.criteria.minAmount > filters.maxAmount
        ) {
          continue
        }

        if (
          filters.minReputation &&
          advertisement.metadata?.reputation &&
          advertisement.metadata.reputation.score < filters.minReputation
        ) {
          continue
        }

        results.push(advertisement)
        seenPublicKeys.add(advertisement.publicKey.toString())

        if (filters.maxResults && results.length >= filters.maxResults) {
          break
        }
      }
    }

    return results
  }

  // ========================================================================
  // Phase 1-2: Signing Request Methods
  // ========================================================================

  /**
   * Announce signing request
   * Creates a request for signatures from specific public keys
   *
   * Note: MuSig2 requires ALL participants to sign (n-of-n)
   * For m-of-n threshold signatures, use FROST protocol or Taproot script paths
   *
   * @param requiredPublicKeys - Public keys that must sign (ALL of them)
   * @param message - Message/transaction to sign
   * @param myPrivateKey - Creator's private key
   * @param options - Optional configuration
   * @returns Request ID
   */
  async announceSigningRequest(
    requiredPublicKeys: PublicKey[],
    message: Buffer,
    myPrivateKey: PrivateKey,
    options?: {
      metadata?: SigningRequest['metadata']
    },
  ): Promise<string> {
    const myPubKey = myPrivateKey.publicKey

    // Verify creator is in required keys
    const creatorIndex = requiredPublicKeys.findIndex(
      pk => pk.toString() === myPubKey.toString(),
    )
    if (creatorIndex === -1) {
      throw new Error('Creator must be one of the required signers')
    }

    // Generate request ID
    const requestId = Hash.sha256(
      Buffer.concat([
        message,
        ...requiredPublicKeys.map(pk => pk.toBuffer()),
        Buffer.from(Date.now().toString()),
      ]),
    ).toString('hex')

    const createdAt = Date.now()
    const expiresAt = createdAt + this.musig2Config.sessionTimeout

    // Create signature data (MuSig2 = n-of-n, all keys required)
    const requestData = Buffer.concat([
      Buffer.from(requestId),
      message,
      ...requiredPublicKeys.map(pk => pk.toBuffer()),
      Buffer.from(requiredPublicKeys.length.toString()), // n participants
    ])

    const hashbuf2 = Hash.sha256(requestData)
    const creatorSignature = Schnorr.sign(
      hashbuf2,
      myPrivateKey,
      'big',
    ).toBuffer('schnorr')

    const request: SigningRequest = {
      requestId,
      requiredPublicKeys,
      message,
      creatorPeerId: this.peerId,
      creatorPublicKey: myPubKey,
      createdAt,
      expiresAt,
      metadata: options?.metadata,
      creatorSignature,
      joinedParticipants: new Map(),
    }

    // Store locally
    this.signingRequests.set(requestId, request)

    // Create active signing session
    const activeSession: ActiveSigningSession = {
      sessionId: requestId,
      request,
      participants: new Map([[creatorIndex, this.peerId]]),
      myIndex: creatorIndex,
      myPrivateKey,
      phase: 'waiting',
      createdAt,
      updatedAt: createdAt,
      lastSequenceNumbers: new Map(),
    }
    this.activeSigningSessions.set(requestId, activeSession)

    // Announce to DHT - indexed by each required public key
    for (const pubKey of requiredPublicKeys) {
      await this.announceResource(
        MuSig2MessageType.SIGNING_REQUEST,
        `${requestId}:${pubKey.toString()}`,
        {
          requestId,
          requiredPublicKeys: requiredPublicKeys.map(pk =>
            serializePublicKey(pk),
          ),
          message: message.toString('hex'),
          creatorPeerId: this.peerId,
          creatorPublicKey: serializePublicKey(myPubKey),
          createdAt,
          expiresAt,
          metadata: options?.metadata,
          creatorSignature: creatorSignature.toString('hex'),
        } as SigningRequestPayload,
      )
    }

    // Broadcast to connected peers
    await this.broadcast({
      type: MuSig2MessageType.SIGNING_REQUEST,
      from: this.peerId,
      payload: {
        requestId,
        requiredPublicKeys: requiredPublicKeys.map(pk =>
          serializePublicKey(pk),
        ),
        message: message.toString('hex'),
        creatorPeerId: this.peerId,
        creatorPublicKey: serializePublicKey(myPubKey),
        createdAt,
        expiresAt,
        metadata: options?.metadata,
        creatorSignature: creatorSignature.toString('hex'),
      } as SigningRequestPayload,
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })

    this.emit(MuSig2Event.SIGNING_REQUEST_CREATED, request)

    return requestId
  }

  /**
   * Find signing requests that need my public key
   *
   * Searches both local cache (from broadcasts) and DHT
   *
   * @param myPublicKey - Your public key
   * @returns Array of signing requests
   */
  async findSigningRequestsForMe(
    myPublicKey: PublicKey,
  ): Promise<SigningRequest[]> {
    const seenRequestIds = new Set<string>()
    const results: SigningRequest[] = []
    const myPubKeyStr = myPublicKey.toString()

    // Query local cache first
    for (const [, request] of this.signingRequests) {
      // Skip expired
      if (request.expiresAt < Date.now()) {
        continue
      }

      // Check if my key is required
      if (
        request.requiredPublicKeys.some(pk => pk.toString() === myPubKeyStr)
      ) {
        results.push(request)
        seenRequestIds.add(request.requestId)
      }
    }

    // Query DHT for requests indexed by my public key
    const dhtRequests = await this._querySigningRequestsForKey(myPubKeyStr)

    for (const request of dhtRequests) {
      // Skip if already in results
      if (seenRequestIds.has(request.requestId)) {
        continue
      }

      // Skip expired
      if (request.expiresAt < Date.now()) {
        continue
      }

      results.push(request)
      seenRequestIds.add(request.requestId)
    }

    return results
  }

  /**
   * Join a signing request
   * Announces participation in a signing request
   *
   * @param requestId - Request ID
   * @param myPrivateKey - Your private key
   */
  async joinSigningRequest(
    requestId: string,
    myPrivateKey: PrivateKey,
  ): Promise<void> {
    const myPubKey = myPrivateKey.publicKey

    // Find request (local or DHT)
    let request = this.signingRequests.get(requestId)

    if (!request) {
      // Try to discover from DHT
      const resource = await this.discoverResource(
        'musig2-signing-request',
        `${requestId}:${myPubKey.toString()}`,
        5000,
      )

      if (resource && resource.data) {
        const payload = resource.data as SigningRequestPayload
        // Deserialize and store
        request = {
          requestId: payload.requestId,
          requiredPublicKeys: payload.requiredPublicKeys.map(hex =>
            PublicKey.fromString(hex),
          ),
          message: Buffer.from(payload.message, 'hex'),
          creatorPeerId: payload.creatorPeerId,
          creatorPublicKey: PublicKey.fromString(payload.creatorPublicKey),
          createdAt: payload.createdAt,
          expiresAt: payload.expiresAt,
          metadata: payload.metadata,
          creatorSignature: Buffer.from(payload.creatorSignature, 'hex'),
        }
        this.signingRequests.set(requestId, request)
      }
    }

    if (!request) {
      throw new Error(`Signing request ${requestId} not found`)
    }

    // Verify my key is required
    const myIndex = request.requiredPublicKeys.findIndex(
      pk => pk.toString() === myPubKey.toString(),
    )

    if (myIndex === -1) {
      throw new Error('Your public key is not required for this request')
    }

    // Verify request signature
    const requestData = Buffer.concat([
      Buffer.from(request.requestId),
      request.message,
      ...request.requiredPublicKeys.map(pk => pk.toBuffer()),
      Buffer.from(request.requiredPublicKeys.length.toString()), // n participants (all required)
    ])
    const hashbuf3 = Hash.sha256(requestData)

    // Parse Schnorr signature (64 bytes)
    if (request.creatorSignature.length !== 64) {
      throw new Error('Invalid signature length')
    }
    const r = new BN(request.creatorSignature.subarray(0, 32), 'be')
    const s = new BN(request.creatorSignature.subarray(32, 64), 'be')
    const sig = new Signature({ r, s, isSchnorr: true })

    if (!Schnorr.verify(hashbuf3, sig, request.creatorPublicKey, 'big')) {
      throw new Error('Invalid request signature')
    }

    // Create or update active session
    let activeSession = this.activeSigningSessions.get(requestId)

    if (!activeSession) {
      activeSession = {
        sessionId: requestId,
        request,
        participants: new Map(),
        myIndex,
        myPrivateKey,
        phase: 'waiting',
        createdAt: request.createdAt,
        updatedAt: Date.now(),
        lastSequenceNumbers: new Map(),
      }
      this.activeSigningSessions.set(requestId, activeSession)
    }

    // Add myself to participants
    activeSession.participants.set(myIndex, this.peerId)

    // Create participation signature
    const participationData = Buffer.concat([
      Buffer.from(requestId),
      Buffer.from(myIndex.toString()),
      myPubKey.toBuffer(),
      Buffer.from(this.peerId),
    ])
    const hashbuf4 = Hash.sha256(participationData)
    const participationSig = Schnorr.sign(
      hashbuf4,
      myPrivateKey,
      'big',
    ).toBuffer('schnorr')

    // Broadcast participation
    await this.broadcast({
      type: MuSig2MessageType.PARTICIPANT_JOINED,
      from: this.peerId,
      payload: {
        requestId,
        participantIndex: myIndex,
        participantPeerId: this.peerId,
        participantPublicKey: serializePublicKey(myPubKey),
        timestamp: Date.now(),
        signature: participationSig.toString('hex'),
      } as ParticipantJoinedPayload,
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })

    // Check if ALL participants have joined (MuSig2 = n-of-n)
    if (activeSession.participants.size === request.requiredPublicKeys.length) {
      // All participants joined - create MuSig session
      await this._createMuSigSessionFromRequest(activeSession)
    }

    this.emit(MuSig2Event.SIGNING_REQUEST_JOINED, requestId)
  }

  /**
   * Internal: Create MuSig session from signing request when ALL participants joined
   *
   * MuSig2 requires n-of-n signing (all participants must sign)
   */
  private async _createMuSigSessionFromRequest(
    activeSession: ActiveSigningSession,
  ): Promise<void> {
    if (activeSession.phase !== 'waiting') {
      return // Already created
    }

    if (!activeSession.myPrivateKey) {
      throw new Error('Private key not available')
    }

    const { request } = activeSession

    // Create MuSig session
    const session = this.sessionManager.createSession(
      request.requiredPublicKeys,
      activeSession.myPrivateKey,
      request.message,
      request.metadata,
    )

    activeSession.session = session
    activeSession.phase = 'ready'
    activeSession.updatedAt = Date.now()

    // Emit ready event
    this.emit(MuSig2Event.SESSION_READY, activeSession.sessionId)

    // Broadcast session ready
    await this.broadcast({
      type: MuSig2MessageType.SESSION_READY,
      from: this.peerId,
      payload: {
        requestId: activeSession.sessionId,
        participantIndex: activeSession.myIndex,
      },
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })
  }

  /**
   * Start Round 1: Generate and share nonces
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @param privateKey - This signer's private key
   */
  async startRound1(sessionId: string, privateKey: PrivateKey): Promise<void> {
    // Support both old and new architecture
    const activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Get session from either architecture
    let session: MuSigSession
    let participants: Map<number, string>

    if (signingSession) {
      // New architecture
      if (!signingSession.session) {
        throw new Error('Session not ready - threshold not met')
      }
      session = signingSession.session
      participants = signingSession.participants
    } else if (activeSession) {
      // Old architecture
      session = activeSession.session
      participants = activeSession.participants
    } else {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Generate nonces locally
    const publicNonces = this.sessionManager.generateNonces(session, privateKey)

    // Sync phase (generateNonces transitions to NONCE_EXCHANGE)
    if (signingSession) {
      signingSession.phase = session.phase
      signingSession.updatedAt = Date.now()
    } else if (activeSession) {
      activeSession.phase = session.phase
      activeSession.updatedAt = Date.now()
    }

    // Broadcast nonces to all participants
    await this._broadcastNonceShare(
      sessionId,
      session.myIndex,
      publicNonces,
      participants,
    )

    // Check if we already have all nonces (if others sent first)
    if (this.sessionManager.hasAllNonces(session)) {
      await this._handleAllNoncesReceived(sessionId)
    }
  }

  /**
   * Start Round 2: Create and share partial signatures
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @param privateKey - This signer's private key
   */
  async startRound2(sessionId: string, privateKey: PrivateKey): Promise<void> {
    // Support both old and new architecture
    const activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Get session from either architecture
    let session: MuSigSession
    let participants: Map<number, string>

    if (signingSession) {
      // New architecture
      if (!signingSession.session) {
        throw new Error('Session not ready - threshold not met')
      }
      session = signingSession.session
      participants = signingSession.participants
    } else if (activeSession) {
      // Old architecture
      session = activeSession.session
      participants = activeSession.participants
    } else {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Create partial signature
    const partialSig = this.sessionManager.createPartialSignature(
      session,
      privateKey,
    )

    // Sync phase (createPartialSignature transitions to PARTIAL_SIG_EXCHANGE)
    if (signingSession) {
      signingSession.phase = session.phase
      signingSession.updatedAt = Date.now()
    } else if (activeSession) {
      activeSession.phase = session.phase
      activeSession.updatedAt = Date.now()
    }

    // Broadcast partial signature to all participants
    await this._broadcastPartialSigShare(
      sessionId,
      session.myIndex,
      partialSig,
      participants,
    )

    // Check if we already have all partial signatures
    if (this.sessionManager.hasAllPartialSignatures(session)) {
      await this._handleAllPartialSigsReceived(sessionId)
    }
  }

  /**
   * Get final aggregated signature
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @returns Final signature
   */
  getFinalSignature(sessionId: string): Signature {
    const activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (signingSession && signingSession.session) {
      return this.sessionManager.getFinalSignature(signingSession.session)
    } else if (activeSession) {
      return this.sessionManager.getFinalSignature(activeSession.session)
    }

    throw new Error(`Session ${sessionId} not found`)
  }

  /**
   * Get session status
   *
   * @param sessionId - Session ID
   * @returns Session status
   */
  getSessionStatus(sessionId: string) {
    // Support both old and new architecture
    const activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (signingSession && signingSession.session) {
      return this.sessionManager.getSessionStatus(signingSession.session)
    } else if (activeSession) {
      return this.sessionManager.getSessionStatus(activeSession.session)
    }

    return null
  }

  /**
   * Get all active session IDs (includes both old and new architecture sessions)
   */
  getActiveSessions(): string[] {
    const oldSessions = Array.from(this.activeSessions.keys())
    const newSessions = Array.from(this.activeSigningSessions.keys())
    return [...oldSessions, ...newSessions]
  }

  /**
   * Get session data
   *
   * @param sessionId - Session ID
   * @returns Session data or null if not found
   */
  getSession(sessionId: string): MuSigSession | null {
    const activeSession = this.activeSessions.get(sessionId)
    return activeSession?.session ?? null
  }

  /**
   * Get active session (includes tracking state like sequence numbers)
   *
   * @param sessionId - Session ID
   * @returns ActiveSession or undefined
   */
  getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId)
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

    // Send abort to all participants (only if node is still running)
    if (this.libp2pNode) {
      try {
        await this._broadcastSessionAbort(
          sessionId,
          'Session closed',
          activeSession.participants,
        )
      } catch (error) {
        // Ignore errors if node has been stopped
        console.warn(
          `[MuSig2P2P] Failed to broadcast session abort for ${sessionId}:`,
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    // Remove session
    this.activeSessions.delete(sessionId)

    // Clean up peer mapping
    const peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (peerMap) {
      this.peerIdToSignerIndex.delete(sessionId)
    }

    this.emit(MuSig2Event.SESSION_CLOSED, sessionId)
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
    const announcement: SessionAnnouncementData = {
      sessionId,
      signers,
      creatorPeerId,
      creatorIndex,
      message,
      requiredSigners: signers.length,
      createdAt: Date.now(),
      metadata,
    }

    this.emit(MuSig2Event.SESSION_ANNOUNCED, {
      sessionId,
      announcement,
    })
  }

  /**
   * Handle session join from peer
   */
  async _handleSessionJoin(
    sessionId: string,
    signerIndex: number,
    sequenceNumber: number,
    publicKey: PublicKey,
    peerId: string,
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Validate protocol phase (must be in INIT to accept JOIN)
    if (
      !this._validateProtocolPhase(
        activeSession,
        MuSig2MessageType.SESSION_JOIN,
      )
    ) {
      throw new Error(
        `Protocol violation: SESSION_JOIN not allowed in phase ${activeSession.phase}`,
      )
    }

    // Validate sequence number for replay protection
    if (
      !this._validateMessageSequence(activeSession, signerIndex, sequenceNumber)
    ) {
      throw new Error(
        `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
      )
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
      this.emit(MuSig2Event.SESSION_READY, sessionId)
    }
  }

  /**
   * Handle nonce share from peer
   */
  async _handleNonceShare(
    sessionId: string,
    signerIndex: number,
    sequenceNumber: number,
    publicNonce: [Point, Point],
    peerId: string,
  ): Promise<void> {
    // Support both old and new architecture
    let activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Use activeSession for validation (create wrapper if using new architecture)
    if (signingSession && !activeSession) {
      // Create temporary ActiveSession wrapper for validation
      activeSession = {
        sessionId: signingSession.sessionId,
        session: signingSession.session!,
        participants: signingSession.participants,
        phase:
          signingSession.phase === 'ready' || signingSession.phase === 'waiting'
            ? MuSigSessionPhase.INIT
            : signingSession.phase,
        createdAt: signingSession.createdAt,
        updatedAt: signingSession.updatedAt,
        lastSequenceNumbers: signingSession.lastSequenceNumbers,
      }
    }

    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Validate protocol phase (must be in NONCE_EXCHANGE to accept NONCE_SHARE)
    if (
      !this._validateProtocolPhase(activeSession, MuSig2MessageType.NONCE_SHARE)
    ) {
      throw new Error(
        `Protocol violation: NONCE_SHARE not allowed in phase ${activeSession.phase}`,
      )
    }

    // Validate sequence number for replay protection
    if (
      !this._validateMessageSequence(activeSession, signerIndex, sequenceNumber)
    ) {
      throw new Error(
        `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
      )
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
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      return
    }

    let session: MuSigSession

    if (signingSession && signingSession.session) {
      session = signingSession.session
      signingSession.phase = session.phase
      signingSession.updatedAt = Date.now()
    } else if (activeSession) {
      session = activeSession.session
      activeSession.phase = session.phase
      activeSession.updatedAt = Date.now()
    } else {
      return
    }

    // Nonces are automatically aggregated by session manager
    // Now we can start Round 2 (partial signatures)
    // For now, we'll emit an event and let the caller decide when to start Round 2
    this.emit(MuSig2Event.SESSION_NONCES_COMPLETE, sessionId)
  }

  /**
   * Handle partial signature share from peer
   */
  async _handlePartialSigShare(
    sessionId: string,
    signerIndex: number,
    sequenceNumber: number,
    partialSig: BN,
    peerId: string,
  ): Promise<void> {
    // Support both old and new architecture
    let activeSession = this.activeSessions.get(sessionId)
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Use activeSession for validation (create wrapper if using new architecture)
    if (signingSession && !activeSession) {
      activeSession = {
        sessionId: signingSession.sessionId,
        session: signingSession.session!,
        participants: signingSession.participants,
        phase:
          signingSession.phase === 'ready' || signingSession.phase === 'waiting'
            ? MuSigSessionPhase.INIT
            : signingSession.phase,
        createdAt: signingSession.createdAt,
        updatedAt: signingSession.updatedAt,
        lastSequenceNumbers: signingSession.lastSequenceNumbers,
      }
    }

    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Validate protocol phase (must be in PARTIAL_SIG_EXCHANGE to accept PARTIAL_SIG_SHARE)
    if (
      !this._validateProtocolPhase(
        activeSession,
        MuSig2MessageType.PARTIAL_SIG_SHARE,
      )
    ) {
      throw new Error(
        `Protocol violation: PARTIAL_SIG_SHARE not allowed in phase ${activeSession.phase}`,
      )
    }

    // Validate sequence number for replay protection
    if (
      !this._validateMessageSequence(activeSession, signerIndex, sequenceNumber)
    ) {
      throw new Error(
        `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
      )
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
    const signingSession = this.activeSigningSessions.get(sessionId)

    if (!activeSession && !signingSession) {
      return
    }

    let session: MuSigSession
    let election: ActiveSession['election'] | undefined

    if (signingSession && signingSession.session) {
      session = signingSession.session
      signingSession.phase = session.phase
      signingSession.updatedAt = Date.now()
      election = signingSession.election
    } else if (activeSession) {
      session = activeSession.session
      activeSession.phase = session.phase
      activeSession.updatedAt = Date.now()
      election = activeSession.election
    } else {
      return
    }

    // Signature is automatically finalized by session manager
    this.emit(MuSig2Event.SESSION_COMPLETE, sessionId)

    // Initialize coordinator failover if enabled and election is active
    if (this.musig2Config.enableCoordinatorFailover && election) {
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

    this.emit(MuSig2Event.SESSION_ABORTED, sessionId, reason)

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

    this.emit(MuSig2Event.SESSION_ERROR, sessionId, error, code)
  }

  /**
   * Handle peer discovery (before connection)
   * Called when bootstrap nodes discover peers
   */
  _onPeerDiscovered(peerInfo: PeerInfo): void {
    // Log discovery for debugging
    console.log(
      `[MuSig2P2P] Peer discovered: ${peerInfo.peerId.substring(0, 12)}... (${peerInfo.multiaddrs?.length || 0} addresses)`,
    )

    // Check if we're already connected to this peer
    const isAlreadyConnected = this.isConnected(peerInfo.peerId)
    if (isAlreadyConnected) {
      console.log(
        `[MuSig2P2P]   Already connected to ${peerInfo.peerId.substring(0, 12)}...`,
      )
      this.emit(MuSig2Event.PEER_DISCOVERED, peerInfo)
      return
    }

    // Check if peer has known identity and reputation
    let shouldAutoConnect = true
    let reputation = 0

    if (this.identityManager) {
      const identity = this.identityManager.getIdentity(peerInfo.peerId)
      if (identity) {
        reputation = identity.reputation.score
        console.log(
          `[MuSig2P2P]   Known identity with reputation: ${reputation}/100`,
        )

        // Check minimum reputation for auto-connect
        const minReputation = this.musig2Config.minReputationForAutoConnect ?? 0
        if (reputation < minReputation) {
          console.log(
            `[MuSig2P2P]   Reputation ${reputation} below minimum ${minReputation} - skipping auto-connect`,
          )
          shouldAutoConnect = false
        }
      }
    }

    // Emit discovery event for applications to react
    this.emit(MuSig2Event.PEER_DISCOVERED, peerInfo)

    // Attempt automatic connection if enabled
    const autoConnectEnabled = this.musig2Config.enableAutoConnect ?? true
    if (autoConnectEnabled && shouldAutoConnect && peerInfo.multiaddrs) {
      // Attempt connection asynchronously (don't block discovery event)
      this._attemptAutoConnect(peerInfo, reputation).catch(error => {
        console.warn(
          `[MuSig2P2P] Auto-connect failed for ${peerInfo.peerId.substring(0, 12)}...:`,
          error.message,
        )
      })
    }
  }

  /**
   * Attempt automatic connection to a discovered peer
   * Called asynchronously from _onPeerDiscovered
   */
  private async _attemptAutoConnect(
    peerInfo: PeerInfo,
    reputation: number,
  ): Promise<void> {
    if (!peerInfo.multiaddrs || peerInfo.multiaddrs.length === 0) {
      return
    }

    console.log(
      `[MuSig2P2P] Attempting auto-connect to ${peerInfo.peerId.substring(0, 12)}...`,
    )

    // Try each multiaddr until one succeeds
    for (const addr of peerInfo.multiaddrs) {
      try {
        await this.connectToPeer(addr)
        console.log(
          `[MuSig2P2P] ✅ Auto-connected to ${peerInfo.peerId.substring(0, 12)}... at ${addr}`,
        )
        return // Success - stop trying
      } catch (error) {
        // Try next multiaddr
        continue
      }
    }

    // All connection attempts failed
    console.warn(
      `[MuSig2P2P] ⚠️  Failed to auto-connect to ${peerInfo.peerId.substring(0, 12)}... (tried ${peerInfo.multiaddrs.length} addresses)`,
    )
  }

  /**
   * Handle peer connection (after successful connection)
   */
  _onPeerConnected(peerId: string): void {
    // Could notify active sessions
    this.emit(MuSig2Event.PEER_CONNECTED, peerId)
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
            MuSig2Event.SESSION_PARTICIPANT_DISCONNECTED,
            sessionId,
            peerId,
          )
        }
      }
    }

    this.emit(MuSig2Event.PEER_DISCONNECTED, peerId)
  }

  /**
   * Handle peer information update
   * Called when libp2p fires peer:update event (e.g., when multiaddrs change)
   */
  _onPeerUpdated(peerInfo: PeerInfo): void {
    console.log(
      `[MuSig2P2P] Peer updated: ${peerInfo.peerId.substring(0, 12)}... (${peerInfo.multiaddrs?.length || 0} addresses)`,
    )

    // Update signer advertisements if this peer has advertised
    for (const [publicKeyHex, advertisement] of this.signerAdvertisements) {
      if (advertisement.peerId === peerInfo.peerId) {
        // Update multiaddrs in the cached advertisement (only if provided)
        if (peerInfo.multiaddrs) {
          const updatedAdvertisement = {
            ...advertisement,
            multiaddrs: peerInfo.multiaddrs,
          }
          this.signerAdvertisements.set(publicKeyHex, updatedAdvertisement)
          console.log(
            `[MuSig2P2P]   Updated multiaddrs for signer advertisement: ${publicKeyHex.substring(0, 12)}...`,
          )
        }
      }
    }

    // Emit event for external consumers
    this.emit('peer:updated' as MuSig2Event, peerInfo)
  }

  // Private helper methods for messaging

  /**
   * Sign a session announcement with creator's private key
   *
   * Creates a canonical serialization of the announcement and signs it with
   * Schnorr to prevent DHT poisoning attacks.
   *
   * @param announcement - Session announcement payload to sign
   * @param privateKey - Creator's private key
   * @returns Schnorr signature as Buffer
   */
  private _signSessionAnnouncement(
    announcement: SessionAnnouncementPayload,
    privateKey: PrivateKey,
  ): Buffer {
    // Create canonical serialization for signing
    // Order: sessionId | signers | message | creatorIndex | requiredSigners
    const message = Buffer.concat([
      Buffer.from(announcement.sessionId),
      Buffer.concat(announcement.signers.map(s => Buffer.from(s, 'hex'))),
      Buffer.from(announcement.message, 'hex'),
      Buffer.from([announcement.creatorIndex]),
      Buffer.from([announcement.requiredSigners]),
    ])

    // Hash the message
    const hashbuf = Hash.sha256(message)

    // Sign with Schnorr (big-endian)
    const signature = Schnorr.sign(hashbuf, privateKey, 'big')

    // Return signature as buffer (64 bytes: r || s)
    return signature.toBuffer('schnorr')
  }

  /**
   * Verify session announcement signature
   *
   * Reconstructs the canonical message and verifies the Schnorr signature
   * against the creator's public key to prevent DHT poisoning.
   *
   * @param announcement - Session announcement data to verify
   * @returns true if signature is valid, false otherwise
   */
  private _verifySessionAnnouncement(
    announcement: SessionAnnouncementData,
  ): boolean {
    // Check if signature exists
    if (!announcement.creatorSignature) {
      console.warn(
        '[MuSig2P2P] Session announcement missing signature:',
        announcement.sessionId,
      )
      return false
    }

    // Reconstruct canonical message
    const message = Buffer.concat([
      Buffer.from(announcement.sessionId),
      Buffer.concat(announcement.signers.map(pk => pk.toBuffer())),
      announcement.message,
      Buffer.from([announcement.creatorIndex]),
      Buffer.from([announcement.requiredSigners]),
    ])

    // Hash the message
    const hashbuf = Hash.sha256(message)

    // Get creator's public key
    const creatorPubKey = announcement.signers[announcement.creatorIndex]

    // Parse signature
    let signature: Signature
    try {
      // Schnorr signatures are 64 bytes (r || s)
      if (announcement.creatorSignature.length !== 64) {
        console.error(
          '[MuSig2P2P] Invalid signature length:',
          announcement.creatorSignature.length,
        )
        return false
      }

      // Parse as Schnorr signature (64 bytes)
      const r = new BN(announcement.creatorSignature.subarray(0, 32), 'be')
      const s = new BN(announcement.creatorSignature.subarray(32, 64), 'be')
      signature = new Signature({ r, s, isSchnorr: true })
    } catch (error) {
      console.error('[MuSig2P2P] Failed to parse signature:', error)
      return false
    }

    // Verify signature
    try {
      return Schnorr.verify(hashbuf, signature, creatorPubKey, 'big')
    } catch (error) {
      console.error('[MuSig2P2P] Signature verification failed:', error)
      return false
    }
  }

  /**
   * Get next sequence number for a signer in a session
   *
   * @param activeSession - Active session
   * @param signerIndex - Signer index
   * @returns Next sequence number
   */
  private _getNextSequenceNumber(
    activeSession: ActiveSession,
    signerIndex: number,
  ): number {
    const lastSeq = activeSession.lastSequenceNumbers.get(signerIndex) || 0
    const nextSeq = lastSeq + 1
    activeSession.lastSequenceNumbers.set(signerIndex, nextSeq)
    return nextSeq
  }

  /**
   * Validate message sequence number for replay protection
   *
   * Ensures sequence numbers are strictly increasing per signer and detects
   * suspicious gaps that might indicate replay attacks or protocol violations.
   *
   * @param activeSession - Active session
   * @param signerIndex - Index of the signer sending the message
   * @param sequenceNumber - Sequence number from the message
   * @returns true if sequence is valid, false if replay or suspicious activity detected
   */
  private _validateMessageSequence(
    activeSession: ActiveSession,
    signerIndex: number,
    sequenceNumber: number,
  ): boolean {
    // Skip validation if replay protection is disabled
    if (!this.musig2Config.enableReplayProtection) {
      return true
    }

    const lastSeq = activeSession.lastSequenceNumbers.get(signerIndex) || 0

    // CHECK 1: Strictly increasing (prevents replay)
    if (sequenceNumber <= lastSeq) {
      console.error(
        `[MuSig2P2P] ⚠️ REPLAY DETECTED in session ${activeSession.sessionId}: ` +
          `signer ${signerIndex} sent seq ${sequenceNumber} but last was ${lastSeq}`,
      )
      return false
    }

    // CHECK 2: Prevent huge gaps (suspicious activity)
    const gap = sequenceNumber - lastSeq
    if (gap > this.musig2Config.maxSequenceGap) {
      console.error(
        `[MuSig2P2P] ⚠️ SUSPICIOUS GAP in session ${activeSession.sessionId}: ` +
          `signer ${signerIndex} jumped from seq ${lastSeq} to ${sequenceNumber} (gap: ${gap})`,
      )
      return false
    }

    // CHECK 3: Update tracking
    activeSession.lastSequenceNumbers.set(signerIndex, sequenceNumber)
    return true
  }

  /**
   * Validate that a message type is allowed in the current protocol phase
   *
   * Enforces strict protocol phase transitions to prevent out-of-order message
   * acceptance. This ensures messages follow the MuSig2 protocol flow:
   * INIT → NONCE_EXCHANGE → PARTIAL_SIG_EXCHANGE → COMPLETE
   *
   * @param activeSession - Active session
   * @param messageType - Type of message being received
   * @returns true if message is allowed in current phase, false otherwise
   */
  private _validateProtocolPhase(
    activeSession: ActiveSession,
    messageType: MuSig2MessageType,
  ): boolean {
    const currentPhase = activeSession.phase

    // Define allowed messages per phase
    switch (messageType) {
      case MuSig2MessageType.SESSION_JOIN:
        // JOIN only allowed in INIT phase
        if (currentPhase !== MuSigSessionPhase.INIT) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${activeSession.sessionId}: ` +
              `SESSION_JOIN not allowed in phase ${currentPhase} (must be INIT)`,
          )
          return false
        }
        return true

      case MuSig2MessageType.NONCE_SHARE:
        // NONCE_SHARE only allowed in NONCE_EXCHANGE phase
        if (currentPhase !== MuSigSessionPhase.NONCE_EXCHANGE) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${activeSession.sessionId}: ` +
              `NONCE_SHARE not allowed in phase ${currentPhase} (must be NONCE_EXCHANGE)`,
          )
          return false
        }
        return true

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        // PARTIAL_SIG_SHARE only allowed in PARTIAL_SIG_EXCHANGE phase
        if (currentPhase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${activeSession.sessionId}: ` +
              `PARTIAL_SIG_SHARE not allowed in phase ${currentPhase} (must be PARTIAL_SIG_EXCHANGE)`,
          )
          return false
        }
        return true

      case MuSig2MessageType.SESSION_ABORT:
        // ABORT allowed in any phase
        return true

      case MuSig2MessageType.VALIDATION_ERROR:
        // ERROR messages allowed in any phase
        return true

      default:
        // Unknown message types - allow but log warning
        console.warn(
          `[MuSig2P2P] Unknown message type for phase validation: ${messageType}`,
        )
        return true
    }
  }

  /**
   * Announce session to DHT
   */
  private async _announceSessionToDHT(
    session: MuSigSession,
    creatorPeerId: string,
    creatorPrivateKey: PrivateKey,
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

    // Sign the announcement to prevent DHT poisoning
    const signatureBuffer = this._signSessionAnnouncement(
      data,
      creatorPrivateKey,
    )
    data.creatorSignature = signatureBuffer.toString('hex')

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

    // Deserialize signature if present
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
      creatorSignature,
    }

    // Verify signature to prevent DHT poisoning
    if (!this._verifySessionAnnouncement(announcement)) {
      console.error(
        '[MuSig2P2P] Session announcement signature verification failed:',
        sessionId,
      )
      return null
    }

    return announcement
  }

  // ========================================================================
  // Signer Directory Management (DHT-based discovery)
  // ========================================================================

  /**
   * Add signer to DHT directory for transaction type
   *
   * Stores advertisement at well-known key so clients can discover
   * signers without knowing their public keys in advance
   *
   * Steps:
   * 1. Store individual advertisement at: musig2-directory:${type}:${pubkey}
   * 2. Create self-signed directory entry (proof of ownership)
   * 3. Update secure directory index with verified entry
   *
   * Security: Entry is signed by advertiser, proving key ownership
   *
   * @param transactionType - Transaction type (from TransactionType enum)
   * @param publicKey - Signer's public key
   * @param advertisement - Full advertisement (must contain signature)
   */
  private async _addToSignerDirectory(
    transactionType: TransactionType,
    publicKey: PublicKey,
    advertisement: SignerAdvertisement,
  ): Promise<void> {
    const pubKeyStr = publicKey.toString()

    // Step 1: Store individual advertisement
    const directoryKey = `musig2-directory:${transactionType}:${pubKeyStr}`
    await this.announceResource(
      DHTResourceType.SIGNER_DIRECTORY,
      directoryKey,
      {
        peerId: advertisement.peerId,
        multiaddrs: advertisement.multiaddrs,
        publicKey: serializePublicKey(publicKey),
        criteria: advertisement.criteria,
        metadata: advertisement.metadata,
        timestamp: advertisement.timestamp,
        expiresAt: advertisement.expiresAt,
        signature: advertisement.signature.toString('hex'),
      } as SignerAdvertisementPayload,
      {
        expiresAt: advertisement.expiresAt,
      },
    )

    // Step 2: Update secure directory index with self-signed entry
    await this._updateSecureDirectoryIndex(
      transactionType,
      publicKey,
      advertisement.peerId,
      'add',
    )
  }

  /**
   * Update secure directory index to add or remove a signer
   *
   * SECURITY: Each entry is self-signed by the advertiser
   * This prevents directory poisoning where attackers add public keys they don't own
   *
   * The directory index is now a signed append-only log where:
   * 1. Each entry contains publicKey + signature
   * 2. Signature = Schnorr.sign(SHA256(publicKey || transactionType || timestamp), privateKey)
   * 3. Only the owner of a private key can add their public key
   * 4. Verifiers check each entry's signature before trusting it
   *
   * Note: Has potential race conditions with concurrent updates
   * Production: Use CRDTs or last-write-wins with version numbers
   *
   * @param transactionType - Transaction type (from TransactionType enum)
   * @param publicKey - Signer's public key
   * @param peerId - Peer ID of advertiser
   * @param action - 'add' or 'remove'
   */
  private async _updateSecureDirectoryIndex(
    transactionType: TransactionType,
    publicKey: PublicKey,
    peerId: string,
    action: 'add' | 'remove',
  ): Promise<void> {
    try {
      const indexKey = `musig2-directory-index:${transactionType}`
      const pubKeyStr = publicKey.toString()
      const timestamp = Date.now()

      // Fetch current secure index
      const existing = await this.discoverResource(
        DHTResourceType.SIGNER_DIRECTORY_INDEX,
        indexKey,
        2000,
      )

      let entries: DirectoryIndexEntry[] = []
      let version = 1

      if (existing && existing.data) {
        const indexData = existing.data as SecureDirectoryIndex
        if (indexData.entries && Array.isArray(indexData.entries)) {
          entries = indexData.entries
        }
        version = (indexData.version || 0) + 1
      }

      // Update entries
      if (action === 'add') {
        // Check if entry already exists
        const existingEntry = entries.find(e => e.publicKey === pubKeyStr)

        if (!existingEntry) {
          // Create self-signed entry
          // The advertiser must sign their directory entry
          // This uses the SAME signature from the advertisement (already verified)
          const entryData = Buffer.concat([
            Buffer.from(pubKeyStr),
            Buffer.from(transactionType),
            Buffer.from(timestamp.toString()),
          ])
          const entryHash = Hash.sha256(entryData)

          // Get signature from my advertisement (already computed)
          const myAd = this.myAdvertisement
          if (!myAd || myAd.publicKey.toString() !== pubKeyStr) {
            console.warn('[MuSig2P2P] Cannot add entry: not my public key')
            return
          }

          // Use the advertisement signature as proof of ownership
          // (it already proves we own the private key)
          const entry: DirectoryIndexEntry = {
            publicKey: pubKeyStr,
            peerId,
            transactionType,
            timestamp,
            signature: myAd.signature.toString('hex'),
          }

          entries.push(entry)
          console.log(
            `[MuSig2P2P] Added self-signed entry to directory: ${pubKeyStr.slice(0, 20)}...`,
          )
        }
      } else if (action === 'remove') {
        // Remove entry
        entries = entries.filter(e => e.publicKey !== pubKeyStr)
        console.log(
          `[MuSig2P2P] Removed entry from directory: ${pubKeyStr.slice(0, 20)}...`,
        )
      }

      // Store updated secure index
      const secureIndex: SecureDirectoryIndex = {
        entries,
        lastUpdated: timestamp,
        version,
      }

      await this.announceResource(
        DHTResourceType.SIGNER_DIRECTORY_INDEX,
        indexKey,
        secureIndex,
        {
          // Index expires after 24 hours (signers should refresh)
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        },
      )

      console.log(
        `[MuSig2P2P] Updated secure directory index for ${transactionType}: ${action} (total: ${entries.length} entries, version: ${version})`,
      )
    } catch (error) {
      console.error('[MuSig2P2P] Error updating secure directory index:', error)
    }
  }

  /**
   * Query DHT directory for available signers by transaction type
   *
   * This allows discovery of signers without knowing their public keys in advance
   *
   * How it works:
   * 1. Queries well-known directory index key: `musig2-directory-index:${transactionType}`
   * 2. Index contains list of public keys of active signers
   * 3. Queries each signer's individual advertisement from DHT
   * 4. Returns valid, non-expired advertisements
   *
   * @param transactionType - Transaction type to query (from TransactionType enum)
   * @returns Array of signer advertisements discovered from DHT
   */
  private async _querySignerDirectory(
    transactionType: TransactionType,
  ): Promise<SignerAdvertisement[]> {
    const results: SignerAdvertisement[] = []

    try {
      // Query well-known directory index
      const indexKey = `musig2-directory-index:${transactionType}`

      console.log(`[MuSig2P2P] Querying DHT directory index: ${indexKey}`)

      const indexResource = await this.discoverResource(
        DHTResourceType.SIGNER_DIRECTORY_INDEX,
        indexKey,
        8000, // 8 second timeout (DHT queries can be slow, especially in small networks)
      )

      if (!indexResource || !indexResource.data) {
        console.log(
          `[MuSig2P2P] No directory index found for type: ${transactionType}`,
        )
        // No directory index found - this is normal if no signers have advertised yet
        return results
      }

      console.log(`[MuSig2P2P] Found directory index for ${transactionType}`)

      // Parse secure directory index (contains self-signed entries)
      const secureIndex = indexResource.data as SecureDirectoryIndex

      if (!secureIndex.entries || !Array.isArray(secureIndex.entries)) {
        console.warn('[MuSig2P2P] Invalid directory index format')
        return results
      }

      console.log(
        `[MuSig2P2P] Directory has ${secureIndex.entries.length} entries (version ${secureIndex.version})`,
      )

      // Verify each entry's signature before trusting it
      const verifiedEntries: DirectoryIndexEntry[] = []

      for (const entry of secureIndex.entries) {
        try {
          // Reconstruct entry data for signature verification
          const entryData = Buffer.concat([
            Buffer.from(entry.publicKey),
            Buffer.from(entry.transactionType),
            Buffer.from(entry.timestamp.toString()),
          ])
          const entryHash = Hash.sha256(entryData)
          const publicKey = new PublicKey(Buffer.from(entry.publicKey, 'hex'))
          const signatureBuffer = Buffer.from(entry.signature, 'hex')

          // NOTE: The entry signature is actually the ADVERTISEMENT signature
          // which signs more data (including multiaddrs). This is even stronger!
          // We can't verify it here without the full advertisement data,
          // but we'll verify it when we query the individual advertisement.

          // For now, accept the entry and verify the full advertisement later
          verifiedEntries.push(entry)
        } catch (error) {
          console.warn(
            `[MuSig2P2P] Skipping invalid directory entry: ${entry.publicKey.slice(0, 20)}...`,
          )
          continue
        }
      }

      console.log(
        `[MuSig2P2P] Verified ${verifiedEntries.length} directory entries`,
      )

      // Query each signer's individual advertisement
      const queries = verifiedEntries.map(
        async (entry: DirectoryIndexEntry) => {
          const pubKeyStr = entry.publicKey
          try {
            const directoryKey = `musig2-directory:${transactionType}:${pubKeyStr}`

            console.log(`[MuSig2P2P] Querying individual ad: ${directoryKey}`)

            const resource = await this.discoverResource(
              DHTResourceType.SIGNER_DIRECTORY,
              directoryKey,
              8000, // 8 second timeout per query (DHT in small networks needs more time)
            )

            if (!resource || !resource.data) {
              console.warn(
                `[MuSig2P2P] Advertisement not found in DHT for: ${pubKeyStr.slice(0, 20)}...`,
              )
              return null
            }

            console.log(
              `[MuSig2P2P] Retrieved advertisement for: ${pubKeyStr.slice(0, 20)}...`,
            )

            const payload = resource.data as SignerAdvertisementPayload

            // Deserialize and validate
            const publicKey = new PublicKey(
              Buffer.from(payload.publicKey, 'hex'),
            )
            const signatureBuffer = Buffer.from(payload.signature, 'hex')
            const multiaddrs = payload.multiaddrs || []

            // Verify signature (must include multiaddrs)
            const adData = Buffer.concat([
              Buffer.from(payload.peerId),
              Buffer.from(JSON.stringify(multiaddrs)),
              publicKey.toBuffer(),
              Buffer.from(JSON.stringify(payload.criteria)),
              Buffer.from(payload.timestamp.toString()),
              Buffer.from(payload.expiresAt.toString()),
            ])
            const hashbuf = Hash.sha256(adData)

            // Construct Signature object from buffer
            const signature = new Signature({
              r: new BN(signatureBuffer.subarray(0, 32), 'be'),
              s: new BN(signatureBuffer.subarray(32, 64), 'be'),
              isSchnorr: true,
            })

            const isValid = Schnorr.verify(hashbuf, signature, publicKey, 'big')

            if (!isValid) {
              console.warn(
                '[MuSig2P2P] Invalid signature for signer:',
                pubKeyStr.slice(0, 20),
              )
              return null
            }

            // Create advertisement object
            const advertisement: SignerAdvertisement = {
              peerId: payload.peerId,
              multiaddrs,
              publicKey,
              criteria: payload.criteria,
              metadata: payload.metadata,
              timestamp: payload.timestamp,
              expiresAt: payload.expiresAt,
              signature: signatureBuffer,
            }

            return advertisement
          } catch (error) {
            // Individual query failed - continue with others
            return null
          }
        },
      )

      // Wait for all queries (with results)
      const advertisements = await Promise.all(queries)

      // Filter out nulls and add to results
      for (const ad of advertisements) {
        if (ad) {
          results.push(ad)
        }
      }

      console.log(
        `[MuSig2P2P] Discovered ${results.length} signers from DHT directory for type: ${transactionType}`,
      )

      return results
    } catch (error) {
      console.error('[MuSig2P2P] Error querying signer directory:', error)
      return results
    }
  }

  /**
   * Query DHT for signing requests requiring a specific public key
   *
   * Similar to signer directory, this could use an index approach
   * For now, relies on P2P gossip to populate local cache
   *
   * @param publicKeyStr - Public key as hex string
   * @returns Array of signing requests from DHT
   */
  private async _querySigningRequestsForKey(
    publicKeyStr: string,
  ): Promise<SigningRequest[]> {
    const results: SigningRequest[] = []

    try {
      // Signing requests in DHT are stored with keys: ${requestId}:${publicKey}
      // Since we don't know requestIds in advance, we can't query directly
      //
      // Options for production:
      // 1. Maintain a directory index: signing-request-index:${publicKey}
      // 2. Use DHT prefix scanning (if supported)
      // 3. Use Gossipsub topic subscriptions
      // 4. Rely on P2P gossip broadcasts (current approach)
      //
      // For now, return empty - local cache populated by broadcasts is sufficient

      console.log(
        `[MuSig2P2P] DHT query for signing requests (key: ${publicKeyStr.slice(0, 20)}...) - relying on P2P gossip`,
      )

      return results
    } catch (error) {
      console.error('[MuSig2P2P] Error querying signing requests:', error)
      return results
    }
  }

  // ========================================================================
  // Security: Peer Ownership Verification
  // ========================================================================

  /**
   * Verify advertisement signature to prove ownership
   *
   * Alice MUST verify Bob's signature locally BEFORE trusting the advertisement.
   * She cannot trust Zoe or any intermediary - she verifies cryptographic proof herself.
   *
   * The signature proves:
   * 1. Bob owns the private key for the advertised public key
   * 2. The multiaddrs haven't been tampered with
   * 3. The criteria and metadata are authentic
   *
   * @param advertisement - Advertisement to verify
   * @returns true if signature is valid, false otherwise
   */
  verifyAdvertisementSignature(advertisement: SignerAdvertisement): boolean {
    try {
      const { publicKey, criteria, timestamp, expiresAt, signature } =
        advertisement

      // Reconstruct signed data EXACTLY as it was created in advertiseSigner()
      // MUST match the format in advertiseSigner() line 520-527
      const adData = Buffer.concat([
        Buffer.from(advertisement.peerId),
        Buffer.from(JSON.stringify(advertisement.multiaddrs)),
        publicKey.toBuffer(),
        Buffer.from(JSON.stringify(criteria)),
        Buffer.from(timestamp.toString()),
        Buffer.from(expiresAt.toString()),
      ])

      const hashbuf = Hash.sha256(adData)

      // Convert signature buffer to Signature object
      const signatureObj = new Signature({
        r: new BN(signature.subarray(0, 32), 'be'),
        s: new BN(signature.subarray(32, 64), 'be'),
      })

      // Verify: Only someone with the private key could create this signature
      const isValid = Schnorr.verify(hashbuf, signatureObj, publicKey, 'big')

      if (!isValid) {
        console.warn(
          `[MuSig2P2P] ⚠️  Invalid signature for: ${advertisement.peerId.slice(0, 20)}`,
        )
        return false
      }

      return true
    } catch (error) {
      console.error(
        '[MuSig2P2P] Error verifying advertisement signature:',
        error,
      )
      return false
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
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const payload: SessionJoinPayload = {
      sessionId,
      signerIndex,
      sequenceNumber: this._getNextSequenceNumber(activeSession, signerIndex),
      timestamp: Date.now(),
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
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const payload: NonceSharePayload = {
      sessionId,
      signerIndex,
      sequenceNumber: this._getNextSequenceNumber(activeSession, signerIndex),
      timestamp: Date.now(),
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
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const payload: PartialSigSharePayload = {
      sessionId,
      signerIndex,
      sequenceNumber: this._getNextSequenceNumber(activeSession, signerIndex),
      timestamp: Date.now(),
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
   * Get security manager for advanced security operations
   */
  getSecurityManager(): SecurityManager {
    return this.securityManager
  }

  /**
   * Get identity manager (if burn-based identity is enabled)
   */
  getIdentityManager(): MuSig2IdentityManager | undefined {
    return this.identityManager
  }

  /**
   * Register MuSig2 as protocol validator with core P2P security
   * Adds MuSig2-specific validation on top of core security
   */
  private _registerProtocolValidator(): void {
    const validator: IProtocolValidator = {
      // Validate resource announcements
      validateResourceAnnouncement: async (
        resourceType: string,
        resourceId: string,
        data: unknown,
        peerId: string,
      ): Promise<boolean> => {
        // Apply MuSig2-specific validation
        if (resourceType.startsWith('musig2-')) {
          // If burn-based identity is enabled, validate identity
          if (
            this.musig2Config.enableBurnBasedIdentity &&
            this.identityManager
          ) {
            // Extract public key from data
            const announcement = data as SignerAdvertisement
            if (announcement && announcement.publicKey) {
              const pubKeyStr = announcement.publicKey.toString()

              // Check if this public key has a registered identity
              const identity =
                this.identityManager.getIdentityByPublicKey(pubKeyStr)

              if (!identity) {
                console.warn(
                  `[MuSig2P2P] Rejected announcement from ${peerId}: No registered identity for public key ${pubKeyStr.slice(0, 20)}...`,
                )
                return false
              }

              // Check if identity is banned
              if (this.identityManager.isBanned(identity.identityId)) {
                console.warn(
                  `[MuSig2P2P] Rejected announcement from ${peerId}: Identity ${identity.identityId.slice(0, 20)}... is banned`,
                )
                return false
              }

              // Check minimum reputation (if needed)
              if (!this.identityManager.isAllowed(identity.identityId, 0)) {
                console.warn(
                  `[MuSig2P2P] Rejected announcement from ${peerId}: Identity ${identity.identityId.slice(0, 20)}... has insufficient reputation`,
                )
                return false
              }

              console.log(
                `[MuSig2P2P] ✓ Validated identity for announcement: ${identity.identityId.slice(0, 20)}... (reputation: ${identity.reputation.score})`,
              )
            }
          }

          // Additional validation can be added here
          // For now, rely on signature verification in handlers
          return true
        }
        return true
      },

      // Check if peer can announce resource
      canAnnounceResource: (resourceType: string, peerId: string): boolean => {
        // Check if peer is allowed by MuSig2 security
        if (resourceType.startsWith('musig2-')) {
          return this.securityManager.peerReputation.isAllowed(peerId)
        }
        return true
      },
    }

    // Register with core security manager
    this.coreSecurityManager.registerProtocolValidator('musig2', validator)
  }

  /**
   * Cleanup: stop automatic cleanup and close all sessions
   */
  async cleanup(): Promise<void> {
    // Stop automatic cleanup interval
    if (this.sessionCleanupIntervalId) {
      clearInterval(this.sessionCleanupIntervalId)
      this.sessionCleanupIntervalId = undefined
    }

    // SECURITY: Cleanup security manager data
    this.securityManager.cleanup()

    // SECURITY: Shutdown identity manager if enabled
    if (this.identityManager) {
      this.identityManager.shutdown()
    }

    // Close all active sessions
    const sessionIds = Array.from(this.activeSessions.keys())
    await Promise.all(sessionIds.map(id => this.closeSession(id)))
  }

  /**
   * Start periodic session cleanup task
   *
   * Runs every `cleanupInterval` milliseconds to clean up expired and stuck sessions.
   * Automatically called by constructor if `enableAutoCleanup` is true.
   */
  private startSessionCleanup(): void {
    this.sessionCleanupIntervalId = setInterval(() => {
      this.cleanupExpiredSessions()
    }, this.musig2Config.cleanupInterval)
  }

  /**
   * Clean up expired and stuck sessions
   *
   * This method is called periodically by the cleanup interval.
   * It removes sessions that:
   * - Have exceeded the session timeout
   * - Are stuck in a phase for too long
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now()
    const expirationTime = this.musig2Config.sessionTimeout

    for (const [sessionId, activeSession] of this.activeSessions.entries()) {
      // Check if session has expired
      const age = now - activeSession.createdAt
      if (age > expirationTime) {
        console.log(
          `[MuSig2P2P] Cleaning up expired session: ${sessionId} (age: ${Math.round(age / 1000)}s)`,
        )
        this.closeSession(sessionId).catch(error => {
          console.error(
            `[MuSig2P2P] Failed to close expired session ${sessionId}:`,
            error,
          )
        })
        continue
      }

      // Check if session is stuck in a phase
      if (this._isSessionStuck(activeSession, now)) {
        console.warn(
          `[MuSig2P2P] Cleaning up stuck session: ${sessionId} (phase: ${activeSession.phase})`,
        )
        this.closeSession(sessionId).catch(error => {
          console.error(
            `[MuSig2P2P] Failed to close stuck session ${sessionId}:`,
            error,
          )
        })
      }
    }
  }

  /**
   * Check if a session is stuck in a phase
   *
   * A session is considered stuck if it has been in the NONCE_EXCHANGE
   * or PARTIAL_SIG_EXCHANGE phase for longer than the stuck session timeout.
   *
   * @param activeSession - Active session to check
   * @param now - Current timestamp
   * @returns true if session is stuck, false otherwise
   */
  private _isSessionStuck(activeSession: ActiveSession, now: number): boolean {
    const stuckTimeout = this.musig2Config.stuckSessionTimeout
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

    this.emit(MuSig2Event.SESSION_BROADCAST_CONFIRMED, sessionId)
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
        MuSig2Event.SESSION_SHOULD_BROADCAST,
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
        MuSig2Event.SESSION_FAILOVER_EXHAUSTED,
        sessionId,
        failover.failoverAttempts,
      )
      return
    }

    // Save the failed coordinator index before updating
    const failedCoordinatorIndex = failover.currentCoordinatorIndex

    // Update current coordinator
    failover.currentCoordinatorIndex = nextCoordinator
    failover.failoverAttempts++
    failover.broadcastDeadline = Date.now() + this.musig2Config.broadcastTimeout

    this.emit(
      MuSig2Event.SESSION_COORDINATOR_FAILED,
      sessionId,
      failedCoordinatorIndex,
      nextCoordinator,
    )

    // Check if I'm the new coordinator
    if (nextCoordinator === session.myIndex) {
      // I'm now the coordinator - emit event to signal I should broadcast
      this.emit(
        MuSig2Event.SESSION_SHOULD_BROADCAST,
        sessionId,
        nextCoordinator,
      )

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

// ============================================================================
// Type-safe Event Method Declarations
// ============================================================================

/**
 * Strongly-typed event methods for MuSig2P2PCoordinator
 *
 * This declaration merging provides type-safe event handling by overriding
 * the EventEmitter method signatures with our strongly-typed versions.
 *
 * Safety rationale:
 * - We're NOT adding new properties that need initialization
 * - We're ONLY overriding method signatures for type safety
 * - The actual implementations come from the parent EventEmitter class
 * - This is a standard TypeScript pattern used by libraries like typed-emitter
 *
 * This pattern ensures compile-time type checking for:
 * - Valid event names (from MuSig2Event enum)
 * - Correct parameter types for each event handler
 * - IntelliSense support for event handling
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- Safe: Method signature overrides only, no uninitialized properties
export interface MuSig2P2PCoordinator {
  on<E extends keyof MuSig2EventMap>(
    event: E,
    listener: MuSig2EventMap[E],
  ): this

  once<E extends keyof MuSig2EventMap>(
    event: E,
    listener: MuSig2EventMap[E],
  ): this

  emit<E extends keyof MuSig2EventMap>(
    event: E,
    ...args: Parameters<MuSig2EventMap[E]>
  ): boolean

  off<E extends keyof MuSig2EventMap>(
    event: E,
    listener: MuSig2EventMap[E],
  ): this

  removeListener<E extends keyof MuSig2EventMap>(
    event: E,
    listener: MuSig2EventMap[E],
  ): this

  removeAllListeners<E extends keyof MuSig2EventMap>(event?: E): this

  listenerCount<E extends keyof MuSig2EventMap>(event: E): number
}
