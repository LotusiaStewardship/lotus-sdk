/**
 * SwapSig Pool Manager
 *
 * Manages swap pool state, participant registration, and phase transitions.
 */

import { randomBytes } from 'node:crypto'
import type {
  SwapPool,
  SwapParticipant,
  SwapPhase,
  CreatePoolParams,
  BurnConfig,
  ParticipantInput,
  PoolStats,
  GroupSizeStrategy,
} from './types.js'
import { SwapPhase as Phase, DEFAULT_BURN_CONFIG } from './types.js'
import type { PublicKey } from '../../bitcore/publickey.js'
import type { Address } from '../../bitcore/address.js'

/**
 * Manages swap pool lifecycle and state
 */
export class SwapPoolManager {
  private pools: Map<string, SwapPool>

  constructor() {
    this.pools = new Map()
  }

  /**
   * Create new swap pool
   *
   * @param creatorPeerId - P2P peer ID of creator
   * @param params - Pool parameters
   * @returns Pool ID
   */
  createPool(creatorPeerId: string, params: CreatePoolParams): string {
    const poolId = this._generatePoolId()

    // Validate burn percentage
    const burnPercentage =
      params.burnPercentage ?? DEFAULT_BURN_CONFIG.burnPercentage
    if (burnPercentage < 0.0005 || burnPercentage > 0.01) {
      throw new Error('Burn percentage must be between 0.05% and 1.0%')
    }

    const pool: SwapPool = {
      // Identity
      poolId,
      creatorPeerId,

      // Parameters
      denomination: params.denomination,
      minParticipants: params.minParticipants ?? 3,
      maxParticipants: params.maxParticipants ?? 10,
      feeRate: params.feeRate ?? 1,
      feePerParticipant: this._estimateFeePerParticipant(params.feeRate ?? 1),

      // Sybil defense
      burnConfig: {
        ...DEFAULT_BURN_CONFIG,
        burnPercentage,
      },

      // Participants
      participants: [],
      participantMap: new Map(),

      // Outputs (initialized later)
      outputGroups: [],
      sharedOutputs: [],
      settlementMapping: new Map(),

      // Transactions
      setupTransactions: [],
      settlementTransactions: [],
      settlementSessions: new Map(),

      // State
      phase: Phase.DISCOVERY,
      createdAt: Date.now(),
      setupTimeout: params.setupTimeout ?? 600000, // 10 min
      settlementTimeout: params.settlementTimeout ?? 600000, // 10 min
      aborted: false,
    }

    this.pools.set(poolId, pool)

    return poolId
  }

  /**
   * Add participant to pool
   *
   * @param poolId - Pool identifier
   * @param peerId - Participant's peer ID
   * @param publicKey - Participant's public key
   * @param input - Input UTXO
   * @param ownershipProof - Schnorr signature proving ownership
   * @param finalOutputEncrypted - Encrypted final destination
   * @param finalOutputCommitment - SHA256 commitment
   * @returns Participant index
   */
  addParticipant(
    poolId: string,
    peerId: string,
    publicKey: PublicKey,
    input: ParticipantInput,
    ownershipProof: Buffer,
    finalOutputEncrypted: Buffer,
    finalOutputCommitment: Buffer,
  ): number {
    const pool = this.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    // Check phase
    if (pool.phase !== Phase.DISCOVERY && pool.phase !== Phase.REGISTRATION) {
      throw new Error(`Cannot join pool in phase ${pool.phase}`)
    }

    // Check if already registered
    if (pool.participantMap.has(peerId)) {
      throw new Error(`Peer ${peerId} already registered`)
    }

    // Check max participants
    if (pool.participants.length >= pool.maxParticipants) {
      throw new Error(`Pool full (${pool.maxParticipants} max)`)
    }

    // Validate input amount matches denomination
    if (input.amount !== pool.denomination) {
      throw new Error(
        `Input amount ${input.amount} does not match denomination ${pool.denomination}`,
      )
    }

    const participant: SwapParticipant = {
      peerId,
      participantIndex: pool.participants.length,
      publicKey,
      input,
      ownershipProof,
      finalOutputEncrypted,
      finalOutputCommitment,
      setupConfirmed: false,
      joinedAt: Date.now(),
    }

    pool.participants.push(participant)
    pool.participantMap.set(peerId, participant)

    // Transition to registration phase if first participant
    if (pool.phase === Phase.DISCOVERY) {
      pool.phase = Phase.REGISTRATION
    }

    return participant.participantIndex
  }

  /**
   * Remove participant from pool
   *
   * @param poolId - Pool identifier
   * @param peerId - Participant's peer ID
   */
  removeParticipant(poolId: string, peerId: string): void {
    const pool = this.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    const participant = pool.participantMap.get(peerId)
    if (!participant) {
      return // Already removed
    }

    // Remove from map
    pool.participantMap.delete(peerId)

    // Remove from array (maintain indices for existing participants)
    const index = pool.participants.findIndex(p => p.peerId === peerId)
    if (index !== -1) {
      pool.participants.splice(index, 1)
    }

    // Recompute participant indices
    pool.participants.forEach((p, i) => {
      p.participantIndex = i
    })
  }

  /**
   * Transition pool to new phase
   *
   * @param poolId - Pool identifier
   * @param newPhase - Target phase
   */
  transitionPhase(poolId: string, newPhase: SwapPhase): void {
    const pool = this.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    const oldPhase = pool.phase
    pool.phase = newPhase

    // Track timing
    if (newPhase === Phase.SETUP && !pool.startedAt) {
      pool.startedAt = Date.now()
    }

    if (newPhase === Phase.COMPLETE && !pool.completedAt) {
      pool.completedAt = Date.now()
    }
  }

  /**
   * Mark pool as aborted
   *
   * @param poolId - Pool identifier
   * @param reason - Abort reason
   */
  abortPool(poolId: string, reason: string): void {
    const pool = this.getPool(poolId)
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`)
    }

    pool.aborted = true
    pool.abortReason = reason
    pool.phase = Phase.ABORTED
  }

  /**
   * Get pool by ID
   *
   * @param poolId - Pool identifier
   * @returns Pool or undefined
   */
  getPool(poolId: string): SwapPool | undefined {
    return this.pools.get(poolId)
  }

  /**
   * Get all active pools
   *
   * @returns Array of pools
   */
  getAllPools(): SwapPool[] {
    return Array.from(this.pools.values())
  }

  /**
   * Get pools by phase
   *
   * @param phase - Target phase
   * @returns Array of pools in that phase
   */
  getPoolsByPhase(phase: SwapPhase): SwapPool[] {
    return Array.from(this.pools.values()).filter(pool => pool.phase === phase)
  }

  /**
   * Check if pool has minimum participants
   *
   * @param poolId - Pool identifier
   * @returns True if minimum reached
   */
  hasMinimumParticipants(poolId: string): boolean {
    const pool = this.getPool(poolId)
    if (!pool) return false

    return pool.participants.length >= pool.minParticipants
  }

  /**
   * Check if all setup transactions are confirmed
   *
   * @param poolId - Pool identifier
   * @returns True if all confirmed
   */
  allSetupsConfirmed(poolId: string): boolean {
    const pool = this.getPool(poolId)
    if (!pool) return false

    return pool.participants.every(p => p.setupConfirmed)
  }

  /**
   * Check if all final addresses are revealed
   *
   * @param poolId - Pool identifier
   * @returns True if all revealed
   */
  allDestinationsRevealed(poolId: string): boolean {
    const pool = this.getPool(poolId)
    if (!pool) return false

    return pool.participants.every(p => p.finalAddress !== undefined)
  }

  /**
   * Check if all settlement transactions are confirmed
   *
   * @param poolId - Pool identifier
   * @returns True if all confirmed
   */
  allSettlementsConfirmed(poolId: string): boolean {
    const pool = this.getPool(poolId)
    if (!pool) return false

    return pool.sharedOutputs.every(o => o.settlementConfirmed)
  }

  /**
   * Get pool statistics
   *
   * @param poolId - Pool identifier
   * @returns Pool statistics
   */
  getPoolStats(poolId: string): PoolStats | undefined {
    const pool = this.getPool(poolId)
    if (!pool) return undefined

    const anonymitySet = this._calculateAnonymitySet(pool)
    const duration = pool.completedAt
      ? pool.completedAt - pool.createdAt
      : undefined
    const setupDuration = pool.startedAt
      ? (pool.completedAt ?? Date.now()) - pool.startedAt
      : undefined

    return {
      poolId: pool.poolId,
      phase: pool.phase,
      participants: pool.participants.length,
      denomination: pool.denomination,
      totalBurned:
        pool.participants.length *
        Math.floor(pool.denomination * pool.burnConfig.burnPercentage),
      totalFees: pool.participants.length * 2 * pool.feePerParticipant,
      anonymitySet,
      duration,
      setupDuration,
    }
  }

  /**
   * Determine optimal group size for pool
   *
   * Based on participant count, automatically selects:
   * - 3-9 participants: 2-of-2
   * - 10-14 participants: 3-of-3
   * - 15-49 participants: 5-of-5
   * - 50+ participants: 10-of-10
   *
   * @param participantCount - Number of participants
   * @returns Group size strategy
   */
  determineOptimalGroupSize(participantCount: number): GroupSizeStrategy {
    // Tier 1: Small pools (3-9) → 2-of-2
    if (participantCount <= 9) {
      return {
        groupSize: 2,
        groupCount: Math.floor(participantCount / 2),
        anonymityPerGroup: 2, // but total is N!
        reasoning: `Small pool (${participantCount} participants): 2-of-2 optimal for simplicity. Total anonymity: ${participantCount}! = ${this._factorial(participantCount)}`,
        recommendedRounds: 2, // Amplify with multiple rounds
      }
    }

    // Tier 2: Medium-small (10-14) → 3-of-3
    if (participantCount <= 14) {
      return {
        groupSize: 3,
        groupCount: Math.floor(participantCount / 3),
        anonymityPerGroup: 6,
        reasoning: `Medium-small pool (${participantCount} participants): 3-of-3 provides 6 mappings per group`,
        recommendedRounds: 1,
      }
    }

    // Tier 3: Medium-large (15-49) → 5-of-5 (SWEET SPOT!)
    if (participantCount <= 49) {
      return {
        groupSize: 5,
        groupCount: Math.floor(participantCount / 5),
        anonymityPerGroup: 120, // TARGET ANONYMITY
        reasoning: `Medium pool (${participantCount} participants): 5-of-5 provides 120 mappings per group (excellent anonymity)`,
        recommendedRounds: 1,
      }
    }

    // Tier 4: Very large (50+) → 10-of-10
    return {
      groupSize: 10,
      groupCount: Math.floor(participantCount / 10),
      anonymityPerGroup: 3628800, // overkill but necessary for scale
      reasoning: `Large pool (${participantCount} participants): 10-of-10 necessary for large-scale coordination`,
      recommendedRounds: 1,
    }
  }

  /**
   * Remove pool
   *
   * @param poolId - Pool identifier
   */
  removePool(poolId: string): void {
    this.pools.delete(poolId)
  }

  /**
   * Generate unique pool ID (32-byte hex)
   */
  private _generatePoolId(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * Estimate fee per participant transaction
   */
  private _estimateFeePerParticipant(feeRate: number): number {
    // Rough estimate: 250 bytes per tx * feeRate
    // Setup tx: input + 2 outputs (shared + burn) ≈ 250 bytes
    // Settlement tx: input + output ≈ 200 bytes
    const avgTxSize = 225
    return Math.ceil(avgTxSize * feeRate)
  }

  /**
   * Calculate anonymity set for pool
   */
  private _calculateAnonymitySet(pool: SwapPool): number {
    const n = pool.participants.length

    if (pool.groupSizeStrategy) {
      // Dynamic group sizing: factorial per group
      const groupSize = pool.groupSizeStrategy.groupSize
      const numGroups = Math.floor(n / groupSize)
      return Math.pow(this._factorial(groupSize), numGroups)
    }

    // Fallback: total factorial
    return this._factorial(n)
  }

  /**
   * Calculate factorial
   */
  private _factorial(n: number): number {
    if (n <= 1) return 1
    let result = 1
    for (let i = 2; i <= n; i++) {
      result *= i
    }
    return result
  }
}
