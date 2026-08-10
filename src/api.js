import { generateClient } from 'aws-amplify/api';

// One client for the whole app. Every call uses the API key from
// amplify_outputs.json, so no AWS credentials ever reach the browser.
const client = generateClient();

// Amplify returns { data, errors } and does not throw. Turning that into a
// thrown Error keeps every call site to a single try/catch.
function unwrap({ data, errors }) {
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join('\n'));
  }
  return data;
}

export const generateImage = async (prompt, aspectRatio) =>
  unwrap(await client.queries.generateImage({ prompt, aspectRatio }));

export const removeBackground = async (imageUrl) =>
  unwrap(await client.queries.removeBackground({ imageUrl }));

export const saveDesign = async (json) =>
  unwrap(await client.mutations.saveDesign({ json }));
