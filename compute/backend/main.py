import torch
from optimum.neuron import NeuronStableDiffusionXLPipeline
from safetensors.torch import save_file
import boto3
import requests
import time
import json
import os

cloudflare_account_id = os.environ['CLOUDFLARE_ACCOUNT_ID']
cloudflare_token = os.environ['CLOUDFLARE_TOKEN']
cloudflare_queue_id = os.environ['CLOUDFLARE_QUEUE_ID']

r2_endpoint_url = f'https://{cloudflare_account_id}.r2.cloudflarestorage.com'
r2_bucket_name = os.environ['R2_BUCKET_NAME']
r2_access_key_id = os.environ['R2_ACCESS_KEY_ID']
r2_secret_access_key = os.environ['R2_SECRET_ACCESS_KEY']

ack_endpoint = os.environ['ACK_ENDPOINT']
ack_secret_key = os.environ['ACK_SECRET_KEY']

model_identifier = os.environ['MODEL_IDENTIFIER']

headers = {
    'Authorization': f'Bearer {cloudflare_token}'
}

def assert_status_200(r):
    if r.status_code != 200:
        raise Exception(f'Expected status code 200, got {r.status_code}: {r.text}')

# Get one message off the queue
def pull():
    url = f'https://api.cloudflare.com/client/v4/accounts/{cloudflare_account_id}/queues/{cloudflare_queue_id}/messages/pull'
    data = {
        'visibility_timeout': 10000,
        'batch_size': 1
    }

    r = requests.post(url, headers=headers, json=data)
    assert_status_200(r)
    
    messages = r.json()['result']['messages']

    if (len(messages) == 0):
        return None
    
    message = messages[0]
    message_body = json.loads(message['body'])
    message_lease_id = message['lease_id']
    
    return message_body, message_lease_id

def generate_latents(message_body, stable_diffusion_xl):
    vae_scaling = 0.13025
    multiplier = 1.0 / vae_scaling
    latents = stable_diffusion_xl(
        prompt=message_body['positivePrompt'],
        negative_prompt=message_body['negativePrompt'],
        num_inference_steps=12,
        guidance_scale=5,
        output_type='latent').images
    latents = latents * multiplier  # comfy vae decoder expects latents to already be scaled
    return latents

def work(message_body, stable_diffusion_xl, s3):
    latents = generate_latents(message_body, stable_diffusion_xl)

    data = {
        "latent_format_version_0": torch.tensor([]),  # comfy load latent code expects this header, otherwise it will scale latents by 0.18215
        "latent_tensor": latents
    }

    file_name = "latents.safetensors"
    save_file(data, file_name)

    s3.upload_file(file_name, r2_bucket_name, message_body["imageId"])

def ack(message_body, message_lease_id):
    ack_message = message_body
    ack_message['key'] = ack_secret_key
    r = requests.post(ack_endpoint, json=ack_message)
    # Catches error for when websocket loses connection
    try:
        assert_status_200(r)
    except:
        print(f'Failed to ack: Expected status 200, got {r.status_code}: {r.text}')

    url = f'https://api.cloudflare.com/client/v4/accounts/{cloudflare_account_id}/queues/{cloudflare_queue_id}/messages/ack'
    data = {
        'acks': [
            {
                'lease_id': message_lease_id
            }
        ]
    }

    r = requests.post(url, headers=headers, json=data)
    assert_status_200(r)

def main():
    stable_diffusion_xl = NeuronStableDiffusionXLPipeline.from_pretrained(model_identifier)
    s3 = boto3.client(
        service_name='s3',
        region_name='auto',
        endpoint_url=r2_endpoint_url,
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key)

    while True:
        message = pull()

        if message is None:
            print('Nothing in queue...')
            time.sleep(5)
            continue
        
        message_body, message_lease_id = message
        print(message_body)

        work(message_body, stable_diffusion_xl, s3)

        ack(message_body, message_lease_id)

if __name__ == '__main__':
    main()
