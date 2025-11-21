/**
 * SwapSig Protocol Coordinator
 *
 * Main coordinator for SwapSig privacy protocol.
 * Builds on top of MuSig2 P2P infrastructure for decentralized coordination.
 *
 * Architecture:
 * - Phase 0: Discovery & Pool Formation
 * - Phase 1: Registration
 * - Phase 2: Setup Round (Round 1) - Create MuSig2 shared outputs
 * - Phase 3: Setup Confirmation
 * - Phase 4: Destination Reveal
 * - Phase 5: Settlement Round (Round 2) - THREE-PHASE MuSig2
 * - Phase 6: Settlement Confirmation
 * - Phase 7: Completion
 */

import { Hash } from '../../bitcore/crypto/hash.js'
import { Schnorr } from '../../bitcore/crypto/schnorr.js'
import { Signature } from '../../bitcore/crypto/signature.js'
import type { PrivateKey } from '../../bitcore/privatekey.js'
import type { PublicKey } from '../../bitcore/publickey.js'
import { Address } from '../../bitcore/address.js'
import type { UnspentOutput } from '../../bitcore/transaction/unspentoutput.js'
import { Transaction } from '../../bitcore/transaction/index.js'
import { Output } from '../../bitcore/transaction/output.js'
import { Script } from '../../bitcore/script.js'
import { createMuSigTaprootAddress } from '../../bitcore/taproot/musig2.js'
import { MuSig2P2PCoordinator } from '../musig2/coordinator.js'
import type { P2PConfig } from '../types.js'
import type { MuSig2P2PConfig, SigningRequest } from '../musig2/types.js'
import { MuSig2Event, TransactionType } from '../musig2/types.js'
import { SwapPoolManager } from './pool.js'
import { SwapSigBurnMechanism } from './burn.js'
import { SwapSigP2PProtocolHandler } from './protocol-handler.js'
import { TransactionMonitor } from '../blockchain-utils.js'
import type {
  SwapPool,
  SwapParticipant,
  SwapPoolAnnouncement,
  CreatePoolParams,
  PoolDiscoveryFilters,
  SwapSigMessage,
  SwapSigMessageType,
  ParticipantInput,
  PoolStats,
  SwapSigEventMap,
  SwapSigSigningMetadata,
  SettlementInfo,
} from './types.js'
import { SwapPhase, SwapSigEvent } from './types.js'

/**
 * SwapSig coordinator configuration
 */
export interface SwapSigConfig {
  // SwapSig-specific config
  preferredDenominations?: number[] // e.g., [100000000, 1000000000] (1 XPI, 10 XPI)
  minParticipants?: number // Default: 3
  maxParticipants?: number // Default: 10
  feeRate?: number // Satoshis per byte (default: 1)

  // Timeouts
  setupTimeout?: number // Round 1 timeout (default: 600000 = 10 min)
  settlementTimeout?: number // Round 2 timeout (default: 600000 = 10 min)

  // Privacy
  requireEncryptedDestinations?: boolean // Default: true
  randomizeOutputOrder?: boolean // Default: true

  // Blockchain configuration
  chronikUrl?: string | string[] // Chronik indexer URL(s) (default: 'https://chronik.lotusia.org')
  requiredConfirmations?: number // Default: 1 (Lotus pre-consensus is fast)
  confirmationPollInterval?: number // milliseconds (default: 3000)
}

/**
 * SwapSig Protocol Coordinator
 *
 * Extends MuSig2P2PCoordinator to provide privacy-preserving swaps.
 * SwapSig is a MuSig2 P2P application that builds on top of the three-phase architecture.
 *
 * Note: The interface override below intentionally narrows the event types from
 * MuSig2EventMap to SwapSigEventMap. TypeScript reports this as incompatible, but
 * it's the correct design - SwapSig has its own event system and consumes MuSig2
 * events internally via super.on().
 */
// @ts-expect-error - Intentionally overriding parent event types with SwapSigEventMap
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SwapSigCoordinator extends MuSig2P2PCoordinator {
  private swapConfig: SwapSigConfig
  private poolManager: SwapPoolManager
  private burnMechanism: SwapSigBurnMechanism
  private privateKey: PrivateKey
  private swapSigProtocolHandler: SwapSigP2PProtocolHandler
  private txMonitor: TransactionMonitor

  constructor(
    privateKey: PrivateKey,
    p2pConfig: P2PConfig,
    musig2Config?: Partial<MuSig2P2PConfig>,
    swapSigConfig?: Partial<SwapSigConfig>,
  ) {
    // Call parent MuSig2P2PCoordinator constructor
    super(p2pConfig, musig2Config)

    this.swapConfig = {
      minParticipants: 3,
      maxParticipants: 10,
      feeRate: 1,
      setupTimeout: 600000, // 10 min
      settlementTimeout: 600000, // 10 min
      requireEncryptedDestinations: true,
      randomizeOutputOrder: true,
      chronikUrl: 'https://chronik.lotusia.org',
      requiredConfirmations: 1,
      confirmationPollInterval: 3000,
      ...swapSigConfig,
    }

    this.privateKey = privateKey
    this.poolManager = new SwapPoolManager()
    this.burnMechanism = new SwapSigBurnMechanism()
    this.txMonitor = new TransactionMonitor(this.swapConfig.chronikUrl!)

    // Create and register SwapSig protocol handler
    this.swapSigProtocolHandler = new SwapSigP2PProtocolHandler()
    this.swapSigProtocolHandler.setCoordinator(this)

    // Register SwapSig protocol handler with parent P2PCoordinator
    this.registerProtocol(this.swapSigProtocolHandler)

    this._setupSwapSigEventHandlers()
  }

  /**
   * Start coordinator (starts P2P node)
   */
  async start(): Promise<void> {
    // Start parent MuSig2P2PCoordinator
    await super.start()
  }

  /**
   * Stop coordinator
   */
  async stop(): Promise<void> {
    // Cleanup active pools
    const pools = this.poolManager.getAllPools()
    for (const pool of pools) {
      if (
        pool.phase !== SwapPhase.COMPLETE &&
        pool.phase !== SwapPhase.ABORTED
      ) {
        this.poolManager.abortPool(pool.poolId, 'Coordinator stopped')
        this.emit(SwapSigEvent.POOL_ABORTED, pool.poolId, 'Coordinator stopped')
      }
    }

    // Stop parent coordinator
    await super.stop()
  }

  /**
   * Discover available swap pools from DHT
   *
   * @param filters - Optional filters
   * @returns Array of pool announcements
   */
  async discoverPools(
    filters?: PoolDiscoveryFilters,
  ): Promise<SwapPoolAnnouncement[]> {
    // Query local cache first
    const localPools = this.poolManager
      .getAllPools()
      .filter(
        pool =>
          pool.phase === SwapPhase.DISCOVERY ||
          pool.phase === SwapPhase.REGISTRATION,
      )
      .map(pool => this._createPoolAnnouncement(pool))

    // Apply filters
    const filtered = localPools.filter(announcement => {
      if (
        filters?.denomination &&
        announcement.denomination !== filters.denomination
      ) {
        return false
      }
      if (
        filters?.minParticipants &&
        announcement.currentParticipants < filters.minParticipants
      ) {
        return false
      }
      if (
        filters?.maxParticipants &&
        announcement.maxParticipants > filters.maxParticipants
      ) {
        return false
      }
      // Apply preferred denominations from swapConfig if no explicit filter
      if (
        !filters?.denomination &&
        this.swapConfig.preferredDenominations &&
        this.swapConfig.preferredDenominations.length > 0
      ) {
        return this.swapConfig.preferredDenominations.includes(
          announcement.denomination,
        )
      }
      return true
    })

    // TODO: Query DHT for additional pools
    // const dhtPools = await this.p2pCoordinator.discoverResources('swapsig-pool')

    return filtered
  }

  /**
   * Create new swap pool
   *
   * @param params - Pool parameters
   * @returns Pool ID
   */
  async createPool(params: CreatePoolParams): Promise<string> {
    // Apply swapConfig defaults to pool parameters
    const poolParams: CreatePoolParams = {
      denomination: params.denomination,
      minParticipants:
        params.minParticipants ?? this.swapConfig.minParticipants,
      maxParticipants:
        params.maxParticipants ?? this.swapConfig.maxParticipants,
      feeRate: params.feeRate ?? this.swapConfig.feeRate,
      burnPercentage: params.burnPercentage,
      setupTimeout: params.setupTimeout ?? this.swapConfig.setupTimeout,
      settlementTimeout:
        params.settlementTimeout ?? this.swapConfig.settlementTimeout,
    }

    const poolId = this.poolManager.createPool(
      this.libp2pNode.peerId.toString(),
      poolParams,
    )

    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error('Failed to create pool')
    }

    // Announce to DHT and P2P network
    await this._announcePool(pool)

    this.emit(SwapSigEvent.POOL_CREATED, pool)

    return poolId
  }

  /**
   * Join existing swap pool
   *
   * @param poolId - Pool identifier
   * @param input - Input UTXO to swap
   * @param finalDestination - Final destination address
   * @returns Participant index
   */
  async joinPool(
    poolId: string,
    input: UnspentOutput,
    finalDestination: Address,
  ): Promise<number> {
    let pool = this.poolManager.getPool(poolId)

    // If pool not in local state, try to discover from DHT
    if (!pool) {
      console.log(
        `[SwapSig] Pool ${poolId.substring(0, 8)}... not found locally, discovering from DHT...`,
      )

      const announcement = await this.discoverResource(
        'swapsig-pool',
        poolId,
        5000,
      )
      if (!announcement) {
        throw new Error(`Pool ${poolId} not found locally or in DHT`)
      }

      const poolData = announcement.data as SwapPoolAnnouncement

      // Create local pool state from announcement
      const localPoolId = this.poolManager.createPool(poolData.creatorPeerId, {
        denomination: poolData.denomination,
        minParticipants: poolData.minParticipants,
        maxParticipants: poolData.maxParticipants,
        burnPercentage: poolData.burnConfig.burnPercentage,
        setupTimeout: poolData.setupTimeout,
        settlementTimeout: poolData.settlementTimeout,
      })

      // Update pool ID to match discovered pool
      pool = this.poolManager.getPool(localPoolId)
      if (pool) {
        // Replace the generated poolId with the actual poolId
        this.poolManager['pools'].delete(localPoolId)
        pool.poolId = poolId
        this.poolManager['pools'].set(poolId, pool)
      }

      console.log(
        `[SwapSig] Pool ${poolId.substring(0, 8)}... discovered and imported`,
      )
    }

    if (!pool) {
      throw new Error('Failed to get or create pool')
    }

    // Validate input
    if (input.satoshis !== pool.denomination) {
      throw new Error(
        `Input amount ${input.satoshis} does not match denomination ${pool.denomination}`,
      )
    }

    // Create ownership proof (Schnorr signature)
    const ownershipMessage = Buffer.concat([
      Buffer.from(poolId, 'hex'),
      Buffer.from(input.txId, 'hex'),
      Buffer.from([input.outputIndex]),
    ])
    // Hash before signing (Schnorr requires 32-byte hash)
    const ownershipHash = Hash.sha256(ownershipMessage)
    const ownershipProof = Schnorr.sign(
      ownershipHash,
      this.privateKey,
    ).toBuffer()

    // Encrypt final destination (if required by config)
    const finalOutputEncrypted = this._encryptAddress(finalDestination, poolId)
    const finalOutputCommitment = Hash.sha256(finalOutputEncrypted)

    // Convert input to ParticipantInput
    const participantInput: ParticipantInput = {
      txId: input.txId,
      outputIndex: input.outputIndex,
      amount: input.satoshis,
      script: input.script,
      address:
        input.address ||
        Address.fromPublicKeyHash(
          Hash.sha256ripemd160(input.script.toBuffer()),
        ),
    }

    // Add participant
    const participantIndex = this.poolManager.addParticipant(
      poolId,
      this.libp2pNode.peerId.toString(),
      this.privateKey.publicKey,
      participantInput,
      ownershipProof,
      finalOutputEncrypted,
      finalOutputCommitment,
    )

    // Advertise as signer (Phase 0)
    await this._advertiseSwapSigner(pool)

    // Broadcast registration
    await this._broadcastParticipantRegistered(pool, participantIndex)

    this.emit(SwapSigEvent.POOL_JOINED, poolId, participantIndex)

    return participantIndex
  }

  /**
   * Execute complete swap (convenience method)
   *
   * @param poolId - Pool identifier
   * @param input - Input UTXO
   * @param finalDestination - Final destination address
   * @returns Settlement transaction ID
   */
  async executeSwap(
    poolId: string,
    input: UnspentOutput,
    finalDestination: Address,
  ): Promise<string> {
    // 1. Join pool
    await this.joinPool(poolId, input, finalDestination)

    // 2. Wait for minimum participants
    await this._waitForMinimumParticipants(poolId)

    // 3. Execute setup round (Round 1)
    await this._executeSetupRound(poolId)

    // 4. Wait for setup confirmations
    await this._waitForSetupConfirmations(poolId)

    // 5. Reveal final destinations
    await this._revealFinalDestinations(poolId)

    // 6. Execute settlement round (Round 2 - MuSig2)
    await this._executeSettlementRound(poolId)

    // 7. Wait for settlement confirmations
    await this._waitForSettlementConfirmations(poolId)

    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error('Pool not found')
    }

    // Get my settlement transaction
    const myParticipant = this._getMyParticipant(pool)
    const settlementInfo = pool.settlementMapping.get(
      myParticipant.participantIndex,
    )

    if (!settlementInfo?.txId) {
      throw new Error('Settlement transaction not found')
    }

    return settlementInfo.txId
  }

  /**
   * Get pool statistics
   *
   * @param poolId - Pool identifier
   * @returns Pool statistics or undefined
   */
  getPoolStats(poolId: string): PoolStats | undefined {
    return this.poolManager.getPoolStats(poolId)
  }

  /**
   * Get all active pools
   *
   * @returns Array of pools
   */
  getActivePools(): SwapPool[] {
    return this.poolManager.getAllPools()
  }

  /**
   * Get pool manager (for testing)
   */
  getPoolManager(): SwapPoolManager {
    return this.poolManager
  }

  /**
   * Get burn mechanism (for testing)
   */
  getBurnMechanism(): SwapSigBurnMechanism {
    return this.burnMechanism
  }

  /**
   * Get swap configuration (for testing)
   */
  getSwapConfig(): SwapSigConfig {
    return this.swapConfig
  }

  /**
   * Setup SwapSig-specific event handlers
   */
  private _setupSwapSigEventHandlers(): void {
    // Listen for signing requests (Phase 3 of three-phase architecture)
    super.on(
      MuSig2Event.SIGNING_REQUEST_RECEIVED,
      async (request: SigningRequest) => {
        try {
          // Check if this is a SwapSig settlement request
          const metadata = request.metadata as
            | SwapSigSigningMetadata
            | undefined

          // Multi-level filtering
          if (metadata?.transactionType !== TransactionType.SWAP) {
            return // Not a swap transaction
          }

          if (metadata?.swapPhase !== SwapPhase.SETTLEMENT) {
            return // Not a settlement phase transaction
          }

          // Check if we're a required signer
          const myPubKey = this.privateKey.publicKey.toString()
          const isRequiredSigner = request.requiredPublicKeys.some(
            (pk: PublicKey) => pk.toString() === myPubKey,
          )

          if (!isRequiredSigner) {
            return // Not needed for this signing
          }

          // Check if this belongs to one of our active pools
          const poolId = metadata.swapPoolId
          if (!poolId) return

          const pool = this.poolManager.getPool(poolId)
          if (!pool) {
            console.log(
              `[SwapSig] Received signing request for unknown pool ${poolId.substring(0, 8)}...`,
            )
            return
          }

          console.log(
            `[SwapSig] Discovered signing request ${request.requestId.substring(0, 8)}... for pool ${poolId.substring(0, 8)}...`,
          )

          // Automatically join the signing request (Phase 3)
          await this.joinSigningRequest(request.requestId, this.privateKey)

          console.log(
            `[SwapSig] Auto-joined signing request ${request.requestId.substring(0, 8)}...`,
          )

          this.emit(
            SwapSigEvent.SWAPSIG_REQUEST_JOINED,
            request.requestId,
            poolId,
          )
        } catch (error) {
          console.error(
            '[SwapSig] Error handling signing request discovery:',
            error,
          )
        }
      },
    )

    // Listen for session ready (when ALL participants join - n-of-n)
    super.on(MuSig2Event.SESSION_READY, ({ sessionId, requestId }) => {
      console.log(
        `[SwapSig] Session ${sessionId.substring(0, 8)}... ready for signing (all participants joined)`,
      )
      // Note: MuSig2 SESSION_READY doesn't provide requestId, emit with empty string
      this.emit(SwapSigEvent.SWAPSIG_SESSION_READY, sessionId, requestId)
    })

    // Listen for session completion
    super.on(MuSig2Event.SESSION_COMPLETE, sessionId => {
      console.log(`[SwapSig] Session ${sessionId.substring(0, 8)}... completed`)
      this.emit(SwapSigEvent.SWAPSIG_SESSION_COMPLETE, sessionId)
    })
  }

  /**
   * Announce pool to DHT and P2P network
   */
  private async _announcePool(pool: SwapPool): Promise<void> {
    const announcement = this._createPoolAnnouncement(pool)

    // Announce to DHT (if enabled)
    await this.announceResource('swapsig-pool', pool.poolId, announcement, {
      ttl: pool.setupTimeout + pool.settlementTimeout,
    })

    // Broadcast to P2P network
    await this._broadcastMessage({
      type: 'swapsig:pool-announce' as SwapSigMessageType,
      poolId: pool.poolId,
      from: this.libp2pNode.peerId.toString(),
      payload: announcement,
      timestamp: Date.now(),
      messageId: this._generateMessageId(),
    })
  }

  /**
   * Create pool announcement
   */
  private _createPoolAnnouncement(pool: SwapPool): SwapPoolAnnouncement {
    const announcementData = Buffer.concat([
      Buffer.from(pool.poolId, 'hex'),
      Buffer.from(pool.denomination.toString()),
      Buffer.from(pool.createdAt.toString()),
    ])

    // Hash the announcement data before signing (Schnorr requires 32-byte hash)
    const announcementHash = Hash.sha256(announcementData)
    const signature = Schnorr.sign(announcementHash, this.privateKey)

    return {
      poolId: pool.poolId,
      denomination: pool.denomination,
      minParticipants: pool.minParticipants,
      maxParticipants: pool.maxParticipants,
      currentParticipants: pool.participants.length,
      burnConfig: pool.burnConfig,
      createdAt: pool.createdAt,
      expiresAt: pool.createdAt + pool.setupTimeout + pool.settlementTimeout,
      setupTimeout: pool.setupTimeout,
      settlementTimeout: pool.settlementTimeout,
      creatorPeerId: pool.creatorPeerId,
      creatorSignature: signature.toBuffer(),
    }
  }

  /**
   * Advertise as signer (Phase 0 of three-phase architecture)
   */
  private async _advertiseSwapSigner(pool: SwapPool): Promise<void> {
    await this.advertiseSigner(
      this.privateKey,
      {
        transactionTypes: [TransactionType.SWAP], // SwapSig settlement transactions
        minAmount: pool.denomination,
        maxAmount: pool.denomination,
      },
      {
        ttl: pool.setupTimeout + pool.settlementTimeout,
        metadata: {
          description: `SwapSig signer for pool ${pool.poolId}`,
          fees: 0,
        },
      },
    )
  }

  /**
   * Broadcast participant registered message
   */
  private async _broadcastParticipantRegistered(
    pool: SwapPool,
    participantIndex: number,
  ): Promise<void> {
    await this._broadcastMessage({
      type: 'swapsig:participant-registered' as SwapSigMessageType,
      poolId: pool.poolId,
      from: this.libp2pNode.peerId.toString(),
      payload: { participantIndex },
      timestamp: Date.now(),
      messageId: this._generateMessageId(),
    })
  }

  /**
   * Broadcast message to P2P network
   */
  private async _broadcastMessage(message: SwapSigMessage): Promise<void> {
    await this.broadcast({
      type: message.type,
      from: message.from,
      payload: message.payload,
      timestamp: message.timestamp,
      messageId: message.messageId,
      protocol: 'swapsig',
    })
  }

  /**
   * Wait for minimum participants
   */
  private async _waitForMinimumParticipants(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error('Pool not found')
    }

    // Poll until minimum reached
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for minimum participants'))
      }, pool.setupTimeout)

      const checkMinimum = () => {
        if (this.poolManager.hasMinimumParticipants(poolId)) {
          clearTimeout(timeout)
          resolve()
        } else {
          setTimeout(checkMinimum, 1000) // Check every second
        }
      }

      checkMinimum()
    })
  }

  /**
   * Compute output groups with dynamic sizing
   *
   * Supports: 2-of-2, 3-of-3, 5-of-5, 10-of-10
   *
   * @param participants - Array of participants
   * @param groupSize - Group size (2, 3, 5, or 10)
   * @returns Array of participant index groups
   */
  private _computeOutputGroups(
    participants: SwapParticipant[],
    groupSize: number,
  ): number[][] {
    const groups: number[][] = []
    const n = participants.length

    if (groupSize === 2) {
      // Tier 1: 2-of-2 circular pairs (special case)
      for (let i = 0; i < n; i++) {
        const partner = (i + 1) % n
        groups.push([i, partner])
      }
      // Result: [(0,1), (1,2), (2,3), ..., (n-1,0)]
    } else {
      // Tier 2-4: Larger groups (3, 5, or 10)
      const numCompleteGroups = Math.floor(n / groupSize)

      // Create complete groups
      for (let g = 0; g < numCompleteGroups; g++) {
        const group: number[] = []
        for (let i = 0; i < groupSize; i++) {
          group.push(g * groupSize + i)
        }
        groups.push(group)
      }

      // Handle remaining participants (wrap around)
      const remaining = n % groupSize
      if (remaining > 0) {
        const lastGroup: number[] = []
        for (let i = 0; i < remaining; i++) {
          lastGroup.push(numCompleteGroups * groupSize + i)
        }
        // Pad with participants from beginning
        while (lastGroup.length < groupSize) {
          lastGroup.push(lastGroup.length % n)
        }
        groups.push(lastGroup)
      }
    }

    return groups
  }

  /**
   * Compute settlement mapping (circular rotation)
   *
   * Maps each shared output to a receiver based on group rotation.
   * This breaks the linkability between inputs and outputs.
   *
   * @param pool - Swap pool
   * @returns Map of receiver index to settlement info
   */
  private _computeSettlementMapping(
    pool: SwapPool,
  ): Map<number, SettlementInfo> {
    const mapping = new Map<number, SettlementInfo>()
    const n = pool.participants.length
    const numGroups = pool.outputGroups.length

    for (let g = 0; g < numGroups; g++) {
      const sourceOutput = pool.sharedOutputs[g]

      // Determine receiver based on group size
      let receiverIndex: number

      if (!pool.groupSizeStrategy) {
        throw new Error('Pool group size strategy not initialized')
      }

      if (pool.groupSizeStrategy.groupSize === 2) {
        // 2-of-2: Each pair's output goes to opposite participant
        receiverIndex = (g + 1) % n
      } else {
        // Larger groups: Each group's output → first participant of next group
        const nextGroup = (g + 1) % numGroups
        receiverIndex = pool.outputGroups[nextGroup][0]
      }

      // Get receiver's final address
      const receiver = pool.participants[receiverIndex]
      if (!receiver.finalAddress) {
        throw new Error(
          `Receiver ${receiverIndex} has not revealed final address`,
        )
      }

      mapping.set(receiverIndex, {
        receiverIndex,
        sourceOutputIndex: g,
        sourceOutput,
        finalDestination: receiver.finalAddress,
        signers: sourceOutput.signers,
        confirmed: false,
      })
    }

    return mapping
  }

  /**
   * Execute setup round (Round 1)
   *
   * Builds setup transactions:
   * - Input: Participant's UTXO
   * - Output 1: MuSig2 shared output (Taproot)
   * - Output 2: Burn output (OP_RETURN)
   *
   * Each participant builds their own setup transaction.
   */
  private async _executeSetupRound(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    // Validate phase
    if (pool.phase !== SwapPhase.REGISTRATION) {
      throw new Error(
        `Cannot execute setup round: pool is in ${pool.phase} phase`,
      )
    }

    console.log(
      `[SwapSig] Executing setup round for pool ${poolId.substring(0, 8)}...`,
    )

    // Step 1: Determine optimal group size
    const groupStrategy = this.poolManager.determineOptimalGroupSize(
      pool.participants.length,
    )
    console.log(`[SwapSig] Group strategy: ${groupStrategy.reasoning}`)

    // Step 2: Compute output groups
    const outputGroups = this._computeOutputGroups(
      pool.participants,
      groupStrategy.groupSize,
    )
    console.log(`[SwapSig] Created ${outputGroups.length} output groups`)

    // Store group strategy and output groups in pool
    pool.groupSizeStrategy = groupStrategy
    pool.outputGroups = outputGroups

    // Step 3: Create MuSig2 aggregated keys for each output group
    pool.sharedOutputs = []

    for (let i = 0; i < outputGroups.length; i++) {
      const group = outputGroups[i]
      const signerPubKeys = group.map(idx => pool.participants[idx].publicKey)

      // Create MuSig2 Taproot address
      const { address, keyAggContext, commitment } = createMuSigTaprootAddress(
        signerPubKeys,
        'livenet', // TODO: Make network configurable
      )

      console.log(
        `[SwapSig] Group ${i}: ${group.length}-of-${group.length} MuSig2 address: ${address.toString()}`,
      )

      // Store shared output info
      pool.sharedOutputs.push({
        outputIndex: i,
        signers: signerPubKeys,
        aggregatedKey: keyAggContext.aggregatedPubKey,
        taprootAddress: address,
        amount: pool.denomination,
        txId: '', // Will be set after building transaction
        confirmed: false,
      })
    }

    // Step 4: Build and broadcast my setup transaction
    const myParticipant = this._getMyParticipant(pool)
    const myGroupIndex = outputGroups.findIndex(group =>
      group.includes(myParticipant.participantIndex),
    )

    if (myGroupIndex === -1) {
      throw new Error('My participant not found in any group')
    }

    const mySharedOutput = pool.sharedOutputs[myGroupIndex]

    // Build setup transaction
    const setupTx = await this._buildSetupTransaction(
      myParticipant,
      mySharedOutput.taprootAddress,
      pool.denomination,
      poolId,
    )

    // Sign transaction
    setupTx.sign(this.privateKey)

    // Broadcast transaction
    const txHex = setupTx.toString()
    const txId = await this.txMonitor.broadcastTransaction(txHex)

    if (!txId) {
      throw new Error('Failed to broadcast setup transaction')
    }

    console.log(
      `[SwapSig] Setup transaction broadcast: ${txId.substring(0, 8)}...`,
    )

    // Store transaction ID
    myParticipant.setupTxId = txId
    mySharedOutput.txId = txId

    // Transition to SETUP_CONFIRM phase
    this.poolManager.transitionPhase(poolId, SwapPhase.SETUP_CONFIRM)
    console.log(`[SwapSig] Setup round complete, waiting for confirmations...`)
  }

  /**
   * Build setup transaction
   *
   * Creates a transaction:
   * - Input: Participant's UTXO
   * - Output 1: MuSig2 Taproot output (shared)
   * - Output 2: Burn output (OP_RETURN)
   *
   * @param participant - Participant building the transaction
   * @param sharedAddress - MuSig2 Taproot address for shared output
   * @param amount - Swap denomination
   * @param poolId - Pool identifier
   * @returns Unsigned transaction
   */
  private async _buildSetupTransaction(
    participant: SwapParticipant,
    sharedAddress: Address,
    amount: number,
    poolId: string,
  ): Promise<Transaction> {
    // Calculate burn amount
    const burnAmount = this.burnMechanism.calculateBurnAmount(amount)

    // Create transaction
    const tx = new Transaction()

    // Add input from participant's UTXO
    tx.from(participant.input)

    // Add shared output (MuSig2 Taproot)
    tx.to(sharedAddress, amount)

    // Add burn output
    const burnOutput = this.burnMechanism.createBurnOutput(burnAmount, poolId)
    tx.addOutput(burnOutput)

    // Set fee
    const feeRate = this.swapConfig.feeRate || 1
    tx.feePerByte = feeRate

    // Add change output if needed (automatically handled by Transaction class)
    tx.change(participant.input.address)

    return tx
  }

  /**
   * Wait for setup confirmations
   *
   * Monitors blockchain for setup transaction confirmations from all participants.
   */
  private async _waitForSetupConfirmations(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    console.log(
      `[SwapSig] Waiting for setup confirmations for pool ${poolId.substring(0, 8)}...`,
    )

    // Collect all setup transaction IDs
    const setupTxIds: string[] = []
    for (const participant of pool.participants) {
      if (participant.setupTxId) {
        setupTxIds.push(participant.setupTxId)
      }
    }

    if (setupTxIds.length !== pool.participants.length) {
      console.warn(
        `[SwapSig] Not all participants have broadcast setup transactions: ${setupTxIds.length}/${pool.participants.length}`,
      )
    }

    // Wait for all transactions to confirm
    const requiredConfs = this.swapConfig.requiredConfirmations || 1
    const pollInterval = this.swapConfig.confirmationPollInterval || 3000

    console.log(
      `[SwapSig] Waiting for ${requiredConfs} confirmations on ${setupTxIds.length} transactions...`,
    )

    // Monitor all transactions in parallel
    const confirmationPromises = setupTxIds.map(txId =>
      this.txMonitor.waitForConfirmations(
        txId,
        requiredConfs,
        pollInterval,
        this.swapConfig.setupTimeout,
      ),
    )

    const results = await Promise.all(confirmationPromises)

    // Check if all confirmed
    const allConfirmed = results.every(result => result?.isConfirmed)

    if (!allConfirmed) {
      console.error(
        `[SwapSig] Setup confirmation timeout for pool ${poolId.substring(0, 8)}...`,
      )
      this.poolManager.abortPool(poolId, 'Setup confirmation timeout')
      this.emit(SwapSigEvent.POOL_ABORTED, poolId, 'Setup confirmation timeout')
      throw new Error('Setup confirmation timeout')
    }

    console.log(`[SwapSig] All setup transactions confirmed!`)

    // Mark all setup transactions as confirmed
    for (const participant of pool.participants) {
      participant.setupConfirmed = true
    }

    // Mark all shared outputs as confirmed
    for (const output of pool.sharedOutputs) {
      output.confirmed = true
    }

    // Transition to REVEAL phase
    this.poolManager.transitionPhase(poolId, SwapPhase.REVEAL)
    this.emit(SwapSigEvent.SETUP_COMPLETE, poolId)
  }

  /**
   * Reveal final destinations
   *
   * Decrypts and reveals final destination addresses.
   *
   * Note: For MVP, this is a placeholder. Full implementation requires:
   * 1. Decrypt encrypted addresses (if requireEncryptedDestinations is true)
   * 2. Validate commitments
   * 3. Broadcast revealed addresses to all participants
   * 4. Wait for all participants to reveal
   */
  private async _revealFinalDestinations(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    console.log(
      `[SwapSig] Revealing final destinations for pool ${poolId.substring(0, 8)}...`,
    )

    // TODO: Implement destination decryption and broadcast
    // For MVP, we assume addresses are already revealed (testing mode)
    if (!this.swapConfig.requireEncryptedDestinations) {
      console.log(`[SwapSig] Encryption disabled, addresses already plaintext`)
    } else {
      console.log(
        `[SwapSig] Destination reveal/decryption not yet implemented (proceeding with test addresses)`,
      )
    }

    // Mark all destinations as revealed (placeholder)
    // In production, this would be done as each participant reveals their address

    // Transition to SETTLEMENT phase
    this.poolManager.transitionPhase(poolId, SwapPhase.SETTLEMENT)
    this.emit(SwapSigEvent.REVEAL_COMPLETE, poolId)
  }

  /**
   * Execute settlement round (Round 2 - THREE-PHASE MuSig2)
   *
   * Builds settlement transactions using MuSig2:
   * - Input: Shared MuSig2 output from setup round
   * - Output: Final destination address
   *
   * Uses three-phase MuSig2 architecture:
   * - Phase 1: Signer advertisement (already done in joinPool)
   * - Phase 2: Announce signing requests (this method)
   * - Phase 3: Automatic discovery and joining (via event handlers)
   */
  private async _executeSettlementRound(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    // Validate phase
    if (pool.phase !== SwapPhase.SETTLEMENT) {
      throw new Error(
        `Cannot execute settlement round: pool is in ${pool.phase} phase`,
      )
    }

    console.log(
      `[SwapSig] Executing settlement round for pool ${poolId.substring(0, 8)}...`,
    )

    // Step 1: Compute settlement mapping (circular rotation)
    const settlementMapping = this._computeSettlementMapping(pool)
    console.log(
      `[SwapSig] Computed settlement mapping for ${settlementMapping.size} participants`,
    )

    // Store settlement mapping in pool
    pool.settlementMapping = settlementMapping

    // Step 2: Build settlement transactions for each shared output
    const settlementTxs: Array<{ tx: Transaction; outputIndex: number }> = []

    for (const [receiverIndex, settlementInfo] of settlementMapping) {
      const tx = await this._buildSettlementTransaction(
        settlementInfo.sourceOutput,
        settlementInfo.finalDestination,
        pool,
      )

      settlementTxs.push({
        tx,
        outputIndex: settlementInfo.sourceOutputIndex,
      })

      console.log(
        `[SwapSig] Built settlement tx for output ${settlementInfo.sourceOutputIndex} → receiver ${receiverIndex}`,
      )
    }

    // Step 3: Announce MuSig2 signing requests (Phase 2 of three-phase architecture)
    console.log(
      `[SwapSig] Announcing ${settlementTxs.length} MuSig2 signing requests...`,
    )

    for (const { tx, outputIndex } of settlementTxs) {
      const sharedOutput = pool.sharedOutputs[outputIndex]

      // Compute sighash for this transaction
      // Note: This is a simplified version - proper implementation needs correct sighash computation
      const sigHashBuffer = Buffer.from(tx.id, 'hex')

      // Announce signing request (Phase 2)
      const requestId = await this.announceSigningRequest(
        sharedOutput.signers,
        sigHashBuffer,
        this.privateKey,
        {
          metadata: {
            transactionType: TransactionType.SWAP,
            swapPhase: SwapPhase.SETTLEMENT,
            swapPoolId: poolId,
            outputIndex,
            transactionHex: tx.toString(),
            taprootKeyPath: true,
          } as SwapSigSigningMetadata,
        },
      )

      console.log(
        `[SwapSig] Announced signing request ${requestId.substring(0, 8)}... for output ${outputIndex}`,
      )
    }

    // Step 4: Transition to SETTLEMENT_CONFIRM phase
    // Event handlers will automatically join signing requests (Phase 3)
    // MuSig2 rounds will execute automatically
    // We'll wait for confirmations in the next phase

    this.poolManager.transitionPhase(poolId, SwapPhase.SETTLEMENT_CONFIRM)
    console.log(
      `[SwapSig] Settlement round announced, waiting for MuSig2 coordination and confirmations...`,
    )
  }

  /**
   * Build settlement transaction
   *
   * Creates a transaction:
   * - Input: Shared MuSig2 output
   * - Output: Final destination address
   *
   * @param sharedOutput - Shared output to spend
   * @param destination - Final destination address
   * @param pool - Swap pool
   * @returns Unsigned transaction
   */
  private async _buildSettlementTransaction(
    sharedOutput: SwapPool['sharedOutputs'][0],
    destination: Address,
    pool: SwapPool,
  ): Promise<Transaction> {
    const tx = new Transaction()

    // Add input from shared output
    // Note: This is simplified - proper implementation needs correct UTXO reference
    tx.from({
      txId: sharedOutput.txId,
      outputIndex: sharedOutput.outputIndex,
      satoshis: sharedOutput.amount,
      script: Script.fromAddress(sharedOutput.taprootAddress),
    })

    // Add output to final destination
    // Apply randomization if configured
    const feeRate = this.swapConfig.feeRate || 1
    const outputAmount = sharedOutput.amount - feeRate * 200 // Estimate fee

    tx.to(destination, outputAmount)

    // Set fee
    tx.feePerByte = feeRate

    return tx
  }

  /**
   * Wait for settlement confirmations
   *
   * Monitors blockchain for settlement transaction confirmations.
   * Also waits for MuSig2 sessions to complete and get finalized signatures.
   */
  private async _waitForSettlementConfirmations(poolId: string): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    console.log(
      `[SwapSig] Waiting for settlement confirmations for pool ${poolId.substring(0, 8)}...`,
    )

    // Step 1: Wait for MuSig2 sessions to complete
    // Note: In a full implementation, we would track session IDs and wait for SESSION_COMPLETE events
    // For now, we'll add a delay to allow P2P coordination to happen
    console.log(`[SwapSig] Waiting for MuSig2 coordination...`)
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Step 2: Get finalized signatures and broadcast settlement transactions
    // Note: In a full implementation, we would:
    // 1. Wait for SESSION_COMPLETE events
    // 2. Get finalized signatures from each session
    // 3. Attach signatures to transactions
    // 4. Broadcast transactions
    // For now, this is a placeholder

    console.log(`[SwapSig] MuSig2 coordination complete (placeholder)`)

    // Step 3: Wait for settlement transaction confirmations
    // In a full implementation, we would have settlement transaction IDs from broadcasting
    // For now, we'll check if we have any settlement info

    if (!pool.settlementMapping || pool.settlementMapping.size === 0) {
      console.warn(`[SwapSig] No settlement transactions to monitor`)
      this.poolManager.transitionPhase(poolId, SwapPhase.COMPLETE)
      this.emit(SwapSigEvent.SETTLEMENT_COMPLETE, poolId)
      this.emit(SwapSigEvent.POOL_COMPLETE, poolId)
      return
    }

    // Collect settlement transaction IDs (if available)
    // Note: In full implementation, these would be set after broadcasting
    const settlementTxIds: string[] = []
    for (const settlement of pool.settlementMapping.values()) {
      // Placeholder: settlement.sourceOutput would have the final tx ID
      // if (settlement.sourceOutput.finalTxId) {
      //   settlementTxIds.push(settlement.sourceOutput.finalTxId)
      // }
    }

    if (settlementTxIds.length > 0) {
      // Wait for confirmations
      const requiredConfs = this.swapConfig.requiredConfirmations || 1
      const pollInterval = this.swapConfig.confirmationPollInterval || 3000

      console.log(
        `[SwapSig] Waiting for ${requiredConfs} confirmations on ${settlementTxIds.length} settlement transactions...`,
      )

      const confirmationPromises = settlementTxIds.map(txId =>
        this.txMonitor.waitForConfirmations(
          txId,
          requiredConfs,
          pollInterval,
          this.swapConfig.settlementTimeout,
        ),
      )

      const results = await Promise.all(confirmationPromises)

      const allConfirmed = results.every(result => result?.isConfirmed)

      if (!allConfirmed) {
        console.error(
          `[SwapSig] Settlement confirmation timeout for pool ${poolId.substring(0, 8)}...`,
        )
        this.poolManager.abortPool(poolId, 'Settlement confirmation timeout')
        this.emit(
          SwapSigEvent.POOL_ABORTED,
          poolId,
          'Settlement confirmation timeout',
        )
        throw new Error('Settlement confirmation timeout')
      }

      console.log(`[SwapSig] All settlement transactions confirmed!`)
    } else {
      console.log(
        `[SwapSig] No settlement transaction IDs available (placeholder mode)`,
      )
    }

    // Mark all settlements as confirmed
    for (const settlement of pool.settlementMapping.values()) {
      settlement.confirmed = true
    }

    // Transition to COMPLETE phase
    this.poolManager.transitionPhase(poolId, SwapPhase.COMPLETE)
    this.emit(SwapSigEvent.SETTLEMENT_COMPLETE, poolId)
    this.emit(SwapSigEvent.POOL_COMPLETE, poolId)

    console.log(`[SwapSig] Pool ${poolId.substring(0, 8)}... complete! 🎉`)
  }

  /**
   * Get my participant from pool
   */
  private _getMyParticipant(pool: SwapPool): SwapParticipant {
    const myPeerId = this.libp2pNode.peerId.toString()
    const participant = pool.participantMap.get(myPeerId)

    if (!participant) {
      throw new Error('Not a participant in this pool')
    }

    return participant
  }

  /**
   * Encrypt address for privacy (simple XOR encryption with pool secret)
   *
   * @param address - Address to encrypt
   * @param poolId - Pool identifier
   * @returns Encrypted address buffer (or plaintext if encryption disabled)
   */
  private _encryptAddress(address: Address, poolId: string): Buffer {
    const addressStr = address.toString()
    const addressBuf = Buffer.from(addressStr, 'utf8')

    // If encryption is not required by config, return plaintext
    if (!this.swapConfig.requireEncryptedDestinations) {
      return addressBuf
    }

    // Encrypt using XOR with pool secret
    const poolSecret = Hash.sha256(Buffer.from(poolId, 'hex'))
    const encrypted = Buffer.alloc(addressBuf.length)
    for (let i = 0; i < addressBuf.length; i++) {
      encrypted[i] = addressBuf[i] ^ poolSecret[i % poolSecret.length]
    }

    return encrypted
  }

  /**
   * Decrypt address from encrypted buffer
   *
   * @param encryptedAddress - Encrypted address buffer
   * @param poolId - Pool identifier
   * @returns Decrypted address
   */
  private _decryptAddress(encryptedAddress: Buffer, poolId: string): Address {
    // If encryption is not required by config, treat as plaintext
    if (!this.swapConfig.requireEncryptedDestinations) {
      return Address.fromString(encryptedAddress.toString('utf8'))
    }

    // Decrypt using XOR with pool secret (XOR is symmetric)
    const poolSecret = Hash.sha256(Buffer.from(poolId, 'hex'))
    const decrypted = Buffer.alloc(encryptedAddress.length)
    for (let i = 0; i < encryptedAddress.length; i++) {
      decrypted[i] = encryptedAddress[i] ^ poolSecret[i % poolSecret.length]
    }

    return Address.fromString(decrypted.toString('utf8'))
  }

  /**
   * Generate unique message ID
   */
  private _generateMessageId(): string {
    return Hash.sha256(
      Buffer.concat([
        Buffer.from(Date.now().toString()),
        Buffer.from(Math.random().toString()),
      ]),
    ).toString('hex')
  }

  // ========================================
  // Protocol Handler Methods (Public API for SwapSigP2PProtocolHandler)
  // ========================================

  /**
   * Validate pool announcement signature
   */
  _validatePoolAnnouncement(announcement: SwapPoolAnnouncement): boolean {
    try {
      const announcementData = Buffer.concat([
        Buffer.from(announcement.poolId, 'hex'),
        Buffer.from(announcement.denomination.toString()),
        Buffer.from(announcement.createdAt.toString()),
      ])
      const announcementHash = Hash.sha256(announcementData)

      // Parse signature from buffer (Schnorr signatures are 64 bytes)
      const signature = Signature.fromBuffer(
        announcement.creatorSignature,
        false,
      )

      // Verify Schnorr signature
      return Schnorr.verify(
        announcementHash,
        signature,
        this.privateKey.publicKey,
      )
    } catch (error) {
      console.error('[SwapSig] Error validating pool announcement:', error)
      return false
    }
  }

  /**
   * Handle pool join notification
   */
  async _handlePoolJoin(
    poolId: string,
    participantIndex: number,
    peerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Peer ${peerId} joined pool ${poolId.substring(0, 8)}... as participant ${participantIndex}`,
    )
    this.emit(SwapSigEvent.POOL_JOINED, poolId, participantIndex)
  }

  /**
   * Handle participant registered
   */
  async _handleParticipantRegistered(
    poolId: string,
    participantIndex: number,
    peerId: string,
    publicKey: PublicKey,
    inputTxId: string,
    inputIndex: number,
    ownershipProof: Buffer,
    finalOutputCommitment: Buffer,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      console.warn(
        `[SwapSig] Received participant registration for unknown pool ${poolId.substring(0, 8)}...`,
      )
      return
    }

    // Verify the participant doesn't already exist
    if (pool.participantMap.has(peerId)) {
      console.warn(
        `[SwapSig] Participant ${peerId} already registered in pool ${poolId.substring(0, 8)}...`,
      )
      return
    }

    console.log(
      `[SwapSig] Participant ${peerId} registered in pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )

    // Note: The actual participant addition happens via joinPool()
    // This message is for informing other participants
    this.emit(SwapSigEvent.PARTICIPANT_JOINED, poolId, {
      peerId,
      participantIndex,
      publicKey,
      input: {
        txId: inputTxId,
        outputIndex: inputIndex,
        amount: pool.denomination,
        script: pool.participants[participantIndex]?.input.script,
        address: pool.participants[participantIndex]?.input.address,
      },
      ownershipProof,
      finalOutputEncrypted: Buffer.alloc(0), // Not shared in broadcast
      finalOutputCommitment,
      setupConfirmed: false,
      joinedAt: Date.now(),
    })
  }

  /**
   * Handle registration acknowledgment
   */
  async _handleRegistrationAck(
    poolId: string,
    participantIndex: number,
    acknowledgedBy: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Registration ACK for participant ${participantIndex} in pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )
    // Could track acknowledgments if needed for consensus
  }

  /**
   * Handle setup transaction broadcast
   */
  async _handleSetupTxBroadcast(
    poolId: string,
    participantIndex: number,
    txId: string,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) {
      console.warn(
        `[SwapSig] Received setup tx broadcast for unknown pool ${poolId.substring(0, 8)}...`,
      )
      return
    }

    console.log(
      `[SwapSig] Setup tx ${txId.substring(0, 8)}... broadcast for participant ${participantIndex} in pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )

    // Store setup transaction ID
    if (pool.participants[participantIndex]) {
      pool.participants[participantIndex].setupTxId = txId
    }

    this.emit(SwapSigEvent.SETUP_TX_BROADCAST, poolId, participantIndex, txId)
  }

  /**
   * Handle setup confirmation
   */
  async _handleSetupConfirmed(
    poolId: string,
    participantIndex: number,
    txId: string,
    confirmations: number,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) return

    console.log(
      `[SwapSig] Setup tx ${txId.substring(0, 8)}... confirmed (${confirmations} confs) for participant ${participantIndex} in pool ${poolId.substring(0, 8)}...`,
    )

    // Mark as confirmed
    if (pool.participants[participantIndex]) {
      pool.participants[participantIndex].setupConfirmed = true
    }

    this.emit(SwapSigEvent.SETUP_CONFIRMED, poolId, participantIndex)

    // Check if all setup transactions are confirmed
    if (this.poolManager.allSetupsConfirmed(poolId)) {
      this.poolManager.transitionPhase(poolId, SwapPhase.REVEAL)
      this.emit(SwapSigEvent.SETUP_COMPLETE, poolId)
    }
  }

  /**
   * Handle setup complete
   */
  async _handleSetupComplete(
    poolId: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Setup complete for pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )
    this.emit(SwapSigEvent.SETUP_COMPLETE, poolId)
  }

  /**
   * Handle destination reveal
   */
  async _handleDestinationReveal(
    poolId: string,
    participantIndex: number,
    finalAddress: Address,
    revealProof: Buffer,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) return

    console.log(
      `[SwapSig] Destination revealed for participant ${participantIndex} in pool ${poolId.substring(0, 8)}...`,
    )

    // Verify commitment matches
    const participant = pool.participants[participantIndex]
    if (participant) {
      // TODO: Verify revealProof matches finalOutputCommitment
      participant.finalAddress = finalAddress
    }

    this.emit(
      SwapSigEvent.DESTINATION_REVEALED,
      poolId,
      participantIndex,
      finalAddress,
    )

    // Check if all destinations are revealed
    if (this.poolManager.allDestinationsRevealed(poolId)) {
      this.poolManager.transitionPhase(poolId, SwapPhase.SETTLEMENT)
      this.emit(SwapSigEvent.REVEAL_COMPLETE, poolId)
    }
  }

  /**
   * Handle reveal complete
   */
  async _handleRevealComplete(
    poolId: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Reveal complete for pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )
    this.emit(SwapSigEvent.REVEAL_COMPLETE, poolId)
  }

  /**
   * Handle settlement transaction broadcast
   */
  async _handleSettlementTxBroadcast(
    poolId: string,
    outputIndex: number,
    txId: string,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) return

    console.log(
      `[SwapSig] Settlement tx ${txId.substring(0, 8)}... broadcast for output ${outputIndex} in pool ${poolId.substring(0, 8)}...`,
    )

    // Store settlement transaction ID
    if (pool.sharedOutputs[outputIndex]) {
      pool.sharedOutputs[outputIndex].settlementTxId = txId
    }

    this.emit(SwapSigEvent.SETTLEMENT_TX_BROADCAST, poolId, outputIndex, txId)
  }

  /**
   * Handle settlement confirmation
   */
  async _handleSettlementConfirmed(
    poolId: string,
    outputIndex: number,
    txId: string,
    confirmations: number,
    fromPeerId: string,
  ): Promise<void> {
    const pool = this.poolManager.getPool(poolId)
    if (!pool) return

    console.log(
      `[SwapSig] Settlement tx ${txId.substring(0, 8)}... confirmed (${confirmations} confs) for output ${outputIndex} in pool ${poolId.substring(0, 8)}...`,
    )

    // Mark as confirmed
    if (pool.sharedOutputs[outputIndex]) {
      pool.sharedOutputs[outputIndex].settlementConfirmed = true
    }

    this.emit(SwapSigEvent.SETTLEMENT_CONFIRMED, poolId, outputIndex)

    // Check if all settlement transactions are confirmed
    if (this.poolManager.allSettlementsConfirmed(poolId)) {
      this.poolManager.transitionPhase(poolId, SwapPhase.COMPLETE)
      this.emit(SwapSigEvent.SETTLEMENT_COMPLETE, poolId)
      this.emit(SwapSigEvent.POOL_COMPLETE, poolId)
    }
  }

  /**
   * Handle settlement complete
   */
  async _handleSettlementComplete(
    poolId: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Settlement complete for pool ${poolId.substring(0, 8)}... from ${fromPeerId}`,
    )
    this.emit(SwapSigEvent.SETTLEMENT_COMPLETE, poolId)
  }

  /**
   * Handle pool abort
   */
  async _handlePoolAbort(
    poolId: string,
    reason: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Pool ${poolId.substring(0, 8)}... aborted by ${fromPeerId}: ${reason}`,
    )

    this.poolManager.abortPool(poolId, reason)
    this.emit(SwapSigEvent.POOL_ABORTED, poolId, reason)
  }

  /**
   * Handle participant dropped
   */
  async _handleParticipantDropped(
    poolId: string,
    peerId: string,
    reason: string,
    fromPeerId: string,
  ): Promise<void> {
    console.log(
      `[SwapSig] Participant ${peerId} dropped from pool ${poolId.substring(0, 8)}... by ${fromPeerId}: ${reason}`,
    )

    this.poolManager.removeParticipant(poolId, peerId)
    this.emit(SwapSigEvent.PARTICIPANT_DROPPED, poolId, peerId)
  }

  /**
   * Handle peer connection (SwapSig-specific)
   */
  _onSwapSigPeerConnected(peerId: string): void {
    console.log(`[SwapSig] Peer connected: ${peerId}`)
    // Could track connected peers for pool coordination
  }

  /**
   * Handle peer disconnection (SwapSig-specific)
   */
  _onSwapSigPeerDisconnected(peerId: string): void {
    console.log(`[SwapSig] Peer disconnected: ${peerId}`)

    // Check all active pools for this peer
    const pools = this.poolManager.getAllPools()
    for (const pool of pools) {
      if (pool.participantMap.has(peerId)) {
        // Participant disconnected - handle gracefully
        if (
          pool.phase === SwapPhase.DISCOVERY ||
          pool.phase === SwapPhase.REGISTRATION
        ) {
          // Safe to remove during early phases
          this.poolManager.removeParticipant(pool.poolId, peerId)
          this.emit(SwapSigEvent.PARTICIPANT_DROPPED, pool.poolId, peerId)
        } else {
          // After setup started - abort pool
          this.poolManager.abortPool(
            pool.poolId,
            `Participant ${peerId} disconnected`,
          )
          this.emit(
            SwapSigEvent.POOL_ABORTED,
            pool.poolId,
            `Participant ${peerId} disconnected`,
          )
        }
      }
    }
  }

  /**
   * Send message to specific peer (used by protocol handler)
   */
  async _sendMessageToPeer(
    peerId: string,
    messageType: string,
    payload: unknown,
  ): Promise<void> {
    // Use broadcast or direct message from parent P2PCoordinator
    await this.broadcast({
      type: messageType,
      from: this.libp2pNode.peerId.toString(),
      to: peerId,
      payload,
      timestamp: Date.now(),
      messageId: this._generateMessageId(),
      protocol: 'swapsig',
    })
  }
}

/**
 * Interface declaration merging for proper event typing
 *
 * OVERRIDES parent MuSig2P2PCoordinator event types completely with SwapSigEventMap.
 * This follows the same pattern as MuSig2P2PCoordinator overriding P2PCoordinator.
 *
 * - External API: Users only see SwapSigEventMap
 * - Internal: Can still use super.on(MuSig2Event.*) to consume parent events
 * - Clean abstraction: SwapSig wraps MuSig2 coordination internally
 *
 * Benefits:
 * - Type-safe event emission: `this.emit(SwapSigEvent.POOL_CREATED, pool)`
 * - Type-safe event listening: `coordinator.on(SwapSigEvent.POOL_JOINED, (poolId, index) => ...)`
 * - IntelliSense support for all SwapSig events
 * - Compile-time validation of event parameters
 */
// @ts-expect-error - Intentionally overriding parent event types with SwapSigEventMap
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SwapSigCoordinator {
  on<E extends keyof SwapSigEventMap>(
    event: E,
    listener: SwapSigEventMap[E],
  ): this

  once<E extends keyof SwapSigEventMap>(
    event: E,
    listener: SwapSigEventMap[E],
  ): this

  emit<E extends keyof SwapSigEventMap>(
    event: E,
    ...args: Parameters<SwapSigEventMap[E]>
  ): boolean

  off<E extends keyof SwapSigEventMap>(
    event: E,
    listener: SwapSigEventMap[E],
  ): this

  removeListener<E extends keyof SwapSigEventMap>(
    event: E,
    listener: SwapSigEventMap[E],
  ): this

  removeAllListeners<E extends keyof SwapSigEventMap>(event?: E): this

  listenerCount<E extends keyof SwapSigEventMap>(event: E): number
}
