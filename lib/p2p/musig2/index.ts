/**
 * MuSig2 P2P Coordination Module
 *
 * Exports all components for MuSig2 multi-signature coordination over P2P networks
 */

export { MuSig2P2PCoordinator } from './coordinator.js'
export { MuSig2ProtocolHandler } from './protocol.js'
export { MuSig2SecurityValidator } from './security.js'
export type { MuSig2SecurityConfig } from './security.js'
export * from './types.js'

// Coordinator Election
export {
  electCoordinator,
  verifyElectionResult,
  isCoordinator,
  getCoordinatorPublicKey,
  getBackupCoordinator,
  getCoordinatorPriorityList,
  ElectionMethod,
  type ElectionResult,
} from './election.js'
