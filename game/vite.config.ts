import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    /** Bind on all interfaces so the dev build can be opened from a phone or a
     *  second machine on the LAN. Playing together is the hosted site's job —
     *  Playroom rooms are keyed by room code on a global relay, so a dev client
     *  and a production client sharing ?room=CODE land in the same city. */
    host: true,
  },
});
