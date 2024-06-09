## Send prompt
requestId must be a uuid.
```json
{ "type": "txt2img_prompt", "requestId": "uuid", "positivePrompt": "prompt-string", "negativePrompt": "prompt-string" }
```

## Send prompt response
Client receives this message if the prompt is handled successfully
```json
{ "type": "txt2img_prompt", "success": true, "imageId": "uuid", "requestId": "uuid", "positivePrompt": "prompt-string", "negativePrompt": "prompt-string" }
```

Client receives this message if the message it sends is invalid.
```json
{ "type": "txt2img_prompt", "success": false, "error": "Request contained malformed json"|"Invalid request" }
```

Client receives this message if the server fails to accept the prompt
```json
{ "type": "txt2img_prompt", "success": false, "error": "server-error-msg", "requestId": "uuid", "positivePrompt": "prompt-string", "negativePrompt": "prompt-string" }
```

## Image generation response
Client receives this message if the image generation succeeds
```json
{ "type": "txt2img_image", "success": true, "imageId": "uuid", "positivePrompt": "prompt-string", "negativePrompt": "prompt-string" }
```

Client receives this message if the image generation fails
```json
{ "type": "txt2img_image", "success": false, "error": "server-error-msg", "imageId": "uuid", "positivePrompt": "prompt-string", "negativePrompt": "prompt-string" }
```
