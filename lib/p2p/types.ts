/**
 * Core P2P Type Definitions
 *
 * Re-exports libp2p types and defines protocol-specific types
 */

import { PublicKey } from '../bitcore/publickey.js'
import type {
  Connection,
  Stream,
  PeerInfo as LibP2PPeerInfo,
} from '@libp2p/interface'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Libp2p } from 'libp2p'
import type { PeerInfoMapper } from '@libp2p/kad-dht'

// Re-export libp2p native types
export type { PeerId, Connection, Stream, Multiaddr, Libp2p, PeerInfoMapper }

/**
 * Message types (can be extended by protocols)
 */
export enum BaseMessageType {
  // Connection lifecycle
  PEER_HANDSHAKE = 'peer-handshake',
  PEER_DISCONNECT = 'peer-disconnect',
  PEER_HEARTBEAT = 'peer-heartbeat',

  // DHT operations
  DHT_ANNOUNCE = 'dht-announce',
  DHT_QUERY = 'dht-query',
  DHT_RESPONSE = 'dht-response',

  // Generic data exchange
  DATA_MESSAGE = 'data-message',
  DATA_BROADCAST = 'data-broadcast',

  // Error handling
  ERROR = 'error',
}

/**
 * Peer information (enriched with Lotus-specific data)
 */
export interface PeerInfo {
  /** libp2p peer ID */
  peerId: string

  /** Peer's public key (for authentication) */
  publicKey?: PublicKey

  /** Multiaddresses for connection */
  multiaddrs?: string[]

  /** Peer metadata (extensible) */
  metadata?: Record<string, unknown>

  /** Last seen timestamp */
  lastSeen?: number
}

/**
 * Base P2P message structure
 */
export interface P2PMessage<T = unknown> {
  /** Message type */
  type: string

  /** Sender peer ID */
  from: string

  /** Target peer ID (optional, for directed messages) */
  to?: string

  /** Message payload */
  payload: T

  /** Message timestamp */
  timestamp: number

  /** Message ID (for deduplication) */
  messageId: string

  /** Optional signature for authentication */
  signature?: Buffer

  /** Protocol identifier (e.g., 'musig2', 'coinjoin') */
  protocol?: string
}

/**
 * DHT query structure
 */
export interface DHTQuery {
  /** Query key or pattern */
  key: string

  /** Optional filters */
  filters?: Record<string, unknown>

  /** Max results */
  maxResults?: number
}

/**
 * Connection event types
 */
export enum ConnectionEvent {
  CONNECTED = 'peer:connect',
  DISCONNECTED = 'peer:disconnect',
  DISCOVERED = 'peer:discovery',
  MESSAGE = 'message',
  ERROR = 'error',
}

/**
 * P2P Configuration
 */
export interface P2PConfig {
  /** Listen addresses (multiaddrs) */
  listen?: string[]

  /** Announce addresses (multiaddrs) */
  announce?: string[]

  /** Bootstrap peer addresses */
  bootstrapPeers?: string[]

  /** Enable Kad-DHT */
  enableDHT?: boolean

  /** DHT protocol prefix */
  dhtProtocol?: string

  /**
   * Enable DHT server mode (participate in DHT network).
   * If true: node acts as DHT server (routing, storing data, background operations)
   * If false: node acts as DHT client only (queries only, no background operations)
   * Default: false (client mode for clean shutdown)
   */
  enableDHTServer?: boolean

  /**
   * Enable GossipSub pub/sub for real-time event-driven discovery
   * If true: enables topic-based pub/sub for instant notifications
   * Default: true (recommended for production)
   */
  enableGossipSub?: boolean

  /**
   * DHT peer info mapper function
   * Controls which peer addresses are considered valid for DHT operations.
   *
   * Available options from @libp2p/kad-dht:
   * - passthroughMapper: Allow all addresses (use for local development/testing)
   * - removePrivateAddressesMapper: Only public addresses (filters out 127.0.0.1)
   * - removePublicAddressesMapper: Only private addresses (for LAN-only DHT)
   *
   * Default: Auto-detected (passthroughMapper for localhost, removePrivateAddressesMapper for production)
   * Override: Explicitly set for custom network configurations
   */
  dhtPeerInfoMapper?: PeerInfoMapper

  /** Maximum connections */
  maxConnections?: number

  /** Connection manager options */
  connectionManager?: {
    minConnections?: number
    maxConnections?: number
  }

  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Protocol handler interface
 * Protocols (like MuSig2) implement this to handle their specific messages
 */
export interface IProtocolHandler {
  /** Protocol name */
  readonly protocolName: string

  /** Protocol ID for libp2p streams */
  readonly protocolId: string

  /** Handle incoming message */
  handleMessage(message: P2PMessage, from: PeerInfo): Promise<void>

  /** Handle peer connection */
  onPeerConnected?(peerId: string): Promise<void>

  /** Handle peer disconnection */
  onPeerDisconnected?(peerId: string): Promise<void>

  /** Handle incoming stream (optional) */
  handleStream?(stream: Stream, connection: Connection): Promise<void>
}

/**
 * Resource announcement (generic)
 */
export interface ResourceAnnouncement<T = unknown> {
  /** Resource ID */
  resourceId: string

  /** Resource type (e.g., 'musig-session', 'coinjoin-round') */
  resourceType: string

  /** Creator peer ID */
  creatorPeerId: string

  /** Resource data */
  data: T

  /** Creation timestamp */
  createdAt: number

  /** Expiration timestamp */
  expiresAt?: number

  /** Signature */
  signature?: Buffer
}

/**
 * Broadcast options
 */
export interface BroadcastOptions {
  /** Exclude specific peers */
  exclude?: string[]

  /** Only send to specific peers */
  includedOnly?: string[]

  /** Protocol to use */
  protocol?: string
}

/**
 * Message handler callback
 */
export type MessageHandler = (
  message: P2PMessage,
  from: PeerInfo,
) => Promise<void> | void

/**
 * DHT statistics and status
 * Provides real-time information about DHT health and readiness
 */
export interface DHTStats {
  /** Whether DHT is enabled */
  enabled: boolean

  /** DHT operating mode */
  mode: 'client' | 'server' | 'disabled'

  /** Number of peers in DHT routing table */
  routingTableSize: number

  /**
   * Whether DHT is ready for operations
   * true if routing table has at least 1 peer
   * With passthroughMapper (localhost): Auto-populates via TopologyListener
   * With removePrivateAddressesMapper (production): Auto-populates for public peers
   */
  isReady: boolean
}

/**
 * P2P coordinator statistics
 * Comprehensive snapshot of node state, connections, and DHT health
 */
export interface P2PStats {
  /** This node's peer ID */
  peerId: string

  /** Peer connection statistics */
  peers: {
    /** Total known peers */
    total: number
    /** Currently connected peers */
    connected: number
  }

  /** DHT statistics */
  dht: {
    /** Whether DHT is enabled */
    enabled: boolean
    /** DHT operating mode */
    mode: 'client' | 'server' | 'disabled'
    /** Number of peers in DHT routing table */
    routingTableSize: number
    /** Number of locally cached DHT records */
    localRecords: number
  }

  /** This node's multiaddrs */
  multiaddrs: string[]
}
