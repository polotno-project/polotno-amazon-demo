import { env } from '$amplify/env/remove-background';
import type { Schema } from '../../data/resource';
import { REMOVE_BG_MODEL_ID, invokeStabilityModel } from '../shared/bedrock';
import { putImage } from '../shared/assets';

// This endpoint is unauthenticated and it fetches a URL that the caller
// supplies. Without an allowlist that is a server-side request forgery
// primitive: anyone could point it at the EC2 instance metadata service or at
// a host inside a VPC and read the response.
//
// The list holds our own bucket plus the hosts that Polotno's default photo
// and element panels serve from, which is everything the demo can select.
const ALLOWED_HOSTS = [
  env.ASSETS_BUCKET_HOST,
  'images.unsplash.com',
  'plus.unsplash.com',
  'api.polotno.com',
  'static.polotno.com',
];

// Bedrock limits the input: every side at least 64 px, at most 9,437,184 px in
// total, and an aspect ratio between 1:2.5 and 2.5:1.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

async function fetchAllowedImage(rawUrl: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('imageUrl is not a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('imageUrl must use https.');
  }
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    throw new Error(`Host "${url.hostname}" is not allowed.`);
  }

  const response = await fetch(url, {
    redirect: 'error', // a redirect could leave the allowlist
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Could not read the image: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error('The image is larger than 10 MB.');
  }
  return bytes;
}

export const handler: Schema['removeBackground']['functionHandler'] = async (event) => {
  const source = await fetchAllowedImage(event.arguments.imageUrl);

  const png = await invokeStabilityModel(REMOVE_BG_MODEL_ID, {
    image: source.toString('base64'),
    // png keeps the alpha channel. jpeg would flatten the cutout onto black.
    output_format: 'png',
  });

  return putImage(png, env.ASSETS_BUCKET_NAME, env.ASSETS_PUBLIC_BASE_URL);
};
