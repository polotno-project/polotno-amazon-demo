import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineFunction } from '@aws-amplify/backend';
import { Duration, Size } from 'aws-cdk-lib';
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';

// The batch render Lambda cannot use the normal defineFunction path. That path
// bundles the handler with esbuild, and this function needs a real node_modules
// tree on disk: a headless Chromium binary and polotno-node's browser client.
// So it is a plain CDK Function whose code is the render-lambda/ folder.

// Resolved from THIS FILE, not from process.cwd(). The Amplify deployer loads
// the backend in-process with tsx, so import.meta.url is the true path on disk
// and this keeps working if ampx is ever run from another directory.
const RENDER_DIR = fileURLToPath(new URL('../../../render-lambda', import.meta.url));

export const renderDesign = defineFunction(
  (scope) => {
    // Code.fromAsset does NOT fail on a missing node_modules. Without this
    // guard a clean checkout ships a 20 KB zip, the deploy goes green, and the
    // function dies on its first invoke with "Cannot find module polotno-node".
    if (!existsSync(join(RENDER_DIR, 'node_modules', 'polotno-node'))) {
      throw new Error(
        `render-lambda has no dependencies installed.\n` +
          `Run:  cd render-lambda && npm install\n` +
          `(Amplify Hosting does this in the preBuild phase of amplify.yml.)`,
      );
    }

    return new Function(scope, 'RenderDesign', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      // @sparticuz/chromium ships an x86-64 binary only. On arm64 this fails at
      // runtime with an exec format error, so pin it rather than rely on the
      // CDK default.
      architecture: Architecture.X86_64,
      code: Code.fromAsset(RENDER_DIR, {
        // CDK never reads .gitignore. Everything not excluded here goes into
        // the deployment package.
        exclude: ['*.zip', 'out/**', '.git/**', '*.md', '.DS_Store'],
      }),
      // Chromium needs the memory. polotno-node fails or times out on larger
      // designs below roughly 2 GB.
      memorySize: 2048,
      // Not on the AppSync path, so the 30 s API limit does not apply here.
      timeout: Duration.minutes(2),
      // Chromium inflates itself into /tmp on cold start, and polotno-node
      // caches downloaded Google Fonts there too. The 512 MB default is not
      // enough for both.
      ephemeralStorageSize: Size.mebibytes(2048),
      environment: {
        // Both values describe how this package is laid out, so they live here
        // rather than in backend.ts.
        //
        // @sparticuz/chromium assigns FONTCONFIG_PATH with ??=, so setting it
        // here WINS and its own unpacked fonts are then invisible to
        // fontconfig. fonts/fonts.conf therefore lists /tmp/fonts as well as
        // /var/task/fonts. Removing one of those two lines loses fonts.
        FONTCONFIG_PATH: '/var/task/fonts',
        // Chromium writes its profile somewhere under HOME, and /var/task is
        // read-only on Lambda.
        HOME: '/tmp',
      },
    });
  },
  { resourceGroupName: 'assets' },
);
