import { defineFunction } from '@aws-amplify/backend';

export const removeBackground = defineFunction({
  name: 'remove-background',
  entry: './handler.ts',
  // Under the fixed 30 s AppSync request limit. See generate-image/resource.ts.
  timeoutSeconds: 29,
  memoryMB: 1024,
  runtime: 22,
  resourceGroupName: 'assets',
});
