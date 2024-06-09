import { DurableObject } from "cloudflare:workers"
import { Context, Hono } from "hono"
import { StatusCodes, ReasonPhrases } from 'http-status-codes'
import { z } from 'zod'

function sendWSError(ws: WebSocket, message: string) {
  const messageJSON = JSON.stringify({ type: 'txt2img_prompt', success: false, error: message })
  ws.send(messageJSON)
}

function createHTTPError(message: string, statusCode: StatusCodes) {
  return new Response(message, { status: statusCode })
}

export class User extends DurableObject<Env> {
  app: Hono

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    this.ctx.blockConcurrencyWhile(async () => {
      this.app = new Hono()
  
      this.app.get('/websocket', async () => {
        return this.initWebSocket()
      })

      this.app.post('/ack', async (c) => {
        return this.ack(c)
      })

      this.app.notFound((c) => {
        // This should never be executed, unless we mess up worker code
        return c.text(ReasonPhrases.NOT_FOUND, StatusCodes.NOT_FOUND)
      })
    })
  }

  async fetch(request: Request) {
    return this.app.fetch(request)
  }

  async initWebSocket() {
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)

    this.ctx.acceptWebSocket(server, [crypto.randomUUID()])

    return new Response(null, {
      status: StatusCodes.SWITCHING_PROTOCOLS,
      webSocket: client
    })
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    let clientMessage
    try {
      clientMessage = JSON.parse(message)
    } catch (e) {
      sendWSError(ws, 'Request contained malformed json')
      return
    }

    const schema = z.object({
      type: z.string().max(50),
      requestId: z.string().uuid(),
      positivePrompt: z.string().max(1000),
      negativePrompt: z.string().max(1000)
    })

    const result = await schema.safeParseAsync(clientMessage)

    if (!result.success) {
      sendWSError(ws, 'Invalid request')
      return
    }

    const { requestId, positivePrompt, negativePrompt } = result.data

    const imageId = await this.addToPromptQueue(ws, positivePrompt, negativePrompt)

    const serverMessage = JSON.stringify({
      type: 'txt2img_prompt',
      success: true,
      imageId,
      requestId,
      positivePrompt,
      negativePrompt
    })
    
    ws.send(serverMessage)
  }

  async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code)
  }

  async addToPromptQueue(ws: WebSocket, positivePrompt: string, negativePrompt: string) {
    const imageId = crypto.randomUUID()
    const [webSocketId] = this.ctx.getTags(ws)
    
    await this.env.PROMPT_QUEUE.send({
      webSocketId,
      imageId,
      positivePrompt,
      negativePrompt
    })

    return imageId
  }

  async ack(c: Context) {
    let requestObject
    try {
      requestObject = await c.req.json()
    }
    catch (e) {
      return createHTTPError('Request contained malformed json', StatusCodes.BAD_REQUEST)
    }

    const schema = z.object({
      key: z.string(),
      webSocketId: z.string().uuid(),
      imageId: z.string().uuid(),
      positivePrompt: z.string(),
      negativePrompt: z.string()
    })

    const result = await schema.safeParseAsync(requestObject)

    if (!result.success) {
      return createHTTPError('Invalid request', StatusCodes.BAD_REQUEST)
    }

    const { key, webSocketId, imageId, positivePrompt, negativePrompt } = result.data

    if (key !== this.env.ACK_SECRET_KEY) {
      return createHTTPError('Incorrect key', StatusCodes.UNAUTHORIZED)
    }

    const [ ws ] = this.ctx.getWebSockets(webSocketId)
    if (!ws) {
      return createHTTPError('Websocket does not exist', StatusCodes.BAD_REQUEST)
    }
    
    const message = JSON.stringify({
      type: 'txt2img_image',
      success: true,
      imageId,
      positivePrompt,
      negativePrompt
    })
    ws.send(message)
    
    return new Response(null, { status: StatusCodes.OK })
  }
}
