import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// Text to image. A bare model ID, because Stable Image Core supports In-Region
// inference in us-west-2.
export const GENERATE_MODEL_ID = 'stability.stable-image-core-v1:1';

// Background removal. The "us." prefix selects a geo inference profile and it
// is NOT optional: this model has no In-Region support in any region. Calling
// it with the bare ID fails.
export const REMOVE_BG_MODEL_ID = 'us.stability.stable-image-remove-background-v1:0';

// The Lambda runs in the same region as the models. The SDK reads AWS_REGION,
// which Lambda always sets.
const client = new BedrockRuntimeClient({});

/**
 * Calls a Stability image model and returns the raw PNG bytes.
 *
 * Every Stability image model on Bedrock shares one response envelope:
 *   { images: [base64], finish_reasons: [null | string], seeds: [number] }
 *
 * A content filter returns HTTP 200 with `images` missing entirely, so
 * `finish_reasons` must be read before `images`.
 */
export async function invokeStabilityModel(
  modelId: string,
  body: Record<string, unknown>,
): Promise<Buffer> {
  const response = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );

  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    images?: string[];
    finish_reasons?: (string | null)[];
  };

  const reason = payload.finish_reasons?.[0];
  if (reason != null) {
    throw new Error(`Bedrock rejected the request: ${reason}`);
  }

  const image = payload.images?.[0];
  if (!image) {
    throw new Error('Bedrock returned no image.');
  }

  return Buffer.from(image, 'base64');
}
