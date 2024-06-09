import { Hono } from 'hono'
import { StatusCodes, ReasonPhrases } from 'http-status-codes'
import { User } from './user'
export { User } from './user'

type Bindings = {
  USERS: DurableObjectNamespace<User>
  DB: D1Database
}

const app = new Hono<{Bindings: Bindings}>()

app.get('/websocket', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.text(ReasonPhrases.UPGRADE_REQUIRED, StatusCodes.UPGRADE_REQUIRED)
  }

  const id = c.env.USERS.idFromName("testing")
  const stub = c.env.USERS.get(id)
  return stub.fetch(c.req.raw)
})

app.post('/ack', async (c) => {
  // todo: Move ack key check to here
  const contentTypeHeader = c.req.header('Content-Type')
  if (contentTypeHeader !== 'application/json') {
    return c.text(ReasonPhrases.UNSUPPORTED_MEDIA_TYPE, StatusCodes.UNSUPPORTED_MEDIA_TYPE)
  }
  
  const id = c.env.USERS.idFromName("testing")
  const stub = c.env.USERS.get(id)
  return stub.fetch(c.req.raw)
})

app.notFound((c) => {
    return c.text(ReasonPhrases.NOT_FOUND, StatusCodes.NOT_FOUND)
})

export default app
