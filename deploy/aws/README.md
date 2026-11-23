# Low-cost hosted deployment on AWS Lightsail

This is the small, single-server **cloud** profile. It runs the web UI, gateway,
agent, MongoDB and Redis on one Lightsail instance. Only Caddy publishes ports;
it obtains HTTPS certificates. Firebase handles Google sign-in, a private
Docker volume stores generated downloads, and Google's API handles model calls. Billing, local model
inference, image generation, cloud search, and persistent Qdrant indexing are
off in this profile. Document retrieval uses the app's in-memory vector store.

This is suited to a small demo and light use. It has one server and no high
availability. Public sign-up is available with a limited trial credit balance.
Do not call it a zero-cost service: the instance and optional
snapshots accrue charges even while promotional credits pay the bill. Check
your credit balance and expiry before creating resources. Generated downloads
expire after 24 hours; back up the MongoDB volume for conversation history.

## 1. Check the account and set a budget

1. In **AWS Billing and Cost Management → Credits**, record the remaining
   balance, expiry date, and eligible services. Confirm that the credit can
   offset Lightsail charges.
2. In **Budgets**, create a monthly cost budget and email alerts at amounts you
   can afford. Budget alerts are notifications, not a spending cap.
3. Verify the AWS CLI profile locally with `aws sts get-caller-identity`. If it
   fails, refresh the profile before asking someone else to deploy for you.

The 4 GB Lightsail Linux instance with public IPv4 is listed at **$24/month**
before credits. The 8 GB plan is **$44/month** if the 4 GB host proves too
small. Excess transfer and snapshots are separate. The
4 GB deployment adds 2 GB of swap for build spikes; measure runtime memory
before increasing the plan.

## 2. Prepare the external services

1. Create a Firebase project on the no-cost Spark plan. Add a web app, enable
   **Authentication → Sign-in method → Google**, and record the web config's
   API key, auth domain, project ID and app ID. Create a Firebase Admin service
   account JSON in **Project settings → Service accounts**. Keep the JSON
   private; it is mounted into the gateway at runtime, never put in an image.
2. Create a Google AI Studio API key for chat, coding, PDF, PPT, vision, and
   document retrieval. The profile uses `gemini-2.5-flash` and
   `gemini-embedding-001`, which currently have free tiers with limits. A
   working Groq key is optional; when supplied, it handles text chat, coding,
   and MCP calls using `openai/gpt-oss-120b`.

## 3. Create the server and address

1. In Lightsail, create an **Ubuntu 24.04 LTS** Linux instance in your chosen
   Region, with the **4 GB / 80 GB / public IPv4** bundle. Name it `cldx-cloud-server`.
2. Attach a static IPv4 address. It is included while attached to an instance.
3. In the Lightsail firewall, allow TCP **80** and **443** from the internet.
   Allow TCP **22** only from your own current IP. Leave all other ports closed.
4. Point a domain/subdomain A record at the static IP. For an initial test
   without a purchased domain, `<static-ip>.sslip.io` resolves to that IP; this
   depends on an external free DNS service and is not a durable production name.
5. Add the chosen hostname (without `https://`) to Firebase Authentication's
   **Authorized domains** list.

## 4. Install Docker on the instance

Connect by SSH as the Ubuntu user. Follow Docker's official Ubuntu repository
installation; the commands below are for Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker compose version
```

## 5. Set private configuration on the instance

```bash
git clone https://github.com/gyanranjanpanda/cldxx.git
cd cldxx/deploy/aws
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
chmod 600 .env
```

Edit `.env` on the instance. Fill every required blank value. Leave
`AUTH_ALLOWED_EMAILS` blank to allow any verified Google account to join, or
set a comma-separated list for a private deployment. `PUBLIC_SIGNUP_CREDITS`
limits the initial app credits for each new account; it does not limit AWS
charges or provider charges. Set provider-side quotas and billing alerts before
inviting the public.
Generate each of
`MONGO_PASSWORD`, `REDIS_PASSWORD`, `INTERNAL_API_KEY`, and `MCP_SECRET` with
`openssl rand -hex 24`. Use only the hostname in `SITE_DOMAIN`. If using the
test DNS name, replace dots in the static IP with dots as normal, for example
`203.0.113.10.sslip.io`. Keep `.env` out of Git and chat messages.

Place the Firebase Admin JSON at
`deploy/aws/secrets/firebase-service-account.json`, then run:

```bash
chmod 600 secrets/firebase-service-account.json
sudo docker compose --env-file .env config --quiet
```

## 6. Build, start and verify

```bash
sudo docker compose --env-file .env build app
sudo docker compose --env-file .env build agent
sudo docker compose --env-file .env build web
sudo docker compose --env-file .env up -d
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail=100 app agent web caddy
curl -I "https://$(sed -n 's/^SITE_DOMAIN=//p' .env)"
```

Open the HTTPS address, sign in with Google, send a short chat prompt, and
generate a small document to verify its authenticated download. Check that MongoDB, Redis and
the agent have **no** published host ports (`docker compose ps`). Confirm that
the public site redirects HTTP to HTTPS and that Firebase accepts its domain.
Image generation needs a separate ComfyUI endpoint and is deliberately off by
default. The backup image agent can use Pollinations when a server-side
`POLLINATIONS_API_KEY` is set in `deploy/aws/.env`. It uses the current
`gen.pollinations.ai/image` API and stores the result with the same local
artifact service as PDF downloads. Pollinations usage is separate from AWS
credits; check the account's image pricing and set a key budget before enabling
it for public users. With neither provider configured, image requests return
an unavailable message without deducting app credits.

### Vercel frontend

The repository's `frontend/vercel.json` routes `/api/` and `/artifacts/` to
the Lightsail HTTPS hostname, then serves the Vite single-page app. Keep
`VITE_SERVER_URL` unset in Vercel so browser requests and session cookies use
the Vercel origin. Set the `VITE_FIREBASE_*` build variables from the same
Firebase web app as this gateway. Set the Vercel project's Root Directory to
`frontend`, authorize its production hostname in Firebase Authentication, and
set `VITE_FIREBASE_AUTH_DOMAIN` to that hostname without `https://`. The
The `/__/auth/` rewrite in `frontend/vercel.json` serves Firebase's sign-in
helper through the same origin. The Vite build generates
`/__/firebase/init.json` from the frontend's Firebase environment variables;
this file must return JSON from the deployed site. In Google Auth Platform,
add `https://<frontend-hostname>` as an authorized JavaScript origin and
`https://<frontend-hostname>/__/auth/handler` as an authorized redirect URI
on the Firebase Google provider's web client. Redeploy the frontend after
changing the build variable. Firebase's redirect flow needs all of these
settings to work in browsers that block third-party storage. Set
`FRONTEND_URL` in this profile's `.env` to that HTTPS hostname. Restart the
gateway with `sudo docker compose --env-file .env up -d app` after changing it.
The original Lightsail hostname remains an allowed origin for fallback access.

## 7. Operate or remove it

- Back up MongoDB, and test a restore. Back up the `.env`
  values and Firebase Admin JSON in a secure place; losing them can break
  sessions and encrypted user keys. Snapshots have extra cost.
- Before updating: `git pull --ff-only`, then `sudo docker compose --env-file
  .env build` and `sudo docker compose --env-file .env up -d`. Check the logs
  and one chat turn after each update.
- Check the AWS Credits and Billing pages regularly. A stopped Lightsail
  instance still accrues plan charges; delete the instance and snapshots
  when you no longer need them. Keep a backup before deletion.
