# CLDX deployment guide

CLDX has two supported installation profiles. Deploy them separately; each profile has its own database, cache, vector store, secrets, and user origin. The hosted profile does not expose Sovereign Mode in its UI. The local profile requires Sovereign Mode for its local account.

## Hosted cloud profile

`cloudbuild.yaml` builds and deploys three Cloud Run services in `asia-south1` by default:

1. `cldx-agent`: private IAM protected agent runtime.
2. `cldx-app`: authenticated API gateway, publicly reachable so the agent can call its internal endpoints using `INTERNAL_API_KEY`.
3. `cldx-web`: public Vite frontend. Nginx proxies `/api/` and `/artifacts/` to `cldx-app`, so browser sessions use one origin.

Create an Artifact Registry Docker repository. Create dedicated gateway and agent service accounts. Give the gateway account `roles/run.invoker` on the agent; the pipeline also applies this binding. Give each runtime account Secret Manager access only to the secrets it uses. The Cloud Build account needs Artifact Registry write, Cloud Run deployment, service account user, Secret Manager access for deployment, and permission to update the agent's IAM policy.

Create these Secret Manager secrets before running the build:

- Agent: `MONGODB_URL`, `REDIS_URL`, `INTERNAL_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.
- Gateway: `MONGODB_URL`, `REDIS_URL`, `INTERNAL_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `SARVAM_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`.

The S3 bucket named by `AWS_BUCKET_NAME` must exist and be private. Configure the bucket's retention, encryption, and CORS policy for the actual download flow. MongoDB, Redis, and Qdrant must be reachable from Cloud Run; if they have private endpoints, configure Direct VPC egress for both services. Avoid placing sensitive logs or artifacts on the Cloud Run filesystem because it is ephemeral.

Set the following environment variables locally, then run `./deploy.sh` from the repository root:

```text
PROJECT, GATEWAY_SA, AGENT_SA, AWS_BUCKET_NAME,
FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, RAZORPAY_PUBLIC_KEY
```

Optional: `REGION`, `REPO`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `COMFY_URL`. Image generation requires a reachable ComfyUI endpoint; leave `COMFY_URL` empty to disable that feature.

The first deployment creates the web URL. Add that domain to Firebase Authentication's authorized domains. Cloud Build then sets the gateway CORS origin to that web URL. For a custom domain, map it to `cldx-web` and update `FRONTEND_URL` on `cldx-app` to the custom HTTPS origin.

After deployment, confirm Google sign-in, a chat turn, document export, a restarted agent instance, and a failed direct call to the private agent without an identity token. Cloud Run's IAM token is added by `cloudRunIdentity.js`; `INTERNAL_API_KEY` remains the application level check.

## Sovereign profile

See [deploy/sovereign/README.md](deploy/sovereign/README.md). It runs without cloud credentials or Google sign-in. The local account is forced to `sovereign_only`; local models, embeddings, vectors, history, and artifacts stay in the installation. The default web port binds only to loopback; expose it through an HTTPS reverse proxy with host firewall rules.

## Release gates

- Build the exact revision to deploy; do not copy a developer `.env` or service account JSON into an image.
- Run `docker compose config` for the sovereign profile and inspect Cloud Build substitutions and permissions.
- Verify cloud gateway to private agent authentication and offline network containment from inside the running containers.
- Verify a sovereign canary string cannot be read by a cloud turn or saved in a hosted database.
- Test backup restoration and rollback before admitting production traffic.
