import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');

  // Sentry source map upload only runs in production CI where SENTRY_AUTH_TOKEN
  // is injected as a CI/CD secret — never from a local .env file.
  const sentryEnabled = mode === 'production' && !!env.SENTRY_AUTH_TOKEN;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              authToken: env.SENTRY_AUTH_TOKEN,
              sourcemaps: {
                // Upload source maps then delete them from the dist folder so
                // they are never served publicly (satisfies the acceptance criterion).
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      // Source maps are required for Sentry to map minified stack traces.
      // The sentryVitePlugin deletes the .map files after uploading them.
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/posthog-js')) {
              // Separate chunk so posthog-js loads lazily via dynamic import.
              return 'posthog';
            }
            if (id.includes('node_modules/@sentry')) {
              return 'sentry';
            }
            if (id.includes('node_modules/@google/genai')) {
              return 'genai';
            }
            if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-gfm')) {
              return 'markdown';
            }
            if (id.includes('node_modules/motion')) {
              return 'motion';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    define: {
      'process.env.GEMINI_LIVE_MODEL': JSON.stringify(env.GEMINI_LIVE_MODEL),
      'process.env.BROWSERBUD_LOCAL_API_URL': JSON.stringify(env.BROWSERBUD_LOCAL_API_URL),
      'process.env.BROWSERBUD_DEV_DEFAULT_API_KEY': JSON.stringify(mode === 'development' ? env.GEMINI_API_KEY || '' : ''),
      'process.env.BROWSERBUD_ENABLE_ELEMENT_HIGHLIGHT': JSON.stringify(env.BROWSERBUD_ENABLE_ELEMENT_HIGHLIGHT || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
