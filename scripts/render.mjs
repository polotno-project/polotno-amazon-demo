// Triggers the batch render Lambda from the command line and downloads the PNG.
//
//   npm run render -- designs/<uuid>.json
//
// The editor's "Save & render" button calls the same Lambda through AppSync.
// This script invokes it directly, which is why it needs AWS credentials while
// the browser does not.
//
// Everything it needs comes from amplify_outputs.json, which the sandbox and
// the Amplify Hosting build both write.

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

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

const { region, renderFunctionName } = custom;
console.log(`Invoking ${renderFunctionName} in ${region} for ${designKey} ...`);

const startedAt = Date.now();
const response = await new LambdaClient({ region }).send(
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

// The handler returns the public URL, because the AppSync operation it also
// serves declares a String return type.
console.log(`Rendered in ${Date.now() - startedAt} ms -> ${payload}`);

const image = Buffer.from(await (await fetch(payload)).arrayBuffer());
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/render.png', import.meta.url), image);

console.log(`Saved ${image.length} bytes to out/render.png`);
