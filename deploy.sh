#!/usr/bin/env bash
# Build and deploy the cloud installation using cloudbuild.yaml.
set -euo pipefail

required=(PROJECT GATEWAY_SA AGENT_SA AWS_BUCKET_NAME FIREBASE_API_KEY FIREBASE_PROJECT_ID FIREBASE_APP_ID RAZORPAY_PUBLIC_KEY)
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 2
  fi
done

region="${REGION:-asia-south1}"
repo="${REPO:-cldxai}"
substitutions="_REGION=$region,_REPO=$repo,_GATEWAY_SA=$GATEWAY_SA,_AGENT_SA=$AGENT_SA,_AWS_BUCKET_NAME=$AWS_BUCKET_NAME"
substitutions+=",_FIREBASE_API_KEY=$FIREBASE_API_KEY,_FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,_FIREBASE_APP_ID=$FIREBASE_APP_ID"
substitutions+=",_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN:-},_FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET:-},_FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID:-}"
substitutions+=",_COMFY_URL=${COMFY_URL:-}"
substitutions+=",_RAZORPAY_PUBLIC_KEY=$RAZORPAY_PUBLIC_KEY"

gcloud builds submit . --project="$PROJECT" --config=cloudbuild.yaml --substitutions="$substitutions"
