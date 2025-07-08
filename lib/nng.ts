/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import { Socket, socket } from 'nanomsg'
import { Builder, ByteBuffer } from 'flatbuffers'
import {
  RpcRequest,
  RpcResult,
  GetMempoolRequest,
  GetBlockRangeRequest,
  GetBlockRequest,
  BlockIdentifier,
  BlockHeight,
  RpcCall,
  Block,
  GetBlockResponse,
  GetMempoolResponse,
  GetBlockRangeResponse,
} from './nng-interface'
import {
  NNG_MESSAGE_BATCH_SIZE,
  NNG_RPC_RCVMAXSIZE_POLICY,
  NNG_SOCKET_RECONN,
  NNG_SOCKET_MAXRECONN,
  NNG_REQUEST_TIMEOUT_LENGTH,
  NNG_SOCKET_TYPES,
} from '../utils/constants'
import {
  NNGMessageProcessor,
  NNGMessageType,
  NNGPendingMessageProcessor,
  NNGQueue,
} from '../utils/types'
import { NNG as settings } from '../utils/settings'

/**
 * Create a Lotus NNG socket
 * @param socketType - The type of socket to create
 * @param socketPath - The path to the socket
 * @param channels - The channels to subscribe to
 * @returns The socket
 */
function createSocket(
  socketType: 'pub' | 'sub' | 'req' | 'rep',
  channels?: string[],
) {
  // Validate socket type
  if (!NNG_SOCKET_TYPES.includes(socketType)) {
    throw new Error(`Invalid socket type: ${socketType}`)
  }
  // Create socket
  const sock = socket(socketType)
  sock.rcvmaxsize(NNG_RPC_RCVMAXSIZE_POLICY)
  sock.reconn(NNG_SOCKET_RECONN)
  sock.maxreconn(NNG_SOCKET_MAXRECONN)
  // Connect socket
  switch (socketType) {
    // Lotus RPC socket
    case 'req':
      sock.connect(`ipc://${settings.reqSocketPath}`)
      break
    // Lotus event socket
    case 'sub':
      sock.connect(`ipc://${settings.subSocketPath}`)
      // Validate channels
      if (channels && channels.length > 0) {
        sock.chan(channels)
      }
      break
  }
  return sock
}

/**
 * Destroy a Lotus NNG socket
 * @param sock - The socket to destroy
 */
function destroySocket(sock: Socket) {
  sock.close()
}

/**
 * Send a message to Lotus RPC socket over NNG interface
 * @param sock - The socket to send the message to
 * @param msg - The message to send
 */
function sendMessage(sock: Socket, msg: Buffer | string): number {
  return sock.send(msg)
}

class NNG {
  private sub: Socket
  private req: Socket
  /**
   * Instantiate and configure Lotus NNG sockets
   */
  constructor() {
    this.sub = createSocket('sub')
    this.req = createSocket('req')
  }
  /**
   * Close the Lotus NNG sockets
   */
  close() {
    destroySocket(this.sub)
    destroySocket(this.req)
  }
  /**
   * Fetches mempool txs
   * @returns {Promise<GetMempoolResponse>}
   */
  async rpcGetMempool(): Promise<GetMempoolResponse | null> {
    try {
      const bb = await this.rpcCall('GetMempoolRequest')
      return bb instanceof ByteBuffer
        ? GetMempoolResponse.getRootAsGetMempoolResponse(bb)
        : null
    } catch (e) {
      throw new Error(`rpcGetMempool(): ${e.message}`)
    }
  }
  /**
   * Fetch block at `height`
   * @param height `height` parsed from `BlockHeader`
   * @returns {Promise<Block>}
   */
  async rpcGetBlock(height: number): Promise<Block | null> {
    try {
      const bb = await this.rpcCall('GetBlockRequest', {
        blockRequest: { height },
      })
      return bb instanceof ByteBuffer
        ? GetBlockResponse.getRootAsGetBlockResponse(bb).block()
        : null
    } catch (e) {
      throw new Error(`rpcGetBlock(${height}): ${e.message}`)
    }
  }
  /**
   * Fetches range of blocks from `startHeight`, up to `numBlocks` limit
   * @param startHeight The starting `height` parsed from `BlockHeader`
   * @param numBlocks Configure `NNG_RPC_BLOCKRANGE_SIZE` in `/util/constants.ts` (default: 20)
   * @returns {Promise<GetBlockRangeResponse>}
   */
  async rpcGetBlockRange(
    startHeight: number,
    numBlocks: number,
  ): Promise<GetBlockRangeResponse | null> {
    try {
      const bb = await this.rpcCall('GetBlockRangeRequest', {
        blockRangeRequest: { startHeight, numBlocks },
      })
      return bb instanceof ByteBuffer
        ? GetBlockRangeResponse.getRootAsGetBlockRangeResponse(bb)
        : null
    } catch (e) {
      throw new Error(
        `rpcGetBlockRange(${startHeight}, ${numBlocks}): ${e.message}`,
      )
    }
  }
  /**
   * Send a request to the Lotus RPC request socket and return the response
   * @param rpcType - The type of RPC call to send
   * @param params - The parameters for the RPC call
   * @returns The response from the socket as a ByteBuffer, or null if the request times out
   */
  private async rpcCall(
    rpcType: keyof typeof RpcRequest,
    params?: {
      blockRangeRequest?: { startHeight: number; numBlocks: number }
      blockRequest?: { height: number }
    },
  ): Promise<ByteBuffer | null> {
    // Set up builder and get proper flatbuffer offset for rpcType
    const builder = new Builder()
    let offset: number
    switch (rpcType) {
      case 'GetMempoolRequest':
        offset = GetMempoolRequest.createGetMempoolRequest(builder)
        break
      case 'GetBlockRangeRequest': {
        if (!params?.blockRangeRequest) {
          throw new Error('parameters for "GetBlockRangeRequest" are required')
        }
        offset = GetBlockRangeRequest.createGetBlockRangeRequest(
          builder,
          params.blockRangeRequest.startHeight,
          params.blockRangeRequest.numBlocks,
        )
        break
      }
      case 'GetBlockRequest': {
        if (!params?.blockRequest) {
          throw new Error('parameters for "GetBlockRequest" are required')
        }
        offset = GetBlockRequest.createGetBlockRequest(
          builder,
          BlockIdentifier.Height,
          BlockHeight.createBlockHeight(builder, params.blockRequest.height),
        )
        break
      }
      default:
        throw new Error(`"${rpcType}" is not a valid RPC request`)
    }
    // Create RPC call and finish builder
    builder.finish(RpcCall.createRpcCall(builder, RpcRequest[rpcType], offset))
    // Send RPC call and wait for response
    const bb = await this.sendAndWait(builder.asUint8Array() as Buffer)
    // Get the RPC result
    const result = RpcResult.getRootAsRpcResult(bb)
    if (!result.isSuccess()) {
      // If the RPC call was successful but returned error data, process that now
      switch (result.errorCode()) {
        case 5: // block not found
          return null
        // what's happening
        default:
          throw new Error(
            `rpcCall(${rpcType}, ${typeof params}): ${result.errorMsg()} (code: ${result.errorCode()})`,
          )
      }
    }
    // result.dataArray() is a Uint8Array, as the isSuccess() check above
    // ensures that the RPC call was successful
    return new ByteBuffer(result.dataArray() as Uint8Array)
  }
  /**
   * Send a request to the Lotus NNG RPC socket and return the response
   * @param msg - The message to send
   * @returns The response from the socket as a ByteBuffer
   */
  private async sendAndWait(msg: Buffer): Promise<ByteBuffer> {
    return await new Promise((resolve, reject) => {
      const rpcSocketSendTimeout = setTimeout(
        () => reject(`Socket timeout (${NNG_REQUEST_TIMEOUT_LENGTH}ms)`),
        NNG_REQUEST_TIMEOUT_LENGTH,
      )
      // set up response listener before sending request; avoids race condition
      this.req.once('data', (buf: Buffer) => {
        clearTimeout(rpcSocketSendTimeout)
        resolve(new ByteBuffer(buf))
      })
      this.req.send(msg)
    })
  }
}

export { NNG }
