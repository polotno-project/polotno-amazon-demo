# Build notes

Everything here is observed while building this demo, not copied from
documentation. Where a fact is not yet verified, it says so.

Contents:

- [Models and region](#models-and-region)
- [Cost per image](#cost-per-image)
- [IAM policies](#iam-policies)
- [Render Lambda configuration](#render-lambda-configuration)
- [Fonts in Lambda](#fonts-in-lambda)
- [Gotchas](#gotchas)
- [What is verified and what is not](#what-is-verified-and-what-is-not)

---

## Models and region

| Purpose | Model ID | Inference type |
| --- | --- | --- |
| Text to image | `stability.stable-image-core-v1:1` | `ON_DEMAND`, bare model ID |
| Background removal | `us.stability.stable-image-remove-background-v1:0` | `INFERENCE_PROFILE`, `us.` prefix is mandatory |

**Region: `us-west-2`.** It is the only region that serves Stable Image Core and
is also a destination of the `us` geo inference profile that background removal
needs.

The two models behave differently, and the difference is not obvious:

```
GetFoundationModel stability.stable-image-core-v1:1
  inferenceTypesSupported: [ 'ON_DEMAND' ]

GetFoundationModel stability.stable-image-remove-background-v1:0
  inferenceTypesSupported: [ 'INFERENCE_PROFILE' ]
```

Background removal has **no In-Region support in any region**. It must be called
through the `us.` geo inference profile, which routes among us-east-1, us-east-2
and us-west-2. Calling it with the bare model ID fails.

The reverse is also true. There is **no** `us.stability.stable-image-core-v1:1`
profile. Calling Core with a `us.` prefix returns
`ValidationException: The provided model identifier is invalid`.

`ListInferenceProfiles` returns 13 Stability profiles in us-west-2, all
`SYSTEM_DEFINED` and `ACTIVE`. None of them is a text-to-image model.

Also worth knowing: **Amazon Nova Canvas is not a fallback.** It reached Legacy
status on 2026-03-30 with end of life on 2026-09-30, and new accounts cannot
start using Legacy models.

## Cost per image

The AWS Bedrock pricing page lists the 13 Stability *image services* but does
**not** list Stable Image Core, Ultra or SD3.5 Large. The real prices are in the
AWS Marketplace rate card, which you can read through the API:

```js
const { offers } = await bedrock.send(
  new ListFoundationModelAgreementOffersCommand({ modelId }),
);
offers[0].termDetails.usageBasedPricingTerm.rateCard;
```

Observed rate cards, per output image, in us-west-2:

| Model | Price |
| --- | --- |
| Stable Image Core | **$0.04** |
| Stable Image Ultra | $0.14 |
| Remove Background | $0.07 |

Two useful details:

- Billing is per **output image**, not per prompt or per attempt.
- Subscribing to any one of the 13 Stability image services enrols the account
  in all thirteen. One agreement covers remove background, inpaint, upscale and
  the rest.
- The support terms say "No refunds will be offered."

## IAM policies

The two Bedrock functions need **different** policies. That is the main reason
they are separate Lambdas rather than one handler that switches on the field
name. See `amplify/backend.ts`.

Text to image. A single foundation-model ARN, with an empty account field
(note the double colon):

```json
{
  "Sid": "InvokeStableImageCore",
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": [
    "arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1"
  ]
}
```

Background removal. The inference profile ARN **plus** the bare model ARN in
every region the geo profile can route to. Granting only the profile produces
`AccessDenied` on whichever region Bedrock happens to pick:

```json
{
  "Sid": "InvokeStableImageRemoveBackground",
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": [
    "arn:aws:bedrock:us-west-2:<account-id>:inference-profile/us.stability.stable-image-remove-background-v1:0",
    "arn:aws:bedrock:us-east-1::foundation-model/stability.stable-image-remove-background-v1:0",
    "arn:aws:bedrock:us-east-2::foundation-model/stability.stable-image-remove-background-v1:0",
    "arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-remove-background-v1:0"
  ]
}
```

The inference-profile ARN has an account ID. The foundation-model ARN does not.

The first invoke in an account also subscribes it through AWS Marketplace, so
the caller needs:

```json
{
  "Effect": "Allow",
  "Action": ["aws-marketplace:Subscribe", "aws-marketplace:ViewSubscriptions"],
  "Resource": "*",
  "Condition": { "StringEquals": { "aws:CalledViaLast": "bedrock.amazonaws.com" } }
}
```

## Render Lambda configuration

`polotno-node` renders a design JSON to PNG inside a headless Chromium. Values
that worked:

| Setting | Value | Why |
| --- | --- | --- |
| Runtime | `nodejs22.x` | |
| Architecture | **`x86_64`** | `@sparticuz/chromium` ships an x86-64 binary only. On arm64 it fails at runtime with an exec format error. |
| Memory | 2048 MB | Chromium fails or times out on larger designs below roughly 2 GB. |
| Timeout | 120 s | Not on the AppSync path, so the 30 s API limit does not apply. |
| Ephemeral storage | 2048 MB | Chromium inflates into `/tmp` on cold start, and `polotno-node` caches downloaded Google Fonts there too. The 512 MB default is not enough for both. |
| Package | zip, 129 MB unzipped | Well under the 250 MB hard limit. |

Observed: **3.4 s** for an 800x500 design with five text elements, warm.

Deployment package contents, largest first:

```
129M  node_modules
 66M  @sparticuz    (chromium.br is 62M of that)
 15M  chromium-bidi
 11M  @aws-sdk
7.8M  puppeteer-core
```

The function is defined as a plain CDK `lambda.Function` inside the Amplify
backend, because Amplify's normal `defineFunction` path bundles the handler with
esbuild and this function needs a real `node_modules` tree on disk. See
`amplify/functions/render-design/resource.ts`.

### A plain CDK function can still be an AppSync resolver

Useful and not obvious: `defineFunction(provider)` returns the same factory type
that `a.handler.function()` accepts, so the render Lambda serves the editor's
"Save & render" button **and** the CLI, with no second Lambda and no API
Gateway:

```ts
renderDesign: a
  .query()
  .arguments({ designKey: a.string().required() })
  .returns(a.string())
  .authorization((allow) => [allow.publicApiKey()])
  .handler(a.handler.function(renderDesign)),
```

The two callers deliver different event shapes, so the handler reads both:

```js
const designKey = event?.arguments?.designKey ?? event?.designKey;
```

The AppSync path inherits the fixed 30 s request limit while the Lambda keeps a
120 s timeout, deliberately. Lowering the Lambda to fit AppSync would cripple
the batch path, which is the point of the function. A design heavy enough to
pass 30 s still finishes and writes its PNG; only the browser sees a timeout.

## Fonts in Lambda

This is the part that costs people the most time.

**Lambda has no system fonts.** Any design that asks for Arial or Times New
Roman renders as empty boxes, or `polotno-node` fails with
`Timeout for loading font <name>`.

`@sparticuz/chromium` does ship a font archive, but it is smaller than people
assume. Decompressing `bin/fonts.tar.br` gives exactly this:

```
fonts.conf
fonts/Open_Sans/OpenSans-Bold.ttf
fonts/Open_Sans/OpenSans-Italic.ttf
fonts/Open_Sans/OpenSans-Regular.ttf
```

Open Sans and nothing else. No Arial, no serif, no monospace.

The fix is to ship metric-compatible fonts in the deployment package. This demo
uses all 12 Liberation faces (4.2 MB) from the Debian `fonts-liberation2`
package, SIL OFL licensed, committed to the repo rather than downloaded at build
time. Regular alone is not enough — bold and italic text falls back and the
render stops matching the editor.

`render-lambda/fonts/fonts.conf` maps the names:

```xml
<fontconfig>
  <dir>/var/task/fonts</dir>
  <dir>/tmp/fonts</dir>
  <alias><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias><family>Times New Roman</family><prefer><family>Liberation Serif</family></prefer></alias>
  <alias><family>Courier New</family><prefer><family>Liberation Mono</family></prefer></alias>
</fontconfig>
```

**Both `<dir>` lines are required, and this is the subtle part.**
`@sparticuz/chromium` sets its own font path like this:

```js
process.env["FONTCONFIG_PATH"] ??= join(tmpdir(), "fonts");
```

`??=` only assigns when the variable is unset. The moment the Lambda sets
`FONTCONFIG_PATH=/var/task/fonts` itself, that line does nothing, and this
`fonts.conf` becomes the only configuration fontconfig reads. Leaving
`/tmp/fonts` out of it silently discards Chromium's own Open Sans.

Google Fonts are a separate matter. `polotno-node` fetches them over the network
at render time and caches them in `os.tmpdir()`. Lambda needs outbound internet
for that, so do not put this function in a VPC without a NAT gateway.

Verified output — Roboto from Google Fonts, Arial, Times New Roman italic,
Courier New and Open Sans all render correctly:

![render output](docs/render-check.png)

## Gotchas

### Bedrock account authorization

The single most misleading error in the whole build.

Every `InvokeModel` call returned:

```
ValidationException: Operation not allowed
```

That message names neither billing nor access, and it is an HTTP 400, not a 403.
`GetFoundationModelAvailability` is the tool that tells you what is actually
wrong:

```js
const r = await bedrock.send(
  new GetFoundationModelAvailabilityCommand({ modelId }),
);
// agreementAvailability.status / authorizationStatus /
// entitlementAvailability / regionAvailability
```

Two different causes produce the identical `Operation not allowed` message:

**1. The Marketplace subscription failed.** Shows as
`agreementAvailability=NOT_AVAILABLE` or `ERROR`. On an account without a
chargeable payment method, `CreateFoundationModelAgreement` succeeds, and the
agreement is then terminated within seconds. Observed:

```
DescribeAgreement agmt-...
  status: TERMINATED
  start: 2026-08-10T19:16:45.002Z
  end:   2026-08-10T19:16:57.056Z
```

Twelve seconds. AWS Marketplace sends "offer accepted" and "agreement expired"
emails at the same moment, with identical start and end dates. Fixing the
account's payment method and re-subscribing moved it to `AVAILABLE`.

**2. The account is not authorized to invoke models at all.** Shows as
`agreementAvailability=AVAILABLE` but `authorizationStatus=NOT_AUTHORIZED`. On
this account it applied to **every model in every region**, including Amazon's
own `amazon.nova-micro-v1:0` and `amazon.nova-lite-v1:0`. Confirming it is not a
permissions problem:

- `iam:SimulatePrincipalPolicy` returns `allowed` for `bedrock:InvokeModel`,
  matched to `AdministratorAccess`, with no permissions boundary.
- CloudTrail logs **no `AccessDenied`**. `ListFoundationModels` succeeds in the
  same second that `InvokeModel` fails.
- The account is standalone, so no SCP is involved.

`PutUseCaseForModelAccess` finally returned the real answer:

```
Your account is not authorized to perform this action. Please create a support
case with details about your use case and we will get back to you.
```

Only AWS Support can lift this. The Bedrock **Model access** console page has
been retired and has nothing to click:

> Model access page has been retired. Serverless foundation models are now
> automatically enabled across all AWS commercial regions when first invoked.

So the documented "access is automatic on first invoke" behaviour does not hold
universally, and when it fails there is no console surface that says so.

### AppSync limits shape the API

Two AppSync quotas are fixed and cannot be raised:

- Resolver response size: **5 MB**
- Request execution time: **30 s**

So the Lambdas write the PNG to S3 and return only a URL. Returning base64
through the API would work for small images and then fail unpredictably.

The functions are set to `timeoutSeconds: 29`, deliberately **under** the
AppSync limit. If a Lambda outlives AppSync, the caller gets a generic timeout
while the Lambda keeps running and billing, and can still write an orphan object
to S3.

### Node 23 and later break the Amplify CLI

`ampx` dies before doing anything:

```
TypeError: localStorage.getItem is not a function
  at node_modules/@typescript/vfs/dist/vfs.cjs.development.js:30
```

Node 23+ exposes a `localStorage` global that is not a real Storage object until
you pass `--localstorage-file`. `@typescript/vfs`, a transitive Amplify
dependency, calls `localStorage.getItem("DEBUG")` at import time. The error
mentions neither Amplify nor Node.

Note that `@aws-amplify/backend-cli` declares `engines: { node: ">=22" }`, which
claims Node 25 is supported. It is not.

Use Node 22 LTS. If you cannot, `--no-experimental-webstorage` removes the
global and is enough; `scripts/with-aws.sh` applies it when the Node major
version is 23 or higher.

### CDK bootstrap is a separate step

`ampx sandbox` stops with "The region us-west-2 has not been bootstrapped. Sign
in to the AWS console as a Root user or Admin". You do not need the console:

```bash
npx aws-cdk@2 bootstrap aws://<account-id>/us-west-2
```

### Code.fromAsset ships a broken Lambda without complaining

`Code.fromAsset('render-lambda')` on a directory with no `node_modules` succeeds,
produces a 20 KB zip, deploys green, and the function dies on first invoke with
`Cannot find module 'polotno-node'`. Nothing in the build fails.

CDK does **not** read `.gitignore`, so `node_modules` is included when it exists.
`amplify/functions/render-design/resource.ts` asserts at synth time instead.

### polotno-node pulls in full puppeteer

`polotno-node` depends on `puppeteer`, not only `puppeteer-core`, and
`puppeteer`'s postinstall downloads about 170 MB of desktop Chrome that this
Lambda never uses. `--omit=dev` does not skip it, because it is a production
dependency of a dependency. Use:

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
```

### The Amplify app region is not necessarily the Bedrock region

Amplify Hosting deploys the backend into **the Amplify app's own region**, which
is whatever region the console was set to when the app was created. It is easy
to create the app in us-east-1 without noticing.

That breaks a hardcoded Bedrock region in two ways at once. The Lambda's
`BedrockRuntimeClient` defaults to `AWS_REGION`, so it calls Bedrock in the
deployment region, while the IAM policy names a different one. The result is
`AccessDenied` on a policy that looks correct.

Keep the two explicitly separate:

```ts
// backend.ts - the region the IAM policies name
const BEDROCK_REGION = 'us-west-2';
fn.addEnvironment('BEDROCK_REGION', BEDROCK_REGION);

// handler - do not let this default to AWS_REGION
new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION });
```

The `region` value published through `backend.addOutput` must be the opposite:
`assetsStack.region`, the deployment region, because the CLI scripts use it to
reach Lambda and S3.

### npm ci fails on a lockfile that npm install just wrote

The Amplify build runs `npm ci`, which refuses to install when
`package.json` and `package-lock.json` disagree:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @aws-cdk/toolkit-lib@1.19.0 from lock file
```

The lockfile did contain that package, at a different version. Regenerating with
a plain `npm install` did not fix it, because the resolution was influenced by
what was already in `node_modules`. Resolving purely from the registry did:

```bash
rm -rf node_modules package-lock.json
npm install --package-lock-only
npm ci --dry-run     # verify before pushing
```

Anything that writes to `node_modules` outside a normal install can leave the
lockfile in this state, including `npm install --no-save`. The failure only
appears in CI, so `npm ci --dry-run` is worth running locally before a push.

### Amplify Gen 2 details

- **`defineFunction` defaults to a 3 second timeout.** Any model call fails.
- **`environment` takes literal strings only.** A bucket name is a
  CloudFormation token, so it must go through `backend.myFn.addEnvironment(...)`.
  Note `backend.myFn.resources.lambda.addEnvironment(...)` does not type-check:
  CDK's `IFunction` interface has no such method.
- **`secret()` does not work for a provided (plain CDK) function.** Amplify's SSM
  resolver is injected by the esbuild bundling path only, so a secret arrives as
  an unresolved placeholder string.
- **Avoid `backend.createStack(name)` when functions use `resourceGroupName`.**
  They share one map, so `createStack` throws if a function already claimed the
  name. Putting every function in one `resourceGroupName` and using
  `Stack.of(backend.someFn.resources.lambda)` keeps all grants intra-stack.
- **`defineData` works with no `defineAuth`.** API-key-only is fine. But because
  `apiKeyAuthorizationMode` is set explicitly, transformer sandbox mode is off
  and every operation needs its own `allow.publicApiKey()`. A missing one fails
  at query time, not at deploy time.
- **Setting both `AWS_REGION` and `AWS_DEFAULT_REGION`** makes `ampx` print a
  legacy-variable warning on every run.

### S3 for browser-loaded images

- **Do not send `ACL: 'public-read'` on PutObject.** Buckets default to
  `BUCKET_OWNER_ENFORCED` ownership, which rejects any ACL with
  `AccessControlListNotSupported`.
- **Set all four `BlockPublicAccess` flags explicitly.** An omitted sub-option
  defaults to `true` under the current CDK feature flag, and
  `restrictPublicBuckets: true` alone makes a public bucket policy inert with no
  error anywhere.
- **Use `bucketRegionalDomainName`, not the global endpoint.** A new bucket
  answers `s3.amazonaws.com` with a 307 redirect, and a redirect breaks an
  `<img crossorigin="anonymous">`.
- **Public prefix, not presigned URLs.** Presigned URLs expire; a design saved
  today has to still render next week. `images/` and `renders/` are
  world-readable, because both hold derived images with nothing secret in them.
  `designs/` stays private and returns 403 to anonymous requests.
- `removalPolicy: DESTROY` plus `autoDeleteObjects: true`, otherwise
  `ampx sandbox delete` fails on a bucket that is not empty.

### An unauthenticated URL-fetching endpoint is an SSRF primitive

`removeBackground` takes an image URL so it can work on the stock photos that
Polotno's default panel inserts. With no allowlist, anyone could point it at
`169.254.169.254` and read EC2 instance metadata. The handler allowlists the
host and refuses redirects. Verified:

```
removeBackground, SSRF metadata IP  -> Host "169.254.169.254" is not allowed.
removeBackground, disallowed host   -> Host "evil.example.com" is not allowed.
removeBackground, http not https    -> imageUrl must use https.
```

### Polotno 4 dropped Blueprint

Polotno 4 replaced the Blueprint.js chrome with its own design system. For
custom side panels:

```js
// Before
import '@blueprintjs/core/lib/css/blueprint.css';
// After
import 'polotno/ui.css';
```

Build your own controls from `polotno/primitives` (`Button`, `Textarea`,
`Select`, `Separator` and more) so they follow the editor theme, including dark
mode. The `@blueprintjs/*` packages are declared `optional: true` in Polotno's
`peerDependenciesMeta`, so removing them is clean.

Removing Blueprint from this demo took the bundle from 6670 to 4268 modules and
the CSS from 465 kB to 87 kB.

Style your own UI with Polotno's CSS variables (`--border`, `--card`,
`--muted-foreground`, `--destructive`) rather than its utility classes. The docs
warn that utility classes can change between releases.

## Polotno licence

Everything here works with the **free Polotno developer key**. No paid plan was
needed for the editor, the side panel API, `store.toJSON()`, or `polotno-node`
rendering. The free key shows a "Powered by Polotno" credit on the canvas, which
a paid licence removes.

Polotno keys are visible in the browser by design, so the key is not a secret and
does not belong in Secrets Manager.

## What is verified and what is not

Verified against real AWS:

- Backend deploys clean. AppSync API, three bundled Lambdas, the render Lambda,
  the S3 bucket and all IAM policies. 118 s.
- `saveDesign` round trip: browser to AppSync with an API key, to Lambda, to S3.
- Render Lambda: design JSON from S3 to PNG in S3, 3.4 s, all five font families
  correct.
- `designs/` returns HTTP 403 to anonymous requests; `renders/` returns 200.
- The editor's "Save & render" button, through AppSync: save 1.5 s, render
  6.5 s including Lambda cold start. The same Lambda from the CLI: 1.4 s warm.
- All eight input-validation and SSRF paths, through AppSync.
- Marketplace pricing, model IDs, inference types and region availability.

**Not yet verified:** `generateImage` and `removeBackground` end to end. Both are
implemented and deployed, and their validation paths are tested, but no Bedrock
model has been invoked successfully because the AWS account is not yet authorized
for Bedrock inference. See
[Bedrock account authorization](#bedrock-account-authorization). When the account
is authorized, `npm run check:bedrock` confirms both models with no code change.
