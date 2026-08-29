import type { LensShot, LensSubject } from '../../../shared/lens';
import { HUB_HTTP } from '../net';

/**
 * Where a photograph's facts come from: POST {hub}/api/photo, streamed back.
 *
 * The hub owns the TrueForge session (one per subject, so the archivist
 * remembers the building), injects the world's clock and weather, and logs the
 * shot to the city feed so photographs show up in the city pulse alongside
 * everything else that happens in town.
 *
 * There is deliberately no second route. An earlier draft also spoke to the
 * harness straight from the page as a hub-down fallback, which meant a second
 * copy of session creation, model/connector discovery, SSE parsing and
 * tool-call reassembly living in the browser. docs/plans/feature-isolation.md
 * makes hub/src/trueforge.ts the only thing in the repo that speaks to the
 * harness, and that fallback could not survive the rule — nor the deletion of
 * the dev proxy it rode on. No hub, no dossier, and the card says so rather
 * than inventing one: the whole promise of this feature is that nothing in it
 * is written in advance.
 */

export interface LensCallbacks {
  /** One badge per tool call the agent makes, as it makes it. */
  onTool: (label: string) => void;
  onDelta: (text: string) => void;
}

/** Raised when the hub could not produce a dossier, carrying the last cause. */
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
  }).catch((e) => {
    throw new LensUnavailable(`the World Hub is not answering (${e instanceof Error ? e.message : e})`);
  });
  if (!res.ok || !res.body) throw new LensUnavailable(`hub: ${res.status}`);

  let wrote = 0;
  let failure: string | null = null;
  await readSse(res.body, (frame) => {
    const evt = frame as { t?: string; text?: string; label?: string; message?: string };
    if (evt.t === 'delta' && evt.text) {
      wrote += evt.text.length;
      cb.onDelta(evt.text);
    } else if (evt.t === 'tool' && evt.label) {
      cb.onTool(evt.label);
    } else if (evt.t === 'error') {
      failure = evt.message ?? 'the hub could not reach TrueForge';
    }
  }, signal);
  // A dossier cut off halfway is still a dossier — only a shot that produced
  // nothing at all reads as a failure.
  if (!wrote && failure) throw new LensUnavailable(failure);
}

// ── SSE ─────────────────────────────────────────────────────────────────────

/** Frames are separated by a blank line; a trailing partial is held until the
 *  rest of it arrives. An unparseable frame is skipped, never fatal. */
async function readSse(
  body: NonNullable<Response['body']>,
  onFrame: (data: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
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
        try { onFrame(JSON.parse(data)); } catch { /* not ours to mourn */ }
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
