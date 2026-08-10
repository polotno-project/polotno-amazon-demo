// Triggers the batch render Lambda and downloads the result.
//
//   npm run render -- designs/<uuid>.json
//
// Everything it needs comes from amplify_outputs.json, which the sandbox and
// the Amplify Hosting build both write.

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const designKey = process.argv[2];
if (!designKey) {
  console.error('Usage: npm run render -- designs/<uuid>.json');
  process.exit(1);
}

const outputsPath = new URL('../amplify_outputs.json', import.meta.url);
let custom;
try {
  custom = JSON.parse(await readFile(outputsPath, 'utf8')).custom;
} catch {
  console.error('amplify_outputs.json is missing. Run `npm run sandbox` first.');
  process.exit(1);
}

const { region, renderFunctionName, assetsBucketName } = custom;
console.log(`Invoking ${renderFunctionName} in ${region} for ${designKey} ...`);

const lambda = new LambdaClient({ region });
const response = await lambda.send(
  new InvokeCommand({
    FunctionName: renderFunctionName,
    Payload: JSON.stringify({ designKey }),
  }),
);

const payload = JSON.parse(new TextDecoder().decode(response.Payload));

// A handler that throws still returns HTTP 200. FunctionError is the only
// reliable signal that the invoke failed.
if (response.FunctionError) {
  console.error(`Lambda failed: ${response.FunctionError}`);
  console.error(payload.errorMessage ?? payload);
  if (payload.trace) console.error(payload.trace.join('\n'));
  process.exit(1);
}

console.log(`Rendered in ${payload.ms} ms, ${payload.bytes} bytes -> ${payload.key}`);

// renders/ is private, so download it through the SDK rather than over HTTP.
const s3 = new S3Client({ region });
const object = await s3.send(
  new GetObjectCommand({ Bucket: assetsBucketName, Key: payload.key }),
);

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
const localPath = new URL('../out/render.png', import.meta.url);
writeFileSync(localPath, Buffer.from(await object.Body.transformToByteArray()));

console.log(`Saved to out/render.png`);
