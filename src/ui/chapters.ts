/**
 * The chapter control that replaced the chip cloud.
 *
 * Nine stacked chips were 322 px of navigation on a phone — a third of the viewport spent
 * on getting to the thing the viewport was for. The replacement is one control in two
 * shapes: on a wide screen a single sticky row of links with the current section marked,
 * on a phone a chooser and two step buttons that together stay under the height of one
 * touch target and a little padding.
 *
 * Two shapes, not two behaviours: both render from the same chapter list, both navigate by
 * the same anchors, and the one that does not apply at a given width is removed from the
 * layout with `display: none` rather than faded out, because an invisible control that is
 * still in the tab order is a worse failure than no control at all.
 *
 * The list follows the depth: in Demo mode it names the five beats of the short route, in
 * Full lab all nine acts. Chapters whose target is not in the document are dropped rather
 * than rendered as links into nothing.
 */

import { el } from './dom.ts';
import { currentMode, onModeChange } from './mode.ts';

interface Chapter {
  readonly id: string;
  readonly label: string;
}

const LAB_CHAPTERS: readonly Chapter[] = [
  { id: 'hero-experiment', label: 'Same text, different key' },
  { id: 'act-1', label: 'I · The hidden choice' },
  { id: 'act-2', label: 'II · Find the signal' },
  { id: 'act-3', label: 'III · The watermark needs choices' },
  { id: 'act-4', label: 'IV · Attack it' },
  { id: 'act-5', label: 'V · Sign the same text' },
  { id: 'act-6', label: 'VI · A signature can sign a lie' },
  { id: 'act-7', label: 'VII · What each mechanism proves' },
  { id: 'reference', label: 'Limitations, maths, sources' },
];

/**
 * `branch-depth` is the demo-only "Choose the depth" panel in Act VII. It is filtered out
 * if the panel is absent, so this list cannot outlive the thing it points at.
 */
const DEMO_CHAPTERS: readonly Chapter[] = [
  { id: 'hero-experiment', label: 'The proof' },
  { id: 'act-5', label: 'Sign it' },
  { id: 'act-6', label: 'Sign a lie' },
  { id: 'act-7', label: 'What each proves' },
  { id: 'branch-depth', label: 'Go deeper' },
];

const SELECT_ID = 'chapter-select';

let observer: IntersectionObserver | null = null;
let measure: (() => void) | null = null;

function chaptersForMode(): Chapter[] {
  const list = currentMode() === 'demo' ? DEMO_CHAPTERS : LAB_CHAPTERS;
  return list.filter((chapter) => document.getElementById(chapter.id) !== null);
}

/**
 * Two sticky bars now stack at the top of the window: the shared site header and this
 * control. Their measured heights become custom properties so the acts' scroll margin can
 * clear both, rather than a guessed constant that is wrong the moment the header grows a
 * touch-sized button.
 */
function publishHeights(host: HTMLElement): void {
  const topbar = document.querySelector('.cl-topbar');
  const root = document.documentElement;
  const barHeight = topbar ? topbar.getBoundingClientRect().height : 0;
  root.style.setProperty('--cl-topbar-h', `${Math.round(barHeight)}px`);
  root.style.setProperty('--chapters-h', `${Math.round(host.getBoundingClientRect().height)}px`);
}

function stickyOffset(): number {
  const root = document.documentElement;
  const read = (name: string): number =>
    Number.parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  return read('--cl-topbar-h') + read('--chapters-h');
}

function goTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const url = new URL(window.location.href);
  url.hash = `#${id}`;
  window.history.replaceState(window.history.state, '', url);
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

/**
 * The current chapter is the last one whose heading has passed under the sticky bars, not
 * simply one that happens to be on screen: two acts are on screen at every boundary, and
 * picking either of them by intersection alone makes the mark flicker between the pair.
 */
function currentId(chapters: Chapter[]): string {
  let current = chapters[0]?.id ?? '';
  for (const chapter of chapters) {
    const target = document.getElementById(chapter.id);
    if (!target) continue;
    // Measured against the section's own scroll margin rather than a separate constant,
    // so a section that has just been jumped to always counts as arrived: the margin is
    // exactly where the browser parks it.
    const line = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || stickyOffset();
    if (target.getBoundingClientRect().top - line <= 1) current = chapter.id;
  }
  return current;
}

/**
 * Keep the marked chapter inside the visible part of the row.
 *
 * Nine chapter names are wider than the column at every desktop width — the last three sit
 * past the right edge of a strip that scrolls but, with an overlay scrollbar, advertises
 * nothing. Moving the strip as the reader moves through the document is the affordance:
 * the mark is always on screen, its neighbours are always beside it, and the movement is
 * what says the row continues. `scrollLeft` is written rather than `scrollIntoView` called
 * because the latter also scrolls every scrollable ancestor, and the ancestor here is the
 * page the reader is already reading.
 */
function revealCurrent(list: HTMLElement, link: HTMLElement | undefined): void {
  if (!link) return;
  const margin = 24;
  const left = link.offsetLeft - list.offsetLeft;
  const right = left + link.offsetWidth;
  if (left - margin < list.scrollLeft) list.scrollLeft = Math.max(0, left - margin);
  else if (right + margin > list.scrollLeft + list.clientWidth) {
    list.scrollLeft = right + margin - list.clientWidth;
  }
}

export function renderChapters(host: HTMLElement): void {
  observer?.disconnect();
  observer = null;
  if (measure) window.removeEventListener('resize', measure);
  measure = null;
  while (host.firstChild) host.removeChild(host.firstChild);

  const chapters = chaptersForMode();
  if (chapters.length === 0) return;

  const list = el('ul', { class: 'chapters-inner', role: 'list' });
  const links = new Map<string, HTMLAnchorElement>();
  for (const chapter of chapters) {
    const mark = el('span', { class: 'chapters-mark', 'aria-hidden': 'true' });
    const link = el('a', { class: 'chapters-link', href: `#${chapter.id}` }, [mark, chapter.label]);
    // A real anchor, so the browser does the navigation and the history entry. The mark is
    // moved here as well as by the observer, for the case where the jump is short enough
    // that no section crosses the band.
    link.addEventListener('click', () => setCurrent(chapter.id));
    links.set(chapter.id, link);
    list.append(el('li', {}, [link]));
  }

  const select = el('select', { class: 'chapters-select', id: SELECT_ID });
  for (const chapter of chapters) {
    select.append(el('option', { value: chapter.id, text: chapter.label }));
  }
  // Declared before the controls that call it so the reading order matches the call order;
  // it is assigned once the mark-painting closure below exists.
  let navigate = (id: string): void => goTo(id);
  select.addEventListener('change', () => navigate(select.value));

  const previous = el('button', {
    type: 'button',
    class: 'chapters-step',
    'aria-label': 'Previous section',
  }, [el('span', { 'aria-hidden': 'true', text: '‹' })]);
  const next = el('button', {
    type: 'button',
    class: 'chapters-step',
    'aria-label': 'Next section',
  }, [el('span', { 'aria-hidden': 'true', text: '›' })]);

  const step = (delta: number): void => {
    const index = chapters.findIndex((chapter) => chapter.id === select.value);
    const target = chapters[Math.min(chapters.length - 1, Math.max(0, index + delta))];
    if (target) navigate(target.id);
  };
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  const compact = el('div', { class: 'chapters-compact' }, [
    previous,
    el('label', { class: 'sr-only', for: SELECT_ID, text: 'Section' }),
    select,
    next,
  ]);

  host.append(list, compact);

  const setCurrent = (id: string): void => {
    for (const [chapterId, link] of links) {
      const isCurrent = chapterId === id;
      link.classList.toggle('chapters-current', isCurrent);
      if (isCurrent) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
      const mark = link.firstElementChild;
      if (mark) mark.textContent = isCurrent ? '▸' : '';
    }
    revealCurrent(list, links.get(id));
    select.value = id;
    // The ends of the range are genuinely inactive, and a real `disabled` is what keeps
    // them out of the tab order and out of the contrast oracles that exempt them.
    const index = chapters.findIndex((chapter) => chapter.id === id);
    previous.disabled = index <= 0;
    next.disabled = index >= chapters.length - 1;
  };
  // A chosen chapter is marked at once rather than when the scroll lands: a smooth scroll
  // across twenty viewports would otherwise leave the control disagreeing with the reader.
  navigate = (id: string): void => {
    setCurrent(id);
    goTo(id);
  };
  // Heights first: the sticky line the current chapter is measured against is derived from
  // the properties this publishes.
  measure = () => publishHeights(host);
  publishHeights(host);
  window.addEventListener('resize', measure);
  setCurrent(currentId(chapters));

  // The observer is the trigger, not the answer: a section entering or leaving the band is
  // exactly when the answer can have changed, and geometry decides what it changed to.
  observer = new IntersectionObserver(() => setCurrent(currentId(chapters)), {
    rootMargin: `-${Math.round(stickyOffset()) + 8}px 0px -55% 0px`,
    threshold: 0,
  });
  for (const chapter of chapters) {
    const target = document.getElementById(chapter.id);
    if (target) observer.observe(target);
  }
}

/** Mount the control and keep it in step with the depth, which changes the chapter list. */
export function mountChapters(host: HTMLElement): void {
  renderChapters(host);
  onModeChange(() => renderChapters(host));
}
