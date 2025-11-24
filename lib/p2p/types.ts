/**
 * Core P2P Type Definitions
 *
 * Re-exports libp2p types and defines protocol-specific types
 */

import { PublicKey } from '../bitcore/publickey.js'
import type { Connection, Stream, PeerId, PrivateKey } from '@libp2p/interface'
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
  UPDATED = 'peer:update',
  MESSAGE = 'message',
  ERROR = 'error',
}

/**
 * Relay address monitoring events
 */
export enum RelayEvent {
  /** New relay circuit addresses available */
  ADDRESSES_AVAILABLE = 'relay:addresses-available',

  /** Relay connection established */
  CONNECTED = 'relay:connected',

  /** Relay connection lost */
  DISCONNECTED = 'relay:disconnected',
}

/**
 * P2P Configuration
 */
export interface P2PConfig {
  /**
   * Fixed peer identity (optional - for persistent node identity across restarts)
   * When provided, the node will use this PrivateKey instead of generating a random one
   * The PeerId is instantiated from the PrivateKey in the underlying Libp2p constructor
   */
  privateKey?: PrivateKey

  /** Listen addresses (multiaddrs) */
  listen?: string[]

  /** Announce addresses (multiaddrs) */
  announce?: string[]

  /**
   * Bootstrap peer addresses (multiaddrs with peer IDs)
   * When provided, the node will automatically connect to these peers on startup
   * Example: ['/ip4/135.148.150.142/tcp/6969/p2p/12D3KooW...']
   */
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
   * Security configuration
   * Use for testing or custom security requirements
   */
  securityConfig?: {
    /**
     * Disable rate limiting (TESTING ONLY)
     * WARNING: Never use in production - removes DoS protection
     * Default: false
     */
    disableRateLimiting?: boolean

    /**
     * Custom security limits (override defaults)
     */
    customLimits?: Partial<typeof CORE_P2P_SECURITY_LIMITS>
  }

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

  /**
   * Enable circuit relay v2 (NAT traversal for Node.js peers)
   * Default: true (recommended for production)
   *
   * How it works:
   * - Peers behind NAT connect via public relay nodes (bootstrap/Zoe)
   * - Enables connectivity when direct TCP connection fails
   * - DCUTR automatically upgrades relay → direct P2P connection
   */
  enableRelay?: boolean

  /**
   * Enable relay server mode (allow others to relay through you)
   * Default: false (only set to true for public bootstrap/relay nodes)
   *
   * Bootstrap nodes should enable this to help NAT peers connect
   * Regular wallet nodes should leave this disabled
   */
  enableRelayServer?: boolean

  /**
   * Enable AutoNAT (automatic NAT detection and public address discovery)
   * Default: true (recommended for all nodes)
   *
   * Detects:
   * - Whether node is behind NAT
   * - Public IP address (if available)
   * - Whether port forwarding is working
   */
  enableAutoNAT?: boolean

  /**
   * Enable DCUTR (Direct Connection Upgrade through Relay)
   * Default: true (recommended for production)
   *
   * Automatically upgrades relay connections to direct P2P:
   * - Step 1: Connect via relay (Alice → Relay → Bob)
   * - Step 2: DCUTR hole punching (both peers try direct connection)
   * - Step 3: Direct P2P established (Alice ←→ Bob, relay dropped)
   *
   * Requires enableRelay to be true
   */
  enableDCUTR?: boolean

  /**
   * Enable UPnP/NAT-PMP (automatic port forwarding - LAST RESORT)
   * Default: false (disabled by default for security)
   *
   * WARNING: UPnP can expose security risks:
   * - Opens ports automatically without user consent
   * - May expose internal network topology
   * - Router vulnerabilities can be exploited
   *
   * Only enable if:
   * - Circuit Relay + DCUTR is not sufficient
   * - Running on trusted networks
   * - User explicitly opts in
   */
  enableUPnP?: boolean

  /** Maximum connections */
  maxConnections?: number

  /** Connection manager options */
  connectionManager?: {
    //minConnections?: number
    maxConnections?: number
  }

  /** Custom metadata */
  metadata?: Record<string, unknown>

  /**
   * Relay address monitoring configuration
   * Enables automatic monitoring and notification of relay address changes
   * Useful for protocols that need to re-advertise when connectivity changes
   */
  relayMonitoring?: {
    /** Enable relay address monitoring (default: false) */
    enabled?: boolean

    /** Check interval in milliseconds (default: 10000) */
    checkInterval?: number

    /** Only monitor bootstrap relay connections (default: true) */
    bootstrapOnly?: boolean
  }
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

  /** Handle peer discovery (before connection is established) */
  onPeerDiscovered?(peerInfo: PeerInfo): Promise<void>

  /** Handle peer connection */
  onPeerConnected?(peerId: string): Promise<void>

  /** Handle peer disconnection */
  onPeerDisconnected?(peerId: string): Promise<void>

  /** Handle peer information update */
  onPeerUpdated?(peerInfo: PeerInfo): Promise<void>

  /** Handle incoming stream (optional) */
  handleStream?(stream: Stream, connection: Connection): Promise<void>

  /** Handle relay address change (optional) */
  onRelayAddressesChanged?(data: {
    peerId: string
    reachableAddresses: string[]
    relayAddresses: string[]
    timestamp: number
  }): Promise<void>
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

// ============================================================================
// Core Security Types (Protocol-Agnostic)
// ============================================================================

/**
 * Core P2P security limits
 * Applied universally to all protocols using the P2P layer
 */
export const CORE_P2P_SECURITY_LIMITS = {
  /** Maximum message size for P2P streams (bytes) */
  MAX_P2P_MESSAGE_SIZE: 100_000, // 100KB

  /** Minimum interval between DHT announcements per peer (ms) */
  MIN_DHT_ANNOUNCEMENT_INTERVAL: 30_000, // 30 seconds

  /** Maximum DHT resources per peer */
  MAX_DHT_RESOURCES_PER_PEER: 100,

  /** Maximum DHT resources per resource type per peer */
  MAX_DHT_RESOURCES_PER_TYPE_PER_PEER: 20,

  /** DHT cleanup interval (ms) */
  DHT_CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes

  /** Maximum invalid messages before ban */
  MAX_INVALID_MESSAGES_PER_PEER: 20,
} as const

/**
 * Protocol validator interface
 * Protocols can implement this to add custom validation logic
 */
export interface IProtocolValidator {
  /**
   * Validate a resource announcement before accepting it
   * @returns true if valid, false if should be rejected
   */
  validateResourceAnnouncement?(
    resourceType: string,
    resourceId: string,
    data: unknown,
    peerId: string,
  ): Promise<boolean> | boolean

  /**
   * Validate a message before processing it
   * @returns true if valid, false if should be rejected
   */
  validateMessage?(
    message: P2PMessage,
    from: PeerInfo,
  ): Promise<boolean> | boolean

  /**
   * Check if peer can announce a resource
   * @returns true if allowed, false if denied
   */
  canAnnounceResource?(
    resourceType: string,
    peerId: string,
  ): Promise<boolean> | boolean
}

/**
 * Core security metrics
 */
export interface CoreSecurityMetrics {
  dhtAnnouncements: {
    total: number
    rejected: number
    rateLimited: number
  }
  messages: {
    total: number
    rejected: number
    oversized: number
  }
  peers: {
    banned: number
    warnings: number
  }
}
