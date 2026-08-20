/**
 * Token Tell — entry point.
 *
 * Each act renders into its own section. Nothing is precomputed at build time: the page
 * runs the same functions the unit suite holds to the reference implementations.
 *
 * There is one copy of every experiment at both depths. Demo and Full lab are the same
 * mounted page with a different set of sections shown, which is why the render pass runs
 * unconditionally and the mode is applied after it: a panel that is never built cannot be
 * proved to work, and a page that builds a demo tree and a lab tree separately is a page
 * with two answers to every question.
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

const PANELS: [string, (root: HTMLElement) => void][] = [
  ['hero-experiment', renderHeroExperiment],
  ['act-1', renderAct1],
  ['act-2', renderAct2],
  ['act-3', renderAct3],
  ['act-4', renderAct4],
  ['act-5', renderAct5],
  ['act-6', renderAct6],
  ['act-7', renderAct7],
  ['reference', renderReference],
];

/**
 * Deep-link parameters an experiment may have written. The mode is deliberately not among
 * them: a reset returns the experiments to their shipped state, not the audience to a
 * different page than the one they were being shown.
 */
const EXPERIMENT_PARAMS = ['sample', 'scenario', 'act', 'run', 'key', 'preset', 'depth'];

function renderAll(): void {
  for (const [id, render] of PANELS) {
    const root = document.getElementById(id);
    if (root instanceof HTMLElement) render(root);
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

function resetEverything(): void {
  for (const name of EXPERIMENT_PARAMS) setParam(name, null);
  renderAll();
  // The chapter control outlives the render pass, but one of the sections it points at —
  // Act VII's "Choose the depth" panel — is rebuilt by it. Its observer would be left
  // watching a node that is no longer in the document, and the demo route's last chapter
  // would stop marking itself as the reader reached it.
  if (chapterHost) renderChapters(chapterHost);
  announceReset();
}

renderAll();

mount('mode-host', renderModeControl());
mount('share-host', renderShareControl());

const chapterHost = document.getElementById('chapters');
if (chapterHost instanceof HTMLElement) mountChapters(chapterHost);

const resetAll = document.getElementById('reset-all');
if (resetAll instanceof HTMLButtonElement) resetAll.addEventListener('click', resetEverything);

applyMode();

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
