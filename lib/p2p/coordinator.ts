/**
 * P2P Coordinator
 *
 * Main entry point for P2P functionality using libp2p
 */

import { EventEmitter } from 'events'
import { createLibp2p, Libp2p } from 'libp2p'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'
import { isPrivate } from '@libp2p/utils'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@libp2p/yamux'
import {
  kadDHT,
  KadDHT,
  SingleKadDHT,
  passthroughMapper,
  removePrivateAddressesMapper,
  type PeerInfoMapper,
} from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@libp2p/gossipsub'
import type { GossipSub } from '@libp2p/gossipsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { autoNAT } from '@libp2p/autonat'
import { dcutr } from '@libp2p/dcutr'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { bootstrap } from '@libp2p/bootstrap'
import { peerIdFromString } from '@libp2p/peer-id'
import { isBrowser } from '../../utils/functions.js'
import type {
  Connection,
  Stream,
  PeerId,
  PeerDiscovery,
} from '@libp2p/interface'
import type { StreamHandler } from '@libp2p/interface'
import type { PeerInfo as P2PPeerInfo } from '@libp2p/interface'

import {
  P2PConfig,
  P2PMessage,
  PeerInfo,
  IProtocolHandler,
  ConnectionEvent,
  RelayEvent,
  ResourceAnnouncement,
  BroadcastOptions,
  DHTStats,
  P2PStats,
  CORE_P2P_SECURITY_LIMITS,
} from './types.js'
import { P2PProtocol } from './protocol.js'
import { CoreSecurityManager } from './security.js'

/**
 * Main P2P Coordinator using libp2p
 */
export class P2PCoordinator extends EventEmitter {
  protected node?: Libp2p
  private protocol: P2PProtocol
  private protocolHandlers: Map<string, IProtocolHandler> = new Map()
  private seenMessages: Set<string> = new Set()
  private peerInfo: Map<string, PeerInfo> = new Map()
  private dhtValues: Map<string, ResourceAnnouncement> = new Map()
  private cleanupIntervalId?: NodeJS.Timeout
  // SECURITY: Core security manager (protocol-agnostic)
  protected coreSecurityManager: CoreSecurityManager
  // Track last advertised relay addresses for change detection
  private lastAdvertisedMultiaddrs: string[] = []
  // Track GossipSub topic handlers for proper cleanup
  private topicHandlers: Map<
    string,
    (evt: CustomEvent<{ topic: string; data: Uint8Array }>) => void
  > = new Map()

  constructor(protected readonly config: P2PConfig) {
    super()
    this.protocol = new P2PProtocol()

    // SECURITY: Initialize core security manager with config
    this.coreSecurityManager = new CoreSecurityManager({
      disableRateLimiting: config.securityConfig?.disableRateLimiting ?? false,
      customLimits: config.securityConfig?.customLimits,
    })

    // SECURITY: Start automatic DHT cleanup to prevent memory leaks
    this.startDHTCleanup()
  }

  /**
   * Get core security manager
   * Allows protocols to register validators and access security features
   */
  getCoreSecurityManager(): CoreSecurityManager {
    return this.coreSecurityManager
  }

  /**
   * Start periodic DHT cleanup task
   * Removes expired entries from local cache every 5 minutes
   */
  private startDHTCleanup(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanup()
      },
      5 * 60 * 1000, // Every 5 minutes
    )
  }

  /**
   * Start the P2P node
   */
  async start(): Promise<void> {
    // Determine appropriate peerInfoMapper based on environment
    // If user provides custom mapper, use it
    // Otherwise, auto-detect based on listen addresses
    let peerInfoMapper = this.config.dhtPeerInfoMapper

    if (!peerInfoMapper) {
      // Auto-detect: If listening on localhost, use passthroughMapper
      // If listening on private addresses with bootstrap peers, use relay-aware mapper
      // If listening on public addresses, use removePrivateAddressesMapper
      const listenAddrs = this.config.listen || ['/ip4/0.0.0.0/tcp/0']
      const isPrivateListenAddresses = listenAddrs.some(addr =>
        isPrivate(multiaddr(addr)),
      )

      if (isPrivateListenAddresses) {
        // Development/testing on localhost - allow private addresses
        peerInfoMapper = passthroughMapper
      } else {
        // Production - filter out private addresses for security
        peerInfoMapper = removePrivateAddressesMapper
      }
    }

    // Build libp2p configuration
    // kad-dht requires identify and ping services
    // gossipsub requires identify

    // Prepare transports array based on environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transports: any[] = []

    if (isBrowser()) {
      // Browser environment: Use WebSockets and WebRTC
      // TCP is NOT available in browsers - attempting to use it throws:
      // "Error: TCP connections are not possible in browsers"

      // WebSockets for browser-to-server connections
      transports.push(webSockets())

      // WebRTC for browser-to-browser P2P connections
      // Dynamically import since it's an optional dependency
      // Note: WebRTC requires @libp2p/webrtc package
      try {
        const { webRTC } = await import('@libp2p/webrtc')
        transports.push(webRTC())
      } catch {
        console.warn(
          'WebRTC transport not available. Install @libp2p/webrtc for browser-to-browser P2P.',
        )
      }
    } else {
      // Node.js environment: Use TCP and WebSockets
      const { tcp } = await import('@libp2p/tcp')
      transports.push(tcp())

      // WebSockets for connecting to browser peers and firewall traversal
      transports.push(webSockets())
    }

    // Circuit Relay v2 (NAT traversal for all environments)
    // Enables peers behind NAT to connect via relay nodes
    // DCUTR will automatically upgrade relay connections to direct P2P
    // Relay discovery happens automatically via DHT and identify protocol
    if (this.config.enableRelay !== false) {
      transports.push(circuitRelayTransport())
    }

    // Build services configuration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services: any = {
      identify: identify(),
      ping: ping(),
    }

    // DHT service
    if (this.config.enableDHT !== false) {
      services.kadDHT = kadDHT({
        protocol: this.config.dhtProtocol || '/lotus/kad/1.0.0',
        clientMode: !(this.config.enableDHTServer ?? false),
        peerInfoMapper,
      })
    }

    // GossipSub service
    if (this.config.enableGossipSub !== false) {
      services.pubsub = gossipsub({
        allowPublishToZeroTopicPeers: true, // TEMPORARY: Enable for testing relay message forwarding
        // CRITICAL: emitSelf MUST be false to prevent duplicate self-message processing
        // Self-messages are handled manually in broadcast() method (line 467) for precise control
        // This prevents GossipSub from emitting duplicate self-messages that would bypass validation
        emitSelf: false, // Prevent duplicate self-messages - coordinator handles self-processing
        // Enable peer exchange (PX) for subscription info propagation
        // This allows peers to discover topic subscribers through intermediate nodes
        doPX: true, // Critical for relaying subscription info through bootstrap nodes
      })
    }

    // Circuit Relay Server (for bootstrap/relay nodes to relay traffic)
    // This allows the node to act as a relay for NAT peers
    // Should only be enabled on public bootstrap nodes
    if (this.config.enableRelayServer === true) {
      services.relay = circuitRelayServer({
        reservations: {
          maxReservations: 100, // Max number of peers that can reserve relay slots
        },
      })
    }

    // AutoNAT service (detect if behind NAT and discover public address)
    // Enabled by default for all nodes
    if (this.config.enableAutoNAT !== false) {
      services.autoNAT = autoNAT()
    }

    // DCUTR service (Direct Connection Upgrade through Relay)
    // Automatically upgrades relay connections to direct P2P connections
    // Enabled by default when relay is enabled
    if (
      this.config.enableDCUTR !== false &&
      this.config.enableRelay !== false
    ) {
      services.dcutr = dcutr()
    }

    // UPnP NAT service (automatic port forwarding - LAST RESORT)
    // Disabled by default - only enable if explicitly requested
    // UPnP can expose security risks and should be opt-in only
    if (this.config.enableUPnP === true) {
      services.upnpNAT = uPnPNAT()
    }

    // Peer discovery configuration
    const peerDiscovery: ReturnType<typeof bootstrap>[] = []

    // Bootstrap peer discovery (automatic connection to bootstrap nodes)
    // If bootstrapPeers are configured, automatically connect on startup
    if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
      let bootstrapList = this.config.bootstrapPeers

      // In browser environment, filter out TCP-only addresses
      // Browsers can only connect via WebSocket (ws/wss) or WebRTC
      if (isBrowser()) {
        bootstrapList = bootstrapList.filter(addr => {
          // Keep addresses that contain /ws, /wss, or /webrtc
          // Filter out pure TCP addresses
          return (
            addr.includes('/ws') ||
            addr.includes('/wss') ||
            addr.includes('/webrtc')
          )
        })

        if (
          bootstrapList.length === 0 &&
          this.config.bootstrapPeers.length > 0
        ) {
          console.warn(
            'No browser-compatible bootstrap peers found. ' +
              'Browsers require WebSocket (ws/wss) or WebRTC addresses. ' +
              'TCP addresses are not supported in browsers.',
          )
        }
      }

      if (bootstrapList.length > 0) {
        peerDiscovery.push(
          bootstrap({
            list: bootstrapList,
          }),
        )
      }
    }

    // Build listen addresses
    // CRITICAL: Add /p2p-circuit to listen addresses when relay is enabled
    // This tells libp2p to listen for incoming connections via circuit relay
    // and automatically advertise relay addresses in getMultiaddrs()
    // See: https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md
    let listenAddrs: string[]

    if (isBrowser()) {
      // Browser environment: Can only listen via circuit relay
      // Browsers cannot bind to TCP/UDP ports directly
      // Use /p2p-circuit to accept incoming relay connections
      listenAddrs = this.config.listen
        ? [...this.config.listen]
        : ['/p2p-circuit']
    } else {
      // Node.js environment: Can listen on TCP
      listenAddrs = this.config.listen
        ? [...this.config.listen]
        : ['/ip4/0.0.0.0/tcp/0']
    }

    // Ensure /p2p-circuit is in listen addresses when relay is enabled
    if (
      this.config.enableRelay !== false &&
      !listenAddrs.includes('/p2p-circuit')
    ) {
      listenAddrs.push('/p2p-circuit')
    }

    const config: Parameters<typeof createLibp2p>[0] = {
      privateKey: this.config.privateKey, // Use fixed privateKey if provided (for persistent identity)
      addresses: {
        listen: listenAddrs,
        announce: this.config.announce || [],
      },
      transports,
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery,
      services,
      connectionManager: {
        maxConnections: this.config.connectionManager?.maxConnections ?? 50, // Sane default: 50 connections
      },
    }

    this.node = await createLibp2p(config)

    // Setup event handlers
    this._setupEventHandlers()

    // Register protocol stream handlers (must happen after node is created)
    this._registerProtocolStreamHandlers()

    // Start node
    await this.node.start()

    /* console.log('P2P node started')
    console.log('Peer ID:', this.node.peerId.toString())
    console.log(
      'Listening on:',
      this.node.getMultiaddrs().map(ma => ma.toString()),
    ) */
  }

  /**
   * Stop the P2P node
   */
  async stop(): Promise<void> {
    // SECURITY: Clear cleanup interval to allow process exit
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = undefined
    }

    if (this.node) {
      // Stop the node - this should stop all services including DHT
      await this.node.stop()
      this.node = undefined
    }
    // Clear all internal state to prevent memory leaks
    this.protocolHandlers.clear()
    this.seenMessages.clear()
    this.dhtValues.clear()
    this.peerInfo.clear()
    this.topicHandlers.clear()

    // SECURITY: Clear core security manager listeners
    this.coreSecurityManager.removeAllListeners()

    // Clear event listeners to prevent event loop from hanging
    this.removeAllListeners()
  }

  /**
   * Get this node's peer ID
   */
  get peerId(): string {
    if (!this.node) {
      throw new Error('Node not started')
    }
    return this.node.peerId.toString()
  }

  /**
   * Get libp2p node instance
   */
  get libp2pNode(): Libp2p {
    if (!this.node) {
      throw new Error('Node not started')
    }
    return this.node
  }

  /**
   * Register protocol handler
   */
  registerProtocol(handler: IProtocolHandler): void {
    if (this.protocolHandlers.has(handler.protocolName)) {
      throw new Error(`Protocol already registered: ${handler.protocolName}`)
    }

    this.protocolHandlers.set(handler.protocolName, handler)

    // If node is already started, register stream handler immediately
    // Otherwise, stream handlers will be registered during start()
    if (this.node && handler.handleStream) {
      const streamHandler: StreamHandler = async (stream, connection) => {
        try {
          await handler.handleStream!(stream, connection)
        } catch (error) {
          console.error(
            `Error in stream handler for ${handler.protocolName}:`,
            error,
          )
        }
      }
      this.node.handle(handler.protocolId, streamHandler)
    }
  }

  /**
   * Unregister protocol handler
   */
  unregisterProtocol(protocolName: string): void {
    const handler = this.protocolHandlers.get(protocolName)
    if (handler && this.node) {
      this.node.unhandle(handler.protocolId)
    }
    this.protocolHandlers.delete(protocolName)
  }

  /**
   * Connect to peer by multiaddr
   */
  async connectToPeer(peerAddr: string | Multiaddr): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const ma = typeof peerAddr === 'string' ? multiaddr(peerAddr) : peerAddr
    await this.node.dial(ma)
  }

  /**
   * Disconnect from peer
   */
  async disconnectFromPeer(peerId: string): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const parsedPeerId = peerIdFromString(peerId)
    const connections = this.node.getConnections(parsedPeerId)
    await Promise.all(
      connections.map(conn =>
        conn.close({
          signal: AbortSignal.timeout(2000),
        }),
      ),
    )
  }

  /**
   * Send message to specific peer
   */
  async sendTo(
    peerId: string,
    message: P2PMessage,
    protocolId?: string,
  ): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const protocol = protocolId || '/lotus/message/1.0.0'
    const parsedPeerId = peerIdFromString(peerId)
    const stream = await this.node.dialProtocol(parsedPeerId, protocol)

    try {
      const serialized = this.protocol.serialize(message)
      // Send data - this queues it in the buffer
      stream.send(serialized)
    } finally {
      // Close will wait for any pending data to be transmitted
      await stream.close()
    }
  }

  /**
   * Broadcast message to all connected peers
   *
   * ARCHITECTURE: For event-driven architecture, the sender also processes their
   * own broadcast message to ensure consistent event ordering across all peers.
   */
  async broadcast(
    message: P2PMessage,
    options?: BroadcastOptions,
  ): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const peers = this.node.getPeers()

    // Filter peers
    let targetPeers = peers
    if (options?.exclude) {
      targetPeers = targetPeers.filter(
        p => !options.exclude!.includes(p.toString()),
      )
    }
    if (options?.includedOnly) {
      targetPeers = targetPeers.filter(p =>
        options.includedOnly!.includes(p.toString()),
      )
    }

    // Send to all targets, but skip relay-only (limited) connections
    // Limited connections cannot open protocol streams, only GossipSub works
    const promises = targetPeers
      .filter(peer => {
        // Check if peer has any direct (non-relay) connections
        const connections = this.libp2pNode.getConnections(peer)
        const hasDirectConnection = connections.some(conn => {
          // A connection is direct if it doesn't have /p2p-circuit in the multiaddr
          const addr = conn.remoteAddr?.toString() || ''
          return !addr.includes('/p2p-circuit')
        })
        return hasDirectConnection
      })
      .map(peer =>
        this.sendTo(peer.toString(), message, options?.protocol).catch(
          error => {
            console.error(`Failed to send to peer ${peer.toString()}:`, error)
          },
        ),
      )

    await Promise.all(promises)

    // CRITICAL: Also send to self for consistent event ordering
    // The protocol handler will process our own message and emit appropriate events
    // This ensures all peers (including sender) emit events in the same order
    //
    // We process the self-message AFTER the broadcast completes (not before)
    // to simulate the network propagation delay and ensure proper ordering
    const peerInfo: PeerInfo = {
      peerId: this.peerId,
      lastSeen: Date.now(),
    }

    // Route to protocol handler (same path as messages from other peers)
    const handler = this.protocolHandlers.get(message.protocol || '')
    if (handler) {
      // Process synchronously after broadcast completes
      await handler.handleMessage(message, peerInfo).catch(error => {
        console.error('[P2P] Error processing self-broadcast:', error)
      })
    }
  }

  /**
   * Announce resource to DHT
   */
  async announceResource<T = unknown>(
    resourceType: string,
    resourceId: string,
    data: T,
    options?: {
      ttl?: number
      expiresAt?: number
    },
  ): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const peerId = this.node.peerId.toString()

    // NOTE: We do NOT rate limit our own outgoing announcements
    // Rate limiting is ONLY applied to INCOMING data from OTHER peers
    // This is enforced in protocol handlers when receiving data

    const announcement: ResourceAnnouncement<T> = {
      resourceId,
      resourceType,
      creatorPeerId: peerId,
      data,
      createdAt: Date.now(),
      expiresAt: options?.expiresAt,
    }

    // Store locally
    const key = this._makeResourceKey(resourceType, resourceId)
    this.dhtValues.set(key, announcement as ResourceAnnouncement<unknown>)

    // Put in DHT if server mode is enabled AND routing table is ready
    // In client-only mode, we only store locally
    //
    // Failsafe: Check if routing table has peers before DHT operations
    // Why? Even with auto-population via TopologyListener, there's a brief window
    // during startup before the first peer connects. This prevents hanging.
    // Also handles network partitions and isolated scenarios gracefully.
    if (this.node.services.kadDHT && this.config.enableDHTServer) {
      const dhtStats = this.getDHTStats()

      if (dhtStats.isReady) {
        // DHT routing table has peers - proceed with propagation
        const dht = this.node.services.kadDHT as KadDHT
        const keyBytes = Buffer.from(key, 'utf8')
        const valueBytes = Buffer.from(JSON.stringify(announcement), 'utf8')

        await this._putDHT(keyBytes, valueBytes, 5000)
      }
      // Else: Routing table empty, skip DHT propagation
      // Resource is still in local cache for later propagation
    }

    this.emit('resource:announced', announcement)
  }

  /**
   * Get all resources of a given type from local cache
   */
  getLocalResources(
    resourceType: string,
    filters?: Record<string, unknown>,
  ): Array<ResourceAnnouncement<unknown>> {
    const results: Array<ResourceAnnouncement<unknown>> = []

    // Search local cache only
    for (const [key, announcement] of this.dhtValues.entries()) {
      if (announcement.resourceType === resourceType) {
        if (this._matchesFilters(announcement, filters)) {
          if (!announcement.expiresAt || announcement.expiresAt > Date.now()) {
            results.push(announcement)
          }
        }
      }
    }

    return results
  }

  /**
   * Get resource from local cache only
   */
  getResource(
    resourceType: string,
    resourceId: string,
  ): ResourceAnnouncement | null {
    const key = this._makeResourceKey(resourceType, resourceId)

    // Check local cache
    const cached = this.dhtValues.get(key)
    if (cached) {
      // Check expiration
      if (!cached.expiresAt || cached.expiresAt > Date.now()) {
        return cached
      }
    }

    return null
  }

  /**
   * Discover resource from DHT network
   * Searches local cache first, then queries DHT if enabled
   * Note: DHT queries work in both client and server mode
   *
   * Failsafe: Only queries DHT if routing table has peers
   * Even with auto-population, this prevents wasted queries during startup
   */
  async discoverResource(
    resourceType: string,
    resourceId: string,
    timeoutMs: number = 5000,
  ): Promise<ResourceAnnouncement | null> {
    const key = this._makeResourceKey(resourceType, resourceId)

    // Check cache first (fast path)
    const cached = this.dhtValues.get(key)
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
      return cached
    }

    // Query DHT network if DHT is enabled AND routing table is ready
    // Failsafe: Don't query DHT if routing table is empty (no peers to query)
    // This prevents hanging during startup or in isolated networks
    if (this.node?.services.kadDHT) {
      const dhtStats = this.getDHTStats()

      if (dhtStats.isReady) {
        // DHT has peers in routing table - proceed with query
        return this._queryDHT(key, timeoutMs)
      }
      // Routing table empty - skip DHT query
      // This is normal immediately after startup or in network partitions
    }

    return null
  }

  /**
   * Internal method to query DHT with timeout
   *
   * DHT queries in libp2p return an async iterator that may not complete naturally
   * in small networks. We use a timeout + event limit to ensure termination.
   * This is the recommended pattern for DHT operations in variable network conditions.
   */
  private async _queryDHT(
    key: string,
    timeoutMs: number,
  ): Promise<ResourceAnnouncement | null> {
    if (!this.node?.services.kadDHT) {
      return null
    }

    const dht = this.node.services.kadDHT as KadDHT
    const keyBytes = Buffer.from(key, 'utf8')
    const controller = new AbortController()

    // Set overall timeout for the entire DHT query
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      let eventCount = 0
      const maxEvents = 20 // Limit events to prevent infinite loops

      for await (const event of dht.get(keyBytes, {
        signal: controller.signal,
      })) {
        eventCount++

        // Handle VALUE event
        if (event.name === 'VALUE') {
          const valueStr = Buffer.from(event.value).toString('utf8')
          const announcement = JSON.parse(valueStr) as ResourceAnnouncement

          // SECURITY: Check expiry before returning (prevent stale data attacks)
          if (announcement.expiresAt && announcement.expiresAt < Date.now()) {
            const expiredAgo = Math.round(
              (Date.now() - announcement.expiresAt) / 1000,
            )
            console.warn(
              `[P2P] DHT returned expired entry (expired ${expiredAgo}s ago): ${key}`,
            )
            // Don't return it, continue looking for valid providers
            continue
          }

          // Cache it
          this.dhtValues.set(key, announcement)
          clearTimeout(timeout)
          controller.abort() // Cancel further searching
          return announcement
        }

        // Prevent infinite iteration
        if (eventCount >= maxEvents) {
          controller.abort()
          break
        }
      }
    } catch (error) {
      // AbortError is expected when we cancel or timeout
      if ((error as Error).name !== 'AbortError') {
        console.error('Error querying DHT:', error)
      }
    } finally {
      clearTimeout(timeout)
    }

    return null
  }

  /**
   * Internal method to put value in DHT with timeout
   *
   * DHT put operations in libp2p return an async iterator for replication events.
   * In small networks without sufficient peers, this iterator may not emit events.
   * We use a timeout + event limit to ensure the operation completes gracefully.
   */
  private async _putDHT(
    keyBytes: Buffer,
    valueBytes: Buffer,
    timeoutMs: number,
  ): Promise<void> {
    if (!this.node?.services.kadDHT) {
      return
    }

    const dht = this.node.services.kadDHT as KadDHT
    const controller = new AbortController()

    // Set overall timeout
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      let eventCount = 0
      const maxEvents = 20

      for await (const event of dht.put(keyBytes, valueBytes, {
        signal: controller.signal,
      })) {
        eventCount++
        // Limit events to prevent infinite iteration
        if (eventCount >= maxEvents) {
          controller.abort()
          break
        }
      }
    } catch (error) {
      // AbortError is expected and acceptable
      if ((error as Error).name !== 'AbortError') {
        console.error('Error storing in DHT:', error)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Get all connected peers
   */
  getConnectedPeers(): PeerInfo[] {
    if (!this.node) {
      return []
    }

    const peers = this.node.getPeers()
    return peers.map(peerId => {
      const cached = this.peerInfo.get(peerId.toString())
      if (cached) {
        return cached
      }

      // Create basic peer info
      const connections = this.libp2pNode.getConnections(peerId)
      const multiaddrs = connections.flatMap(conn =>
        conn.remoteAddr ? [conn.remoteAddr.toString()] : [],
      )

      return {
        peerId: peerId.toString(),
        multiaddrs,
        lastSeen: Date.now(),
      }
    })
  }

  /**
   * Get peer info
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peerInfo.get(peerId)
  }

  /**
   * Check if connected to peer
   */
  isConnected(peerId: string): boolean {
    if (!this.node) {
      return false
    }

    const parsedPeerId = peerIdFromString(peerId)
    const connections = this.node.getConnections(parsedPeerId)
    return connections.length > 0
  }

  /**
   * Get connection statistics
   */
  getStats(): P2PStats {
    if (!this.node) {
      return {
        peerId: 'not-started',
        peers: { total: 0, connected: 0 },
        dht: {
          enabled: false,
          mode: 'disabled',
          routingTableSize: 0,
          localRecords: 0,
        },
        multiaddrs: [],
      }
    }

    const peers = this.node.getPeers()
    const multiaddrs = this.node.getMultiaddrs()
    const dhtStats = this.getDHTStats()

    return {
      peerId: this.node.peerId.toString(),
      peers: {
        total: peers.length,
        connected: peers.length,
      },
      dht: {
        enabled: dhtStats.enabled,
        mode: dhtStats.mode,
        routingTableSize: dhtStats.routingTableSize,
        localRecords: this.dhtValues.size,
      },
      multiaddrs: multiaddrs.map(ma => ma.toString()),
    }
  }

  /**
   * Get reachable addresses for peer discovery and NAT traversal
   *
   * Production implementation:
   * - Relay circuit addresses (highest priority for NAT traversal)
   * - Public addresses (if publicly reachable)
   *
   * This is CRITICAL for DCUtR - peers must advertise reachable addresses
   */
  async getReachableAddresses(): Promise<string[]> {
    if (!this.node) {
      return []
    }

    // Get all multiaddrs the node is announcing
    const announcedAddrs = this.node.getMultiaddrs()

    // PRODUCTION: Always prioritize relay circuit addresses for NAT traversal
    const relayCircuitAddrs = this._constructRelayCircuitAddresses()
    if (relayCircuitAddrs.length > 0) {
      console.log(
        `[P2P] Using ${relayCircuitAddrs.length} relay circuit addresses for NAT traversal`,
      )
      return relayCircuitAddrs
    }

    // Fallback: Try to use public addresses
    try {
      const peer = await this.node.peerStore.get(this.node.peerId)
      if (peer?.addresses) {
        const observableAddrs = peer.addresses.map(addr => addr.toString())

        // Filter for PUBLIC addresses only (exclude private LAN ranges)
        const publicAddrs = observableAddrs.filter((addr: string) => {
          // Exclude localhost
          if (addr.includes('/ip4/127.') || addr.includes('/ip6/::1/')) {
            return false
          }
          // Exclude wildcard
          if (addr.includes('/ip4/0.0.0.0/')) {
            return false
          }
          // Exclude private LAN ranges using regex for accurate matching
          // RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
          // Also exclude link-local: 169.254.0.0/16
          const ipv4Match = addr.match(/\/ip4\/(\d+\.\d+\.\d+\.\d+)\//)
          if (ipv4Match) {
            const ip = ipv4Match[1]
            const octets = ip.split('.').map(Number)

            // 10.0.0.0/8
            if (octets[0] === 10) return false

            // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
            if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
              return false

            // 192.168.0.0/16
            if (octets[0] === 192 && octets[1] === 168) return false

            // 169.254.0.0/16 (link-local)
            if (octets[0] === 169 && octets[1] === 254) return false

            // 127.0.0.0/8 (loopback - extra check)
            if (octets[0] === 127) return false
          }

          // Include public addresses
          return true
        })

        if (publicAddrs.length > 0) {
          console.log(`[P2P] Using ${publicAddrs.length} public addresses`)
          return publicAddrs
        }
      }
    } catch (error) {
      console.debug(
        '[P2P] Could not get observable addresses, falling back to relay circuits',
      )
    }

    // Final fallback: Use relay circuits
    console.log(`[P2P] No public addresses available, using relay circuits`)
    return this._constructRelayCircuitAddresses()
  }

  /**
   * Construct relay circuit addresses that other peers can use to reach us
   *
   * Production implementation uses bootstrap peers as relays for reliable NAT traversal
   */
  private _constructRelayCircuitAddresses(): string[] {
    if (!this.node) {
      return []
    }

    const circuitAddrs: string[] = []

    try {
      // Use bootstrap peers as relays for production NAT traversal
      if (this.config.bootstrapPeers) {
        const connections = this.node.getConnections()

        for (const bootstrapAddr of this.config.bootstrapPeers) {
          // Parse the bootstrap address to get the relay peer ID
          const parts = bootstrapAddr.split('/p2p/')
          if (parts.length === 2) {
            const relayPeerId = parts[1]

            // Check if we're connected to this bootstrap peer
            const isConnected = connections.some(
              conn => conn.remotePeer.toString() === relayPeerId,
            )

            if (isConnected) {
              // Construct circuit address using the bootstrap peer
              const circuitAddr =
                bootstrapAddr +
                '/p2p-circuit/p2p/' +
                this.node.peerId.toString()
              circuitAddrs.push(circuitAddr)
              console.log(
                `[P2P] Bootstrap relay circuit: ${bootstrapAddr} → ${circuitAddr}`,
              )
            }
          }
        }
      }
    } catch (error) {
      console.debug('[P2P] Error constructing relay circuit addresses:', error)
    }

    return circuitAddrs
  }

  /**
   * Check if this node has relay circuit addresses available
   * Indicates we're connected to at least one relay and can be reached via circuit
   */
  async hasRelayAddresses(): Promise<boolean> {
    const reachableAddrs = await this.getReachableAddresses()
    return reachableAddrs.some((addr: string) =>
      addr.includes('/p2p-circuit/p2p/'),
    )
  }

  /**
   * Get relay circuit addresses only
   * Returns addresses that go through relay nodes for NAT traversal
   */
  async getRelayAddresses(): Promise<string[]> {
    const reachableAddrs = await this.getReachableAddresses()
    return reachableAddrs.filter((addr: string) =>
      addr.includes('/p2p-circuit/p2p/'),
    )
  }

  /**
   * Get current connection statistics
   * Returns information about active peer connections
   */
  getConnectionStats(): {
    totalConnections: number
    connectedPeers: string[]
  } {
    if (!this.node) {
      return {
        totalConnections: 0,
        connectedPeers: [],
      }
    }

    const connections = this.node.getConnections()
    const connectedPeers = connections.map(conn => conn.remotePeer.toString())

    return {
      totalConnections: connections.length,
      connectedPeers,
    }
  }

  /**
   * Check and notify about relay address changes (called by self:peer:update event)
   */
  private async _checkAndNotifyRelayAddresses(): Promise<void> {
    try {
      const currentAddrs = await this.getReachableAddresses()

      // Check if relay addresses have changed
      const hasNewRelayAddrs = currentAddrs.some(
        (addr: string) =>
          addr.includes('/p2p-circuit/p2p/') &&
          !this.lastAdvertisedMultiaddrs.includes(addr),
      )

      if (hasNewRelayAddrs) {
        console.log('[P2P] New relay addresses detected (periodic check)')

        // Update stored addresses for tracking
        this.lastAdvertisedMultiaddrs = [...currentAddrs]

        // Emit core event
        this.emit(RelayEvent.ADDRESSES_AVAILABLE, {
          peerId: this.peerId,
          reachableAddresses: currentAddrs,
          relayAddresses: currentAddrs.filter((addr: string) =>
            addr.includes('/p2p-circuit/p2p/'),
          ),
          timestamp: Date.now(),
        })

        // Notify protocol handlers
        const relayData = {
          peerId: this.peerId,
          reachableAddresses: currentAddrs,
          relayAddresses: currentAddrs.filter((addr: string) =>
            addr.includes('/p2p-circuit/p2p/'),
          ),
          timestamp: Date.now(),
        }

        for (const handler of this.protocolHandlers.values()) {
          if (handler.onRelayAddressesChanged) {
            handler.onRelayAddressesChanged(relayData).catch(error => {
              console.error(
                `Error in onRelayAddressesChanged for ${handler.protocolName}:`,
                error,
              )
            })
          }
        }
      }
    } catch (error) {
      console.debug('[P2P] Relay address check error:', error)
    }
  }

  /**
   * Get DHT-specific statistics and status
   * Use this to make intelligent decisions about DHT operations
   *
   * isReady: Indicates if routing table has peers
   * - With passthroughMapper (localhost): Auto-populates via TopologyListener
   * - With removePrivateAddressesMapper (production): Auto-populates for public peers
   * - Always check isReady before DHT operations to prevent hanging during startup
   */
  getDHTStats(): DHTStats {
    if (!this.node?.services.kadDHT) {
      return {
        enabled: false,
        mode: 'disabled',
        routingTableSize: 0,
        isReady: false,
      }
    }

    const dht = this.node.services.kadDHT as SingleKadDHT
    // Access public RoutingTable.size property (no internal APIs needed)
    const routingTableSize = dht.routingTable?.size ?? 0

    // Get DHT mode
    let mode: 'client' | 'server' | 'disabled' = 'disabled'
    if (dht.getMode) {
      mode = dht.getMode()
    } else {
      // Fallback: check config
      mode = this.config.enableDHTServer ? 'server' : 'client'
    }

    // DHT is "ready" if routing table has at least 1 peer
    // With proper peerInfoMapper configuration, this happens automatically
    // via TopologyListener when peers connect and identify completes
    const isReady = routingTableSize > 0

    return {
      enabled: true,
      mode,
      routingTableSize,
      isReady,
    }
  }

  /**
   * Cleanup expired DHT entries
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, announcement] of this.dhtValues.entries()) {
      if (announcement.expiresAt && announcement.expiresAt < now) {
        this.dhtValues.delete(key)

        // SECURITY: Remove from resource tracker when expired
        this.coreSecurityManager.resourceTracker.removeResource(
          announcement.creatorPeerId,
          announcement.resourceType,
          announcement.resourceId,
        )
      }
    }

    // SECURITY: Cleanup core security manager data
    this.coreSecurityManager.cleanup()
  }

  /**
   * Shutdown coordinator
   */
  async shutdown(): Promise<void> {
    // SECURITY: Stop cleanup interval before shutdown
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = undefined
    }

    if (this.node) {
      await this.node.stop()
      this.node = undefined
    }

    this.protocolHandlers.clear()
    this.seenMessages.clear()
    this.dhtValues.clear()
    this.peerInfo.clear()
    this.topicHandlers.clear()

    // SECURITY: Clear core security manager
    this.coreSecurityManager.removeAllListeners()

    this.removeAllListeners()
  }

  /**
   * Setup event handlers for libp2p events
   */
  private _setupEventHandlers(): void {
    if (!this.node) {
      return
    }

    // CRITICAL: Listen for self peer updates (when our own multiaddrs change)
    // This includes when relay circuit addresses become available
    this.node.addEventListener('self:peer:update', event => {
      console.log(
        '[P2P] Self peer updated - checking for relay address changes',
      )
      this._checkAndNotifyRelayAddresses().catch(error => {
        console.debug('[P2P] Error checking relay addresses:', error)
      })
    })

    // Peer connection events
    this.node.addEventListener('peer:connect', event => {
      const peerId = event.detail.toString()

      // Get existing peer info (may have multiaddrs from discovery)
      const existing = this.peerInfo.get(peerId)

      // Get fresh multiaddrs from active connections
      const connections = this.libp2pNode.getConnections(event.detail)
      const multiaddrs = connections.flatMap(conn =>
        conn.remoteAddr ? [conn.remoteAddr.toString()] : [],
      )

      // Merge with existing data, preferring fresh connection multiaddrs
      const peerInfo: PeerInfo = {
        peerId,
        multiaddrs: multiaddrs.length > 0 ? multiaddrs : existing?.multiaddrs,
        publicKey: existing?.publicKey,
        metadata: existing?.metadata,
        lastSeen: Date.now(),
      }
      this.peerInfo.set(peerId, peerInfo)

      this.emit(ConnectionEvent.CONNECTED, peerInfo)

      // Notify protocol handlers
      for (const handler of this.protocolHandlers.values()) {
        handler.onPeerConnected?.(peerId).catch(error => {
          console.error(
            `Error in onPeerConnected for ${handler.protocolName}:`,
            error,
          )
        })
      }
    })

    this.node.addEventListener('peer:disconnect', event => {
      const peerId = event.detail.toString()

      const peerInfo = this.peerInfo.get(peerId)
      if (peerInfo) {
        this.emit(ConnectionEvent.DISCONNECTED, peerInfo)
      }

      // Notify protocol handlers
      for (const handler of this.protocolHandlers.values()) {
        handler.onPeerDisconnected?.(peerId).catch((error: Error) => {
          console.error(
            `Error in onPeerDisconnected for ${handler.protocolName}:`,
            error,
          )
        })
      }
    })

    this.node.addEventListener('peer:discovery', event => {
      const detail = event.detail
      const peerId = detail.id.toString()
      const multiaddrs = detail.multiaddrs.map(ma => ma.toString())

      const peerInfo: PeerInfo = {
        peerId,
        multiaddrs,
        lastSeen: Date.now(),
      }

      this.peerInfo.set(peerId, peerInfo)
      this.emit(ConnectionEvent.DISCOVERED, peerInfo)

      // Notify protocol handlers about discovered peer
      for (const handler of this.protocolHandlers.values()) {
        handler.onPeerDiscovered?.(peerInfo).catch(error => {
          console.error(
            `Error in onPeerDiscovered for ${handler.protocolName}:`,
            error,
          )
        })
      }
    })

    this.node.addEventListener('peer:update', event => {
      const detail = event.detail
      const peer = detail.peer
      const peerId = peer.id.toString()

      // Get existing peer info
      const existing = this.peerInfo.get(peerId)

      // Get fresh multiaddrs from active connections if available
      const connections = this.libp2pNode.getConnections(peer.id)
      const multiaddrs = connections.flatMap(conn =>
        conn.remoteAddr ? [conn.remoteAddr.toString()] : [],
      )

      const peerInfo: PeerInfo = {
        peerId,
        multiaddrs: multiaddrs.length > 0 ? multiaddrs : existing?.multiaddrs,
        publicKey: existing?.publicKey,
        metadata: existing?.metadata,
        lastSeen: Date.now(),
      }

      this.peerInfo.set(peerId, peerInfo)
      this.emit(ConnectionEvent.UPDATED, peerInfo)

      // Notify protocol handlers about updated peer
      for (const handler of this.protocolHandlers.values()) {
        handler.onPeerUpdated?.(peerInfo).catch(error => {
          console.error(
            `Error in onPeerUpdated for ${handler.protocolName}:`,
            error,
          )
        })
      }
    })

    // Register default message handler
    const messageHandler: StreamHandler = async (stream, connection) => {
      try {
        await this._handleIncomingStream(stream, connection)
      } catch (error) {
        console.error('Error handling message stream:', error)
      }
    }
    this.node.handle('/lotus/message/1.0.0', messageHandler)
  }

  /**
   * Register stream handlers for all protocol handlers
   * Must be called after this.node is created
   */
  private _registerProtocolStreamHandlers(): void {
    if (!this.node) {
      throw new Error(
        'Cannot register protocol stream handlers: node not created',
      )
    }

    // Iterate through all registered protocol handlers
    for (const handler of this.protocolHandlers.values()) {
      // Register stream handler with libp2p if handler supports it
      if (handler.handleStream) {
        const streamHandler: StreamHandler = async (stream, connection) => {
          try {
            await handler.handleStream!(stream, connection)
          } catch (error) {
            console.error(
              `Error in stream handler for ${handler.protocolName}:`,
              error,
            )
          }
        }
        this.node.handle(handler.protocolId, streamHandler)
      }
    }
  }

  /**
   * Handle incoming message stream
   */
  private async _handleIncomingStream(
    stream: Stream,
    connection: Connection,
  ): Promise<void> {
    try {
      const data: Uint8Array[] = []
      let totalSize = 0
      const MAX_MESSAGE_SIZE = 100_000 // 100KB limit (DoS protection)

      // Stream is AsyncIterable - iterate directly
      for await (const chunk of stream) {
        if (chunk instanceof Uint8Array) {
          totalSize += chunk.length

          // SECURITY: Check total size to prevent memory exhaustion
          if (totalSize > MAX_MESSAGE_SIZE) {
            console.warn(
              `[P2P] Oversized message from ${connection.remotePeer.toString()}: ${totalSize} bytes (max: ${MAX_MESSAGE_SIZE})`,
            )
            this.coreSecurityManager.recordMessage(false, true) // Track oversized
            this.coreSecurityManager.peerBanManager.warnPeer(
              connection.remotePeer.toString(),
              'oversized-message',
            )
            stream.abort(new Error('Message too large'))
            return
          }

          data.push(chunk.subarray())
        } else {
          // Handle Uint8ArrayList
          totalSize += chunk.length

          // SECURITY: Check total size
          if (totalSize > MAX_MESSAGE_SIZE) {
            console.warn(
              `[P2P] Oversized message from ${connection.remotePeer.toString()}: ${totalSize} bytes (max: ${MAX_MESSAGE_SIZE})`,
            )
            this.coreSecurityManager.recordMessage(false, true) // Track oversized
            this.coreSecurityManager.peerBanManager.warnPeer(
              connection.remotePeer.toString(),
              'oversized-message',
            )
            stream.abort(new Error('Message too large'))
            return
          }

          data.push(chunk.subarray())
        }
      }

      // Check if we received any data
      if (data.length === 0) {
        // Stream closed without sending data - this can happen during shutdown
        return
      }

      // Combine chunks
      const combined = Buffer.concat(data.map(d => Buffer.from(d)))

      // Check if combined buffer is empty
      if (combined.length === 0) {
        return
      }

      // Deserialize message
      const message = this.protocol.deserialize(combined)

      // Validate
      if (!this.protocol.validateMessage(message)) {
        console.warn('Invalid message received')
        this.coreSecurityManager.recordMessage(false) // Track invalid message
        this.coreSecurityManager.peerBanManager.warnPeer(
          connection.remotePeer.toString(),
          'invalid-message-format',
        )
        return
      }

      // SECURITY: Track valid message
      this.coreSecurityManager.recordMessage(true)

      // Check for duplicate
      const messageHash = this.protocol.computeMessageHash(message)
      if (this.seenMessages.has(messageHash)) {
        return // Duplicate
      }

      this.seenMessages.add(messageHash)

      // Limit cache size
      if (this.seenMessages.size > 10000) {
        const toRemove = Array.from(this.seenMessages).slice(0, 1000)
        toRemove.forEach(hash => this.seenMessages.delete(hash))
      }

      // Get peer info
      const from: PeerInfo = {
        peerId: connection.remotePeer.toString(),
        lastSeen: Date.now(),
      }

      // Emit message event
      this.emit(ConnectionEvent.MESSAGE, message, from)

      // Route to protocol handler
      if (message.protocol) {
        const handler = this.protocolHandlers.get(message.protocol)
        if (handler) {
          await handler.handleMessage(message, from)
        }
      }
    } catch (error) {
      console.error('Error processing incoming message:', error)
    }
  }

  /**
   * Check if announcement matches filters
   */
  private _matchesFilters(
    announcement: ResourceAnnouncement,
    filters?: Record<string, unknown>,
  ): boolean {
    if (!filters) {
      return true
    }

    for (const [key, value] of Object.entries(filters)) {
      if (announcement.data && typeof announcement.data === 'object') {
        const data = announcement.data as Record<string, unknown>
        if (data[key] !== value) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Make resource key
   */
  private _makeResourceKey(resourceType: string, resourceId: string): string {
    return `resource:${resourceType}:${resourceId}`
  }

  // ========================================================================
  // GossipSub Pub/Sub Methods (Event-Driven Discovery)
  // ========================================================================

  /**
   * Subscribe to a GossipSub topic
   *
   * Enables real-time event-driven discovery
   *
   * @param topic - Topic name to subscribe to
   * @param handler - Message handler callback
   */
  async subscribeToTopic(
    topic: string,
    handler: (message: Uint8Array) => void,
  ): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const pubsub = this.node.services.pubsub as GossipSub | undefined
    if (!pubsub) {
      throw new Error('GossipSub not enabled in config')
    }

    // Remove existing handler if re-subscribing to same topic
    if (this.topicHandlers.has(topic)) {
      const existingHandler = this.topicHandlers.get(topic)!
      pubsub.removeEventListener('message', existingHandler as EventListener)
      this.topicHandlers.delete(topic)
    }

    // Subscribe to topic
    pubsub.subscribe(topic)

    // Create and store message handler for proper cleanup
    // Event detail has: { topic: string, data: Uint8Array }
    const messageHandler = (
      evt: CustomEvent<{ topic: string; data: Uint8Array }>,
    ) => {
      if (evt.detail.topic === topic) {
        handler(evt.detail.data)
      }
    }
    this.topicHandlers.set(topic, messageHandler)
    pubsub.addEventListener('message', messageHandler as EventListener)

    console.log(`[P2P] Subscribed to topic: ${topic}`)
  }

  /**
   * Unsubscribe from a GossipSub topic
   *
   * @param topic - Topic name to unsubscribe from
   */
  async unsubscribeFromTopic(topic: string): Promise<void> {
    if (!this.node) {
      return
    }

    const pubsub = this.node.services.pubsub as GossipSub | undefined
    if (!pubsub) {
      return
    }

    // Remove event listener to prevent memory leak
    const handler = this.topicHandlers.get(topic)
    if (handler) {
      pubsub.removeEventListener('message', handler as EventListener)
      this.topicHandlers.delete(topic)
    }

    pubsub.unsubscribe(topic)
    console.log(`[P2P] Unsubscribed from topic: ${topic}`)
  }

  /**
   * Publish message to a GossipSub topic
   *
   * @param topic - Topic name
   * @param message - Message data (will be serialized)
   */
  async publishToTopic(topic: string, message: unknown): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const pubsub = this.node.services.pubsub as GossipSub | undefined
    if (!pubsub) {
      throw new Error('GossipSub not enabled in config')
    }

    // Convert to Uint8Array using Node.js Buffer
    const messageStr = JSON.stringify(message)
    const messageBytes = new Uint8Array(Buffer.from(messageStr, 'utf8'))

    await pubsub.publish(topic, messageBytes)

    console.log(`[P2P] Published to topic: ${topic}`)
  }

  /**
   * Get list of peers subscribed to a topic
   *
   * @param topic - Topic name
   * @returns Array of peer IDs
   */
  getTopicPeers(topic: string): string[] {
    if (!this.node) {
      return []
    }

    const pubsub = this.node.services.pubsub as GossipSub | undefined
    if (!pubsub) {
      return []
    }

    const peers = pubsub.getSubscribers(topic)
    return Array.from(peers).map(p => p.toString())
  }
}
