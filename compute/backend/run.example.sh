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

# Activate the correct conda environment
eval "$(/home/ubuntu/miniconda3/bin/conda shell.bash hook)"
conda activate build

# Fix python header file
export LD_LIBRARY_PATH="/home/ubuntu/miniconda3/envs/build/lib"

python main.py
