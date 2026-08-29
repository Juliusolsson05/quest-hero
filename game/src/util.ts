/** Tiny shared helpers (the client twin of hub/src/util.ts). */

/**
 * One shortest-path step from `current` toward `target` (radians): normalize
 * the difference into [-π, π] first so things turn the short way instead of
 * spinning the long way round. `blend` is the frame's lerp factor (e.g.
 * `dt * 14`); it is clamped to 1 here.
 */
export function angleToward(current: number, target: number, blend: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * Math.min(1, blend);
}

/** HTML-escape untrusted text (NPC names, model output) for innerHTML use. */
export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── citizen labels ─────────────────────────────────────────────────────────
// "Blacksmith · Bran", "Venture Capitalist · Chad" — the profession leads
// wherever a citizen's name is shown (bubbles, talk bar, prompts, the city
// pulse), so who you're dealing with reads at a glance.

export function roleTitle(role: string): string {
  return role.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export function npcLabel(n: { name: string; role: string }): string {
  return `${roleTitle(n.role)} · ${n.name}`;
}
