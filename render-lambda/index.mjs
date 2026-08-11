// Batch render: a Polotno design JSON in S3 becomes a PNG in S3.
//
// Two callers, one handler:
//   - AppSync, from the editor's "Save & render" button. The event carries
//     { arguments: { designKey } }.
//   - The CLI, `npm run render -- designs/<uuid>.json`, which invokes the
//     function directly with { designKey }.
//
// It returns the public URL as a plain string, because the AppSync operation
// declares `.returns(a.string())`. Never the image itself: a synchronous Lambda
// response is capped at 6 MB and a rendered page passes that easily.

import { randomUUID } from 'node:crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { createInstance } from 'polotno-node';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.ASSETS_BUCKET_NAME;
const PUBLIC_BASE_URL = process.env.ASSETS_PUBLIC_BASE_URL;

export const handler = async (event) => {
  const designKey = event?.arguments?.designKey ?? event?.designKey;
  if (!designKey || !designKey.startsWith('designs/')) {
    throw new Error('designKey is required and must start with "designs/".');
  }

  const startedAt = Date.now();
  let instance;
  let browser;

  try {
    // 1. Read the design JSON.
    const object = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: designKey }),
    );
    const json = JSON.parse(await object.Body.transformToString());
    console.log(
      `Loaded ${designKey}: ${json.pages?.length ?? 0} page(s), ${json.width}x${json.height}`,
    );

    // 2. Start the Chromium that @sparticuz/chromium unpacks into /tmp.
    //
    // Calling chromium.executablePath() is what inflates the binary AND the
    // font archive, so it has to happen before the browser starts.
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--hide-scrollbars',
        '--disable-web-security',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Keeps text metrics identical to the browser editor. Do not add
        // --disable-font-subpixel-positioning: it makes rendering less accurate.
        '--font-render-hinting=none',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      // A large design can spend minutes inside one CDP call.
      protocolTimeout: 10 * 60 * 1000,
    });

    instance = await createInstance({
      key: process.env.POLOTNO_API_KEY,
      browser,
    });

    // 3. Render.
    const base64 = await instance.jsonToImageBase64(json, {
      mimeType: 'image/png',
      pixelRatio: event?.arguments?.pixelRatio ?? event?.pixelRatio ?? 1,
      // The default is 6000 ms. A cold Lambda downloads every Google Font in
      // the design over the network, and 6 s is not always enough. Too short a
      // value silently falls back to a default font instead of failing.
      fontLoadTimeout: 20000,
      assetLoadTimeout: 60000,
    });
    const png = Buffer.from(base64, 'base64');

    // 4. Write the PNG.
    // No ACL property: the bucket uses BUCKET_OWNER_ENFORCED ownership and
    // rejects any PutObject that carries one.
    const key = `renders/${randomUUID()}.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    console.log(
      `Rendered ${designKey} -> ${key} (${png.length} bytes, ${Date.now() - startedAt} ms)`,
    );
    return `${PUBLIC_BASE_URL}${key}`;
  } finally {
    // close() shuts the browser down too, so guard against a failure before
    // the instance existed.
    if (instance) {
      await instance.close().catch(() => {});
    } else if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
