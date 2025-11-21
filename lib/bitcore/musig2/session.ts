/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 Session Management
 *
 * Provides stateful session management for multi-party MuSig2 signing.
 * Handles nonce exchange, partial signature collection, and finalization.
 *
 * This is a general-purpose session manager that can be used for any
 * MuSig2 signing scenario, not just Taproot transactions.
 *
 * @module MuSig2Session
 */

import { PublicKey } from '../publickey.js'
import { PrivateKey } from '../privatekey.js'
import { Point, BN, Signature, Random, Hash } from '../crypto/index.js'
import {
  musigKeyAgg,
  musigNonceGen,
  musigNonceAgg,
  musigPartialSign,
  musigPartialSigVerify,
  musigSigAgg,
  type MuSigKeyAggContext,
  type MuSigNonce,
  type MuSigAggregatedNonce,
} from '../crypto/musig2.js'
import { verifyTaprootKeyPathMuSigPartial } from '../taproot/musig2.js'
import { calculateTapTweak, tweakPublicKey } from '../taproot.js'

/**
 * Session phases in the MuSig2 protocol
 */
export enum MuSigSessionPhase {
  /** Initial state - session created but not started */
  INIT = 'init',
  /** Round 1 - collecting public nonces from all signers */
  NONCE_EXCHANGE = 'nonce-exchange',
  /** Round 2 - collecting partial signatures from all signers */
  PARTIAL_SIG_EXCHANGE = 'partial-sig-exchange',
  /** Final state - signature has been aggregated */
  COMPLETE = 'complete',
  /** Error state - session aborted due to validation failure */
  ABORTED = 'aborted',
}

/**
 * MuSig2 Signing Session
 *
 * Represents a single multi-party signing session with all necessary state.
 */
export interface MuSigSession {
  /** Unique session identifier */
  sessionId: string

  /** All participating signers' public keys (in order) */
  signers: PublicKey[]

  /** Index of this signer in the signers array */
  myIndex: number

  /** Key aggregation context (computed once) */
  keyAggContext: MuSigKeyAggContext

  /** Message to be signed */
  message: Buffer

  /** Optional: Session metadata */
  metadata?: Record<string, unknown>

  // Round 1 state
  /** This signer's secret nonce (NEVER share!) */
  mySecretNonce?: MuSigNonce

  /** This signer's public nonce */
  myPublicNonce?: [Point, Point]

  /** Received public nonces from other signers (index -> nonce) */
  receivedPublicNonces: Map<number, [Point, Point]>

  // Round 2 state
  /** Aggregated nonce (computed when all public nonces received) */
  aggregatedNonce?: MuSigAggregatedNonce

  /** This signer's partial signature */
  myPartialSig?: BN

  /** Received partial signatures from other signers (index -> sig) */
  receivedPartialSigs: Map<number, BN>

  // Final state
  /** Final aggregated signature (if complete) */
  finalSignature?: Signature

  /** Current phase of the session */
  phase: MuSigSessionPhase

  /** Creation timestamp */
  createdAt: number

  /** Last updated timestamp */
  updatedAt: number

  /** Optional: Abort reason if phase is ABORTED */
  abortReason?: string
}

/**
 * MuSig2 Session Manager
 *
 * Manages the lifecycle of MuSig2 signing sessions including:
 * - Session creation and initialization
 * - Nonce generation and exchange
 * - Partial signature creation and collection
 * - Signature aggregation and finalization
 * - Validation and error handling
 */
export class MuSigSessionManager {
  /**
   * Create a new MuSig2 signing session
   *
   * @param signers - All participating signers' public keys (in order)
   * @param myPrivateKey - This signer's private key
   * @param message - Message to be signed
   * @param metadata - Optional session metadata
   * @returns Initialized session
   * @throws Error if signers array is empty or doesn't contain myPrivateKey's public key
   */
  createSession(
    signers: PublicKey[],
    myPrivateKey: PrivateKey,
    message: Buffer,
    metadata?: Record<string, unknown>,
  ): MuSigSession {
    // Validate inputs
    if (signers.length === 0) {
      throw new Error('Cannot create MuSig2 session with zero signers')
    }

    if (!message || message.length === 0) {
      throw new Error('Cannot create MuSig2 session with empty message')
    }

    // Perform key aggregation (sorts keys internally for deterministic ordering)
    const keyAggContext = musigKeyAgg(signers)

    // Find this signer's index in the SORTED key list
    // (musigKeyAgg returns sorted keys in keyAggContext.pubkeys)
    const myPubKey = myPrivateKey.publicKey
    const myIndex = keyAggContext.pubkeys.findIndex(
      signer => signer.toString() === myPubKey.toString(),
    )

    if (myIndex === -1) {
      throw new Error(
        'Private key does not correspond to any signer in the session',
      )
    }

    // Generate session ID (use sorted keys for consistency)
    const sessionId = this._generateSessionId(keyAggContext.pubkeys, message)

    // Create session (use sorted signers from keyAggContext)
    const now = Date.now()
    const session: MuSigSession = {
      sessionId,
      signers: keyAggContext.pubkeys, // Use sorted keys for consistency
      myIndex,
      keyAggContext,
      message,
      metadata,
      receivedPublicNonces: new Map(),
      receivedPartialSigs: new Map(),
      phase: MuSigSessionPhase.INIT,
      createdAt: now,
      updatedAt: now,
    }

    return session
  }

  /**
   * Generate and store public nonces for this signer
   *
   * This begins Round 1 of the MuSig2 protocol. The returned public nonces
   * must be shared with all other signers.
   *
   * 🔒 PRODUCTION SECURITY: This method automatically adds 32 bytes of random
   * entropy to nonce generation for defense-in-depth. The underlying nonce
   * generation uses RFC6979 deterministic generation, and this random layer
   * provides additional protection against implementation bugs or hardware failures.
   *
   * If you need deterministic nonces (e.g., for testing with known vectors),
   * pass Buffer.alloc(32) as extraInput to disable the random layer.
   *
   * WARNING: Do not call this multiple times for the same session!
   * Nonce reuse reveals the private key!
   *
   * @param session - The signing session
   * @param privateKey - This signer's private key
   * @param extraInput - Optional extra randomness. If not provided, 32 random bytes are automatically added for production security.
   * @returns Public nonces to share with other signers
   * @throws Error if session is not in INIT phase or nonces already generated
   *
   * @example Production usage (automatic randomness)
   * ```typescript
   * const nonces = manager.generateNonces(session, privateKey)
   * // Automatically includes 32 random bytes for security
   * ```
   *
   * @example Testing with deterministic nonces
   * ```typescript
   * const nonces = manager.generateNonces(session, privateKey, Buffer.alloc(32))
   * // Uses only RFC6979 deterministic generation (reproducible)
   * ```
   */
  generateNonces(
    session: MuSigSession,
    privateKey: PrivateKey,
    extraInput?: Buffer,
  ): [Point, Point] {
    // Validate phase
    if (session.phase !== MuSigSessionPhase.INIT) {
      throw new Error(
        `Cannot generate nonces in phase ${session.phase}. Must be in INIT phase.`,
      )
    }

    // Check if nonces already generated
    if (session.mySecretNonce || session.myPublicNonce) {
      throw new Error(
        'Nonces already generated for this session. NEVER reuse nonces!',
      )
    }

    // SECURITY: Add random entropy by default for production use
    // This provides defense-in-depth on top of RFC6979 deterministic generation
    // Pass Buffer.alloc(32) as extraInput to disable for testing
    const entropy =
      extraInput !== undefined ? extraInput : Random.getRandomBuffer(32)

    // Generate nonces with RFC6979 + optional randomness
    const nonce = musigNonceGen(
      privateKey,
      session.keyAggContext.aggregatedPubKey,
      session.message,
      entropy,
    )

    // Store in session
    session.mySecretNonce = nonce
    session.myPublicNonce = nonce.publicNonces
    // ARCHITECTURE FIX (2025-11-21): Do NOT transition phase here
    // Phase will be transitioned by P2P coordinator after ALL nonce commitments received
    // This prevents race condition where peers reject each other's NONCE_COMMIT messages
    // session.phase = MuSigSessionPhase.NONCE_EXCHANGE // REMOVED
    session.updatedAt = Date.now()

    // RACE CONDITION FIX: If we already have all other nonces (received before we generated ours),
    // aggregate them now
    if (this.hasAllNonces(session)) {
      this._aggregateNonces(session)
    }

    return nonce.publicNonces
  }

  /**
   * Receive and validate a public nonce from another signer
   *
   * @param session - The signing session
   * @param signerIndex - Index of the signer who sent this nonce
   * @param publicNonce - The public nonce to receive
   * @throws Error if validation fails or duplicate nonce received
   */
  receiveNonce(
    session: MuSigSession,
    signerIndex: number,
    publicNonce: [Point, Point],
  ): void {
    // Validate session phase
    if (
      session.phase !== MuSigSessionPhase.NONCE_EXCHANGE &&
      session.phase !== MuSigSessionPhase.INIT
    ) {
      throw new Error(
        `Cannot receive nonces in phase ${session.phase}. Must be in INIT or NONCE_EXCHANGE phase.`,
      )
    }

    // Validate signer index
    if (signerIndex < 0 || signerIndex >= session.signers.length) {
      throw new Error(`Invalid signer index: ${signerIndex}`)
    }

    // Don't accept our own nonce
    if (signerIndex === session.myIndex) {
      throw new Error('Cannot receive nonce from self')
    }

    // Check for duplicate
    if (session.receivedPublicNonces.has(signerIndex)) {
      throw new Error(
        `Already received nonce from signer ${signerIndex}. Possible equivocation!`,
      )
    }

    // Validate nonce points
    try {
      publicNonce[0].validate()
      publicNonce[1].validate()
    } catch (error) {
      throw new Error(
        `Invalid public nonce from signer ${signerIndex}: ${error}`,
      )
    }

    // Store nonce
    session.receivedPublicNonces.set(signerIndex, publicNonce)
    session.updatedAt = Date.now()

    // If we have all nonces, aggregate them
    if (this.hasAllNonces(session)) {
      this._aggregateNonces(session)
    }
  }

  /**
   * Check if all nonces have been received
   *
   * @param session - The signing session
   * @returns true if all nonces collected
   */
  hasAllNonces(session: MuSigSession): boolean {
    if (!session.myPublicNonce) {
      return false
    }

    // Need nonces from all other signers
    const expectedCount = session.signers.length - 1
    return session.receivedPublicNonces.size === expectedCount
  }

  /**
   * Create this signer's partial signature
   *
   * This begins Round 2 of the MuSig2 protocol. Can only be called after
   * all nonces have been collected and aggregated.
   *
   * @param session - The signing session
   * @param privateKey - This signer's private key
   * @returns Partial signature to share with other signers
   * @throws Error if not ready to sign
   */
  createPartialSignature(session: MuSigSession, privateKey: PrivateKey): BN {
    // Validate we have aggregated nonce
    if (!session.aggregatedNonce) {
      throw new Error(
        'Cannot create partial signature: nonces not yet aggregated. Wait for all nonces.',
      )
    }

    // Validate we have secret nonce
    if (!session.mySecretNonce) {
      throw new Error('Cannot create partial signature: secret nonce not found')
    }

    // Validate phase: Must be in NONCE_EXCHANGE or PARTIAL_SIG_EXCHANGE to create partial signature
    // The phase might already be PARTIAL_SIG_EXCHANGE if _handleAllNoncesReceived transitioned it
    // If still NONCE_EXCHANGE, we'll transition it after creation
    if (
      session.phase !== MuSigSessionPhase.NONCE_EXCHANGE &&
      session.phase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
    ) {
      throw new Error(
        `Cannot create partial signature in phase ${session.phase}. Must be in NONCE_EXCHANGE or PARTIAL_SIG_EXCHANGE.`,
      )
    }

    // Create partial signature
    const partialSig = musigPartialSign(
      session.mySecretNonce,
      privateKey,
      session.keyAggContext,
      session.myIndex,
      session.aggregatedNonce,
      session.message,
    )

    // Store partial signature
    session.myPartialSig = partialSig
    // Ensure phase is PARTIAL_SIG_EXCHANGE (it may already be if transitioned early)
    session.phase = MuSigSessionPhase.PARTIAL_SIG_EXCHANGE
    session.updatedAt = Date.now()

    // Clear secret nonce from memory for security
    this._clearSecretNonce(session)

    return partialSig
  }

  /**
   * Receive and verify a partial signature from another signer
   *
   * @param session - The signing session
   * @param signerIndex - Index of the signer who sent this signature
   * @param partialSig - The partial signature to receive
   * @throws Error if validation fails or duplicate signature received
   */
  receivePartialSignature(
    session: MuSigSession,
    signerIndex: number,
    partialSig: BN,
  ): void {
    // Validate session phase
    if (session.phase !== MuSigSessionPhase.PARTIAL_SIG_EXCHANGE) {
      throw new Error(
        `Cannot receive partial signatures in phase ${session.phase}`,
      )
    }

    // Validate signer index
    if (signerIndex < 0 || signerIndex >= session.signers.length) {
      throw new Error(`Invalid signer index: ${signerIndex}`)
    }

    // Don't accept our own signature
    if (signerIndex === session.myIndex) {
      throw new Error('Cannot receive partial signature from self')
    }

    // Check for duplicate
    if (session.receivedPartialSigs.has(signerIndex)) {
      throw new Error(
        `Already received partial signature from signer ${signerIndex}`,
      )
    }

    // Verify partial signature
    const publicNonce = session.receivedPublicNonces.get(signerIndex)
    if (!publicNonce) {
      throw new Error(
        `No public nonce found for signer ${signerIndex}. Cannot verify.`,
      )
    }

    // For Taproot, use Taproot-aware verification that accounts for the tweak
    let isValid: boolean
    if (session.metadata?.inputScriptType === 'taproot') {
      // Taproot key-path spending requires special verification
      // Compute Taproot tweak (merkle root is all zeros for key-path only)
      const merkleRoot = Buffer.alloc(32)
      const tweak = calculateTapTweak(
        session.keyAggContext.aggregatedPubKey,
        merkleRoot,
      )

      isValid = verifyTaprootKeyPathMuSigPartial(
        partialSig,
        publicNonce,
        session.signers[signerIndex],
        session.keyAggContext,
        signerIndex,
        session.aggregatedNonce!,
        session.message,
        tweak,
      )
    } else {
      // Regular MuSig2 verification (non-Taproot)
      isValid = musigPartialSigVerify(
        partialSig,
        publicNonce,
        session.signers[signerIndex],
        session.keyAggContext,
        signerIndex,
        session.aggregatedNonce!,
        session.message,
      )
    }

    if (!isValid) {
      this._abortSession(
        session,
        `Invalid partial signature from signer ${signerIndex}`,
      )
      throw new Error(
        `Invalid partial signature from signer ${signerIndex}. Session aborted.`,
      )
    }

    // Store partial signature
    session.receivedPartialSigs.set(signerIndex, partialSig)
    session.updatedAt = Date.now()

    // If we have all partial signatures, finalize
    if (this.hasAllPartialSignatures(session)) {
      this._finalizeSignature(session)
    }
  }

  /**
   * Check if all partial signatures have been received
   *
   * @param session - The signing session
   * @returns true if all partial signatures collected
   */
  hasAllPartialSignatures(session: MuSigSession): boolean {
    if (!session.myPartialSig) {
      return false
    }

    // Need partial sigs from all other signers
    const expectedCount = session.signers.length - 1
    return session.receivedPartialSigs.size === expectedCount
  }

  /**
   * Get the final aggregated signature
   *
   * Can only be called after all partial signatures have been collected.
   *
   * @param session - The signing session
   * @returns The final Schnorr signature
   * @throws Error if signature not yet finalized
   */
  getFinalSignature(session: MuSigSession): Signature {
    if (session.phase !== MuSigSessionPhase.COMPLETE) {
      throw new Error(
        `Cannot get final signature: session is in phase ${session.phase}`,
      )
    }

    if (!session.finalSignature) {
      throw new Error('Final signature not found')
    }

    return session.finalSignature
  }

  /**
   * Abort a session with an error reason
   *
   * @param session - The signing session
   * @param reason - Reason for abortion
   */
  abortSession(session: MuSigSession, reason: string): void {
    this._abortSession(session, reason)
  }

  /**
   * Get session status summary
   *
   * @param session - The signing session
   * @returns Human-readable status information
   */
  getSessionStatus(session: MuSigSession): {
    phase: MuSigSessionPhase
    noncesCollected: number
    noncesTotal: number
    partialSigsCollected: number
    partialSigsTotal: number
    isComplete: boolean
    isAborted: boolean
    abortReason?: string
  } {
    const noncesTotal = session.signers.length
    const noncesCollected =
      session.receivedPublicNonces.size + (session.myPublicNonce ? 1 : 0)

    const partialSigsTotal = session.signers.length
    const partialSigsCollected =
      session.receivedPartialSigs.size + (session.myPartialSig ? 1 : 0)

    return {
      phase: session.phase,
      noncesCollected,
      noncesTotal,
      partialSigsCollected,
      partialSigsTotal,
      isComplete: session.phase === MuSigSessionPhase.COMPLETE,
      isAborted: session.phase === MuSigSessionPhase.ABORTED,
      abortReason: session.abortReason,
    }
  }

  // Private helper methods

  /**
   * Generate a unique session ID
   */
  private _generateSessionId(signers: PublicKey[], message: Buffer): string {
    const signersHash = Hash.sha256(
      Buffer.concat(signers.map(s => s.toBuffer())),
    )
    const messageHash = Hash.sha256(message)
    const combined = Buffer.concat([signersHash, messageHash])
    return Hash.sha256(combined).toString('hex').slice(0, 16)
  }

  /**
   * Aggregate all received nonces
   */
  private _aggregateNonces(session: MuSigSession): void {
    if (!session.myPublicNonce) {
      throw new Error('My public nonce not set')
    }

    // Collect all nonces in signer index order (critical for consistent aggregation!)
    const allNonces: Array<[Point, Point]> = []

    for (let i = 0; i < session.signers.length; i++) {
      if (i === session.myIndex) {
        allNonces.push(session.myPublicNonce)
      } else {
        const nonce = session.receivedPublicNonces.get(i)
        if (!nonce) {
          throw new Error(`Missing nonce from signer ${i}`)
        }
        allNonces.push(nonce)
      }
    }

    // Aggregate
    session.aggregatedNonce = musigNonceAgg(allNonces)
    session.updatedAt = Date.now()
  }

  /**
   * Finalize the signature
   */
  private _finalizeSignature(session: MuSigSession): void {
    if (!session.myPartialSig) {
      throw new Error('My partial signature not set')
    }

    if (!session.aggregatedNonce) {
      throw new Error('Aggregated nonce not set')
    }

    // Collect all partial signatures in signer index order (for consistency)
    const allPartialSigs: BN[] = []

    for (let i = 0; i < session.signers.length; i++) {
      if (i === session.myIndex) {
        allPartialSigs.push(session.myPartialSig)
      } else {
        const partialSig = session.receivedPartialSigs.get(i)
        if (!partialSig) {
          throw new Error(`Missing partial signature from signer ${i}`)
        }
        allPartialSigs.push(partialSig)
      }
    }

    // Aggregate into final signature
    // For Taproot, use the commitment (tweaked pubkey) instead of aggregated pubkey
    // because the partial signatures were created using the commitment in the challenge hash
    let pubKeyForAggregation = session.keyAggContext.aggregatedPubKey
    if (session.metadata?.inputScriptType === 'taproot') {
      // Compute Taproot commitment (merkle root is all zeros for key-path only)
      const merkleRoot = Buffer.alloc(32)
      pubKeyForAggregation = tweakPublicKey(
        session.keyAggContext.aggregatedPubKey,
        merkleRoot,
      )
    }

    // Get sighash type from metadata (defaults to SIGHASH_ALL | SIGHASH_LOTUS for Taproot)
    // BUG FIX: This nhashtype will be embedded in the signature for proper transaction serialization
    const sighashType = session.metadata?.sighashType
      ? (session.metadata.sighashType as number)
      : session.metadata?.inputScriptType === 'taproot'
        ? Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS
        : undefined

    session.finalSignature = musigSigAgg(
      allPartialSigs,
      session.aggregatedNonce,
      session.message,
      pubKeyForAggregation,
      sighashType,
    )

    session.phase = MuSigSessionPhase.COMPLETE
    session.updatedAt = Date.now()
  }

  /**
   * Clear secret nonce from memory
   */
  private _clearSecretNonce(session: MuSigSession): void {
    if (session.mySecretNonce) {
      // Zero out the secret nonce values
      const [k1, k2] = session.mySecretNonce.secretNonces
      // BN doesn't have a clear method, but we can at least remove the reference
      session.mySecretNonce = undefined
    }
  }

  /**
   * Abort the session
   */
  private _abortSession(session: MuSigSession, reason: string): void {
    session.phase = MuSigSessionPhase.ABORTED
    session.abortReason = reason
    session.updatedAt = Date.now()

    // Clear sensitive data
    this._clearSecretNonce(session)
  }
}
