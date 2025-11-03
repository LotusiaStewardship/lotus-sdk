/**
 * P2P Coordinator
 *
 * Main entry point for P2P functionality using libp2p
 */

import { EventEmitter } from 'events'
import { createLibp2p, Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import {
  kadDHT,
  KadDHT,
  SingleKadDHT,
  passthroughMapper,
  removePrivateAddressesMapper,
} from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@libp2p/gossipsub'
import type { GossipSub } from '@libp2p/gossipsub'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'
import type { Connection, Stream, PeerId } from '@libp2p/interface'
import type { StreamHandler } from '@libp2p/interface'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'

import {
  P2PConfig,
  P2PMessage,
  PeerInfo,
  IProtocolHandler,
  ConnectionEvent,
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
  private node?: Libp2p
  private protocol: P2PProtocol
  private protocolHandlers: Map<string, IProtocolHandler> = new Map()
  private seenMessages: Set<string> = new Set()
  private peerInfo: Map<string, PeerInfo> = new Map()
  private dhtValues: Map<string, ResourceAnnouncement> = new Map()
  private cleanupIntervalId?: NodeJS.Timeout
  // SECURITY: Core security manager (protocol-agnostic)
  protected coreSecurityManager: CoreSecurityManager

  constructor(private readonly config: P2PConfig) {
    super()
    this.protocol = new P2PProtocol()

    // SECURITY: Initialize core security manager
    this.coreSecurityManager = new CoreSecurityManager()

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
      // If listening on public addresses, use removePrivateAddressesMapper
      const listenAddrs = this.config.listen || ['/ip4/0.0.0.0/tcp/0']
      const isLocalhost = listenAddrs.some(
        addr => addr.includes('127.0.0.1') || addr.includes('localhost'),
      )

      if (isLocalhost) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      addresses: {
        listen: this.config.listen || ['/ip4/0.0.0.0/tcp/0'],
        announce: this.config.announce || [],
      },
      transports: [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [mplex()],
      services:
        this.config.enableDHT !== false
          ? {
              identify: identify(),
              ping: ping(),
              kadDHT: kadDHT({
                protocol: this.config.dhtProtocol || '/lotus/kad/1.0.0',
                // Use server mode if enabled, otherwise client-only mode
                // Server mode: participate in DHT network (routing, storing)
                // Client mode: only query DHT, no background operations
                clientMode: !(this.config.enableDHTServer ?? false),
                // CRITICAL: peerInfoMapper determines which addresses are valid
                // - passthroughMapper: Allow all (localhost development/testing)
                // - removePrivateAddressesMapper: Only public (production security)
                // Auto-detected based on listen addresses, or override via config
                peerInfoMapper,
              }),
              // Enable GossipSub for real-time event-driven discovery
              ...(this.config.enableGossipSub !== false
                ? {
                    pubsub: gossipsub({
                      allowPublishToZeroTopicPeers: true, // Allow publishing even with no subscribers (for testing)
                      emitSelf: false, // Don't receive own messages
                    }),
                  }
                : {}),
            }
          : {
              identify: identify(),
              // Enable GossipSub even without DHT
              ...(this.config.enableGossipSub !== false
                ? {
                    pubsub: gossipsub({
                      allowPublishToZeroTopicPeers: true,
                      emitSelf: false,
                    }),
                  }
                : {}),
            },
      connectionManager: {
        maxConnections: this.config.connectionManager?.maxConnections || 50,
      },
    }

    this.node = await createLibp2p(config)

    // Setup event handlers
    this._setupEventHandlers()

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

    // Register stream handler with libp2p if handler supports it
    if (handler.handleStream && this.node) {
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

    // Send to all targets
    const promises = targetPeers.map(peer =>
      this.sendTo(peer.toString(), message, options?.protocol).catch(error => {
        console.error(`Failed to send to peer ${peer.toString()}:`, error)
      }),
    )

    await Promise.all(promises)
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

    // SECURITY: Check if peer can announce to DHT
    const canAnnounce = await this.coreSecurityManager.canAnnounceToDHT(
      peerId,
      resourceType,
      resourceId,
      data,
    )

    if (!canAnnounce) {
      throw new Error(
        `DHT announcement rejected: rate limited or resource limit exceeded`,
      )
    }

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
        const keyBytes = uint8ArrayFromString(key)
        const valueBytes = uint8ArrayFromString(JSON.stringify(announcement))

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
    const keyBytes = uint8ArrayFromString(key)
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
          const valueStr = uint8ArrayToString(event.value)
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
    keyBytes: Uint8Array,
    valueBytes: Uint8Array,
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
      const connections = this.node!.getConnections(peerId)
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

    // Peer connection events
    this.node.addEventListener('peer:connect', event => {
      const peerId = event.detail.toString()

      const peerInfo: PeerInfo = {
        peerId,
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
        handler.onPeerDisconnected?.(peerId).catch(error => {
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

    // Subscribe to topic
    pubsub.subscribe(topic)

    // Setup message handler
    // Event detail has: { topic: string, data: Uint8Array }
    pubsub.addEventListener(
      'message',
      (evt: CustomEvent<{ topic: string; data: Uint8Array }>) => {
        if (evt.detail.topic === topic) {
          handler(evt.detail.data)
        }
      },
    )

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
