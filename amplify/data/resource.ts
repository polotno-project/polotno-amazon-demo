import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

import { generateImage } from '../functions/generate-image/resource';
import { removeBackground } from '../functions/remove-background/resource';
import { saveDesign } from '../functions/save-design/resource';

const schema = a.schema({
  // Every Bedrock result is written to S3 and only its URL crosses the wire.
  // AppSync caps a resolver response at 5 MB and that limit cannot be raised,
  // so returning the base64 image itself would break on larger images.
  // Width and height come from the PNG header, so the editor can size the
  // element without a second network round trip.
  ImageResult: a.customType({
    url: a.string().required(),
    width: a.integer().required(),
    height: a.integer().required(),
  }),

  // Text to image with Stability Stable Image Core.
  generateImage: a
    .query()
    .arguments({
      prompt: a.string().required(),
      aspectRatio: a.string(), // "1:1" (default), "16:9", "9:16", "3:2", ...
    })
    .returns(a.ref('ImageResult'))
    .authorization((allow) => [allow.publicApiKey()])
    .handler(a.handler.function(generateImage)),

  // Background removal with Stability Stable Image Remove Background.
  //
  // This takes a URL rather than an S3 key, because the demo must also work on
  // the stock photos that Polotno's default side panel inserts. An
  // unauthenticated endpoint that fetches any URL you give it is an SSRF
  // primitive, so the handler allowlists the host.
  removeBackground: a
    .query()
    .arguments({
      imageUrl: a.string().required(),
    })
    .returns(a.ref('ImageResult'))
    .authorization((allow) => [allow.publicApiKey()])
    .handler(a.handler.function(removeBackground)),

  // Store a Polotno design JSON in S3. It is a write, so it is a mutation.
  saveDesign: a
    .mutation()
    .arguments({
      json: a.string().required(),
    })
    .returns(a.string()) // the S3 key, for example "designs/<uuid>.json"
    .authorization((allow) => [allow.publicApiKey()])
    .handler(a.handler.function(saveDesign)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  // There is no defineAuth in this backend. That is supported: backend-data
  // resolves auth resources optionally, and falls back to the single
  // configured authorization mode.
  //
  // Because apiKeyAuthorizationMode is set explicitly, the transformer's
  // "sandbox mode" is OFF. Every operation above must therefore carry its own
  // allow.publicApiKey(). A missing one fails at query time, not at deploy time.
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});
