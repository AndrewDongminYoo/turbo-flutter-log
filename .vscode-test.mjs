import { defineConfig } from '@vscode/test-cli';

// Extension-host suite only. `out/test/unit/**` is vscode-free and runs under
// plain mocha via `npm run test:unit`; loading it here would double-run it.
export default defineConfig({
  files: 'out/test/suite/**/*.test.js',
});
