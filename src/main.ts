/**
 * Token Tell — entry point.
 *
 * Each act renders into its own section. Nothing is precomputed at build time: the page
 * runs the same functions the unit suite holds to the reference implementations.
 *
 * There is one copy of every experiment at both depths. Demo and Full lab are the same
 * mounted page with a different set of sections shown, which is why the render pass runs
 * unconditionally: a panel that is never built cannot be proved to work, and a page that
 * builds a demo tree and a lab tree separately is a page with two answers to every
 * question. The depth is applied before that pass as well as after it — the sections carry
 * their tag in the HTML, so hiding the lab half first means fifteen thousand pixels of it
 * are never laid out only to be hidden a moment later.
 *
 * The pass yields between panels. Built as one uninterrupted loop it was a single 736 ms
 * task on a mid-range phone, and the page's own call to action sat disabled for nine
 * hundred milliseconds behind panels the demo route does not even show. Nothing is skipped
 * to buy that back; the order simply puts what the short route shows first, and hands the
 * browser back the main thread between each one.
 *
 * The global reset re-runs that render pass. A full rebuild is the only reset that cannot
 * fall behind an experiment's own state, and it costs less than the reload it replaces —
 * a reload would also discard the depth, the anchor and the scroll position the audience
 * is looking at.
 */

import './style.css';

import { renderHeroExperiment } from './ui/hero-experiment.ts';
import { renderAct1 } from './ui/act1-tournament.ts';
import { renderAct2 } from './ui/act2-detector.ts';
import { renderAct3 } from './ui/act3-entropy.ts';
import { renderAct4 } from './ui/act4-attacks.ts';
import { renderAct5, renderAct6 } from './ui/act5-sign.ts';
import { renderAct7 } from './ui/act7-compare.ts';
import { renderReference } from './ui/reference.ts';
import { mountChapters, renderChapters } from './ui/chapters.ts';
import { applyMode, renderModeControl, setParam } from './ui/mode.ts';
import { renderShareControl } from './ui/share.ts';
import { nextFrame } from './ui/dom.ts';

/**
 * Render order, not document order: the four panels the short route shows come first, so
 * the ninety-second path is complete and pressable while the acts only an auditor opens
 * are still being built. Every panel is still built, at both depths.
 */
const PANELS: [string, (root: HTMLElement) => void][] = [
  ['hero-experiment', renderHeroExperiment],
  ['act-5', renderAct5],
  ['act-6', renderAct6],
  ['act-7', renderAct7],
  ['act-1', renderAct1],
  ['act-2', renderAct2],
  ['act-3', renderAct3],
  ['act-4', renderAct4],
  ['reference', renderReference],
];

/**
 * Deep-link parameters an experiment may have written — the whole list, checked against
 * every `setParam` call in `src/`, because a name that is listed here but never written is
 * a reset that claims to clear something it has never seen, and a name that is written but
 * missing survives the reset and reopens the state the reader asked to be rid of.
 *
 * The mode is deliberately not among them: a reset returns the experiments to their
 * shipped state, not the audience to a different page than the one they were being shown.
 */
const EXPERIMENT_PARAMS = ['sample', 'scenario', 'sign'];

/**
 * The address the page was opened at. The render pass yields between panels, so an act
 * above a deep-linked one arrives after the browser has already jumped, and pushes the
 * target as far down the page as it is tall. The jump is repeated once the last panel is
 * built and the document has stopped growing.
 */
const landing = window.location.hash;

function honourLanding(): void {
  if (!landing.startsWith('#') || landing.length < 2) return;
  const target = document.getElementById(landing.slice(1));
  if (!target || target.closest('[hidden]')) return;
  const url = new URL(window.location.href);
  if (url.hash !== landing) {
    url.hash = landing;
    window.history.replaceState(window.history.state, '', url);
  }
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

async function renderAll(): Promise<void> {
  applyMode();
  for (const [id, render] of PANELS) {
    const root = document.getElementById(id);
    if (root instanceof HTMLElement) render(root);
    // Handing the main thread back between panels is what keeps the longest task on this
    // page shorter than a frame a reader would notice losing.
    await nextFrame();
  }
  applyMode();
}

function mount(hostId: string, node: HTMLElement): void {
  const host = document.getElementById(hostId);
  if (host instanceof HTMLElement) host.append(node);
}

function announceReset(): void {
  const status = document.getElementById('reset-status');
  if (!status) return;
  status.textContent = 'Every experiment has been reset.';
  window.setTimeout(() => {
    status.textContent = '';
  }, 4000);
}

async function resetEverything(): Promise<void> {
  for (const name of EXPERIMENT_PARAMS) setParam(name, null);
  await renderAll();
  // The chapter control outlives the render pass, but one of the sections it points at —
  // Act VII's "Choose the depth" panel — is rebuilt by it. Its observer would be left
  // watching a node that is no longer in the document, and the demo route's last chapter
  // would stop marking itself as the reader reached it.
  if (chapterHost instanceof HTMLElement) renderChapters(chapterHost);
  announceReset();
}

// The presenter's own controls first: they are three small pieces of DOM, and they are
// what the page is unusable without.
mount('mode-host', renderModeControl());
mount('share-host', renderShareControl());

const chapterHost = document.getElementById('chapters');
if (chapterHost instanceof HTMLElement) mountChapters(chapterHost);

const resetAll = document.getElementById('reset-all');
if (resetAll instanceof HTMLButtonElement) {
  resetAll.addEventListener('click', () => void resetEverything());
}

void renderAll().then(() => {
  // The last chapter of the short route is built by Act VII, so the control that lists it
  // is rendered once more now that it exists.
  if (chapterHost instanceof HTMLElement) renderChapters(chapterHost);
  honourLanding();
});

// Only the built site has a service worker: the dev server answers `sw.js` with the SPA
// shell, and a registration that fails on a text/html body is reported as a console error
// rather than as a rejected promise, so it cannot be caught below. Registering the built
// worker over a development bundle would also serve yesterday's code back to whoever is
// working on the page.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = document.querySelector('base')?.getAttribute('href') ?? import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // An unavailable service worker costs the page nothing but offline use.
    });
  });
}
