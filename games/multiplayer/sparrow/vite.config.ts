import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';

// Content-Security-Policy injected as a <meta> tag into the built index.html. Static hosts such as
// GitHub Pages cannot set response headers, so this is the only policy that ships with dist/.
const PRODUCTION_META_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self';";

function injectProductionCspPlugin(): Plugin {
  return {
    name: 'inject-production-csp',
    apply: 'build',
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        {
          tag: 'meta',
          injectTo: 'head-prepend',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: PRODUCTION_META_CSP,
          },
        },
      ];
    },
  };
}

export default defineConfig({
  // Relative asset URLs so dist/ works from any path (e.g. https://<user>.github.io/<repo>/).
  base: './',
  // Only inject strict <meta http-equiv="Content-Security-Policy"> on GitHub Pages builds;
  // AI Studio injects inline bridge/error-trap scripts into preview iframes.
  plugins: process.env.GITHUB_ACTIONS === 'true' ? [injectProductionCspPlugin()] : [],
  server: {
    port: 3000,
    host: '0.0.0.0',
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three')) {
            return 'vendor-three';
          }
          if (id.includes('node_modules/cannon-es')) {
            return 'vendor-physics';
          }
          return undefined;
        },
      },
    },
  },
});
