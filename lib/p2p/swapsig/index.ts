/**
 * SwapSig Protocol
 *
 * CoinJoin-equivalent privacy protocol using MuSig2 multi-signatures.
 *
 * Main components:
 * - SwapSigCoordinator: Protocol coordinator (builds on MuSig2 P2P)
 * - SwapPoolManager: Pool state management
 * - SwapSigBurnMechanism: Sybil defense through XPI burning
 *
 * Architecture:
 * - Phase 0: Discovery & Pool Formation
 * - Phase 1: Registration
 * - Phase 2: Setup Round (Round 1)
 * - Phase 3: Setup Confirmation
 * - Phase 4: Destination Reveal
 * - Phase 5: Settlement Round (Round 2) - THREE-PHASE MuSig2
 * - Phase 6: Settlement Confirmation
 * - Phase 7: Completion
 *
 * @see {@link ../../docs/SWAPSIG_ARCHITECTURE.md} for architecture details
 * @see {@link ../../docs/SWAPSIG_PROTOCOL.md} for protocol specification
 */

// Core coordinator
export { SwapSigCoordinator } from './coordinator.js'
export type { SwapSigConfig } from './coordinator.js'

// Protocol handler
export { SwapSigP2PProtocolHandler } from './protocol-handler.js'
export type {
  PoolAnnouncePayload,
  PoolJoinPayload,
  ParticipantRegisteredPayload,
  RegistrationAckPayload,
  SetupTxBroadcastPayload,
  SetupConfirmedPayload,
  SetupCompletePayload,
  DestinationRevealPayload,
  RevealCompletePayload,
  SettlementTxBroadcastPayload,
  SettlementConfirmedPayload,
  SettlementCompletePayload,
  PoolAbortPayload,
  ParticipantDroppedPayload,
} from './protocol-handler.js'

// Pool management
export { SwapPoolManager } from './pool.js'

// Burn mechanism (Sybil defense)
export { SwapSigBurnMechanism } from './burn.js'

// Type definitions
export type {
  SwapPool,
  SwapParticipant,
  SwapPoolAnnouncement,
  SharedOutput,
  SettlementInfo,
  BurnConfig,
  ParticipantInput,
  CreatePoolParams,
  PoolDiscoveryFilters,
  PoolStats,
  GroupSizeStrategy,
  SwapSigMessage,
  SwapSigEventMap,
} from './types.js'

export {
  SwapPhase,
  SwapSigEvent,
  SwapSigMessageType,
  DEFAULT_BURN_CONFIG,
} from './types.js'
