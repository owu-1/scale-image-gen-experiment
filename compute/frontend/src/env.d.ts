interface Env {
	USERS: DurableObjectNamespace
  PROMPT_QUEUE: Queue<{ webSocketId: string, imageId: string, positivePrompt: string, negativePrompt: string }>
  IMAGES: R2Bucket
  DB: D1Database
  ACK_SECRET_KEY: string
}
