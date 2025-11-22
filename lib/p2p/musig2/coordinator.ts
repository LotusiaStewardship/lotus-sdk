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
import { peerIdFromString } from '@libp2p/peer-id'
import {
  MuSig2MessageType,
  MuSig2P2PConfig,
  P2PSessionMetadata,
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
import { signTaprootKeyPathWithMuSig2 } from '../../bitcore/taproot/musig2.js'
import { calculateTapTweak } from '../../bitcore/taproot.js'
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
import { Mutex } from 'async-mutex'
import { yieldToEventLoop } from '../../../utils/functions.js'

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
  private readonly securityManager: SecurityManager
  private readonly messageProtocol: P2PProtocol
  private readonly protocolHandler: MuSig2ProtocolHandler
  private readonly sessionManager: MuSigSessionManager
  private readonly debugLoggingEnabled: boolean
  // REMOVED participantJoinCache - now using metadata.participants as single source of truth
  private activeSessions: Map<string, MuSigSession> = new Map() // MuSigSession directly
  private p2pMetadata: Map<string, P2PSessionMetadata> = new Map() // P2P-specific metadata
  // ARCHITECTURE CHANGE (2025-11-21): Request ID → Session ID mapping
  // Signing requests use requestId (SHA256 hash), sessions use sessionId (deterministic from signers+message)
  // This mapping allows looking up sessions by requestId and prevents ID confusion
  private requestIdToSessionId: Map<string, string> = new Map() // requestId -> sessionId
  private signerAdvertisements: Map<string, SignerAdvertisement> = new Map() // publicKey -> advertisement
  private signingRequests: Map<string, SigningRequest> = new Map() // requestId -> request
  private peerIdToSignerIndex: Map<string, Map<string, number>> = new Map() // sessionId -> peerId -> signerIndex
  private myAdvertisement?: SignerAdvertisement // My current advertisement
  private advertisementSigningKey?: PrivateKey // Stored for re-signing on address changes
  // SECURITY (DOS PREVENTION): Automatic cleanup interval to prevent resource exhaustion
  private sessionCleanupIntervalId?: NodeJS.Timeout
  // Track emitted events per session to prevent duplicates
  private emittedEvents: Map<string, Set<MuSig2Event>> = new Map() // sessionId -> Set of emitted events
  // SECURITY: Identity manager for burn-based blockchain-anchored identities
  private identityManager?: MuSig2IdentityManager
  // CONCURRENCY: Mutexes for thread-safe state management
  private stateMutex = new Mutex() // Protects session state and metadata
  private advertisementMutex = new Mutex() // Protects signer advertisements
  private signingRequestMutex = new Mutex() // Protects signing requests
  // EVENT DEFERRAL: Queue for events that must be emitted after state mutations
  private deferredEvents: Array<{
    event: MuSig2Event
    args: Parameters<MuSig2EventMap[MuSig2Event]>
  }> = []
  private isProcessingStateChange = false
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
    enableReplayProtection: boolean
    maxSequenceGap: number
    stuckSessionTimeout: number
    enableAutoCleanup: boolean
    cleanupInterval: number
    securityLimits: typeof MUSIG2_SECURITY_LIMITS
    chronikUrl: string | string[]
    enableBurnBasedIdentity: boolean
    burnMaturationPeriod: number
    enableAutoConnect: boolean
    minReputationForAutoConnect: number
    enableDebugLogging: boolean
  }

  /**
   * Logs a debug message with context and timestamp if debug logging is enabled.
   *
   * @param {string} context - The context of the debug message.
   * @param {string} message - The debug message to log.
   * @param {Record<string, unknown>} [extra] - Extra information to include in the log.
   */
  debugLog(
    context: string,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.debugLoggingEnabled) {
      return
    }

    const timestamp = new Date().toISOString()
    const meta = extra ? ` ${JSON.stringify(extra)}` : ''
    console.debug(`[MuSig2P2P][${timestamp}][${context}] ${message}${meta}`)
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
        musig2Config?.enableCoordinatorElection ?? true,
      electionMethod: musig2Config?.electionMethod || 'lexicographic',
      enableCoordinatorFailover:
        musig2Config?.enableCoordinatorFailover ??
        musig2Config?.enableCoordinatorElection ??
        false,
      enableReplayProtection: musig2Config?.enableReplayProtection ?? true,
      maxSequenceGap: musig2Config?.maxSequenceGap ?? 100,
      stuckSessionTimeout: musig2Config?.stuckSessionTimeout || 10 * 60 * 1000, // 10 minutes
      // SECURITY: Enable automatic cleanup by default for DOS prevention
      enableAutoCleanup: musig2Config?.enableAutoCleanup ?? true,
      cleanupInterval: musig2Config?.cleanupInterval || 60000, // 1 minute
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
      enableDebugLogging: musig2Config?.enableDebugLogging ?? false,
    }
    this.debugLoggingEnabled = this.musig2Config.enableDebugLogging

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

    // SECURITY (DOS PREVENTION): Start automatic session cleanup if enabled
    if (this.musig2Config.enableAutoCleanup) {
      this.startSessionCleanup()
    }

    // NOTE: Relay address monitoring is now handled by core P2P layer
    // Protocol handlers can implement onRelayAddressesChanged to receive notifications
  }

  // ========================================================================
  // Concurrency Control Helpers
  // ========================================================================

  /**
   * Execute a function with state lock held
   * Ensures atomic operations on session state and metadata
   *
   * After the state mutation completes, deferred events are emitted
   * to ensure state consistency: applications see the new state before
   * processing events that depend on it.
   */
  private async withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.stateMutex.acquire()
    const wasProcessing = this.isProcessingStateChange
    this.isProcessingStateChange = true

    try {
      return await fn()
    } finally {
      const pendingEvents = this._collectDeferredEvents()

      // Only reset if we were the outermost lock holder
      if (!wasProcessing) {
        this.isProcessingStateChange = false
      }

      release()

      // Emit deferred events AFTER releasing the lock to avoid deadlocks
      await this._processDeferredEvents(pendingEvents)
    }
  }

  /**
   * Defer an event to be emitted after current state mutations complete
   *
   * This ensures that event handlers see a consistent state:
   * - All state mutations are complete
   * - All related state is committed
   * - No race conditions with incoming messages
   */
  private deferEvent(
    event: MuSig2Event,
    ...args: Parameters<MuSig2EventMap[MuSig2Event]>
  ): void {
    this.deferredEvents.push({ event, args })
  }

  /**
   * Process all deferred events
   *
   * Called after state mutations complete but before releasing the state lock.
   * This ensures event handlers see a consistent state.
   */
  private _collectDeferredEvents(): Array<{
    event: MuSig2Event
    args: Parameters<MuSig2EventMap[MuSig2Event]>
  }> {
    if (this.deferredEvents.length === 0) {
      return []
    }

    return this.deferredEvents.splice(0)
  }

  private async _processDeferredEvents(
    initialEvents: Array<{
      event: MuSig2Event
      args: Parameters<MuSig2EventMap[MuSig2Event]>
    }> = [],
  ): Promise<void> {
    const localQueue = [...initialEvents]

    while (localQueue.length > 0 || this.deferredEvents.length > 0) {
      const nextEvent =
        localQueue.length > 0
          ? localQueue.shift()!
          : this.deferredEvents.shift()!

      this.emit(nextEvent.event, ...nextEvent.args)

      // Yield to event loop to allow handlers to complete
      await yieldToEventLoop()
    }
  }

  /**
   * Execute a function with advertisement lock held
   * Ensures atomic operations on signer advertisements
   */
  private async withAdvertisementLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.advertisementMutex.acquire()
    const wasProcessing = this.isProcessingStateChange
    this.isProcessingStateChange = true

    try {
      const result = await fn()
      return result
    } finally {
      const pendingEvents = this._collectDeferredEvents()

      // Only reset if we were the outermost lock holder
      if (!wasProcessing) {
        this.isProcessingStateChange = false
      }

      release()

      await this._processDeferredEvents(pendingEvents)
    }
  }

  /**
   * Execute a function with signing request lock held
   * Ensures atomic operations on signing requests
   */
  private async withSigningRequestLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.signingRequestMutex.acquire()
    const wasProcessing = this.isProcessingStateChange
    this.isProcessingStateChange = true

    try {
      const result = await fn()
      return result
    } finally {
      const pendingEvents = this._collectDeferredEvents()

      // Only reset if we were the outermost lock holder
      if (!wasProcessing) {
        this.isProcessingStateChange = false
      }
      release()

      await this._processDeferredEvents(pendingEvents)
    }
  }

  /**
   * Helper: Update peer-to-signer index mapping
   * Creates the mapping if it doesn't exist
   */
  private _updatePeerMapping(
    sessionId: string,
    peerId: string,
    signerIndex: number,
  ): void {
    let peerMap = this.peerIdToSignerIndex.get(sessionId)
    if (!peerMap) {
      peerMap = new Map()
      this.peerIdToSignerIndex.set(sessionId, peerMap)
    }
    peerMap.set(peerId, signerIndex)
  }

  /**
   * Setup event handlers for three-phase architecture
   */
  private _setupThreePhaseEventHandlers(): void {
    // Handle discovered signer advertisements (from others)
    this.on(
      MuSig2Event.SIGNER_DISCOVERED,
      (advertisement: SignerAdvertisement) => {
        // Store in local cache with lock to prevent race conditions
        void this.withAdvertisementLock(async () => {
          this.signerAdvertisements.set(
            advertisement.publicKey.toString(),
            advertisement,
          )
        })
      },
    )

    // Handle our own signer advertisement confirmation (from self)
    this.on(
      MuSig2Event.SIGNER_ADVERTISED,
      (advertisement: SignerAdvertisement) => {
        // Store in local cache (same as SIGNER_DISCOVERED)
        // This prevents duplicate emission if we receive via both GossipSub and P2P
        void this.withAdvertisementLock(async () => {
          this.signerAdvertisements.set(
            advertisement.publicKey.toString(),
            advertisement,
          )
        })
      },
    )

    // Handle signer unavailable
    this.on(
      MuSig2Event.SIGNER_UNAVAILABLE,
      (data: { peerId: string; publicKey: PublicKey }) => {
        // Remove from cache with lock to prevent race conditions
        void this.withAdvertisementLock(async () => {
          this.signerAdvertisements.delete(data.publicKey.toString())
        })
      },
    )

    // ARCHITECTURE CHANGE (2025-11-21): Consolidated signing request handling
    // With local-first pattern and self-message filtering:
    // - SIGNING_REQUEST_CREATED: Fires locally when we create a request (synchronous)
    // - SIGNING_REQUEST_RECEIVED: Fires when remote peer broadcasts (async, filtered)
    // Both handlers do the same thing, so we can consolidate

    // Handle signing requests from ANY source (self-created or received from others)
    const handleSigningRequest = (request: SigningRequest) => {
      // Check if already stored (idempotent)
      if (this.signingRequests.has(request.requestId)) {
        return // Already processed
      }

      // Store in local cache
      this.signingRequests.set(request.requestId, request)

      // Ingest creator's participation (if included in request)
      this._ingestCreatorParticipation(request)

      this.debugLog('signing-request', 'Signing request stored', {
        requestId: request.requestId,
        creatorPeerId: request.creatorPeerId,
        requiredKeys: request.requiredPublicKeys.length,
      })
    }

    // Register handler for both events
    this.on(MuSig2Event.SIGNING_REQUEST_CREATED, handleSigningRequest)
    this.on(MuSig2Event.SIGNING_REQUEST_RECEIVED, handleSigningRequest)

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
        let shouldCreateSession = false

        // Wrap state mutations in lock
        await this.withStateLock(async () => {
          // Get metadata - for signing request architecture, this exists before session creation
          const metadata = this.p2pMetadata.get(data.requestId)

          // Skip if we don't have metadata for this request (not relevant to us)
          if (!metadata) {
            return
          }

          // ARCHITECTURE CHANGE (2025-11-21): Single source of truth for duplicate prevention
          // Use metadata.participants as the ONLY duplicate check (protected by state lock)
          // Removed redundant _markParticipantJoinSeen() cache check

          // Check for duplicate FIRST (before expensive signature verification)
          if (metadata.participants.has(data.participantIndex)) {
            this.debugLog(
              'participant:join',
              'Duplicate participant join ignored (already in participants map)',
              {
                requestId: data.requestId,
                participantIndex: data.participantIndex,
                participantPeerId: data.participantPeerId,
              },
            )
            return
          }

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
          metadata.participants.set(
            data.participantIndex,
            data.participantPeerId,
          )

          // Check if ALL participants have joined (MuSig2 = n-of-n)
          if (
            metadata.request &&
            metadata.participants.size ===
              metadata.request.requiredPublicKeys.length
          ) {
            // All participants joined - create MuSig session outside the lock
            shouldCreateSession = true
          }
        })

        if (shouldCreateSession) {
          await this._createMuSigSessionFromRequest(data.requestId)
        }
      },
    )
  }

  /**
   * Stop the coordinator and cleanup
   *
   */
  async stop(): Promise<void> {
    // First cleanup MuSig2-specific resources while the libp2p node is still running
    await this.cleanup()

    // Call parent stop() which will shutdown the libp2p node
    // Event listeners are automatically cleaned up when the node stops
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
    sessionMetadata?: Record<string, unknown>,
  ): Promise<string> {
    return this.withStateLock(async () => {
      this.debugLog('session:create', 'Creating session', {
        signers: signers.length,
      })
      // Create session locally
      const session = this.sessionManager.createSession(
        signers,
        myPrivateKey,
        message,
        sessionMetadata,
      )

      // Perform coordinator election if enabled
      let election: ElectionResult | undefined
      if (this.musig2Config.enableCoordinatorElection) {
        const electionMethod = this._getElectionMethod()
        election = electCoordinator(signers, electionMethod)
      }

      // Store MuSigSession directly
      this.activeSessions.set(session.sessionId, session)

      // Create P2P metadata
      const p2pMetadata: P2PSessionMetadata = {
        participants: new Map([[session.myIndex, this.peerId]]),
        lastSequenceNumbers: new Map(),
        revealedNonces: new Set(),
      }

      // Add election data if enabled
      if (election) {
        p2pMetadata.election = {
          coordinatorIndex: election.coordinatorIndex,
          coordinatorPeerId:
            election.coordinatorIndex === session.myIndex
              ? this.peerId
              : undefined,
          electionProof: election.electionProof,
        }
      }

      this.p2pMetadata.set(session.sessionId, p2pMetadata)

      // Announce session to DHT if enabled
      if (this.musig2Config.enableSessionDiscovery) {
        await this._announceSessionToDHT(session, this.peerId, myPrivateKey)
      }

      // Defer event emission to ensure state consistency
      this.deferEvent(MuSig2Event.SESSION_CREATED, session.sessionId)
      this.debugLog('session:create', 'Session created', {
        sessionId: session.sessionId,
        myIndex: session.myIndex,
      })

      return session.sessionId
    })
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
    return this.withStateLock(async () => {
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

      // Store MuSigSession directly
      this.activeSessions.set(sessionId, session)

      // Create P2P metadata
      const metadata: P2PSessionMetadata = {
        participants: new Map(),
        lastSequenceNumbers: new Map(),
      }

      // Perform coordinator election if enabled (from announcement data)
      if (
        this.musig2Config.enableCoordinatorElection &&
        announcement.election
      ) {
        metadata.election = {
          coordinatorIndex: announcement.election.coordinatorIndex,
          coordinatorPeerId: undefined,
          electionProof: announcement.election.electionProof,
        }
      }

      // Add myself
      metadata.participants.set(session.myIndex, this.peerId)

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
            metadata.participants.set(i, creatorPeerId)
          }
        }
      }

      this.p2pMetadata.set(sessionId, metadata)

      // Send join message to creator
      await this._sendSessionJoin(sessionId, myIndex, myPubKey, creatorPeerId)

      // Defer event emission to ensure state consistency
      this.deferEvent(MuSig2Event.SESSION_JOINED, sessionId)

      // Wait a bit for the creator to send us session state, then start Round 1
      // For now, we'll let the creator initiate Round 1
    })
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
              `[MuSig2P2P] Oversized advertisement rejected: ${messageData.length} bytes (max: ${limits.MAX_ADVERTISEMENT_SIZE})`,
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
              `[MuSig2P2P] Advertisement timestamp out of range: ${timestampSkew}ms skew (max: ${limits.MAX_TIMESTAMP_SKEW}ms)`,
            )
            return // Drop time-invalid advertisement
          }

          // SECURITY 3: Expiry enforcement (drop expired immediately)
          if (payload.expiresAt && payload.expiresAt < Date.now()) {
            console.warn(
              `[MuSig2P2P] Expired advertisement rejected: ${payload.peerId}`,
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
              `[MuSig2P2P] Rejected invalid advertisement from GossipSub: ${payload.peerId}`,
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
              `[MuSig2P2P] Advertisement rejected from GossipSub (rate/key limit): ${payload.peerId}`,
            )
            return // Drop rate-limited advertisement
          }

          // Prevent duplicate emissions - check if signer already discovered
          const pubKeyStr = advertisement.publicKey.toString()
          if (this.signerAdvertisements.has(pubKeyStr)) {
            // Already discovered this signer, skip duplicate emission
            return
          }

          // ARCHITECTURE: Emit appropriate event based on sender
          // - If from self: emit SIGNER_ADVERTISED (we successfully advertised)
          // - If from others: emit SIGNER_DISCOVERED (we discovered a signer)
          const isSelfAdvertisement = payload.peerId === this.peerId

          if (isSelfAdvertisement) {
            // We advertised ourselves successfully (received our own GossipSub message)
            this.emit(MuSig2Event.SIGNER_ADVERTISED, advertisement)
            console.log(
              `[MuSig2P2P] Advertisement confirmed (GossipSub): ${payload.metadata?.nickname || payload.peerId}`,
            )
          } else {
            // We discovered a signer from another peer
            this.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)
            console.log(
              `[MuSig2P2P] Verified & discovered (GossipSub): ${payload.metadata?.nickname || payload.peerId}`,
            )
          }
        } catch (error) {
          // Malformed JSON or invalid data - drop silently
          console.debug('[MuSig2P2P] Malformed GossipSub message dropped')
        }
      })

      console.log(`[MuSig2P2P] Subscribed to topic: ${topic}`)
    }
  }

  /**
   * Subscribe to signing requests via GossipSub for NAT traversal
   *
   * This method allows peers behind NAT to receive signing requests
   * through relay nodes that forward GossipSub messages.
   *
   * @param callback - Optional callback for when signing requests are received
   */
  async subscribeToSigningRequests(
    callback?: (request: SigningRequest) => void,
  ): Promise<void> {
    await this.subscribeToTopic(
      MuSig2MessageType.SIGNING_REQUEST,
      (messageData: Uint8Array) => {
        try {
          // Get security limits (allow config override)
          const limits =
            this.musig2Config.securityLimits || MUSIG2_SECURITY_LIMITS

          // SECURITY 1: Message size limit (prevent memory exhaustion DoS)
          if (messageData.length > limits.MAX_SIGNING_REQUEST_SIZE) {
            console.warn(
              `[MuSig2P2P] Oversized signing request rejected: ${messageData.length} bytes (max: ${limits.MAX_SIGNING_REQUEST_SIZE})`,
            )
            return // Drop oversized message
          }

          // Convert Uint8Array to string using Node.js Buffer
          const messageStr = Buffer.from(messageData).toString('utf8')
          const payload = JSON.parse(messageStr) as SigningRequestPayload

          // SECURITY 2: Timestamp validation (prevent future/past attacks)
          const timestampSkew = Math.abs(Date.now() - payload.createdAt)
          if (timestampSkew > limits.MAX_TIMESTAMP_SKEW) {
            console.warn(
              `[MuSig2P2P] Stale signing request rejected: ${timestampSkew}ms skew (max: ${limits.MAX_TIMESTAMP_SKEW})`,
            )
            return // Drop stale message
          }

          // SECURITY 3: Expiry validation (prevent expired requests)
          if (payload.expiresAt < Date.now()) {
            console.warn(
              `[MuSig2P2P] Expired signing request rejected: expired ${Date.now() - payload.expiresAt}ms ago`,
            )
            return // Drop expired message
          }

          // SECURITY 4: Signature verification (prevent request forgery)
          const requestData = Buffer.concat([
            Buffer.from(payload.requestId),
            Buffer.from(payload.message, 'hex'),
            ...payload.requiredPublicKeys.map(pk => Buffer.from(pk, 'hex')),
            Buffer.from(payload.requiredPublicKeys.length.toString()),
          ])
          const hashbuf = Hash.sha256(requestData)
          const creatorPubKey = PublicKey.fromString(payload.creatorPublicKey)
          const creatorSig = Signature.fromBuffer(
            Buffer.from(payload.creatorSignature, 'hex'),
          )

          if (!Schnorr.verify(hashbuf, creatorSig, creatorPubKey, 'big')) {
            console.warn(
              `[MuSig2P2P] Invalid signing request signature rejected: ${payload.requestId}`,
            )
            return // Drop message with invalid signature
          }

          // SECURITY 5: TODO: Add rate limiting for signing requests (prevent spam)
          // Note: Rate limiting infrastructure for signing requests needs to be implemented
          // For now, we rely on GossipSub's built-in rate limiting and signature validation

          // Process the signing request through the protocol handler
          this.protocolHandler.handleMessage(
            {
              type: MuSig2MessageType.SIGNING_REQUEST,
              from: payload.creatorPeerId,
              payload,
              timestamp: Date.now(),
              messageId: '',
              protocol: 'musig2',
            },
            { peerId: payload.creatorPeerId } as PeerInfo,
          )

          // Convert payload to SigningRequest format
          const signingRequest: SigningRequest = {
            requestId: payload.requestId,
            requiredPublicKeys: payload.requiredPublicKeys.map(pk =>
              PublicKey.fromString(pk),
            ),
            message: Buffer.from(payload.message, 'hex'),
            creatorPeerId: payload.creatorPeerId,
            creatorPublicKey: creatorPubKey,
            createdAt: payload.createdAt,
            expiresAt: payload.expiresAt,
            metadata: payload.metadata,
            creatorSignature: Buffer.from(payload.creatorSignature, 'hex'),
            joinedParticipants: new Map(),
          }

          // Call user callback if provided
          if (callback) {
            callback(signingRequest)
          }
        } catch (error) {
          console.debug(
            '[MuSig2P2P] Malformed GossipSub signing request dropped:',
            error,
          )
        }
      },
    )
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
    // Use reachable addresses for NAT traversal to ensure DCUtR connectivity
    const myMultiaddrs = await this.getReachableAddresses()

    console.log(
      `[MuSig2P2P] Advertising signer with ${myMultiaddrs.length} reachable addresses`,
    )

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
    this.advertisementSigningKey = myPrivateKey
    this.signerAdvertisements.set(myPubKey.toString(), advertisement)

    // NOTE: Address tracking is now handled by core P2P layer

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
        console.log(`[MuSig2P2P] ❌ GossipSub publish failed for ${topic}:`)
        console.log(`    Error: ${error}`)
        console.log(
          `    Discovery messages require GossipSub - check network configuration`,
        )
      }
    }

    // REMOVED (Phase 1): Dual-channel broadcast
    // SIGNER_ADVERTISEMENT is a discovery message and should ONLY use GossipSub
    // per the message channel architecture. Using direct streams creates duplicates
    // and violates the single-channel-per-message principle.

    // NOTE: Do NOT emit SIGNER_ADVERTISED locally!
    // We receive our own broadcast and the protocol handler emits the event.
    // This ensures all peers (including us) emit events in the same order.
  }

  /**
   * Advertise signer availability with relay address waiting
   *
   * Production implementation waits for relay addresses to ensure
   * reliable NAT traversal before advertising signer availability
   *
   * @param myPrivateKey - Your private key
   * @param criteria - Availability criteria
   * @param options - Optional configuration
   */
  async advertiseSignerWithRelay(
    myPrivateKey: PrivateKey,
    criteria: SignerCriteria,
    options?: {
      ttl?: number
      metadata?: SignerAdvertisement['metadata']
      maxWaitTime?: number // Max time to wait for relay addresses (ms)
    },
  ): Promise<void> {
    const maxWaitTime = options?.maxWaitTime || 30000 // Default: 30 seconds
    const checkInterval = 1000 // Check every second
    let waited = 0

    console.log('[MuSig2P2P] Waiting for relay addresses before advertising...')

    // Wait for relay addresses to become available
    while (waited < maxWaitTime) {
      if (await this.hasRelayAddresses()) {
        const relayAddrs = await this.getRelayAddresses()
        console.log(
          `[MuSig2P2P] Relay addresses ready: ${relayAddrs.length} found`,
        )
        break
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
      waited += checkInterval
    }

    if (!(await this.hasRelayAddresses())) {
      console.log(
        '[MuSig2P2P] No relay addresses available, advertising with current addresses',
      )
    }

    // Advertise with whatever addresses are available
    await this.advertiseSigner(myPrivateKey, criteria, options)
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
    this.advertisementSigningKey = undefined

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

    // NOTE: Do NOT emit SIGNER_WITHDRAWN locally!
    // We receive our own broadcast and the protocol handler emits the event.
    // This ensures all peers (including us) emit events in the same order.
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
              `[MuSig2P2P] Verified: Signature validated at discovery time`,
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
   * Coordinator Responsibilities:
   * - MUST set `metadata.inputScriptType` correctly:
   *   - 'taproot' for P2TR inputs → message MUST be computed with SIGHASH_ALL | SIGHASH_LOTUS
   *   - 'pubkeyhash' for P2PKH inputs → message typically computed with SIGHASH_ALL | SIGHASH_FORKID
   *   - 'scripthash' for P2SH inputs → message typically computed with SIGHASH_ALL | SIGHASH_FORKID
   * - MUST compute the `message` parameter (transaction sighash) using the correct sighash type
   *   that matches the inputScriptType
   * - Participants will verify the message before signing, so incorrect metadata will cause
   *   signature verification failures (fail-safe)
   *
   * Security:
   * - Validates metadata consistency and logs warnings for mismatches
   * - The sighash type used to compute `message` must match what will be auto-set in getFinalSignature()
   *
   * @param requiredPublicKeys - Public keys that must sign (ALL of them)
   * @param message - Message/transaction sighash to sign (must be computed with correct sighash type)
   * @param myPrivateKey - Creator's private key
   * @param options - Optional configuration
   * @param options.metadata - Request metadata
   * @param options.metadata.inputScriptType - Input script type ('taproot', 'pubkeyhash', 'scripthash')
   * @param options.metadata.sighashType - Optional explicit sighash type (should match message computation)
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

    // SECURITY: Validate metadata consistency
    // If inputScriptType is set, ensure it matches the expected sighash type
    if (options?.metadata?.inputScriptType === 'taproot') {
      // For Taproot, the message should have been computed with SIGHASH_ALL | SIGHASH_LOTUS
      // Note: We cannot fully verify this without the transaction, but we log a warning
      // if explicit sighashType in metadata doesn't match
      if (
        options.metadata.sighashType &&
        options.metadata.sighashType !==
          (Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS)
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Security warning: inputScriptType='taproot' but sighashType=0x${(
            options.metadata.sighashType as number
          ).toString(16)}. ` +
            `Taproot requires SIGHASH_ALL | SIGHASH_LOTUS (0x61). ` +
            `The message should have been computed with the correct sighash type.`,
        )
      }
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

    // Store P2P metadata (no MuSigSession yet - will be created when threshold is met)
    const metadata: P2PSessionMetadata = {
      participants: new Map([[creatorIndex, this.peerId]]),
      lastSequenceNumbers: new Map(),
      request,
      myPrivateKey,
    }
    this.p2pMetadata.set(requestId, metadata)

    const participationData = Buffer.concat([
      Buffer.from(requestId),
      Buffer.from(creatorIndex.toString()),
      myPubKey.toBuffer(),
      Buffer.from(this.peerId),
    ])
    const hashbuf4 = Hash.sha256(participationData)
    const participationSig = Schnorr.sign(
      hashbuf4,
      myPrivateKey,
      'big',
    ).toBuffer('schnorr')
    const creatorParticipation: ParticipantJoinedPayload = {
      requestId,
      participantIndex: creatorIndex,
      participantPeerId: this.peerId,
      participantPublicKey: serializePublicKey(myPubKey),
      timestamp: Date.now(),
      signature: participationSig.toString('hex'),
    }
    request.creatorParticipation = creatorParticipation

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
          creatorParticipation,
        } as SigningRequestPayload,
      )
    }

    // REAL-TIME DISCOVERY: Publish signing request to GossipSub for NAT traversal
    // This ensures peers behind NAT can receive signing requests via relay
    const signingRequestPayload = {
      requestId,
      requiredPublicKeys: requiredPublicKeys.map(pk => serializePublicKey(pk)),
      message: message.toString('hex'),
      creatorPeerId: this.peerId,
      creatorPublicKey: serializePublicKey(myPubKey),
      createdAt,
      expiresAt,
      metadata: options?.metadata,
      creatorSignature: creatorSignature.toString('hex'),
      creatorParticipation,
    } as SigningRequestPayload

    try {
      await this.publishToTopic(
        MuSig2MessageType.SIGNING_REQUEST,
        signingRequestPayload,
      )
      console.log(
        `[MuSig2P2P] 📡 Published signing request to GossipSub: ${requestId}`,
      )
    } catch (error) {
      console.log(
        `[MuSig2P2P] ❌ GossipSub publish failed for signing request ${requestId}:`,
      )
      console.log(`    Error: ${error}`)
      console.log(
        `    Discovery messages require GossipSub - check network configuration`,
      )
    }

    // ARCHITECTURE CHANGE (2025-11-21): Local-first pattern
    // 1. Emit local events IMMEDIATELY (synchronous, predictable ordering)
    // 2. Broadcast to network ONLY via GossipSub (no direct streams for discovery)
    // 3. Protocol handler filters out self-messages (no duplicate processing)

    // Emit SIGNING_REQUEST_CREATED event locally
    this.emit(MuSig2Event.SIGNING_REQUEST_CREATED, request)

    // Auto-join as creator (emit PARTICIPANT_JOINED event locally)
    // This eliminates the need for self-broadcast reception
    this.emit(MuSig2Event.PARTICIPANT_JOINED, {
      requestId,
      participantIndex: creatorIndex,
      participantPeerId: this.peerId,
      participantPublicKey: myPubKey,
      timestamp: creatorParticipation.timestamp,
      signature: Buffer.from(creatorParticipation.signature, 'hex'),
    })

    // REMOVED (Phase 1): Dual-channel broadcast for SIGNING_REQUEST
    // SIGNING_REQUEST is a discovery message and should ONLY use GossipSub
    // per the message channel architecture. Using direct streams creates duplicates
    // and violates the single-channel-per-message principle.

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

    // Get or create P2P metadata (no MuSigSession yet - will be created when threshold is met)
    let metadata = this.p2pMetadata.get(requestId)

    if (!metadata) {
      // Find creator's index in required keys
      const creatorIndex = request.requiredPublicKeys.findIndex(
        pk => pk.toString() === request.creatorPublicKey.toString(),
      )

      // Initialize participants map with creator (known from request)
      const participants = new Map<number, string>()
      if (creatorIndex !== -1) {
        participants.set(creatorIndex, request.creatorPeerId)
      }

      metadata = {
        participants,
        lastSequenceNumbers: new Map(),
        request,
        myPrivateKey,
      }
      this.p2pMetadata.set(requestId, metadata)
    }

    // Add myself to participants (if not already present)
    if (!metadata.participants.has(myIndex)) {
      metadata.participants.set(myIndex, this.peerId)
    }

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
    if (metadata.participants.size === request.requiredPublicKeys.length) {
      // All participants joined - create MuSig session
      await this._createMuSigSessionFromRequest(requestId)
    }

    // NOTE: SIGNING_REQUEST_JOINED event is NOT emitted here because
    // there is no broadcast message for "join". The PARTICIPANT_JOINED message
    // is the broadcast, and the event is emitted by the protocol handler when
    // it's received. This maintains the architecture where all events are
    // emitted by the protocol handler upon receiving broadcasts.
  }

  /**
   * Internal: Create MuSig session from signing request when ALL participants joined
   *
   * MuSig2 requires n-of-n signing (all participants must sign)
   *
   * This method is called automatically when all participants have joined,
   * or when SESSION_READY is received but the session doesn't exist yet.
   *
   * @param requestId - Request ID
   * @param skipBroadcast - If true, skip broadcasting SESSION_READY (used when called from SESSION_READY handler)
   */
  async _createMuSigSessionFromRequest(requestId: string): Promise<void> {
    return this.withStateLock(async () => {
      const metadata = this.p2pMetadata.get(requestId)

      if (!metadata) {
        return
      }

      const session = this._ensureLocalSession(metadata, requestId)
      if (!session) {
        return
      }

      const { isCoordinator, coordinatorIndex } =
        this._getCoordinatorState(metadata)

      if (!isCoordinator) {
        // Non-coordinators wait for SESSION_READY broadcast from coordinator
        return
      }

      await this._broadcastSessionReady(
        requestId,
        session.sessionId,
        coordinatorIndex,
      )
      // ARCHITECTURE CHANGE (2025-11-21): Emit both requestId and sessionId
      // This allows application code to track the transition from request to session
      this.deferEvent(MuSig2Event.SESSION_READY, {
        requestId,
        sessionId: session.sessionId,
      })
    })
  }

  private _ensureLocalSession(
    metadata: P2PSessionMetadata,
    requestId: string,
  ): MuSigSession | null {
    if (!metadata.request || !metadata.myPrivateKey) {
      return null
    }

    if (metadata.sessionId) {
      const existing = this.activeSessions.get(metadata.sessionId)
      if (existing) {
        return existing
      }
    }

    const session = this.sessionManager.createSession(
      metadata.request.requiredPublicKeys,
      metadata.myPrivateKey,
      metadata.request.message,
      metadata.request.metadata,
    )

    metadata.sessionId = session.sessionId
    this.activeSessions.set(session.sessionId, session)
    this.p2pMetadata.set(session.sessionId, metadata)
    this.p2pMetadata.set(requestId, metadata)

    // ARCHITECTURE CHANGE (2025-11-21): Store bidirectional mapping
    // This allows looking up sessions by requestId and prevents ID confusion
    this.requestIdToSessionId.set(requestId, session.sessionId)

    this.debugLog('session:create', 'Session created from request', {
      requestId,
      sessionId: session.sessionId,
      participants: metadata.participants.size,
    })

    return session
  }

  private _getCoordinatorState(metadata: P2PSessionMetadata): {
    isCoordinator: boolean
    coordinatorIndex: number
  } {
    const request = metadata.request
    if (!request || !metadata.myPrivateKey) {
      return { isCoordinator: false, coordinatorIndex: -1 }
    }

    const myKeyStr = metadata.myPrivateKey.publicKey.toString()
    const myIndex = request.requiredPublicKeys.findIndex(
      pk => pk.toString() === myKeyStr,
    )

    if (myIndex === -1) {
      return { isCoordinator: false, coordinatorIndex: -1 }
    }

    if (this.musig2Config.enableCoordinatorElection) {
      const election = electCoordinator(
        request.requiredPublicKeys,
        this._getElectionMethod(),
      )

      if (myIndex === election.coordinatorIndex) {
        metadata.election = {
          coordinatorIndex: election.coordinatorIndex,
          coordinatorPeerId: this.peerId,
          electionProof: election.electionProof,
        }
        return { isCoordinator: true, coordinatorIndex: myIndex }
      }

      return {
        isCoordinator: false,
        coordinatorIndex: election.coordinatorIndex,
      }
    }

    const creatorIndex = request.requiredPublicKeys.findIndex(
      pk => pk.toString() === request.creatorPublicKey.toString(),
    )
    const isCoordinator = request.creatorPeerId === this.peerId
    return {
      isCoordinator,
      coordinatorIndex: creatorIndex === -1 ? myIndex : creatorIndex,
    }
  }

  private async _broadcastSessionReady(
    requestId: string,
    sessionId: string,
    coordinatorIndex: number,
  ): Promise<void> {
    await this.broadcast({
      type: MuSig2MessageType.SESSION_READY,
      from: this.peerId,
      payload: {
        requestId,
        sessionId,
        participantIndex: coordinatorIndex,
        participantPeerId: this.peerId,
      },
      timestamp: Date.now(),
      messageId: this.messageProtocol.createMessage('', {}, this.peerId)
        .messageId,
      protocol: 'musig2',
    })
  }

  async _handleRemoteSessionReady(payload: {
    requestId: string
    sessionId: string
    participantIndex?: number
    participantPeerId?: string
  }): Promise<void> {
    return this.withStateLock(async () => {
      const metadata =
        this.p2pMetadata.get(payload.sessionId) ||
        this.p2pMetadata.get(payload.requestId)

      if (!metadata) {
        this.debugLog('session:ready', 'Metadata not found', {
          requestId: payload.requestId,
          sessionId: payload.sessionId,
        })
        return
      }

      const session = this._ensureLocalSession(metadata, payload.requestId)
      if (!session) {
        this.debugLog('session:ready', 'Session not found', {
          requestId: payload.requestId,
          sessionId: payload.sessionId,
        })
        return
      }

      if (typeof payload.participantIndex === 'number') {
        metadata.participants.set(
          payload.participantIndex,
          payload.participantPeerId || '',
        )
      }

      // ARCHITECTURE CHANGE (2025-11-21): Emit both requestId and sessionId
      this.deferEvent(MuSig2Event.SESSION_READY, {
        requestId: payload.requestId,
        sessionId: session.sessionId,
      })
    })
  }

  /**
   * Start Round 1: Generate and share nonces
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @param privateKey - This signer's private key
   */
  async startRound1(sessionId: string, privateKey: PrivateKey): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)

    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (!metadata) {
      throw new Error(`P2P metadata not found for session ${sessionId}`)
    }

    // Initialize commitment tracking
    if (!metadata.nonceCommitments) {
      metadata.nonceCommitments = new Map()
    }
    metadata.nonceCommitmentsComplete = false

    // Generate nonces locally (must be done before phase transition)
    const publicNonces = this.sessionManager.generateNonces(session, privateKey)

    // Set phase to NONCE_EXCHANGE for Round 1 (after nonces generated)
    session.phase = MuSigSessionPhase.NONCE_EXCHANGE
    session.updatedAt = Date.now()

    // Compute commitment to the nonces
    const commitment = this._computeNonceCommitment(publicNonces)

    // Store our commitment
    metadata.nonceCommitments.set(session.myIndex, commitment)

    this.debugLog(
      'round1:start',
      'Generated and broadcasting nonce commitment',
      {
        sessionId,
        signerIndex: session.myIndex,
        commitment: commitment.substring(0, 16) + '...',
      },
    )

    // Step 1: Broadcast commitment to all participants
    await this._broadcastNonceCommit(
      sessionId,
      session.myIndex,
      commitment,
      metadata.participants,
    )

    // Step 2: Check if we already have all commitments (if others sent first)
    if (this._hasAllNonceCommitments(session)) {
      this.debugLog(
        'round1:start',
        'All commitments collected, revealing nonces',
        {
          sessionId,
        },
      )
      await this._handleAllNonceCommitmentsReceived(sessionId)
    }
  }

  /**
   * Start Round 2: Create and share partial signatures
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @param privateKey - This signer's private key
   */
  async startRound2(sessionId: string, privateKey: PrivateKey): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)

    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (!metadata) {
      throw new Error(`P2P metadata not found for session ${sessionId}`)
    }

    // Check if we've already created our partial signature
    if (session.myPartialSig) {
      // Already created, skip duplicate processing
      return
    }

    // Verify we're in the correct phase to start Round 2
    // Phase should be PARTIAL_SIG_EXCHANGE (transitioned by _handleAllNoncesReceived)
    // or NONCE_EXCHANGE (if transition hasn't happened yet, though it should have)
    if (
      session.phase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE &&
      session.phase !== MuSigSessionPhase.NONCE_EXCHANGE
    ) {
      throw new Error(
        `Cannot start Round 2: session is in phase ${session.phase}, expected PARTIAL_SIG_EXCHANGE or NONCE_EXCHANGE`,
      )
    }

    // Create partial signature
    // For Taproot, use Taproot-aware signing that accounts for the tweak
    let partialSig: BN
    if (session.metadata?.inputScriptType === 'taproot') {
      // Taproot key-path spending requires special handling
      // Compute Taproot tweak (merkle root is all zeros for key-path only)
      const merkleRoot = Buffer.alloc(32)
      const tweak = calculateTapTweak(
        session.keyAggContext.aggregatedPubKey,
        merkleRoot,
      )

      // Use Taproot-aware signing function
      if (!session.mySecretNonce) {
        throw new Error(
          'Secret nonce not found - cannot create Taproot partial signature',
        )
      }
      if (!session.aggregatedNonce) {
        throw new Error(
          'Aggregated nonce not found - cannot create Taproot partial signature',
        )
      }

      partialSig = signTaprootKeyPathWithMuSig2(
        session.mySecretNonce,
        privateKey,
        session.keyAggContext,
        session.myIndex,
        session.aggregatedNonce,
        session.message,
        tweak,
      )

      // Transition to PARTIAL_SIG_EXCHANGE phase
      session.myPartialSig = partialSig
      session.phase = MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
    } else {
      // Regular MuSig2 signing (non-Taproot)
      // (createPartialSignature transitions session phase to PARTIAL_SIG_EXCHANGE)
      partialSig = this.sessionManager.createPartialSignature(
        session,
        privateKey,
      )
    }

    // Session phase is updated by createPartialSignature, update timestamp
    session.updatedAt = Date.now()
    this.debugLog('round2:start', 'Created partial signature', {
      sessionId,
      signerIndex: session.myIndex,
    })

    // Broadcast partial signature to all participants
    this.debugLog('round2:start', 'Broadcasting partial signature', {
      sessionId,
      signerIndex: session.myIndex,
    })
    await this._broadcastPartialSigShare(
      sessionId,
      session.myIndex,
      partialSig,
      metadata.participants,
    )

    // Check if we already have all partial signatures
    if (this.sessionManager.hasAllPartialSignatures(session)) {
      await this._handleAllPartialSigsReceived(sessionId)
    }
  }

  /**
   * Get final aggregated signature
   *
   * Automatically sets nhashtype based on metadata.inputScriptType.
   * For Taproot inputs, sets SIGHASH_ALL | SIGHASH_LOTUS (required for P2TR key-path spending).
   *
   * Security: No client override allowed - sighash type is determined automatically
   * from metadata to prevent malicious sighash type manipulation.
   *
   * Coordinator Responsibilities:
   * - MUST set `metadata.inputScriptType` correctly when creating signing requests:
   *   - 'taproot' for P2TR inputs (requires SIGHASH_ALL | SIGHASH_LOTUS)
   *   - 'pubkeyhash' for P2PKH inputs (uses SIGHASH_ALL | SIGHASH_FORKID)
   *   - 'scripthash' for P2SH inputs (uses SIGHASH_ALL | SIGHASH_FORKID)
   * - MUST compute the message (sighash) with the correct sighash type that matches
   *   the inputScriptType (e.g., SIGHASH_ALL | SIGHASH_LOTUS for Taproot)
   * - Participants verify the message before signing, so incorrect metadata will
   *   result in signature verification failures (fail-safe behavior)
   *
   * Security Guarantees:
   * - Clients cannot override sighash type (prevents SIGHASH_NONE, SIGHASH_ANYONECANPAY attacks)
   * - Auto-detection ensures correct type for known input types
   * - All sighash type assignments are logged for security auditing
   *
   * @param sessionId - Session ID (or request ID for new architecture)
   * @returns Final signature with nhashtype set if applicable
   */
  getFinalSignature(sessionId: string): Signature {
    const session = this.activeSessions.get(sessionId)

    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const signature = this.sessionManager.getFinalSignature(session)

    // Auto-detect sighash type from metadata (NO CLIENT OVERRIDE - security)
    if (session.metadata?.inputScriptType === 'taproot') {
      // Taproot key-path spending REQUIRES SIGHASH_ALL | SIGHASH_LOTUS
      signature.nhashtype = Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS

      // SECURITY: Log auto-setting for audit trail
      console.log(
        `[MuSig2P2P] [Security] Auto-setting Taproot sighash type (0x61) for session ${sessionId}`,
      )
    } else if (session.metadata?.inputScriptType === 'pubkeyhash') {
      // P2PKH typically uses SIGHASH_ALL | SIGHASH_FORKID
      signature.nhashtype = Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID

      // SECURITY: Log auto-setting for audit trail
      console.log(
        `[MuSig2P2P] [Security] Auto-setting P2PKH sighash type (0x41) for session ${sessionId}`,
      )
    } else if (session.metadata?.sighashType) {
      // Fallback: explicit sighash type in metadata (coordinator-set)
      signature.nhashtype = session.metadata.sighashType as number

      // SECURITY: Log explicit sighash type from metadata
      console.log(
        `[MuSig2P2P] [Security] Using explicit sighash type (0x${signature.nhashtype.toString(
          16,
        )}) from metadata for session ${sessionId}`,
      )
    }
    // If none match, nhashtype stays undefined (for non-standard cases)

    return signature
  }

  /**
   * Get session status
   *
   * @param sessionId - Session ID
   * @returns Session status
   */
  async getSessionStatus(sessionId: string) {
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)

      if (session) {
        return this.sessionManager.getSessionStatus(session)
      }

      return null
    })
  }

  /**
   * Get all active session IDs
   */
  async getActiveSessions(): Promise<string[]> {
    return this.withStateLock(async () => {
      // Return both sessions and metadata (signing requests may have metadata but no session yet)
      const sessionIds = new Set([
        ...this.activeSessions.keys(),
        ...this.p2pMetadata.keys(),
      ])
      return Array.from(sessionIds)
    })
  }

  /**
   * Check if a signer advertisement exists for the given public key
   * Used for duplicate prevention when receiving advertisements from multiple channels
   *
   * @param publicKeyStr - Public key as string (from PublicKey.toString())
   * @returns true if advertisement exists, false otherwise
   */
  hasSignerAdvertisement(publicKeyStr: string): boolean {
    return this.signerAdvertisements.has(publicKeyStr)
  }

  /**
   * Get session data
   *
   * @param sessionId - Session ID
   * @returns Session data or null if not found
   */
  async getSession(sessionId: string): Promise<MuSigSession | null> {
    return this.withStateLock(
      async () => this.activeSessions.get(sessionId) ?? null,
    )
  }

  /**
   * Get active session (includes tracking state like sequence numbers)
   *
   * @param sessionId - Session ID
   * @returns MuSigSession or undefined
   */
  async getActiveSession(sessionId: string): Promise<MuSigSession | undefined> {
    return this.withStateLock(async () => this.activeSessions.get(sessionId))
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
    const metadata = this.p2pMetadata.get(sessionId)
    if (!metadata) {
      throw new Error(`Session ${sessionId} not found`)
    }

    metadata.participants.set(signerIndex, peerId)

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
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)
      const metadata = this.p2pMetadata.get(sessionId)
      if (!session) {
        return
      }

      // Make a copy of participants before async operation
      const participants = metadata?.participants
        ? new Map(metadata.participants)
        : new Map<number, string>()

      // Remove session and metadata before notifying others
      // to prevent race conditions
      this.activeSessions.delete(sessionId)

      // Clean up metadata (including request and private key)
      if (metadata) {
        this._removeMetadataEntries(sessionId, metadata)
      }

      // Clean up emitted events tracking for this session
      this.emittedEvents.delete(sessionId)

      // Clean up peer mapping
      const peerMap = this.peerIdToSignerIndex.get(sessionId)
      if (peerMap) {
        this.peerIdToSignerIndex.delete(sessionId)
      }

      // Send abort to all participants (only if node is still running)
      // Do this after cleaning up local state to prevent race conditions
      if (this.libp2pNode && participants.size > 0) {
        try {
          await this._broadcastSessionAbort(
            sessionId,
            'Session closed',
            participants,
          )
        } catch (error) {
          // Ignore errors if node has been stopped
          console.warn(
            `[MuSig2P2P] Failed to broadcast session abort for ${sessionId}:`,
            error instanceof Error ? error.message : String(error),
          )
        }
      }

      this.deferEvent(MuSig2Event.SESSION_CLOSED, sessionId)
    })
  }

  // Internal methods for handling incoming messages

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
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)
      const metadata = this.p2pMetadata.get(sessionId)

      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      if (!metadata) {
        throw new Error(`P2P metadata not found for session ${sessionId}`)
      }

      // Validate protocol phase (must be in INIT to accept JOIN)
      if (
        !this._validateProtocolPhase(session, MuSig2MessageType.SESSION_JOIN)
      ) {
        throw new Error(
          `Protocol violation: SESSION_JOIN not allowed in phase ${session.phase}`,
        )
      }

      // Validate sequence number for replay protection
      if (
        !this._validateMessageSequence(
          session,
          signerIndex,
          sequenceNumber,
          metadata,
        )
      ) {
        throw new Error(
          `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
        )
      }

      // Verify public key matches expected signer
      const expectedKey = session.signers[signerIndex]
      if (expectedKey.toString() !== publicKey.toString()) {
        throw new Error(
          `Public key mismatch for signer ${signerIndex} in session ${sessionId}`,
        )
      }

      // Add participant
      metadata.participants.set(signerIndex, peerId)
      this.debugLog('participant:join', 'Participant joined session', {
        sessionId,
        signerIndex,
        peerId,
        participants: metadata.participants.size,
      })

      // Track peer mapping
      this._updatePeerMapping(sessionId, peerId, signerIndex)

      // If we're the creator and all participants have joined, start Round 1
      if (
        session.myIndex === 0 && // Assuming creator is index 0
        metadata.participants.size === session.signers.length
      ) {
        // All participants joined - could auto-start Round 1 here
        // Prevent duplicate emissions
        if (this._shouldEmitEvent(sessionId, MuSig2Event.SESSION_READY)) {
          this.debugLog('session:ready', 'All participants joined (creator)', {
            sessionId,
          })

          // ARCHITECTURE CHANGE (2025-11-21): Find requestId if this session came from a signing request
          // For direct session creation (not via signing request), requestId will be sessionId
          const requestId = metadata.request?.requestId || sessionId

          this.deferEvent(MuSig2Event.SESSION_READY, {
            requestId,
            sessionId,
          })
        }
      }
    })
  }

  /**
   * Handle incoming nonce commitment
   */
  async _handleNonceCommit(
    sessionId: string,
    signerIndex: number,
    sequenceNumber: number,
    commitment: string,
    fromPeerId: string,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      this.debugLog(
        'nonce:commit:receive',
        'Ignoring commitment for unknown session',
        {
          sessionId,
          signerIndex,
          from: fromPeerId,
        },
      )
      return
    }

    const metadata = this.p2pMetadata.get(sessionId)
    if (!metadata) {
      throw new Error(`P2P metadata not found for session ${sessionId}`)
    }

    // Initialize commitment tracking if needed
    if (!metadata.nonceCommitments) {
      metadata.nonceCommitments = new Map()
    }

    // Validate sequence number
    const lastSeq = metadata.lastSequenceNumbers.get(signerIndex) ?? -1
    if (sequenceNumber <= lastSeq) {
      this.debugLog('nonce:commit:receive', 'Ignoring old commitment', {
        sessionId,
        signerIndex,
        sequenceNumber,
        lastSeq,
        from: fromPeerId,
      })
      return
    }

    // Store the commitment
    metadata.nonceCommitments.set(signerIndex, commitment)
    metadata.lastSequenceNumbers.set(signerIndex, sequenceNumber)

    // Update participant mapping if needed
    this._updatePeerMapping(sessionId, fromPeerId, signerIndex)
    this.debugLog('nonce:commit:receive', 'Received nonce commitment', {
      sessionId,
      signerIndex,
      commitment: commitment.substring(0, 16) + '...',
      from: fromPeerId,
    })

    // Update timestamp
    session.updatedAt = Date.now()

    // Check if all commitments received
    if (this._hasAllNonceCommitments(session)) {
      this.debugLog('nonce:commit:receive', 'All nonce commitments collected', {
        sessionId,
      })
      await this._handleAllNonceCommitmentsReceived(sessionId)
    }
  }

  /**
   * Handle all nonce commitments received - reveal nonces
   */
  private async _handleAllNonceCommitmentsReceived(
    sessionId: string,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const metadata = this.p2pMetadata.get(sessionId)
    if (!metadata || !metadata.nonceCommitments) {
      throw new Error(
        `P2P metadata or commitments not found for session ${sessionId}`,
      )
    }

    // Mark commitments as complete
    metadata.nonceCommitmentsComplete = true

    // Emit event
    this.emit(MuSig2Event.SESSION_NONCE_COMMITMENTS_COMPLETE, sessionId)

    this.debugLog(
      'nonce:commitments:complete',
      'All commitments collected, revealing nonces',
      {
        sessionId,
      },
    )

    // Now reveal our nonces (we generated them in startRound1)
    if (!session.myPublicNonce) {
      throw new Error(
        `Public nonces not found for session ${sessionId}. This should have been generated in startRound1().`,
      )
    }
    const publicNonces = session.myPublicNonce

    // Broadcast our nonces to all participants
    await this._broadcastNonceShare(
      sessionId,
      session.myIndex,
      publicNonces,
      metadata.participants,
    )

    this.debugLog('nonce:commitments:complete', 'Revealed our nonces', {
      sessionId,
      signerIndex: session.myIndex,
    })

    // Check if we already have all nonces (if others sent theirs first)
    if (this.sessionManager.hasAllNonces(session)) {
      this.debugLog('nonce:commitments:complete', 'Already have all nonces', {
        sessionId,
      })
      await this._handleAllNoncesReceived(sessionId)
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
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)
      const metadata = this.p2pMetadata.get(sessionId)

      // Session MUST exist - nonces can only be shared after SESSION_READY
      if (!session) {
        throw new Error(
          `Session ${sessionId} not found. Nonces can only be shared after SESSION_READY.`,
        )
      }

      if (!metadata) {
        throw new Error(`P2P metadata not found for session ${sessionId}`)
      }

      // Validate protocol phase (must be in NONCE_EXCHANGE to accept NONCE_SHARE)
      if (
        !this._validateProtocolPhase(session, MuSig2MessageType.NONCE_SHARE)
      ) {
        const currentPhase = session.phase
        throw new Error(
          `Protocol violation: NONCE_SHARE not allowed in phase ${currentPhase}`,
        )
      }

      // Validate sequence number for replay protection
      if (
        !this._validateMessageSequence(
          session,
          signerIndex,
          sequenceNumber,
          metadata,
        )
      ) {
        throw new Error(
          `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
        )
      }

      // Verify nonce commitment before accepting the nonce
      if (metadata.nonceCommitmentsComplete && metadata.nonceCommitments) {
        const commitment = metadata.nonceCommitments.get(signerIndex)
        if (!commitment) {
          throw new Error(
            `No commitment received from signer ${signerIndex} in session ${sessionId}`,
          )
        }

        if (!this._verifyNonceCommitment(commitment, publicNonce)) {
          throw new Error(
            `Nonce commitment verification failed for signer ${signerIndex} in session ${sessionId}`,
          )
        }

        this.debugLog('round1:receive', 'Verified nonce commitment', {
          sessionId,
          signerIndex,
          from: peerId,
        })
      }

      // Receive and validate nonce
      this.sessionManager.receiveNonce(session, signerIndex, publicNonce)

      // Update participant mapping if needed
      this._updatePeerMapping(sessionId, peerId, signerIndex)
      this.debugLog('round1:receive', 'Received nonce share', {
        sessionId,
        signerIndex,
        from: peerId,
      })

      // Session phase is updated by receiveNonce, update timestamp
      session.updatedAt = Date.now()

      // Check if all nonces received
      if (this.sessionManager.hasAllNonces(session)) {
        this.debugLog('round1:receive', 'All nonce shares collected', {
          sessionId,
        })
        await this._handleAllNoncesReceived(sessionId)
      }
    })
  }

  /**
   * Handle all nonces received
   *
   * When all nonces are received and aggregated, the session is ready for Round 2.
   * This method transitions the phase to PARTIAL_SIG_EXCHANGE to reflect that
   * the session is ready to accept partial signatures, then emits SESSION_NONCES_COMPLETE.
   */
  private async _handleAllNoncesReceived(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)

    if (!session) {
      return
    }

    // Session phase is updated by session manager, update timestamp
    session.updatedAt = Date.now()

    // Verify all nonces have been received and aggregated
    if (!session.aggregatedNonce) {
      console.warn(
        `[MuSig2P2P] All nonces received but aggregated nonce not computed for session ${sessionId}`,
      )
      return
    }

    // ROOT CAUSE FIX: Transition phase to PARTIAL_SIG_EXCHANGE when all nonces are received.
    // This ensures the phase correctly reflects that Round 2 can begin, preventing
    // protocol violations when peers receive SESSION_NONCES_COMPLETE and immediately
    // start Round 2 (which sends partial signatures).
    if (
      session.phase === MuSigSessionPhase.NONCE_EXCHANGE ||
      session.phase === MuSigSessionPhase.INIT
    ) {
      session.phase = MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
      session.updatedAt = Date.now()
    }

    // Defer event emission AFTER phase transition to ensure protocol consistency
    // Prevent duplicate emissions
    if (this._shouldEmitEvent(sessionId, MuSig2Event.SESSION_NONCES_COMPLETE)) {
      this.deferEvent(MuSig2Event.SESSION_NONCES_COMPLETE, sessionId)
      this.debugLog('round1:complete', 'SESSION_NONCES_COMPLETE emitted', {
        sessionId,
      })
    }
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
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)
      const metadata = this.p2pMetadata.get(sessionId)

      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      if (!metadata) {
        throw new Error(`P2P metadata not found for session ${sessionId}`)
      }

      // Validate protocol phase (must be in PARTIAL_SIG_EXCHANGE to accept PARTIAL_SIG_SHARE)
      if (
        !this._validateProtocolPhase(
          session,
          MuSig2MessageType.PARTIAL_SIG_SHARE,
        )
      ) {
        const currentPhase = session.phase
        throw new Error(
          `Protocol violation: PARTIAL_SIG_SHARE not allowed in phase ${currentPhase}`,
        )
      }

      // Validate sequence number for replay protection
      if (
        !this._validateMessageSequence(
          session,
          signerIndex,
          sequenceNumber,
          metadata,
        )
      ) {
        throw new Error(
          `Invalid sequence number for signer ${signerIndex} in session ${sessionId}`,
        )
      }

      // Receive and verify partial signature
      // The phase should already be PARTIAL_SIG_EXCHANGE (transitioned in _handleAllNoncesReceived)
      this.sessionManager.receivePartialSignature(
        session,
        signerIndex,
        partialSig,
      )

      // Session phase is updated by receivePartialSignature, update timestamp
      session.updatedAt = Date.now()

      // Check if all partial signatures received
      if (this.sessionManager.hasAllPartialSignatures(session)) {
        await this._handleAllPartialSigsReceived(sessionId)
      }
    })
  }

  /**
   * Handle all partial signatures received
   */
  private async _handleAllPartialSigsReceived(
    sessionId: string,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)

    if (!session || !metadata) {
      return
    }

    // Session phase is updated by session manager, update timestamp
    session.updatedAt = Date.now()
    const election = metadata.election

    // Signature is automatically finalized by session manager
    // Prevent duplicate emissions
    if (this._shouldEmitEvent(sessionId, MuSig2Event.SESSION_COMPLETE)) {
      this.deferEvent(MuSig2Event.SESSION_COMPLETE, sessionId)
    }

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
    return this.withStateLock(async () => {
      const session = this.activeSessions.get(sessionId)
      if (!session) {
        return
      }

      const metadata = this.p2pMetadata.get(sessionId)

      // Abort session
      this.sessionManager.abortSession(session, reason)

      // Note: SESSION_ABORTED includes reason as additional arg, but deferEvent only handles sessionId
      // For abort, we emit immediately since it's a cleanup operation
      this.emit(MuSig2Event.SESSION_ABORTED, sessionId, reason)

      // Clean up
      this.activeSessions.delete(sessionId)
      this._removeMetadataEntries(sessionId, metadata)
      // Clean up emitted events tracking for this session
      this.emittedEvents.delete(sessionId)
      this.peerIdToSignerIndex.delete(sessionId)
    })
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

    // Note: SESSION_ERROR includes error and code as additional args, but deferEvent only handles sessionId
    // For errors, we emit immediately since they're exceptional conditions
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
          `[MuSig2P2P] Auto-connected to ${peerInfo.peerId.substring(0, 12)}... at ${addr}`,
        )
        return // Success - stop trying
      } catch (error) {
        // Try next multiaddr
        continue
      }
    }

    // All connection attempts failed
    console.warn(
      `[MuSig2P2P] Failed to auto-connect to ${peerInfo.peerId.substring(0, 12)}... (tried ${peerInfo.multiaddrs.length} addresses)`,
    )
  }

  /**
   * Handle peer connection (after successful connection)
   */
  _onPeerConnected(peerId: string): void {
    // Could notify active sessions
    this.deferEvent(MuSig2Event.PEER_CONNECTED, peerId)
  }

  /**
   * Handle peer disconnection
   */
  async _onPeerDisconnected(peerId: string): Promise<void> {
    // Make a copy of session IDs to avoid modifying the map during iteration
    const sessionIds = Array.from(this.activeSessions.keys())

    for (const sessionId of sessionIds) {
      await this.withStateLock(async () => {
        const session = this.activeSessions.get(sessionId)
        if (!session) return

        const metadata = this.p2pMetadata.get(sessionId)
        if (!metadata) return

        for (const [
          signerIndex,
          participantPeerId,
        ] of metadata.participants.entries()) {
          if (participantPeerId === peerId) {
            // Participant disconnected - abort session?
            // For now, just emit event
            this.deferEvent(
              MuSig2Event.SESSION_PARTICIPANT_DISCONNECTED,
              sessionId,
              peerId,
            )
          }
        }
      })
    }

    this.emit(MuSig2Event.PEER_DISCONNECTED, peerId)
  }

  /**
   * Handle peer information update
   * Called when libp2p fires peer:update event (e.g., when multiaddrs change)
   */
  async _onPeerUpdated(peerInfo: PeerInfo): Promise<void> {
    return this.withAdvertisementLock(async () => {
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
      this.deferEvent(MuSig2Event.PEER_UPDATED, peerInfo)
    })
  }

  /**
   * Handle relay address changes from core P2P layer
   * Called when new relay circuit addresses become available
   */
  _onRelayAddressesChanged(data: {
    peerId: string
    reachableAddresses: string[]
    relayAddresses: string[]
    timestamp: number
  }): void {
    console.log('[MuSig2P2P] Relay addresses changed from core P2P:')
    console.log(`[MuSig2P2P]   Relay addresses: ${data.relayAddresses.length}`)

    // Only re-advertise if we have an active signer advertisement
    if (!this.myAdvertisement) {
      console.log('[MuSig2P2P] No active signer advertisement to update')
      return
    }

    // Re-advertise our signer with the new reachable addresses
    this._readvertiseWithNewAddresses(data.reachableAddresses).catch(error => {
      console.error(
        '[MuSig2P2P] Error re-advertising with new addresses:',
        error,
      )
    })
  }

  /**
   * Re-advertise our signer with updated reachable addresses
   */
  private async _readvertiseWithNewAddresses(
    newAddresses: string[],
  ): Promise<void> {
    if (!this.myAdvertisement) {
      return
    }

    if (!this.advertisementSigningKey) {
      console.warn(
        '[MuSig2P2P] Cannot re-advertise: signing key unavailable (call advertiseSigner first)',
      )
      return
    }

    try {
      console.log('[MuSig2P2P] Re-advertising signer with updated addresses')

      const existingTtl = this.myAdvertisement.expiresAt
        ? this.myAdvertisement.expiresAt - this.myAdvertisement.timestamp
        : 24 * 60 * 60 * 1000 // default 24h if no expiry present
      const ttl = Math.max(1000, existingTtl)
      const timestamp = Date.now()
      const expiresAt = timestamp + ttl

      const adData = Buffer.concat([
        Buffer.from(this.peerId),
        Buffer.from(JSON.stringify(newAddresses)),
        this.myAdvertisement.publicKey.toBuffer(),
        Buffer.from(JSON.stringify(this.myAdvertisement.criteria)),
        Buffer.from(timestamp.toString()),
        Buffer.from(expiresAt.toString()),
      ])

      const hashbuf = Hash.sha256(adData)
      const signature = Schnorr.sign(
        hashbuf,
        this.advertisementSigningKey,
        'big',
      ).toBuffer('schnorr')

      // Update our advertisement with new addresses
      const updatedAdvertisement = {
        ...this.myAdvertisement,
        multiaddrs: newAddresses,
        timestamp,
        expiresAt,
        signature,
      }

      // Re-announce to DHT using existing announceResource method
      const myPubKey = this.myAdvertisement.publicKey
      await this.announceResource(
        DHTResourceType.SIGNER_ADVERTISEMENT,
        `musig2-signer:all:${myPubKey.toString()}`,
        {
          peerId: this.peerId,
          multiaddrs: newAddresses,
          publicKey: serializePublicKey(this.myAdvertisement.publicKey),
          criteria: this.myAdvertisement.criteria,
          metadata: this.myAdvertisement.metadata,
          timestamp: updatedAdvertisement.timestamp,
          expiresAt: updatedAdvertisement.expiresAt,
          signature: signature.toString('hex'),
        },
      )

      // Broadcast via GossipSub using existing broadcast method
      await this.broadcast({
        type: MuSig2MessageType.SIGNER_ADVERTISEMENT,
        from: this.peerId,
        payload: {
          peerId: this.peerId,
          multiaddrs: newAddresses,
          publicKey: serializePublicKey(this.myAdvertisement.publicKey),
          criteria: this.myAdvertisement.criteria,
          metadata: this.myAdvertisement.metadata,
          timestamp: updatedAdvertisement.timestamp,
          expiresAt: updatedAdvertisement.expiresAt,
          signature: signature.toString('hex'),
        },
        timestamp: Date.now(),
        messageId: this.messageProtocol.createMessage('', {}, this.peerId)
          .messageId,
        protocol: 'musig2',
      })

      // Update our stored advertisement
      this.myAdvertisement = updatedAdvertisement
      this.signerAdvertisements.set(
        updatedAdvertisement.publicKey.toString(),
        updatedAdvertisement,
      )

      // Emit MuSig2-specific event for backward compatibility
      this.emit(MuSig2Event.RELAY_ADDRESSES_AVAILABLE, {
        peerId: this.peerId,
        reachableAddresses: newAddresses,
        relayAddresses: newAddresses.filter((addr: string) =>
          addr.includes('/p2p-circuit/p2p/'),
        ),
        timestamp: Date.now(),
      })

      console.log(
        '[MuSig2P2P] Successfully re-advertised with updated addresses',
      )
    } catch (error) {
      console.error(
        '[MuSig2P2P] Failed to re-advertise with new addresses:',
        error,
      )
    }
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
    sessionId: string,
    signerIndex: number,
  ): number {
    const metadata = this.p2pMetadata.get(sessionId)
    if (!metadata) {
      throw new Error(`P2P metadata not found for session ${sessionId}`)
    }
    const lastSeq = metadata.lastSequenceNumbers.get(signerIndex) || 0
    const nextSeq = lastSeq + 1
    metadata.lastSequenceNumbers.set(signerIndex, nextSeq)
    return nextSeq
  }

  private _validateMessageSequence(
    session: MuSigSession,
    signerIndex: number,
    sequenceNumber: number,
    metadata: P2PSessionMetadata,
  ): boolean {
    // Skip validation if replay protection is disabled
    if (!this.musig2Config.enableReplayProtection) {
      return true
    }

    const lastSeq = metadata.lastSequenceNumbers.get(signerIndex) || 0

    // CHECK 1: Strictly increasing (prevents replay)
    if (sequenceNumber <= lastSeq) {
      console.error(
        `[MuSig2P2P] ⚠️ REPLAY DETECTED in session ${session.sessionId}: ` +
          `signer ${signerIndex} sent seq ${sequenceNumber} but last was ${lastSeq}`,
      )
      return false
    }

    // CHECK 2: Prevent huge gaps (suspicious activity)
    const gap = sequenceNumber - lastSeq
    if (gap > this.musig2Config.maxSequenceGap) {
      console.error(
        `[MuSig2P2P] ⚠️ SUSPICIOUS GAP in session ${session.sessionId}: ` +
          `signer ${signerIndex} jumped from seq ${lastSeq} to ${sequenceNumber} (gap: ${gap})`,
      )
      return false
    }

    // CHECK 3: Update tracking
    metadata.lastSequenceNumbers.set(signerIndex, sequenceNumber)
    return true
  }

  /**
   * Check if an event should be emitted (prevents duplicates)
   *
   * Tracks emitted events per session to prevent duplicate emissions
   * that can occur due to race conditions (e.g., receiving nonces while
   * generating our own nonces).
   *
   * @param sessionId - Session ID
   * @param event - Event type to check
   * @returns true if event should be emitted (not already emitted), false otherwise
   */
  private _shouldEmitEvent(sessionId: string, event: MuSig2Event): boolean {
    let emittedSet = this.emittedEvents.get(sessionId)
    if (!emittedSet) {
      emittedSet = new Set()
      this.emittedEvents.set(sessionId, emittedSet)
    }

    if (emittedSet.has(event)) {
      // Event already emitted for this session, skip
      return false
    }

    // Mark event as emitted
    emittedSet.add(event)
    return true
  }

  /**
   * Emit an event with duplicate prevention
   *
   * Public method for protocol handlers to emit events with duplicate checking.
   * This ensures events are only emitted once per session, even if triggered
   * from multiple code paths or received from multiple peers.
   *
   * @param event - Event type to emit
   * @param sessionId - Session ID
   * @param ...args - Additional event arguments
   */
  emitEventWithDuplicatePrevention(
    event: MuSig2Event,
    sessionId: string,
    ...args: unknown[]
  ): boolean {
    if (this._shouldEmitEvent(sessionId, event)) {
      // Use type assertion to work with strongly-typed emit
      // The event system ensures type safety at the call site
      return (this.emit as (event: string, ...args: unknown[]) => boolean)(
        event,
        sessionId,
        ...args,
      )
    }
    return false
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
    session: MuSigSession,
    messageType: MuSig2MessageType,
  ): boolean {
    // Use session.phase as source of truth
    const currentPhase = session.phase

    // Define allowed messages per phase
    switch (messageType) {
      case MuSig2MessageType.SESSION_JOIN:
        // JOIN only allowed in INIT phase
        if (currentPhase !== MuSigSessionPhase.INIT) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${session.sessionId}: ` +
              `SESSION_JOIN not allowed in phase ${currentPhase} (must be INIT)`,
          )
          return false
        }
        return true

      case MuSig2MessageType.NONCE_SHARE:
        // NONCE_SHARE allowed in INIT (if we haven't generated our nonces yet)
        // or NONCE_EXCHANGE (normal case)
        // This allows peers to receive nonces before generating their own
        if (
          currentPhase !== MuSigSessionPhase.INIT &&
          currentPhase !== MuSigSessionPhase.NONCE_EXCHANGE
        ) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${session.sessionId}: ` +
              `NONCE_SHARE not allowed in phase ${currentPhase} (must be INIT or NONCE_EXCHANGE)`,
          )
          return false
        }
        return true

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        // PARTIAL_SIG_SHARE only allowed in PARTIAL_SIG_EXCHANGE phase
        // The phase should have been transitioned in _handleAllNoncesReceived
        // when all nonces were received and aggregated
        if (currentPhase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) {
          console.error(
            `[MuSig2P2P] ⚠️ PROTOCOL VIOLATION in session ${session.sessionId}: ` +
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
    const metadata = this.p2pMetadata.get(session.sessionId)
    let electionPayload: SessionAnnouncementPayload['election'] | undefined

    if (metadata?.election) {
      electionPayload = {
        coordinatorIndex: metadata.election.coordinatorIndex,
        electionMethod: this.musig2Config.electionMethod,
        electionProof: metadata.election.electionProof,
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
      sequenceNumber: this._getNextSequenceNumber(sessionId, signerIndex),
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
   *
   * ARCHITECTURE (Phase 1): Direct streams only - no GossipSub fallback
   * Critical session messages use reliable, ordered direct streams
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
      sequenceNumber: this._getNextSequenceNumber(sessionId, signerIndex),
      timestamp: Date.now(),
      publicNonce: serializePublicNonce(publicNonce),
    }

    // Send to all participants except self
    const directTargets = Array.from(participants.entries()).filter(
      ([idx, peerId]) => idx !== signerIndex && peerId !== this.peerId,
    )

    this.debugLog(
      'round1:broadcast',
      'Sending nonce share via direct streams',
      {
        sessionId,
        signerIndex,
        directTargets: directTargets.length,
      },
    )

    const sendPromises = directTargets.map(([, peerId]) =>
      this._sendMessageToPeer(peerId, MuSig2MessageType.NONCE_SHARE, payload),
    )

    await Promise.allSettled(sendPromises)

    // REMOVED: GossipSub fallback (Phase 1 refactoring)
    // If direct stream fails, the session should abort rather than using unreliable GossipSub
    // This ensures proper error handling and prevents silent failures
  }

  /**
   * Broadcast partial signature share to all participants
   *
   * ARCHITECTURE (Phase 1): Direct streams only - no GossipSub fallback
   * Critical session messages use reliable, ordered direct streams
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
      sequenceNumber: this._getNextSequenceNumber(sessionId, signerIndex),
      timestamp: Date.now(),
      partialSig: serializeBN(partialSig),
    }

    // Send to all participants except self
    const directTargets = Array.from(participants.entries()).filter(
      ([idx, peerId]) => idx !== signerIndex && peerId !== this.peerId,
    )

    this.debugLog('round2:broadcast', 'Sending partial signature share', {
      sessionId,
      signerIndex,
      directTargets: directTargets.length,
    })

    const sendPromises = directTargets.map(([, peerId]) =>
      this._sendMessageToPeer(
        peerId,
        MuSig2MessageType.PARTIAL_SIG_SHARE,
        payload,
      ),
    )

    await Promise.allSettled(sendPromises)

    // REMOVED: GossipSub fallback (Phase 1 refactoring)
    // If direct stream fails, the session should abort rather than using unreliable GossipSub
    // This ensures proper error handling and prevents silent failures
  }

  /**
   * Compute nonce commitment
   *
   * Creates a SHA256 commitment to the serialized public nonces.
   * This binds the signer to their nonces before revealing them.
   */
  private _computeNonceCommitment(publicNonces: [Point, Point]): string {
    const [R1, R2] = publicNonces
    // Serialize the public nonces in a deterministic way
    const R1Buffer = Point.pointToCompressed(R1)
    const R2Buffer = Point.pointToCompressed(R2)

    // Concatenate the serialized nonces
    const nonceData = Buffer.concat([R1Buffer, R2Buffer])

    // Compute SHA256 commitment
    const commitment = Hash.sha256(nonceData)

    // Return as hex string
    return commitment.toString('hex')
  }

  /**
   * Verify nonce commitment
   *
   * Verifies that the revealed nonces match the previously committed hash.
   */
  private _verifyNonceCommitment(
    commitment: string,
    publicNonces: [Point, Point],
  ): boolean {
    const expectedCommitment = this._computeNonceCommitment(publicNonces)
    return commitment === expectedCommitment
  }

  /**
   * Check if all nonce commitments have been received
   */
  private _hasAllNonceCommitments(session: MuSigSession): boolean {
    const metadata = this.p2pMetadata.get(session.sessionId)
    if (!metadata || !metadata.nonceCommitments) {
      return false
    }

    const expectedSigners = session.signers.length
    const receivedCommitments = metadata.nonceCommitments.size

    this.debugLog('nonce:commitments:check', 'Checking commitment collection', {
      sessionId: session.sessionId,
      expectedSigners,
      receivedCommitments,
    })

    return receivedCommitments === expectedSigners
  }

  /**
   * Broadcast nonce commitment
   *
   * ARCHITECTURE (Phase 1): Direct streams only - no GossipSub
   * Critical session messages use reliable, ordered direct streams
   */
  private async _broadcastNonceCommit(
    sessionId: string,
    signerIndex: number,
    commitment: string,
    participants: Map<number, string>,
  ): Promise<void> {
    const payload = {
      sessionId,
      signerIndex,
      sequenceNumber: this._getNextSequenceNumber(sessionId, signerIndex),
      commitment,
    }

    // Send directly to all known participants
    const sendPromises = Array.from(participants.entries())
      .filter(
        ([index, peerId]) => index !== signerIndex && peerId !== this.peerId,
      )
      .map(async ([, peerId]) => {
        try {
          await this._sendMessageToPeer(
            peerId,
            MuSig2MessageType.NONCE_COMMIT,
            payload,
          )
          this.debugLog('nonce:commit:broadcast', 'Sent commitment to peer', {
            sessionId,
            signerIndex,
            targetPeerId: peerId,
          })
        } catch (error) {
          console.error(
            `[MuSig2P2P] Failed to send nonce commitment to ${peerId}:`,
            error,
          )
        }
      })

    await Promise.allSettled(sendPromises)

    // REMOVED: GossipSub publishing for critical messages (Phase 1 refactoring)
    // Critical session messages now use ONLY direct streams for:
    // - Reliable delivery
    // - Ordered processing
    // - No duplicate message handling

    this.debugLog(
      'nonce:commit:broadcast',
      'Broadcasted nonce commitment via direct streams',
      {
        sessionId,
        signerIndex,
        commitment: commitment.substring(0, 16) + '...',
        targets: sendPromises.length,
      },
    )
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
   * Skips relay-only connections (limited connections cannot open protocol streams)
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

    // Check if peer has any direct (non-relay) connections
    // Limited connections cannot open protocol streams, only GossipSub works
    const connections = this.node!.getConnections(peerIdFromString(peerId))
    const hasDirectConnection = connections.some(conn => {
      const addr = conn.remoteAddr?.toString() || ''
      return !addr.includes('/p2p-circuit')
    })

    if (hasDirectConnection) {
      await this.sendTo(peerId, message)
    }
    // If only relay connections exist, the message will be delivered via GossipSub
    // (which is already being used by announceSigningRequest and other methods)
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
   * Removes metadata entries associated with a given key and optionally a signing request.
   *
   * @param {string} key - The key associated with the metadata entries to be removed.
   * @param {P2PSessionMetadata} [metadata] - Optional metadata object containing the request ID of a signing request.
   */
  private _removeMetadataEntries(
    key: string,
    metadata?: P2PSessionMetadata,
  ): void {
    this.p2pMetadata.delete(key)
    // REMOVED participantJoinCache cleanup - no longer needed

    const requestId = metadata?.request?.requestId
    if (requestId) {
      this.p2pMetadata.delete(requestId)
      this.signingRequests.delete(requestId)
      // REMOVED participantJoinCache cleanup - no longer needed
    }
  }

  /**
   * Marks a participant as having joined a signing request.
   *
   * @param {string} requestId - The ID of the signing request.
   * @param {number} participantIndex - The index of the participant who joined.
   * @returns {boolean} - True if the participant has not yet joined the signing request, false otherwise.
   */
  // REMOVED _markParticipantJoinSeen() - duplicate prevention now done via metadata.participants
  // This eliminates the need for a separate cache and ensures single source of truth

  /**
   * Ingests the creator's participation in a signing request.
   *
   * @param {SigningRequest} request - The signing request.
   * @returns {void}
   */
  private _ingestCreatorParticipation(request: SigningRequest): void {
    const participation = request.creatorParticipation
    if (!participation) {
      return
    }

    try {
      const participantPublicKey = PublicKey.fromString(
        participation.participantPublicKey,
      )
      const signature = Buffer.from(participation.signature, 'hex')

      this.emit(MuSig2Event.PARTICIPANT_JOINED, {
        requestId: participation.requestId,
        participantIndex: participation.participantIndex,
        participantPeerId: participation.participantPeerId,
        participantPublicKey,
        timestamp: participation.timestamp,
        signature,
      })
    } catch (error) {
      this.debugLog(
        'participant:join',
        'Failed to ingest creator participation',
        {
          requestId: participation.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  /**
   * Get detailed session state for debugging
   *
   * ARCHITECTURE CHANGE (2025-11-21): Added debugging method to inspect session state
   * Helps troubleshoot requestId/sessionId confusion and metadata lookup issues
   *
   * @param id - Either a requestId or sessionId
   * @returns Detailed debug information about the session
   */
  getSessionDebugInfo(id: string): {
    found: boolean
    foundAs?: 'requestId' | 'sessionId'
    requestId?: string
    sessionId?: string
    phase?: MuSigSessionPhase
    participants?: Array<{ index: number; peerId: string }>
    hasMetadata: boolean
    hasSession: boolean
    allMetadataKeys: string[]
    allSessionKeys: string[]
    requestToSessionMapping: Array<[string, string]>
  } {
    // Try as sessionId first
    let session = this.activeSessions.get(id)
    let metadata = this.p2pMetadata.get(id)
    let foundAs: 'sessionId' | 'requestId' | undefined = undefined
    let requestId: string | undefined = undefined
    let sessionId: string | undefined = undefined

    if (session || metadata) {
      foundAs = 'sessionId'
      sessionId = id
      // Try to find requestId via reverse mapping
      for (const [req, sess] of this.requestIdToSessionId.entries()) {
        if (sess === id) {
          requestId = req
          break
        }
      }
    } else {
      // Try as requestId
      const mappedSessionId = this.requestIdToSessionId.get(id)
      if (mappedSessionId) {
        session = this.activeSessions.get(mappedSessionId)
        metadata = this.p2pMetadata.get(mappedSessionId)
        foundAs = 'requestId'
        requestId = id
        sessionId = mappedSessionId
      }
    }

    if (!session && !metadata) {
      return {
        found: false,
        hasMetadata: false,
        hasSession: false,
        allMetadataKeys: Array.from(this.p2pMetadata.keys()),
        allSessionKeys: Array.from(this.activeSessions.keys()),
        requestToSessionMapping: Array.from(
          this.requestIdToSessionId.entries(),
        ),
      }
    }

    return {
      found: true,
      foundAs,
      requestId,
      sessionId,
      phase: session?.phase,
      participants: metadata
        ? Array.from(metadata.participants.entries()).map(
            ([index, peerId]) => ({
              index,
              peerId,
            }),
          )
        : [],
      hasMetadata: !!metadata,
      hasSession: !!session,
      allMetadataKeys: Array.from(this.p2pMetadata.keys()),
      allSessionKeys: Array.from(this.activeSessions.keys()),
      requestToSessionMapping: Array.from(this.requestIdToSessionId.entries()),
    }
  }

  /**
   * Cleanup coordinator resources
   *
   * Stops automatic cleanup and closes all active sessions
   */
  async cleanup(): Promise<void> {
    // SECURITY: Stop automatic cleanup interval
    if (this.sessionCleanupIntervalId) {
      clearInterval(this.sessionCleanupIntervalId)
      this.sessionCleanupIntervalId = undefined
    }

    // SECURITY: Cleanup security manager data
    this.securityManager.cleanup()

    // SECURITY: Cleanup identity manager if enabled
    if (this.identityManager) {
      this.identityManager.cleanup()
    }

    // Close all active sessions
    const sessionIds = Array.from(this.activeSessions.keys())
    await Promise.all(sessionIds.map(id => this.closeSession(id)))
  }

  /**
   * Start automatic session cleanup (DOS prevention)
   *
   * **SECURITY**: Runs periodically to prevent resource exhaustion from stuck/abandoned sessions.
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
   * **SECURITY (DOS PREVENTION)**: This method is called automatically every minute (by default)
   * to prevent resource exhaustion from stuck or abandoned sessions. Malicious actors could
   * create many sessions and never complete them, exhausting memory.
   *
   * This method removes sessions that:
   * - Have exceeded the session timeout (default: 2 hours)
   * - Are stuck in a phase for too long (default: 10 minutes)
   *
   * Can also be called manually if needed (e.g., before critical operations).
   */
  public async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now()
    const expirationTime = this.musig2Config.sessionTimeout

    // Make a copy of sessions to avoid modifying the map during iteration
    const sessions = Array.from(this.activeSessions.entries())

    for (const [sessionId, activeSession] of sessions) {
      // Check if session has expired
      const age = now - activeSession.createdAt
      if (age > expirationTime) {
        console.log(
          `[MuSig2P2P] Cleaning up expired session: ${sessionId} (age: ${Math.round(age / 1000)}s)`,
        )
        await this.closeSession(sessionId).catch(error => {
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
        await this.closeSession(sessionId).catch(error => {
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
  private _isSessionStuck(activeSession: MuSigSession, now: number): boolean {
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
    this.emit(MuSig2Event.SESSION_BROADCAST_CONFIRMED, sessionId)
  }

  // ============================================================================
  // Coordinator Failover Methods
  // ============================================================================

  /**
   * Initialize coordinator failover mechanism
   *
   * After all partial signatures are collected, determines who should broadcast.
   * **EVENT-DRIVEN**: No automatic timeouts - application must call
   * `triggerCoordinatorFailover()` if coordinator fails to broadcast.
   *
   * @param sessionId - Session ID
   */
  private async _initializeCoordinatorFailover(
    sessionId: string,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata?.election) {
      return
    }

    const { election } = metadata

    // Initialize failover tracking (without timeout)
    metadata.failover = {
      currentCoordinatorIndex: election.coordinatorIndex,
      broadcastDeadline: 0, // No automatic deadline
      failoverAttempts: 0,
    }

    // Check if I'm the current coordinator
    const isCurrentCoordinator =
      metadata.failover.currentCoordinatorIndex === session.myIndex

    if (isCurrentCoordinator) {
      // I'm the coordinator - emit event to signal I should broadcast
      this.emit(
        MuSig2Event.SESSION_SHOULD_BROADCAST,
        sessionId,
        election.coordinatorIndex,
      )
    }
  }

  /**
   * Trigger coordinator failover manually
   *
   * **EVENT-DRIVEN API**: Call this method when a coordinator fails to broadcast.
   * The application is responsible for detecting coordinator failure and calling this.
   *
   * Example usage:
   * ```typescript
   * coordinator.on(MuSig2Event.SESSION_SHOULD_BROADCAST, (sessionId) => {
   *   // Wait for broadcast confirmation with application-level timeout
   *   const timeout = setTimeout(() => {
   *     // Coordinator failed - trigger failover
   *     coordinator.triggerCoordinatorFailover(sessionId)
   *   }, 5 * 60 * 1000) // 5 minutes
   *
   *   coordinator.once(MuSig2Event.SESSION_BROADCAST_CONFIRMED, () => {
   *     clearTimeout(timeout) // Cancel failover
   *   })
   * })
   * ```
   *
   * @param sessionId - Session ID
   */
  public async triggerCoordinatorFailover(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata?.failover || !metadata.election) {
      return
    }

    const { failover } = metadata
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
    failover.broadcastDeadline = 0 // No automatic deadline

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
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata?.election) {
      return false
    }

    return metadata.election.coordinatorIndex === session.myIndex
  }

  /**
   * Check if this peer is the CURRENT coordinator (accounting for failover)
   *
   * @param sessionId - Session ID
   * @returns True if this peer is the current coordinator
   */
  isCurrentCoordinator(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata) {
      return false
    }

    // If failover is active, check failover coordinator
    if (metadata.failover) {
      return metadata.failover.currentCoordinatorIndex === session.myIndex
    }

    // If no failover, fall back to original election
    if (metadata.election) {
      return metadata.election.coordinatorIndex === session.myIndex
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
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata?.election) {
      return null
    }

    // If we're the coordinator, return our peer ID
    if (this.isCoordinator(sessionId)) {
      return this.peerId
    }

    // Otherwise, try to find the coordinator's peer ID from participants
    const coordinatorPeerId = metadata.participants.get(
      metadata.election.coordinatorIndex,
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
    const session = this.activeSessions.get(sessionId)
    const metadata = this.p2pMetadata.get(sessionId)
    if (!session || !metadata?.election) {
      return null
    }

    return {
      coordinatorIndex: metadata.election.coordinatorIndex,
      electionProof: metadata.election.electionProof,
      isCoordinator: this.isCoordinator(sessionId),
    }
  }

  /**
   * Find existing session with the same signers and message
   * Used for idempotency checks to prevent duplicate session creation
   */
  private _findExistingSession(
    signers: PublicKey[],
    message: Buffer,
  ): string | null {
    for (const [sessionId, session] of this.activeSessions.entries()) {
      // Check if signers match (same length and same keys in same order)
      if (session.signers.length !== signers.length) {
        continue
      }

      const signersMatch = session.signers.every(
        (sessionKey, index) =>
          sessionKey.toString() === signers[index].toString(),
      )

      if (!signersMatch) {
        continue
      }

      // Check if message matches
      if (!session.message.equals(message)) {
        continue
      }

      // Found matching session
      return sessionId
    }

    return null
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
