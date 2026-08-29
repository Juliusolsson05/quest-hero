import type { LensShot, LensSubject } from '../../shared/lens';
import { HUB_HTTP } from './net';

/**
 * Where a photograph's facts come from: `POST {hub}/api/photo`.
 *
 * The hub owns the TrueForge session (one per subject, so the archivist
 * remembers the building), attaches the `sf-guide` MCP server, and streams the
 * turn back as SSE — tool calls as it makes them, then the dossier. It also
 * logs the shot to the city feed, so photographs show up in the city pulse
 * alongside everything else that happens in town.
 *
 * No hub, no dossier: the card says the archive is out of reach rather than
 * inventing one, which is the whole promise of the feature.
 */

export interface LensCallbacks {
  /** One badge per tool call the agent makes, as it makes it. */
  onTool: (label: string) => void;
  onDelta: (text: string) => void;
  /** Fires when the first byte of anything arrives — the card stops saying it
   *  is still reaching for the harness. */
  onLive?: () => void;
}

/** Raised when the dossier could not be fetched at all, carrying the cause. */
export class LensUnavailable extends Error {}

export async function fetchDossier(
  subject: LensSubject,
  shot: LensShot,
  cb: LensCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${HUB_HTTP}/api/photo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ subject, shot }),
    signal,
  }).catch((e: unknown) => {
    throw new LensUnavailable(e instanceof Error ? e.message : 'no hub');
  });
  if (!res.ok || !res.body) throw new LensUnavailable(`hub: ${res.status}`);

  let live = false;
  let wrote = 0;
  let failure: string | null = null;
  const announce = (): void => {
    if (live) return;
    live = true;
    cb.onLive?.();
  };

  // SSE: frames separated by a blank line, a trailing partial held until the
  // rest of it arrives. An unparseable frame is skipped, never fatal.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      buffer += value;
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let evt: { t?: string; text?: string; label?: string; message?: string };
        try { evt = JSON.parse(data); } catch { continue; }
        if (evt.t === 'delta' && evt.text) {
          announce();
          wrote += evt.text.length;
          cb.onDelta(evt.text);
        } else if (evt.t === 'tool' && evt.label) {
          announce();
          cb.onTool(evt.label);
        } else if (evt.t === 'error') {
          failure = evt.message ?? 'the hub could not reach TrueForge';
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  // A stream that ended without a word, carrying a reason, is a failure the
  // card should show; one that got halfway is a dossier that got halfway.
  if (!wrote && failure) throw new LensUnavailable(failure);
}
