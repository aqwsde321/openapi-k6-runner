import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, 'src/cli/ui/app'),
  base: '/ui-assets/',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: path.join(projectRoot, 'dist/cli/ui/app'),
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.id?.includes('/node_modules/')) {
          return;
        }

        warn(warning);
      },
    },
  },
});
