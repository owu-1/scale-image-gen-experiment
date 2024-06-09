import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from 'cloudflare:test'
import { describe, it, expect, assert, vi, MockInstance } from 'vitest'
import { StatusCodes, ReasonPhrases } from 'http-status-codes'
import events from "node:events"
import worker from '../src'
import { z } from 'zod'

async function request(path: string, options?: RequestInit): Promise<Response> {
  const request = new Request(`https://example.com${path}`, options)
  const ctx = createExecutionContext()
  const response = await worker.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

describe("General endpoints", () => {
  it("Send HTTP request at api base", async () => {
    const response = await request('/')
    expect(response.status).toBe(StatusCodes.NOT_FOUND)
    expect(await response.text()).toBe(ReasonPhrases.NOT_FOUND)
  })

  it("Send HTTP request at random endpoint", async () => {
    const response = await request('/randomendpoint123')
    expect(response.status).toBe(StatusCodes.NOT_FOUND)
    expect(await response.text()).toBe(ReasonPhrases.NOT_FOUND)
  })
})

describe("Connecting to websocket", () => {
  it("Send regular HTTP request at websocket endpoint", async () => {
    const response = await request('/websocket')
    expect(response.status).toBe(StatusCodes.UPGRADE_REQUIRED)
    expect(await response.text()).toBe(ReasonPhrases.UPGRADE_REQUIRED)
  })

  it("Using incorrect upgrade header", async () => {
    const headers = {
      "Upgrade": "websot"
    }
    const options = {
      headers: new Headers(headers)
    }
    const response = await request('/websocket', options)

    expect(response.status).toBe(StatusCodes.UPGRADE_REQUIRED)
    expect(await response.text()).toBe(ReasonPhrases.UPGRADE_REQUIRED)
  })

  it("Using incorrect method", async () => {
    const headers = {
      "Upgrade": "websocket"
    }
    const options = {
      method: 'POST',
      headers: new Headers(headers)
    }
    const response = await request('/websocket', options)

    expect(response.status).toBe(StatusCodes.NOT_FOUND)
    expect(await response.text()).toBe(ReasonPhrases.NOT_FOUND)
  })

  it("Properly connect to websocket", async () => {
    const headers = {
      "Upgrade": "websocket"
    }
    const options = {
      headers: new Headers(headers)
    }
    const response = await request('/websocket', options)

    expect(response.status).toBe(StatusCodes.SWITCHING_PROTOCOLS)
    expect(response.webSocket).toBeInstanceOf(WebSocket)
  })

  it("Open two simultaneous connections", async () => {
    const headers = {
      "Upgrade": "websocket"
    }
    const options = {
      headers: new Headers(headers)
    }

    {
      // Connection 1
      const response = await request('/websocket', options)
      expect(response.status).toBe(StatusCodes.SWITCHING_PROTOCOLS)
      expect(response.webSocket).toBeInstanceOf(WebSocket)
    }

    {
      // Connection 2
      const response = await request('/websocket', options)
      expect(response.status).toBe(StatusCodes.SWITCHING_PROTOCOLS)
      expect(response.webSocket).toBeInstanceOf(WebSocket)
    }
  })
})

async function setupWebSocket(): Promise<[WebSocket, Promise<[MessageEvent]>]> {
  const headers = {
    "Upgrade": "websocket"
  }
  const options = {
    headers: new Headers(headers)
  }
  const response = await request('/websocket', options)

  assert(response.webSocket !== null)
  const ws = response.webSocket
  const messagePromise = events.once(ws, 'message') as Promise<[MessageEvent]>
  return [ws, messagePromise]
}

function compareMessage(serverMessage: MessageEvent, expectedMessage: object) {
  assert(typeof serverMessage.data === 'string')
  expect(JSON.parse(serverMessage.data)).toEqual(expectedMessage)
}

const isUUID = z.string().uuid()

describe("Sending message to websocket", () => {
  it("Empty string", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    ws.send("")

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Request contained malformed json'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("A string", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    ws.send("aaabbbccc123")

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Request contained malformed json'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("Malformed json", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    ws.send("{ \"a: b }")

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Request contained malformed json'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("Valid JSON with bad data", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    const message = JSON.stringify({ a: "b" })
    ws.send(message)

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Invalid request'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("JSON with partial data", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    const message = JSON.stringify({
      type: 'txt2img_prompt',
      requestId: crypto.randomUUID()
    })
    ws.send(message)

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Invalid request'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("Request id not a valid uuid", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    const message = JSON.stringify({
      type: 'txt2img_prompt',
      requestId: 'aaa-aaaa-123'
    })
    ws.send(message)

    const [serverMessage] = await messagePromise
    const expectedMessage = {
      type: 'txt2img_prompt',
      success: false,
      error: 'Invalid request'
    }
    compareMessage(serverMessage, expectedMessage)
  })

  it("Valid request", async () => {
    const [ws, messagePromise] = await setupWebSocket()

    ws.accept()
    const requestId = crypto.randomUUID()
    const positivePrompt = 'a fox'
    const negativePrompt = 'watermark'
    const message = JSON.stringify({
      type: 'txt2img_prompt',
      requestId,
      positivePrompt,
      negativePrompt
    })
    ws.send(message)

    const [serverMessage] = await messagePromise
    const partialExpectedMessage = {
      type: 'txt2img_prompt',
      success: true,
      // imageId is a random uuid
      requestId,
      positivePrompt,
      negativePrompt
    }

    assert(typeof serverMessage.data === 'string')
    const serverMessageObject = JSON.parse(serverMessage.data)
    expect(serverMessageObject).toMatchObject(partialExpectedMessage)
    await isUUID.parseAsync(serverMessageObject.imageId)
  })
})

async function sendPrompt(positivePrompt: string, negativePrompt: string) {
  const [ws, messagePromise] = await setupWebSocket()

  ws.accept()
  const requestId = crypto.randomUUID()
  const message = JSON.stringify({
    type: 'txt2img_prompt',
    requestId,
    positivePrompt,
    negativePrompt
  })
  ws.send(message)

  const [serverMessageEvent] = await messagePromise
  assert(typeof serverMessageEvent.data === 'string')
  const serverMessage = JSON.parse(serverMessageEvent.data)
  return { ws, serverMessage }
}

describe("Prompt processing", () => {
  // Failed creating tests for invalid requests.
  // e.g. when allowing bad request to passthrough and be added to queue,
  // toBeCalledTimes gets 0

  it("Place item on the queue", async () => {
    const sendSpy = vi
      .spyOn(env.PROMPT_QUEUE, "send")
      .mockImplementation(async () => {})

    const expectedPositivePrompt = 'a fox'
    const expectedNegativePrompt = 'watermark'
    const { serverMessage } = await sendPrompt(expectedPositivePrompt, expectedNegativePrompt)

    expect(sendSpy).toBeCalledTimes(1)

    const { webSocketId, imageId, positivePrompt, negativePrompt } = sendSpy.mock.calls[0][0]

    await isUUID.parseAsync(webSocketId)
    expect(imageId).toBe(serverMessage.imageId)
    expect(positivePrompt).toBe(expectedPositivePrompt)
    expect(negativePrompt).toBe(expectedNegativePrompt)
  })

  it("Retrieve item off queue", async () => {
    const sendSpy = vi
      .spyOn(env.PROMPT_QUEUE, "send")
      .mockImplementation(async () => {})

    let expectedPositivePrompt
    let expectedNegativePrompt

    {
      // Client send prompt
      expectedPositivePrompt = 'a fox'
      expectedNegativePrompt = 'watermark'
      await sendPrompt(expectedPositivePrompt, expectedNegativePrompt)
    }

    {
      // Backend pull from queue
      const { webSocketId, imageId, positivePrompt, negativePrompt } = sendSpy.mock.calls[0][0]
      await isUUID.parseAsync(webSocketId)
      await isUUID.parseAsync(imageId)
      expect(positivePrompt).toBe(expectedPositivePrompt)
      expect(negativePrompt).toBe(expectedNegativePrompt)
    }
  })

  // This test is kind of useless. It only tests that the R2 bucket exists
  it("Send image to R2", async () => {
    {
      // Client send prompt
      const expectedPositivePrompt = 'a fox'
      const expectedNegativePrompt = 'watermark'
      await sendPrompt(expectedPositivePrompt, expectedNegativePrompt)
    }

    {
      // Backend pull from queue
      
      // Do processing...

      const imageData = "test"
      const file = await env.IMAGES.put('image', imageData)
      expect(file).not.toBe(null)

      // Cannot retrieve from R2 in vitest without error
      // https://github.com/cloudflare/workers-sdk/issues/5524
      // const read = await env.IMAGES.get('image')
    }
  })

  it("Incorrect ack key", async () => {
    const sendSpy = vi
      .spyOn(env.PROMPT_QUEUE, "send")
      .mockImplementation(async () => {})

    let expectedPositivePrompt
    let expectedNegativePrompt

    {
      // Client send prompt
      expectedPositivePrompt = 'a fox'
      expectedNegativePrompt = 'watermark'
      await sendPrompt(expectedPositivePrompt, expectedNegativePrompt)
    }

    {
      // Backend pull from queue
      const { webSocketId, imageId, positivePrompt, negativePrompt } = sendSpy.mock.calls[0][0]
      
      // Do work...
      // Send image to R2

      // Backend send acknowledgement to worker
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: 'abc123', webSocketId, imageId, positivePrompt, negativePrompt })
      }

      const response = await request('/ack', options)
      expect(response.status).toBe(StatusCodes.UNAUTHORIZED)
      expect(await response.text()).toBe("Incorrect key")
    }
  })

  it("Acknowledge prompt processing finished", async () => {
    const sendSpy = vi
      .spyOn(env.PROMPT_QUEUE, "send")
      .mockImplementation(async () => {})

    let ws
    let expectedPositivePrompt
    let expectedNegativePrompt
    let expectedImageId

    {
      // Client send prompt
      expectedPositivePrompt = 'a fox'
      expectedNegativePrompt = 'watermark'
      const result = await sendPrompt(expectedPositivePrompt, expectedNegativePrompt)
      ws = result.ws
    }

    // Listen for websocket message
    const messagePromise = events.once(ws, 'message') as Promise<[MessageEvent]>

    {
      // Backend pull from queue
      const { webSocketId, imageId, positivePrompt, negativePrompt } = sendSpy.mock.calls[0][0]
      expectedImageId = imageId
      
      // Do work...
      // Send image to R2

      // Backend send acknowledgement to worker
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: env.ACK_SECRET_KEY, webSocketId, imageId, positivePrompt, negativePrompt })
      }

      const response = await request('/ack', options)
      expect(response.status).toBe(StatusCodes.OK)
      expect(await response.text()).toBe("")
    }

    {
      // Client recieve image generation complete
      const [ messageEvent ] = await messagePromise
      assert(typeof messageEvent.data === 'string')
      const message = JSON.parse(messageEvent.data)

      const expectedMessage = {
        type: 'txt2img_image',
        success: true,
        imageId: expectedImageId,
        positivePrompt: expectedPositivePrompt,
        negativePrompt: expectedNegativePrompt
      }

      expect(message).toEqual(expectedMessage)
    }
  })
})

describe('Acknowledgement endpoint', () => {
  it('Incorrect method', async () => {
    const response = await request('/ack')
    expect(response.status).toBe(StatusCodes.NOT_FOUND)
    expect(await response.text()).toBe(ReasonPhrases.NOT_FOUND)
  })

  it('No headers and body', async () => {
    const options = {
      method: 'POST'
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.UNSUPPORTED_MEDIA_TYPE)
    expect(await response.text()).toBe(ReasonPhrases.UNSUPPORTED_MEDIA_TYPE)
  })

  it('Wrong header', async () => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      }
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.UNSUPPORTED_MEDIA_TYPE)
    expect(await response.text()).toBe(ReasonPhrases.UNSUPPORTED_MEDIA_TYPE)
  })

  it('No body', async () => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.BAD_REQUEST)
    expect(await response.text()).toBe('Request contained malformed json')
  })
  
  it('Malformed JSON', async () => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: "{ \"a: b }"
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.BAD_REQUEST)
    expect(await response.text()).toBe('Request contained malformed json')
  })

  it('Valid JSON with bad data', async () => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({a: 'b'})
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.BAD_REQUEST)
    expect(await response.text()).toBe('Invalid request')
  })

  it('JSON with partial data', async () => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ imageId: crypto.randomUUID() })
    }

    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.BAD_REQUEST)
    expect(await response.text()).toBe('Invalid request')
  })

  it('Invalid web socket id', async () => {
    const positivePrompt = 'a fox'
    const negativePrompt = 'watermark'
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: env.ACK_SECRET_KEY,
        webSocketId: crypto.randomUUID(),
        imageId: crypto.randomUUID(),
        positivePrompt,
        negativePrompt
      })
    }

    await sendPrompt('a fox', 'watermark')
    const response = await request('/ack', options)
    expect(response.status).toBe(StatusCodes.BAD_REQUEST)
    expect(await response.text()).toBe("Websocket does not exist")
  })
})

async function consumeQueueItem(sendSpy: MockInstance, callIndex: number) {
  // Backend pull from queue
  const { webSocketId, imageId, positivePrompt, negativePrompt } = sendSpy.mock.calls[callIndex][0]

  // Do work...
  // Send image to R2

  // Backend send acknowledgement to worker
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ key: env.ACK_SECRET_KEY, webSocketId, imageId, positivePrompt, negativePrompt })
  }

  await request('/ack', options)
}

describe('Simultaneous websocket processing', () => {
  it("Two requests", async () => {
    const sendSpy = vi
      .spyOn(env.PROMPT_QUEUE, "send")
      .mockImplementation(async () => {})

    let client1ws
    let client2ws

    let client1PositivePrompt
    let client1NegativePrompt
    let client2PositivePrompt
    let client2NegativePrompt

    {
      // [Client 1] Send prompt
      client1PositivePrompt = 'a fox'
      client1NegativePrompt = 'watermark'
      const result = await sendPrompt(client1PositivePrompt, client1NegativePrompt)
      client1ws = result.ws
    }

    {
      // [Client 2] Send prompt
      client2PositivePrompt = 'a fox'
      client2NegativePrompt = 'bad anatomy'
      const result = await sendPrompt(client2PositivePrompt, client2NegativePrompt)
      client2ws = result.ws
    }

    // Listen for websocket message
    const client1MessagePromise = events.once(client1ws, 'message') as Promise<[MessageEvent]>
    const client2MessagePromise = events.once(client2ws, 'message') as Promise<[MessageEvent]>

    let client1WebSocketId
    
    let client1ImageId
    let client2ImageId

    {
      // [Client 1] Check queue has correct information
      const queueItem = sendSpy.mock.calls[0][0]
      const { webSocketId, imageId, positivePrompt, negativePrompt } = queueItem
      client1WebSocketId = webSocketId
      client1ImageId = imageId
      await isUUID.parseAsync(webSocketId)
      await isUUID.parseAsync(imageId)
      expect(positivePrompt).toBe(client1PositivePrompt)
      expect(negativePrompt).toBe(client1NegativePrompt)
    }

    {
      // [Client 2] Check queue has correct information
      const queueItem = sendSpy.mock.calls[1][0]
      const { webSocketId, imageId, positivePrompt, negativePrompt } = queueItem
      expect(client1WebSocketId).not.toBe(webSocketId)  // check websocket ids are unique
      client2ImageId = imageId
      await isUUID.parseAsync(webSocketId)
      await isUUID.parseAsync(imageId)
      expect(positivePrompt).toBe(client2PositivePrompt)
      expect(negativePrompt).toBe(client2NegativePrompt)
    }

    // Process the queue items and ack
    await consumeQueueItem(sendSpy, 0)
    await consumeQueueItem(sendSpy, 1)
    
    {
      // [Client 1] Recieve image generation complete
      const [ messageEvent ] = await client1MessagePromise
      assert(typeof messageEvent.data === 'string')
      const message = JSON.parse(messageEvent.data)

      const expectedMessage = {
        type: 'txt2img_image',
        success: true,
        imageId: client1ImageId,
        positivePrompt: client1PositivePrompt,
        negativePrompt: client1NegativePrompt
      }

      expect(message).toEqual(expectedMessage)
    }

    {
      // [Client 2] Recieve image generation complete
      const [ messageEvent ] = await client2MessagePromise
      assert(typeof messageEvent.data === 'string')
      const message = JSON.parse(messageEvent.data)

      const expectedMessage = {
        type: 'txt2img_image',
        success: true,
        imageId: client2ImageId,
        positivePrompt: client2PositivePrompt,
        negativePrompt: client2NegativePrompt
      }

      expect(message).toEqual(expectedMessage)
    }
  })
})
