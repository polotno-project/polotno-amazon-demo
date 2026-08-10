import { env } from '$amplify/env/generate-image';
import type { Schema } from '../../data/resource';
import { GENERATE_MODEL_ID, invokeStabilityModel } from '../shared/bedrock';
import { putImage } from '../shared/assets';

// Stable Image Core accepts only these ratios. An unknown value is rejected by
// Bedrock with a validation error, so it is cheaper to check here.
const ASPECT_RATIOS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '21:9',
  '9:21',
  '2:3',
  '3:2',
  '4:5',
  '5:4',
]);

export const handler: Schema['generateImage']['functionHandler'] = async (event) => {
  const prompt = event.arguments.prompt.trim();
  if (!prompt) {
    throw new Error('Prompt is empty.');
  }

  const aspectRatio = event.arguments.aspectRatio ?? '1:1';
  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(
      `Unsupported aspect ratio "${aspectRatio}". Use one of: ${[...ASPECT_RATIOS].join(', ')}`,
    );
  }

  const png = await invokeStabilityModel(GENERATE_MODEL_ID, {
    prompt,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  });

  return putImage(png, env.ASSETS_BUCKET_NAME, env.ASSETS_PUBLIC_BASE_URL);
};
