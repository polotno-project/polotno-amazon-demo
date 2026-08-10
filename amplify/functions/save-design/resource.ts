import { defineFunction } from '@aws-amplify/backend';

export const saveDesign = defineFunction({
  name: 'save-design',
  entry: './handler.ts',
  // No model call here, so the default 3 s is the only thing to beat.
  timeoutSeconds: 10,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'assets',
});
