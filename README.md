# Polotno + Amazon Bedrock demo

A design editor that generates images with Amazon Bedrock, removes their
backgrounds, and renders designs to PNG in a Lambda.

Vite + React + [Polotno SDK](https://polotno.com), AWS Amplify Gen 2, Amazon
Bedrock (Stability AI), and `polotno-node` on Lambda. No user accounts: the
editor calls an AppSync API with an API key, and every AWS call happens in a
Lambda, so no credentials reach the browser.

1. **AI panel → Generate image.** A prompt goes to Bedrock, the image lands on
   the canvas.
2. **Select an image → Remove background.** Bedrock returns a transparent PNG.
3. **Save & render.** The design JSON goes to S3, then a Lambda running
   `polotno-node` renders it to a PNG and the editor links to it.
4. **`npm run render`.** The same Lambda from the command line, for batch use.

## Prerequisites

- **Node.js 22 LTS.** Node 23+ crashes the Amplify CLI on startup.
- An AWS account with a payment method. Bedrock subscribes to Stability models
  through AWS Marketplace on the first call.
- A Polotno API key from [polotno.com/login](https://polotno.com/login). Set it
  as `VITE_POLOTNO_KEY`. Optional — without it the app uses the public demo key,
  which watermarks the canvas.

No AWS CLI needed — this uses `ampx` and the AWS SDK for JavaScript.

## Setup

```bash
npm install
(cd render-lambda && PUPPETEER_SKIP_DOWNLOAD=true npm install)
```

The second install is separate because the render Lambda ships its own
`node_modules` with a Chromium binary (~130 MB).

Credentials stay inside this project; nothing touches `~/.aws`.

Deploying Amplify Gen 2 needs broad permissions, so the quickest path is an IAM
user with `AdministratorAccess`. That is fine for a throwaway demo account and
wrong for anything else — AWS recommends
[temporary credentials and least privilege](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).
Prefer IAM Identity Center and paste the temporary keys below instead, and
delete the access key when you are finished either way.

```bash
mkdir -p .aws && cat > .aws/credentials <<'EOF'
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
EOF
npm run whoami          # confirms the key works, prints your account ID
```

## Run

```bash
npx aws-cdk@2 bootstrap aws://<account-id>/us-west-2   # once per region
npm run check:bedrock   # confirms both models are reachable
npm run sandbox         # deploys the backend, leave running
npm run dev             # editor on localhost:5173
```

`npm run render -- designs/<uuid>.json` renders a saved design and downloads it
to `out/render.png`. `npm run sandbox:delete` removes everything.

## Deploy

Amplify console → **Create new app** → GitHub → pick this repo and branch. It
reads `amplify.yml` from the repo; do not edit build settings in the console.
Set `_BUILD_TIMEOUT` = `60` in the app's environment variables. The first build
takes about 15 minutes.

## Region and models

Fixed to **us-west-2**, the only region serving both:

| Purpose | Model ID |
| --- | --- |
| Text to image | `stability.stable-image-core-v1:1` ($0.04/image) |
| Background removal | `us.stability.stable-image-remove-background-v1:0` ($0.07/image) |

The `us.` prefix on background removal is mandatory — it has no in-region
support. Stable Image Core is the opposite: the prefix is invalid there.

Bedrock is called in us-west-2 regardless of where the backend is deployed, via
the `BEDROCK_REGION` environment variable.

## Security and cost

This is a public demo, not a template for production. Known trade-offs:

- **The AppSync API key is public and calls paid Bedrock operations.** Anyone
  who reads it from the JavaScript bundle can spend your money at $0.04 and
  $0.07 per image. Before leaving a deployment up, set an
  [AWS Budget alert](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html),
  and consider AWS WAF rate limiting on the AppSync API. Real applications
  should authenticate users and rate limit per user instead.
- **The key expires after 365 days.** It is baked into `amplify_outputs.json` at
  build time, so rotating it means redeploying the frontend.
- **`images/` and `renders/` are world readable.** Anyone with a URL can fetch
  them. URLs are unguessable UUIDs, not access control. `designs/` is private.
- **Do not put anything sensitive in a prompt or on the canvas.** Prompts go to
  a third-party model, and the results land in a public S3 prefix.
- **Objects expire after 30 days** by an S3 lifecycle rule, which bounds storage
  cost and exposure. Nothing else cleans up.
- **Delete it when you are done.** `npm run sandbox:delete` removes the sandbox;
  delete the Amplify app in the console to remove the hosted stack.
