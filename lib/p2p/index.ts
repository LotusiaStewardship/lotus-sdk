/**
 * P2P Coordination Layer
 *
 * Generic peer-to-peer networking infrastructure using libp2p
 */

// Main coordinator
export { P2PCoordinator } from './coordinator.js'

// Core types (includes libp2p re-exports)
export * from './types.js'

// Protocol and messaging
export { P2PProtocol } from './protocol.js'

// Core security (protocol-agnostic)
export * from './security.js'

// Blockchain utilities (burn verification)
export * from './blockchain-utils.js'

// Utilities
export {
  createPeerIdFromPrivateKey,
  createRandomPeerId,
  parsePeerId,
  serializePeerId,
  parseMultiaddrs,
  waitForEvent,
} from './utils.js'

// Re-export DHT mapper functions for convenience
export {
  passthroughMapper,
  removePrivateAddressesMapper,
  removePublicAddressesMapper,
} from '@libp2p/kad-dht'

// MuSig2 P2P coordination
export * from './musig2/index.js'

// SwapSig protocol
//export * from './swapsig/index.js'
