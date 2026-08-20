/**
 * Demo depth, Full lab depth, and the deep link that carries the choice.
 *
 * A first-time visitor and an auditor want the same page at two different depths, and the
 * tempting shortcut — a second, shorter copy of the experiments — is the one thing that
 * would make the page dishonest, because the two copies would drift and only one of them
 * would be the code under test. So there is exactly one copy of every experiment, and the
 * mode is a display decision expressed as a tag: `data-depth="lab"` on anything that only
 * an auditor needs, `data-depth="demo"` on the few compact restatements that exist for the
 * short route, nothing at all on everything shared.
 *
 * The chosen depth is written back into the address bar on every change, so the URL a
 * presenter copies is always a working deep link and never a lie about what the audience
 * will see. A `?mode=` in the URL therefore outranks the stored preference: a link handed
 * to someone else has to survive whatever they last looked at.
 */

import { el, srOnly } from './dom.ts';

export type Mode = 'demo' | 'lab';

/** Namespaced so it cannot collide with the shared `theme` key the top bar pins. */
const STORAGE_KEY = 'token-tell:mode';
const MODE_PARAM = 'mode';

const listeners = new Set<(mode: Mode) => void>();

let active: Mode | null = null;

export function param(name: string): string | null {
  return new URL(window.location.href).searchParams.get(name);
}

/**
 * Deep-link state is edited in place. A `pushState` here would fill the back button with
 * every slider a presenter touched, and a reload would lose the computed page for the sake
 * of a query string the page can already act on.
 */
export function setParam(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(window.history.state, '', url);
}

function readStored(): Mode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'demo' || stored === 'lab' ? stored : null;
  } catch {
    // Storage is unavailable in a private window and behind some enterprise policies.
    // A missing preference is a first visit, which already has an answer.
    return null;
  }
}

function writeStored(mode: Mode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // See readStored: losing the preference costs a presenter one click.
  }
}

function resolve(): Mode {
  const requested = param(MODE_PARAM);
  const chosen: Mode = requested === 'lab' || requested === 'demo'
    ? requested
    : (readStored() ?? 'demo');
  writeStored(chosen);
  setParam(MODE_PARAM, chosen);
  return chosen;
}

export function currentMode(): Mode {
  if (active === null) active = resolve();
  return active;
}

/**
 * Tag an element as lab-only and settle its visibility immediately, so a panel built long
 * after the last mode switch is never briefly wrong.
 */
export function labOnly<T extends HTMLElement>(node: T): T {
  node.dataset.depth = 'lab';
  applyDepth(node);
  return node;
}

export function demoOnly<T extends HTMLElement>(node: T): T {
  node.dataset.depth = 'demo';
  applyDepth(node);
  return node;
}

function applyDepth(node: HTMLElement): void {
  const depth = node.dataset.depth;
  const hide = depth === 'lab' ? currentMode() === 'demo' : depth === 'demo' && currentMode() === 'lab';
  if (hide) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

/**
 * Reconcile the whole document with the active depth. Cheap enough to call after every
 * render pass, which is what main.ts does — an element that arrives after a switch has no
 * other way to learn about it.
 */
export function applyMode(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-depth]')) applyDepth(node);
}

export function onModeChange(listener: (mode: Mode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function scrollToAnchor(anchorId: string): void {
  const target = document.getElementById(anchorId);
  if (!target) return;
  const url = new URL(window.location.href);
  url.hash = `#${anchorId}`;
  window.history.replaceState(window.history.state, '', url);
  // One frame, so the newly unhidden sections have contributed their height before the
  // scroll offset is computed against them.
  requestAnimationFrame(() => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  });
}

export function setMode(mode: Mode, options: { anchor?: string } = {}): void {
  const changed = mode !== currentMode();
  active = mode;
  writeStored(mode);
  setParam(MODE_PARAM, mode);
  applyMode();
  if (changed) for (const listener of listeners) listener(mode);
  if (options.anchor) scrollToAnchor(options.anchor);
}

/** A branch out of the short route: the target is lab-only, so open the lab first. */
export function goToLab(anchorId: string): void {
  setMode('lab', { anchor: anchorId });
}

const OPTIONS: { mode: Mode; label: string }[] = [
  { mode: 'demo', label: 'Demo' },
  { mode: 'lab', label: 'Full lab' },
];

/**
 * The segmented control.
 *
 * `role="group"` rather than a bare div, because an aria-label on a role-less element is
 * discarded — the same trap `readout()` documents. The selected segment is announced by
 * `aria-pressed` and shown by a filled pill, a heavier weight and a glyph, so the state
 * survives a grayscale screenshot as well as it survives a screen reader.
 */
export function renderModeControl(): HTMLElement {
  const status = srOnly('');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const buttons = OPTIONS.map(({ mode, label }) => {
    const glyph = el('span', { class: 'mode-switch-glyph', 'aria-hidden': 'true' });
    const node = el('button', { type: 'button', class: 'mode-switch-option' }, [glyph, label]);
    node.addEventListener('click', () => setMode(mode));
    return { mode, label, node, glyph };
  });

  const group = el('div', {
    class: 'mode-switch',
    role: 'group',
    'aria-label': 'Depth of detail',
  }, [...buttons.map((b) => b.node), status]);

  const paint = (mode: Mode): void => {
    for (const b of buttons) {
      const selected = b.mode === mode;
      b.node.setAttribute('aria-pressed', String(selected));
      b.glyph.textContent = selected ? '●' : '○';
    }
  };

  paint(currentMode());
  onModeChange((mode) => {
    paint(mode);
    const label = OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
    status.textContent = `${label} selected.`;
  });

  return group;
}
