import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

import { data } from './data/resource';
import { generateImage } from './functions/generate-image/resource';
import { removeBackground } from './functions/remove-background/resource';
import { saveDesign } from './functions/save-design/resource';
import { renderDesign } from './functions/render-design/resource';

// The region Bedrock is called in. This is deliberately independent of the
// region the rest of the backend is deployed to: Amplify Hosting provisions the
// backend into the Amplify app's own region, and Stability image models are not
// available everywhere.
//
// us-west-2 serves Stable Image Core and is a destination of the "us" geo
// inference profile that background removal requires.
const BEDROCK_REGION = 'us-west-2';

// Polotno keys are visible in the browser by design, so this is not a secret
// and does not belong in Secrets Manager. The fallback is Polotno's public
// demo key. Override it with a POLOTNO_API_KEY environment variable.
const POLOTNO_API_KEY = process.env.POLOTNO_API_KEY ?? 'nFA5H9elEytDyPyvKL7T';

const backend = defineBackend({
  data,
  generateImage,
  removeBackground,
  saveDesign,
  renderDesign,
});

// ---------------------------------------------------------------------------
// Assets bucket
//
// Deliberately NOT backend.createStack('Assets'). That method shares one map
// with resourceGroupName, so it throws if a function already claimed the name,
// and it would put the bucket in a different nested stack from the functions
// that use it. Every function above declares resourceGroupName: 'assets', so
// the stack below IS that group and all the grants are intra-stack references.
// ---------------------------------------------------------------------------

const assetsStack = Stack.of(backend.renderDesign.resources.lambda);

const assets = new s3.Bucket(assetsStack, 'AssetsBucket', {
  // All four flags are listed on purpose. Under the current CDK feature flag an
  // omitted sub-option defaults to true, and restrictPublicBuckets alone is
  // enough to make the bucket policy below inert with no error anywhere.
  blockPublicAccess: new s3.BlockPublicAccess({
    blockPublicAcls: true, // ACLs stay off. Access comes from the policy.
    ignorePublicAcls: true,
    blockPublicPolicy: false, // needed: a public bucket policy is attached below
    restrictPublicBuckets: false, // needed: otherwise that policy never applies
  }),
  // The S3 default since April 2023. Stated explicitly so that nobody adds
  // `ACL: 'public-read'` to a PutObject and gets AccessControlListNotSupported.
  objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  // Amplify forces DESTROY on every resource in a sandbox. Without
  // autoDeleteObjects, `ampx sandbox delete` then fails on a bucket that is not
  // empty. CDK rejects autoDeleteObjects unless removalPolicy is DESTROY.
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  // The editor loads these images into a canvas and later exports that canvas.
  // Without CORS the browser taints the canvas and the export fails.
  cors: [
    {
      allowedOrigins: ['*'],
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
      maxAge: 3000,
    },
  ],
});

// Public read on images/ and renders/. designs/ stays private, because it is
// the input the render Lambda reads and nothing else should.
//
// Presigned URLs were the alternative and they are wrong here: they expire, and
// a design saved today has to still render next week. Both prefixes hold
// derived images with nothing secret in them.
assets.addToResourcePolicy(
  new iam.PolicyStatement({
    sid: 'PublicReadGeneratedImages',
    effect: iam.Effect.ALLOW,
    principals: [new iam.AnyPrincipal()],
    actions: ['s3:GetObject'],
    resources: [assets.arnForObjects('images/*'), assets.arnForObjects('renders/*')],
  }),
);

// The regional endpoint, not the global one. A new bucket answers the global
// s3.amazonaws.com host with a 307 redirect, and a redirect breaks an <img>
// that carries crossorigin="anonymous".
const assetsHost = assets.bucketRegionalDomainName;
const assetsPublicBaseUrl = `https://${assetsHost}/`;

// ---------------------------------------------------------------------------
// Bedrock permissions
//
// The two models need different policies, which is the main reason they are
// separate functions.
// ---------------------------------------------------------------------------

backend.generateImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'InvokeStableImageCore',
    effect: iam.Effect.ALLOW,
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:${BEDROCK_REGION}::foundation-model/stability.stable-image-core-v1:1`,
    ],
  }),
);

// Background removal runs through the "us" geo inference profile, so the policy
// needs the profile ARN in this account PLUS the bare model ARN in every region
// the profile can route to. Listing only the profile gives AccessDenied on
// whichever region Bedrock happens to pick.
backend.removeBackground.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'InvokeStableImageRemoveBackground',
    effect: iam.Effect.ALLOW,
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:${BEDROCK_REGION}:${assetsStack.account}:inference-profile/us.stability.stable-image-remove-background-v1:0`,
      ...['us-east-1', 'us-east-2', 'us-west-2'].map(
        (region) =>
          `arn:aws:bedrock:${region}::foundation-model/stability.stable-image-remove-background-v1:0`,
      ),
    ],
  }),
);

// Bedrock stopped using an access-request form in October 2025. A model is now
// enabled by its first invoke, which subscribes the account through AWS
// Marketplace. Only that first invoke in the whole account needs these actions.
for (const fn of [backend.generateImage, backend.removeBackground]) {
  fn.resources.lambda.addToRolePolicy(
    new iam.PolicyStatement({
      sid: 'BedrockFirstInvokeMarketplaceSubscription',
      effect: iam.Effect.ALLOW,
      actions: ['aws-marketplace:Subscribe', 'aws-marketplace:ViewSubscriptions'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'aws:CalledViaLast': 'bedrock.amazonaws.com' },
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// S3 permissions, one prefix per function
// ---------------------------------------------------------------------------

assets.grantPut(backend.generateImage.resources.lambda, 'images/*');

assets.grantRead(backend.removeBackground.resources.lambda, 'images/*');
assets.grantPut(backend.removeBackground.resources.lambda, 'images/*');

assets.grantPut(backend.saveDesign.resources.lambda, 'designs/*');

assets.grantRead(backend.renderDesign.resources.lambda, 'designs/*');
assets.grantPut(backend.renderDesign.resources.lambda, 'renders/*');

// ---------------------------------------------------------------------------
// Environment variables
//
// defineFunction({ environment }) accepts literal strings only. A bucket name
// is a CloudFormation token, so it has to go through addEnvironment, which
// Amplify resolves at the end of synth and also writes into the typed
// $amplify/env/<name> shim that the handlers import.
// ---------------------------------------------------------------------------

for (const fn of [backend.generateImage, backend.removeBackground, backend.saveDesign]) {
  fn.addEnvironment('ASSETS_BUCKET_NAME', assets.bucketName);
  fn.addEnvironment('ASSETS_PUBLIC_BASE_URL', assetsPublicBaseUrl);
}

// Only remove-background needs the bare host, for its SSRF allowlist.
backend.removeBackground.addEnvironment('ASSETS_BUCKET_HOST', assetsHost);

// Call Bedrock in the region the IAM policies above name, whatever region this
// backend happens to be deployed to.
for (const fn of [backend.generateImage, backend.removeBackground]) {
  fn.addEnvironment('BEDROCK_REGION', BEDROCK_REGION);
}

// The render function gets the same treatment, but note what does NOT work
// here: Amplify's secret() helper. Its resolver runs from a banner that only
// the bundled esbuild path injects, so a secret passed to a provided function
// arrives as an unresolved placeholder string. Plain strings only.
backend.renderDesign.addEnvironment('ASSETS_BUCKET_NAME', assets.bucketName);
backend.renderDesign.addEnvironment('ASSETS_PUBLIC_BASE_URL', assetsPublicBaseUrl);
backend.renderDesign.addEnvironment('POLOTNO_API_KEY', POLOTNO_API_KEY);

// ---------------------------------------------------------------------------
// Outputs, so scripts/render.mjs needs no hardcoded names
// ---------------------------------------------------------------------------

backend.addOutput({
  custom: {
    // The DEPLOYMENT region, which scripts/render.mjs uses to reach Lambda and
    // S3. Not the Bedrock region: Amplify Hosting deploys into the Amplify
    // app's own region, which may differ.
    region: assetsStack.region,
    assetsBucketName: assets.bucketName,
    assetsPublicBaseUrl,
    renderFunctionName: backend.renderDesign.resources.lambda.functionName,
  },
});
