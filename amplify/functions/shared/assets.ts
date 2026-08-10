import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export type ImageResult = {
  url: string;
  width: number;
  height: number;
};

/**
 * Reads the pixel size out of a PNG header.
 *
 * A PNG always starts with an 8-byte signature followed by the IHDR chunk:
 * 4 bytes length, 4 bytes type, then width and height as big-endian uint32.
 * Cheaper and more reliable than making the browser load the image to measure it.
 */
function readPngSize(png: Buffer): { width: number; height: number } {
  const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504e47;
  if (!isPng) {
    throw new Error('Bedrock did not return a PNG.');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Writes a PNG under `images/` and returns a stable public URL.
 *
 * The `images/` prefix is world-readable through a bucket policy, on purpose.
 * A presigned URL would expire, and a design saved today must still render
 * next week. Nothing secret is ever written to this prefix.
 *
 * There is deliberately no `ACL` property here. The bucket uses
 * BUCKET_OWNER_ENFORCED object ownership, which is the S3 default since 2023,
 * and any PutObject that carries an ACL is rejected with
 * AccessControlListNotSupported.
 */
export async function putImage(
  png: Buffer,
  bucket: string,
  publicBaseUrl: string,
): Promise<ImageResult> {
  const { width, height } = readPngSize(png);
  const key = `images/${randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: png,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return { url: `${publicBaseUrl}${key}`, width, height };
}
