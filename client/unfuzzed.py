from safetensors import safe_open
import aiohttp
import asyncio
import json
import uuid
import folder_paths
import random
import os

age_check_instructions = "This model can generate NSFW. You must be 18+ to use this model. Toggle below to True to confirm you are 18+."
age_check_key = "I confirm that I am 18+ and acknowledge that the model can generate NSFW. Response: "

class UnfuzzedAgeCheck:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "instructions": ("STRING", { "multiline": True, "dynamicPrompts": True, "default": age_check_instructions }),
                "is18plus": ("BOOLEAN", { "default": False })
            }
        }
    
    RETURN_TYPES = ("STRING",)
    FUNCTION = "key"

    CATEGORY = "unfuzzed.org"

    def key(self, instructions, is18plus):
        if instructions != age_check_instructions:
            raise Exception("The age check instructions were modified. Reverse the change or create a new UnfuzzedAgeCheck node")
        return (age_check_key + str(is18plus), )

class UnfuzzedKSampler:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "key": ("STRING", {}),
                "positive": ("STRING", { "multiline": True, "dynamicPrompts": True }),
                "negative": ("STRING", { "multiline": True, "dynamicPrompts": True })
            }
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "sample"

    CATEGORY = "unfuzzed.org"

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.prefix_append = "_temp_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))

    # todo: cleanly return memory from aiohttp
    # todo: move all the try catch to __init__
    # todo: handle websocket connection being interrupted

    async def verify_prompt_response(self, requestId):
        message = await self.websocket.receive()
        if (message.type != aiohttp.WSMsgType.TEXT):
            raise Exception(f"Expected websocket message of type text, got {message.type}")
        
        # Message contents
        message = message.json()
        if message["requestId"] != requestId:
            raise Exception(f"Got prompt response for request id " + message["requestId"] + " instead of " + requestId)
        if message["type"] != 'txt2img_prompt':
            raise Exception("Expected websocket message of type txt2img_prompt, got " + message["type"])
        if message["success"] != True:
            raise Exception("Sending prompt failed: " + message["error"])
        
        return message["imageId"]
        
    async def verify_image_generation_response(self, imageId):
        message = await self.websocket.receive()
        if (message.type != aiohttp.WSMsgType.TEXT):
            raise Exception(f"Expected websocket message of type text, got {message.type}")
        
        # Message contents
        message = message.json()
        if message["imageId"] != imageId:
            raise Exception("Got image generation response for image id " + message["imageId"] + " instead of " + imageId)
        if message["type"] != 'txt2img_image':
            raise Exception("Expected websocket message of type txt2img_image, got " + message["type"])
        if message["success"] != True:
            raise Exception("Image generation failed: " + message["error"])

    async def test(self, positive_prompt, negative_prompt):
        requestId = str(uuid.uuid4())
        data = {
            "type": "txt2img_prompt",
            "requestId": requestId,
            "positivePrompt": positive_prompt,
            "negativePrompt": negative_prompt
        }

        try:
            await self.websocket.send_str(json.dumps(data))
        except:
            print("[unfuzzed.org] Starting websocket connection")
            self.session = aiohttp.ClientSession()
            self.websocket = await self.session.ws_connect("wss://api.unfuzzed.org/websocket")
            await self.websocket.send_str(json.dumps(data))

        imageId = await self.verify_prompt_response(requestId)
        print(f"[unfuzzed.org] Websocket responded with imageId: {imageId}. Waiting for latents...")
        await self.verify_image_generation_response(imageId)

        async with self.session.get(f"https://data.unfuzzed.org/{imageId}") as resp:
            latents_file_path = os.path.join(self.output_dir, f'unfuzzed.org{self.prefix_append}_{imageId}.latent')
            os.makedirs(self.output_dir, exist_ok=True)  # ensure temp folder exists
            with open(latents_file_path, 'wb') as file:
                file.write(await resp.read())

        with safe_open(latents_file_path, framework="pt", device="cpu") as f:
            latents = f.get_tensor('latent_tensor')

        return latents

    def sample(self, key, positive, negative):
        if key != age_check_key + str(True):
            raise Exception("You must be 18+ to use the UnfuzzedKSampler node. Use the UnfuzzedAgeCheck node to confirm you are 18+")
    
        try:
            task = self.event_loop.create_task(self.test(positive, negative))
        except:
            self.event_loop = asyncio.new_event_loop()
            task = self.event_loop.create_task(self.test(positive, negative))

        latents = self.event_loop.run_until_complete(task)

        out = { "samples" : latents }

        return (out, )

NODE_CLASS_MAPPINGS = {
    "UnfuzzedAgeCheck": UnfuzzedAgeCheck,
    "UnfuzzedKSampler": UnfuzzedKSampler
}
