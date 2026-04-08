import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
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
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
