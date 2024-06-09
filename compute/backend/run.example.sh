#!/bin/bash

export CLOUDFLARE_ACCOUNT_ID="abc123"
export CLOUDFLARE_TOKEN="abc123"
export CLOUDFLARE_QUEUE_ID="abc123"

export R2_ACCESS_KEY_ID="abc123"
export R2_SECRET_ACCESS_KEY="abc123"
export R2_BUCKET_NAME="images"

export ACK_SECRET_KEY="ab123"
export ACK_ENDPOINT="https://example.com/ack"

export MODEL_IDENTIFIER="abc123"

python main.py
