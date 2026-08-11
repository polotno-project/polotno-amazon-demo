// Proves that the two Bedrock models this demo needs are reachable, before any
// backend code depends on them.
//
// Run:  npm run check:bedrock

import { mkdirSync, writeFileSync } from 'node:fs';
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env.AWS_REGION || 'us-west-2';

// Text to image. Bare model ID, In-Region inference.
const GENERATE_MODEL_ID = 'stability.stable-image-core-v1:1';
// Background removal. This model has NO In-Region support in any region, so the
// "us." geo inference profile prefix is mandatory.
const REMOVE_BG_MODEL_ID = 'us.stability.stable-image-remove-background-v1:0';

const OUT_DIR = new URL('../out/', import.meta.url);

const bedrock = new BedrockClient({ region: REGION });
const runtime = new BedrockRuntimeClient({ region: REGION });

function fail(step, error) {
  console.error(`\nFAILED at: ${step}`);
  console.error(`${error.name}: ${error.message}`);

  if (error.name === 'AccessDeniedException') {
    console.error(
      '\nThe caller is missing IAM permissions, or the AWS Marketplace subscription\n' +
        'is still settling. The first invoke in an account subscribes it through\n' +
        'AWS Marketplace, and that needs aws-marketplace:Subscribe.',
    );
  }

  // This message is the confusing one. It names neither billing nor access.
  if (/Operation not allowed/i.test(error.message)) {
    console.error(
      '\n"Operation not allowed" is a 400 from Bedrock, NOT an IAM error. The\n' +
        'account cannot invoke models. GetFoundationModelAvailability says which\n' +
        'gate is closed, and two different causes give this same message:\n' +
        '\n  agreement=NOT_AVAILABLE or ERROR\n' +
        '    The AWS Marketplace subscription failed, usually because the account\n' +
        '    has no chargeable payment method. The agreement is created and then\n' +
        '    terminated seconds later. Fix billing, then subscribe again.\n' +
        '\n  agreement=AVAILABLE but authorizationStatus=NOT_AUTHORIZED\n' +
        '    Billing is fine and the account still cannot invoke ANY model, in any\n' +
        '    region, including Amazon first-party ones. Only AWS Support can lift\n' +
        '    this. The Bedrock "Model access" console page is retired.',
    );
  }
  process.exit(1);
}

async function invoke(modelId, body) {
  const startedAt = process.hrtime.bigint();
  const response = await runtime.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const payload = JSON.parse(new TextDecoder().decode(response.body));

  // A content filter returns HTTP 200 with no `images` key at all, so checking
  // finish_reasons first is the only safe read order.
  const reason = payload.finish_reasons?.[0];
  if (reason != null) {
    throw new Error(`Model returned finish_reason: ${reason}`);
  }
  if (!payload.images?.[0]) {
    throw new Error(`No image in response: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return { base64: payload.images[0], ms, seed: payload.seeds?.[0] };
}

mkdirSync(OUT_DIR, { recursive: true });

// --- 1. Is Stable Image Core still offered in this region? -------------------

console.log(`Region: ${REGION}\n`);
console.log('Stability models listed by ListFoundationModels:');

let listed = [];
try {
  const { modelSummaries } = await bedrock.send(
    new ListFoundationModelsCommand({ byProvider: 'stability' }),
  );
  listed = (modelSummaries ?? []).map((m) => m.modelId);
  for (const id of listed) console.log(`  ${id}`);
} catch (error) {
  fail('ListFoundationModels', error);
}

if (!listed.includes(GENERATE_MODEL_ID)) {
  console.warn(
    `\nWARNING: ${GENERATE_MODEL_ID} is NOT in the list above for ${REGION}.\n` +
      'Switch the demo to stability.stable-image-ultra-v1:1.',
  );
}

// --- 2. Text to image --------------------------------------------------------

console.log(`\nInvoking ${GENERATE_MODEL_ID} ...`);
let generated;
try {
  generated = await invoke(GENERATE_MODEL_ID, {
    prompt: 'a red vintage bicycle against a plain white wall, product photo',
    aspect_ratio: '1:1',
    output_format: 'png',
  });
} catch (error) {
  fail(`InvokeModel ${GENERATE_MODEL_ID}`, error);
}

const generatedBytes = Buffer.from(generated.base64, 'base64');
writeFileSync(new URL('generated.png', OUT_DIR), generatedBytes);
console.log(
  `  OK  ${generated.ms.toFixed(0)} ms  ${(generatedBytes.length / 1024).toFixed(0)} KB` +
    `  seed=${generated.seed}  -> out/generated.png`,
);

// --- 3. Background removal, fed with the image we just generated -------------

console.log(`\nInvoking ${REMOVE_BG_MODEL_ID} ...`);
let cutout;
try {
  cutout = await invoke(REMOVE_BG_MODEL_ID, {
    image: generated.base64,
    output_format: 'png', // png keeps the alpha channel; jpeg would flatten it
  });
} catch (error) {
  fail(`InvokeModel ${REMOVE_BG_MODEL_ID}`, error);
}

const cutoutBytes = Buffer.from(cutout.base64, 'base64');
writeFileSync(new URL('cutout.png', OUT_DIR), cutoutBytes);
console.log(
  `  OK  ${cutout.ms.toFixed(0)} ms  ${(cutoutBytes.length / 1024).toFixed(0)} KB` +
    '  -> out/cutout.png',
);

console.log('\nBoth models work. Open out/cutout.png and confirm it has transparency.');
console.log(
  `Total AppSync budget check: generate took ${generated.ms.toFixed(0)} ms, ` +
    `remove background took ${cutout.ms.toFixed(0)} ms. ` +
    'AppSync caps a request at 30 s and that limit cannot be raised.',
);
