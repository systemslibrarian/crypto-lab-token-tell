/**
 * Token Tell — entry point.
 *
 * Each act renders into its own section. Nothing is precomputed at build time: the page
 * runs the same functions the unit suite holds to the reference implementations.
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

for (const [id, render] of PANELS) {
  const root = document.getElementById(id);
  if (root instanceof HTMLElement) render(root);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = document.querySelector('base')?.getAttribute('href') ?? import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // An unavailable service worker costs the page nothing but offline use.
    });
  });
}
