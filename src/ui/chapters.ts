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
 * Full lab all ten sections. Chapters whose target is not in the document are dropped
 * rather than rendered as links into nothing.
 *
 * The mark follows the reader rather than the other way round, and the address bar follows
 * the mark: the section on screen is written back into the URL as it changes, so the link
 * a presenter copies is a link to what the audience is looking at.
 */

import { el } from './dom.ts';
import { currentMode, onModeChange } from './mode.ts';

interface Chapter {
  readonly id: string;
  readonly label: string;
}

/**
 * Short labels, and the same noun phrase the act's own kicker uses. Two reasons, and they
 * are the same reason twice: nine long names measured 1,474 px against a 1,168 px strip at
 * the widest desktop, so the last two were off screen and the one before them was cut mid
 * word, and there are ten names now rather than nine; and a chip that says one thing while
 * the heading it lands on says another makes the reader check whether they arrived, which
 * on a phone is a 19 px journey between the two labels. Neither is fixed by scrolling the
 * strip further.
 */
const LAB_CHAPTERS: readonly Chapter[] = [
  { id: 'hero-experiment', label: 'The proof' },
  { id: 'act-1', label: 'I · The hidden choice' },
  { id: 'act-2', label: 'II · Find the signal' },
  { id: 'act-3', label: 'III · Entropy' },
  { id: 'act-4', label: 'IV · Attack it' },
  { id: 'act-5', label: 'V · Sign it' },
  { id: 'act-6', label: 'VI · Sign a lie' },
  { id: 'act-7', label: 'VII · What each proves' },
  { id: 'act-8', label: 'VIII · Measure a population' },
  { id: 'reference', label: 'Reference' },
];

/**
 * `branch-depth` is the demo-only "Choose the depth" panel in Act VII, and it is the one
 * chapter target that is not already in index.html: Act VII builds it, several frames
 * after this control first paints. Listing it only once it exists meant the reader watched
 * a fifth chapter appear inside the bar they were reading, a third of a second in. So the
 * declared list is the list, and `goTo` carries the cost of a target that may be a frame
 * or two behind — which is the honest place for it, because a chapter the short route
 * always ends on is not conditional in any sense a reader would recognise.
 */
const DEMO_CHAPTERS: readonly Chapter[] = [
  { id: 'hero-experiment', label: 'The proof' },
  { id: 'act-5', label: 'Sign it' },
  { id: 'act-6', label: 'Sign a lie' },
  { id: 'act-7', label: 'What each proves' },
  { id: 'branch-depth', label: 'Go deeper' },
];

const SELECT_ID = 'chapter-select';

/**
 * Everything this control attaches to something that outlives it — the window, an
 * observer, a pending frame. Held as one list because the control is rebuilt on every
 * depth change and on every global reset, and a teardown that forgets one of them leaks a
 * listener per reset onto a page a presenter resets in front of an audience.
 */
let detach: (() => void)[] = [];

/**
 * The marked chapter, held here rather than read back off the `<select>`. The step buttons
 * count from it: a repaint that put a value into the chooser the option list does not hold
 * leaves `select.value` empty, and "next" would then count from the top of the list and
 * step to a section the reader had already passed.
 */
let currentChapterId = '';

/**
 * Whether the reader has moved the page themselves yet. The address bar follows the mark,
 * but only once there is a reader to follow: a mark that moves while the panels below are
 * still being built is the document growing, not a reader arriving, and writing a hash
 * then would overwrite the section a deep link had just asked for with one it is passing
 * through on the way.
 */
let hasScrolled = false;

/**
 * The line an incoming section has to cross to count as arrived. Cached because the answer
 * is now recomputed on every animation frame a scroll produces, and a `getComputedStyle`
 * there costs a style recalculation per frame; it only moves when the sticky bars do,
 * which is exactly when `publishHeights` runs.
 */
let arrivalLine = 0;

function chaptersForMode(): Chapter[] {
  return [...(currentMode() === 'demo' ? DEMO_CHAPTERS : LAB_CHAPTERS)];
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
  // Where the document parks a section it has been asked to jump to is where "arrived"
  // has to be measured, or a section the browser has just landed counts as one pixel
  // short of itself. That offset is the page's scroll padding; a section's own scroll
  // margin is read as well and the larger wins, because the two are interchangeable ways
  // to say the same thing and this file must not care which one the stylesheet uses.
  const section = document.querySelector('.act');
  const padding = Number.parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  const margin = section ? Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0 : 0;
  arrivalLine = Math.max(padding, margin) || stickyOffset();
}

function stickyOffset(): number {
  const root = document.documentElement;
  const read = (name: string): number =>
    Number.parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  return read('--cl-topbar-h') + read('--chapters-h');
}

function goTo(id: string, retry = true): void {
  const target = document.getElementById(id);
  // The only chapter that can be missing is one whose act has not finished rendering, and
  // that window is a frame or two wide. A press inside it used to do nothing at all, which
  // reads as a broken control rather than as an early one; asking again on the next frame
  // costs nothing and turns the race into a delay nobody can perceive. Once only, so a
  // genuinely absent target fails quietly instead of rescheduling itself for ever.
  if (!target) {
    if (retry) requestAnimationFrame(() => goTo(id, false));
    return;
  }
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
    if (target.getBoundingClientRect().top - arrivalLine <= 1) current = chapter.id;
  }
  // The last section can be shorter than the space below it, and then its top never
  // reaches the line however far the reader scrolls: the document runs out first. A reader
  // at the foot of the page has arrived at the last chapter by any honest reading, and a
  // control that never marks its own last entry is a control that lies about where it can
  // take you.
  const root = document.documentElement;
  if (window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
    return chapters[chapters.length - 1]?.id ?? current;
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
 *
 * The same movement answers the keyboard: Chrome does not scroll a partly visible element
 * into view when focus reaches it, so a tab that lands on a chip at the clipped edge would
 * otherwise put the focus ring half outside the strip. The margin is wide enough for the
 * ring rather than just the box.
 */
function revealCurrent(list: HTMLElement, link: HTMLElement | undefined): void {
  if (!link) return;
  const margin = 32;
  const left = link.offsetLeft - list.offsetLeft;
  const right = left + link.offsetWidth;
  if (left - margin < list.scrollLeft) list.scrollLeft = Math.max(0, left - margin);
  else if (right + margin > list.scrollLeft + list.clientWidth) {
    list.scrollLeft = right + margin - list.clientWidth;
  }
}

export function renderChapters(host: HTMLElement): void {
  for (const stop of detach) stop();
  detach = [];
  // A freshly rendered control repaints where the reader already is; only a move from
  // there is a move, and only a move writes itself into the address bar.
  currentChapterId = '';
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
  // One listener on the strip rather than nine on the links: `focusin` is the bubbling
  // form of focus, so a tab into any chip brings that chip into view, and there is one
  // thing to tear down instead of nine.
  const onFocusIn = (event: FocusEvent): void => {
    const link = event.target;
    if (link instanceof HTMLElement) revealCurrent(list, link);
  };
  list.addEventListener('focusin', onFocusIn);
  detach.push(() => list.removeEventListener('focusin', onFocusIn));

  const select = el('select', { class: 'chapters-select', id: SELECT_ID });
  for (const chapter of chapters) {
    select.append(el('option', { value: chapter.id, text: chapter.label }));
  }
  // Declared before the controls that call it so the reading order matches the call order;
  // it is assigned once the mark-painting closure below exists.
  let navigate = (id: string): void => goTo(id);

  /**
   * Browsing a `<select>` is not choosing from it. A closed select fires `change` for
   * every option a keyboard walks past — on Windows that is one per arrow press, and
   * typeahead fires it on the first letter typed — so navigating on `change` alone turns
   * reading the list of sections into nine full-page jumps the reader never asked for
   * (WCAG 3.2.2, On Input). The flag says which kind of `change` this is: a pointer picks
   * an option and the page moves at once, a keyboard moves the page when the choice is
   * committed with Enter or by leaving the control.
   */
  let browsing = false;
  const commit = (): void => {
    browsing = false;
    if (select.value && select.value !== currentChapterId) navigate(select.value);
  };
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
    else if (event.key === 'Escape' || event.key === 'Tab') browsing = false;
    else if (event.key.length === 1 || event.key.startsWith('Arrow')
      || event.key === 'Home' || event.key === 'End') browsing = true;
  });
  select.addEventListener('blur', () => {
    if (browsing) commit();
  });
  select.addEventListener('click', () => {
    browsing = false;
  });
  select.addEventListener('change', () => {
    if (!browsing) navigate(select.value);
  });

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
    const index = chapters.findIndex((chapter) => chapter.id === currentChapterId);
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
    const atStart = index <= 0;
    const atEnd = index >= chapters.length - 1;
    // Focus leaves before the switch is thrown. Disabling the control that is holding
    // focus drops the reader on `<body>`, and the reader who pressed "previous section"
    // at the first section is precisely the one this happens to.
    if (atStart && document.activeElement === previous) (atEnd ? select : next).focus();
    if (atEnd && document.activeElement === next) (atStart ? select : previous).focus();
    previous.disabled = atStart;
    next.disabled = atEnd;

    if (id === currentChapterId) return;
    currentChapterId = id;
    // The address bar is what "Copy link" hands out and what a reload restores, so it
    // follows the reader down the page. Only on a real change of chapter: this runs on
    // every animation frame a scroll produces, and a `replaceState` per frame is throttled
    // by the browser rather than honoured. And only once the reader has scrolled — every
    // other way of arriving at a section writes its own anchor already.
    if (!hasScrolled) return;
    const url = new URL(window.location.href);
    if (url.hash === `#${id}`) return;
    url.hash = `#${id}`;
    window.history.replaceState(window.history.state, '', url);
  };
  // A chosen chapter is marked at once rather than when the scroll lands: a smooth scroll
  // across twenty viewports would otherwise leave the control disagreeing with the reader.
  navigate = (id: string): void => {
    setCurrent(id);
    goTo(id);
  };
  // Heights first: the sticky line the current chapter is measured against is derived from
  // the properties this publishes.
  const measure = (): void => publishHeights(host);
  publishHeights(host);
  window.addEventListener('resize', measure);
  detach.push(() => window.removeEventListener('resize', measure));
  setCurrent(currentId(chapters));

  /**
   * The scroll is the signal. The observer below only fires at the edges of its band, and
   * those edges are not the moment the answer changes: between two of them a reader can
   * scroll two thousand pixels with the bar still naming the section they left — measured
   * at thirty-seven of a hundred and one positions down the full lab. Every frame that
   * moves the page is asked again instead, coalesced into one animation frame so a fast
   * wheel costs one recomputation per painted frame rather than one per event, and passive
   * so it can never delay the scroll it is watching.
   */
  let frame = 0;
  const onScroll = (): void => {
    hasScrolled = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      setCurrent(currentId(chapters));
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  detach.push(() => {
    window.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
  });

  // The observer stays as a second trigger, for the times the document moves under a
  // still reader: a panel that finishes rendering changes which section is under the line
  // without any scroll event to say so.
  const observer = new IntersectionObserver(() => setCurrent(currentId(chapters)), {
    rootMargin: `-${Math.round(stickyOffset()) + 8}px 0px -55% 0px`,
    threshold: 0,
  });
  for (const chapter of chapters) {
    const target = document.getElementById(chapter.id);
    if (target) observer.observe(target);
  }
  detach.push(() => observer.disconnect());
}

/** Mount the control and keep it in step with the depth, which changes the chapter list. */
export function mountChapters(host: HTMLElement): void {
  renderChapters(host);
  onModeChange(() => renderChapters(host));
}
