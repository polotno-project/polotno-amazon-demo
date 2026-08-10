import { defineFunction } from '@aws-amplify/backend';

export const generateImage = defineFunction({
  name: 'generate-image',
  entry: './handler.ts',
  // AppSync caps a request at 30 s and that limit is not adjustable. Staying
  // under it means the caller sees this function's real error instead of a
  // generic AppSync timeout while the Lambda keeps running and billing.
  timeoutSeconds: 29,
  memoryMB: 1024,
  runtime: 22,
  // All four functions and the S3 bucket share one nested stack, so every IAM
  // grant and environment variable below is an intra-stack reference.
  resourceGroupName: 'assets',
});
