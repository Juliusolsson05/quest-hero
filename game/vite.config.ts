import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    /** Bind on all interfaces so the invite link works across the venue wifi:
     *  share the "Network" URL vite prints (http://<LAN-IP>:PORT/?room=CODE) —
     *  a localhost link only ever points at the opener's own machine. */
    host: true,
    /**
     * TrueForge serves no CORS headers, so a direct browser fetch from
     * :5173 to :8790 is blocked before it leaves the page — it surfaces as
     * an opaque "TypeError: Failed to fetch" rather than an HTTP status.
     *
     * Proxying through the dev server makes the call same-origin. This also
     * matches how the game will run in production, where a backend of ours
     * sits in front of the harness rather than exposing it to the browser.
     */
    proxy: {
      '/api/v1': {
        target: process.env.TRUEFORGE_URL ?? 'http://localhost:8790',
        changeOrigin: true,
        // Turn buffering off so streamed turn events reach the dialogue box
        // as they arrive instead of landing in one lump at the end.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['content-encoding'];
          });
        },
      },
    },
  },
});
