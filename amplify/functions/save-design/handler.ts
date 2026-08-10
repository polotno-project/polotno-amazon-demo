import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '$amplify/env/save-design';
import type { Schema } from '../../data/resource';

const s3 = new S3Client({});

export const handler: Schema['saveDesign']['functionHandler'] = async (event) => {
  // Fail here rather than let S3 store something the render Lambda cannot read.
  let design: unknown;
  try {
    design = JSON.parse(event.arguments.json);
  } catch {
    throw new Error('json is not valid JSON.');
  }
  if (!design || typeof design !== 'object' || !Array.isArray((design as any).pages)) {
    throw new Error('json is not a Polotno design: no "pages" array.');
  }

  const key = `designs/${randomUUID()}.json`;

  // The designs/ prefix stays private. Only the render Lambda reads it, through
  // its execution role.
  await s3.send(
    new PutObjectCommand({
      Bucket: env.ASSETS_BUCKET_NAME,
      Key: key,
      Body: event.arguments.json,
      ContentType: 'application/json',
    }),
  );

  return key;
};
