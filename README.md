# Polotno + Amazon Bedrock demo

A design editor that generates images with Amazon Bedrock, removes their
backgrounds, saves the design to S3, and renders that design to a PNG in a
Lambda.

| Part | Technology |
| --- | --- |
| Editor | Vite, React 19, [Polotno SDK](https://polotno.com) |
| Backend | AWS Amplify Gen 2, `defineFunction` behind AppSync, API-key auth |
| AI | Amazon Bedrock, Stability AI models |
| Batch render | AWS Lambda, `polotno-node`, `@sparticuz/chromium`, `puppeteer-core` |
| Hosting | AWS Amplify Hosting |

There are no user accounts, no database and no Cognito. AWS credentials never
reach the browser: the editor calls an AppSync API with an API key, and every
AWS call happens inside a Lambda.

`NOTES.md` records the model IDs, the IAM policies, the Lambda configuration and
every problem found while building this.

## What it does

1. **AI side panel → Generate image.** A prompt goes to Bedrock. The image
   lands on the canvas.
2. **Select an image → Remove background.** Bedrock returns a transparent PNG
   and replaces the element's source.
3. **Save design.** The design JSON goes to S3.
4. **`npm run render`.** A Lambda reads that JSON and writes a PNG to S3.

## Prerequisites

- **Node.js 22 LTS.** Node 23 and later expose a `localStorage` global that
  crashes the Amplify CLI on startup. `scripts/with-aws.sh` works around it, but
  22 is the tested version.
- An AWS account with a payment method. Bedrock subscribes to Stability models
  through AWS Marketplace on the first call.
- A GitHub account, for the hosting step only

You do **not** need the AWS CLI. This project uses the AWS SDK for JavaScript
and the Amplify CLI (`ampx`), both installed by `npm install`.

## 1. Install

```bash
git clone https://github.com/lavrton/polotno-amazon-demo.git
cd polotno-amazon-demo
npm install
cd render-lambda && PUPPETEER_SKIP_DOWNLOAD=true npm install && cd ..
```

The second install is separate on purpose. The render Lambda ships a real
`node_modules` folder, because it needs a Chromium binary on disk. It comes to
about 130 MB. `PUPPETEER_SKIP_DOWNLOAD` stops `puppeteer` from downloading a
desktop Chrome that this project never uses.

## 2. AWS credentials

Credentials stay inside this project. Nothing reads or writes `~/.aws`.

1. In the AWS console open **IAM → Users → Create user**.
2. Attach the **AdministratorAccess** policy. Amplify creates
   CloudFormation stacks, IAM roles, Lambda functions, an S3 bucket and an
   AppSync API.
3. Open the new user, choose **Security credentials → Create access key**, and
   select **Command Line Interface (CLI)**.
4. Write the key into `.aws/credentials` in this folder:

```bash
mkdir -p .aws
cat > .aws/credentials <<'EOF'
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
EOF
```

`.aws/` is in `.gitignore`. Confirm that the key works:

```bash
npm run whoami
```

## 3. Confirm that Bedrock works

Run this before deploying anything. It lists the Stability models that your
account can reach in `us-west-2`, then calls both models for real and writes
two PNGs to `out/`.

```bash
npm run check:bedrock
```

The first call in a new AWS account subscribes it to the Stability models
through AWS Marketplace. That can take up to 15 minutes, and returns
`AccessDeniedException` until it finishes. If that happens, wait and run the
command again.

**The region is fixed at `us-west-2`.** It is the only region that serves
Stable Image Core and is also a destination of the `us` geo inference profile
that background removal needs. See `NOTES.md`.

## 4. Run it locally

The first deploy into a region needs a one-off CDK bootstrap. Without it the
sandbox stops and tells you to sign in to the console as root, which you do not
have to do:

```bash
npx aws-cdk@2 bootstrap aws://<your-account-id>/us-west-2
```

`npm run whoami` prints your account ID.

Now start the backend sandbox. It creates real AWS resources in your account and
writes `amplify_outputs.json`. Leave it running.

```bash
npm run sandbox
```

In a second terminal:

```bash
npm run dev
```

Open the URL that Vite prints. The **AI** tab is the first side panel section.

To remove the sandbox and everything in it:

```bash
npm run sandbox:delete
```

## 5. Render a design in Lambda

Press **Save design** in the editor. It prints a key such as
`designs/1f0c….json`. Then:

```bash
npm run render -- designs/1f0c….json
```

The Lambda reads the JSON, renders it and writes a PNG to S3. The script
downloads it to `out/render.png`.

## 6. Deploy to Amplify Hosting

1. Push this repository to GitHub.
2. Open the **AWS Amplify** console in **us-west-2** and choose **Create new
   app → GitHub**. Authorise Amplify and select the repository and branch.
3. Amplify reads `amplify.yml` from the repository. Do not edit the build
   settings in the console.
4. Under **Advanced settings → Environment variables** add:
   - `_BUILD_TIMEOUT` = `60`. The default is 30 minutes, and this build
     installs a Chromium package and uploads an 85 MB Lambda asset.
   - `VITE_POLOTNO_KEY` = your Polotno key. Optional. Without it the app uses
     Polotno's public demo key, which shows a watermark.
5. Deploy. The first build creates the backend and takes about 15 minutes.

The build role needs permission to create the same resources as step 2. The
service role that Amplify offers to create for you is enough.

## Cost

Everything except Bedrock stays inside the AWS free tier at demo volumes.
Bedrock charges per image. `NOTES.md` has the numbers.

Delete the sandbox with `npm run sandbox:delete` and delete the Amplify app in
the console when you are finished. The S3 bucket empties itself on delete.

## Layout

```
amplify/
  backend.ts                     S3 bucket, IAM policies, environment, outputs
  data/resource.ts               the three API operations
  functions/
    generate-image/              Bedrock text to image
    remove-background/           Bedrock background removal
    save-design/                 design JSON to S3
    render-design/resource.ts    CDK definition of the render Lambda
    shared/                      Bedrock and S3 helpers
render-lambda/                   the render Lambda, with its own dependencies
  index.mjs
  fonts/                         Liberation fonts. Lambda has no system fonts.
scripts/                         check-bedrock, render, whoami
src/                             the editor
```
