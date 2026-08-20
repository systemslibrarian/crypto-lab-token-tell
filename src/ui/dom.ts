/**
 * Small DOM helpers.
 *
 * The accessibility rules the gate enforces are easier to keep if the helpers make the
 * right thing the easy thing: every control gets a real label, every computed readout is
 * a live region, and every state is announced with a glyph and a word, never with colour
 * alone.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A number formatted for display, with a fixed number of decimals. */
export function fixed(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

export function integer(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-GB');
}

/** p-values reach past what a double can hold, so they are reported on a log scale too. */
export function pValue(p: number, log10P: number): string {
  if (!Number.isFinite(log10P)) return 'below the smallest value this arithmetic can express';
  if (p > 1e-4) return p.toPrecision(3);
  return `10^${log10P.toFixed(1)}`;
}

export type ProvenanceKind = 'paper' | 'reference' | 'demo' | 'pinned';

const PROVENANCE_LABELS: Record<ProvenanceKind, string> = {
  paper: 'PAPER-FAITHFUL',
  reference: 'REFERENCE-IMPLEMENTATION-FAITHFUL',
  demo: 'DEMO-SIMPLIFICATION',
  pinned: 'PINNED EMPIRICAL DATA',
};

/**
 * The implementation-provenance label every component on this page has to carry.
 *
 * Deliberately no `title`. The tag's whole text is already on screen, so a tooltip
 * repeating it carries nothing — and the assistive technologies that expose `title` as an
 * element's description read the label out a second time, which on the Full lab is
 * forty-eight duplicated announcements for no added fact. A `title` earns its place only
 * where it says something the visible text does not.
 */
export function provenanceTag(kind: ProvenanceKind, detail?: string): HTMLElement {
  const label = PROVENANCE_LABELS[kind] + (detail ? ` · ${detail}` : '');
  return el('span', { class: `provenance-tag ${kind}`, text: label });
}

export type VerdictTone = 'evidence' | 'none' | 'alarm' | 'caution';

const GLYPHS: Record<VerdictTone, string> = {
  evidence: '[+]',
  none: '[ ]',
  alarm: '[x]',
  caution: '[!]',
};

/**
 * A verdict is a glyph, a word and a colour — never a colour on its own, which is both a
 * WCAG requirement and the only way the claim survives a grayscale screenshot.
 */
export function verdict(tone: VerdictTone, label: string, detail: string): HTMLElement {
  return el('div', { class: `verdict ${tone}` }, [
    el('span', { class: 'glyph', 'aria-hidden': 'true', text: GLYPHS[tone] }),
    el('span', { class: 'label' }, [label, el('span', { class: 'detail', text: detail })]),
  ]);
}

/** Text carried for a screen reader alone, where a glyph or a layout says it visually. */
export function srOnly(text: string): HTMLElement {
  return el('span', { class: 'sr-only', text });
}

/**
 * The one-line closure at the end of a demo beat: what was changed, and what that did.
 *
 * The arrow is the whole sentence visually and useless aloud, so it is decorative and the
 * relation is spelled out for a reader who hears the line instead of seeing it. Keeping
 * the two halves in their own elements is what lets the change be stated in the page's
 * voice and the effect be the part that carries the weight.
 */
export function consequence(change: string, effect: string): HTMLElement {
  return el('p', { class: 'consequence' }, [
    el('span', { class: 'consequence-change', text: change }),
    srOnly(' leads to '),
    el('span', { class: 'consequence-arrow', 'aria-hidden': 'true', text: '→' }),
    el('span', { class: 'consequence-effect', text: effect }),
  ]);
}

/**
 * A disclosure whose body is built on first open.
 *
 * Deferring the build keeps the initial render honest about its cost — the calculation
 * trails behind these summaries are the expensive part of several panels. The `eager`
 * option exists because deferral is wrong wherever the hidden content is itself under
 * test: the claims suite re-derives statistics by reading a `dt` and its `dd` through a
 * closed `<details>`, and a body that has not been built yet reads as an empty string and
 * silently turns an arithmetic check into a comparison against zero.
 */
export function disclosure(
  summaryText: string,
  build: () => Node[],
  options: { class?: string; eager?: boolean } = {},
): HTMLElement {
  const body = el('div', { class: 'disclosure-body' });
  const details = el('details', {
    class: options.class ? `disclosure ${options.class}` : 'disclosure',
  }, [el('summary', { text: summaryText }), body]);

  let built = false;
  const fill = (): void => {
    if (built) return;
    built = true;
    body.append(...build());
  };
  if (options.eager) fill();
  else details.addEventListener('toggle', () => { if (details.open) fill(); });
  return details;
}

/**
 * Below this the value column cannot hold a four-digit figure on one line. The gate's own
 * bar for a readout value is eight characters and four characters to a line
 * (`e2e/visual.spec.ts`), which at this face and size is about 57px; the margin above it
 * is deliberate, because the alternative to stacking early is stacking a character at a
 * time.
 */
const MIN_VALUE_COLUMN_PX = 72;

/**
 * Stack a readout's pairs when its own box is too narrow to set them side by side.
 *
 * This is the container query the stylesheet cannot write. The sheet stacks every readout
 * below a 640px VIEWPORT, which stands in for "this readout is narrow" and holds right up
 * to the moment a readout sits in a narrow COLUMN of a wide page: Act III's three entropy
 * cards are 319px each on a 1052px laptop, the term column takes its max-content 218px,
 * the values are left 15px, and all eight of them wrap one character to a line. A viewport
 * query cannot see that, because the viewport is not the thing that got narrow.
 */
function stackWhenNarrow(dl: HTMLElement): void {
  const values = Array.from(dl.querySelectorAll('dd'));
  const sync = (): void => {
    // Ask the stylesheet what it would do unaided first: with the override in force, the
    // computed tracks only ever report the override back.
    dl.style.removeProperty('grid-template-columns');
    const tracks = getComputedStyle(dl).gridTemplateColumns
      .split(' ')
      .map((track) => Number.parseFloat(track))
      .filter((track) => Number.isFinite(track));
    // One track means the sheet has already stacked this readout, and nothing is owed.
    const valueColumn = tracks.length > 1
      ? tracks[tracks.length - 1] ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
    const stack = valueColumn < MIN_VALUE_COLUMN_PX;
    if (stack) dl.style.gridTemplateColumns = 'minmax(0, 1fr)';
    // Right alignment is what makes a column of figures comparable; stacked, it only
    // pushes each value away from the term it belongs to.
    for (const value of values) value.style.textAlign = stack ? 'left' : '';
  };
  // Safe against a resize loop: the decision changes the list's height, never its width,
  // and the width is what is being observed.
  new ResizeObserver(sync).observe(dl);
}

/** A definition-list readout. Every displayed statistic goes through here. */
export function readout(
  rows: [string, string][],
  ariaLabel?: string,
  options: { stackWhenNarrow?: boolean } = {},
): HTMLElement {
  const dl = el('dl');
  for (const [term, value] of rows) {
    dl.append(el('dt', { text: term }), el('dd', { text: value }));
  }
  if (options.stackWhenNarrow) stackWhenNarrow(dl);
  const attributes: Record<string, string> = { class: 'readout' };
  if (ariaLabel) {
    // An aria-label on a role-less element is silently discarded — axe files it under
    // `aria-prohibited-attr`, and a reader simply never hears it. The label is the only
    // thing distinguishing one readout from the next on a page with dozens, so the
    // container takes a real role to carry it.
    attributes.role = 'group';
    attributes['aria-label'] = ariaLabel;
  }
  return el('div', attributes, [dl]);
}

/** A live region for anything computed after a user action. */
export function liveRegion(ariaLabel: string): HTMLElement {
  return el('div', {
    class: 'readout',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': ariaLabel,
  });
}

/**
 * A scrollable region, which needs a role, a label, and a tab stop only when it actually
 * scrolls.
 *
 * WCAG 2.1.1 wants a keyboard route into a container the mouse can pan; it does not want
 * a stop at a container that goes nowhere. Whether a given region overflows is a fact
 * about the viewport rather than about the markup — of the twelve visible on the Full
 * lab, none overflow at 1440 and six do at 390 — so a literal `tabindex="0"` written once
 * is wrong at one of those widths whichever value it takes. Twelve stops that announce a
 * region name and then ignore every arrow key is the more expensive way to be wrong, so
 * the attribute is measured instead of assumed.
 *
 * Both axes are tested because `overflow-x: auto` computes the untouched `overflow-y` to
 * `auto` as well: a scroller can scroll in the direction its own rule never named, and
 * the reachability gate tests for exactly that.
 */
export function scroller(ariaLabel: string, children: Node[]): HTMLElement {
  const node = el('div', { class: 'scroller', role: 'region', 'aria-label': ariaLabel },
    children);
  const syncTabStop = (): void => {
    node.tabIndex = node.scrollWidth > node.clientWidth + 1
      || node.scrollHeight > node.clientHeight + 1
      ? 0
      : -1;
  };
  // The first notification arrives once the element has been laid out, which is also the
  // first moment the answer exists — a region still off the document, or inside a closed
  // disclosure, has no size and correctly gets no tab stop until it does.
  new ResizeObserver(syncTabStop).observe(node);
  return node;
}

export function panel(title: string, children: Node[], tag?: HTMLElement): HTMLElement {
  const heading = el('div', { class: 'panel-title' }, [title]);
  if (tag) {
    heading.style.display = 'flex';
    heading.style.justifyContent = 'space-between';
    heading.style.gap = '0.6rem';
    heading.style.flexWrap = 'wrap';
    heading.append(tag);
  }
  return el('div', { class: 'panel' }, [heading, ...children]);
}

export function labelledSelect(
  id: string,
  labelText: string,
  options: { value: string; label: string }[],
  initial: string,
): { field: HTMLElement; select: HTMLSelectElement } {
  const select = el('select', { id });
  for (const option of options) {
    select.append(el('option', { value: option.value, text: option.label }));
  }
  select.value = initial;
  const field = el('div', { class: 'field' }, [
    el('label', { for: id, text: labelText }),
    select,
  ]);
  return { field, select };
}

export function labelledRange(
  id: string,
  labelText: string,
  min: number,
  max: number,
  value: number,
): { field: HTMLElement; input: HTMLInputElement; output: HTMLElement } {
  const input = el('input', {
    id,
    type: 'range',
    min: String(min),
    max: String(max),
    value: String(value),
    step: '1',
  });
  const output = el('output', { for: id, class: 'mono', text: String(value) });
  const field = el('div', { class: 'field' }, [
    el('label', { for: id }, [labelText, ' ', output]),
    input,
  ]);
  return { field, input, output };
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = el('button', { type: 'button', class: primary ? 'primary' : '' }, [label]);
  node.addEventListener('click', onClick);
  return node;
}

/** The thesis, in the compact form that rides on every panel. */
export function thesisStrip(): HTMLElement {
  const strip = el('p', { class: 'thesis-strip' });
  strip.append(
    el('b', { text: 'A watermark is not a signature.' }),
    ' The detector runs a statistical test for evidence associated with a particular ' +
      'watermark configuration and key. It does not establish authorship and does not ' +
      'prove that text is AI-generated.',
  );
  return strip;
}

export function actHeader(
  id: string,
  kicker: string,
  title: string,
  lede: string,
): HTMLElement[] {
  const strip = thesisStrip();
  // The claim is worth repeating to an auditor working through nine acts out of order,
  // and worth stating ONCE to a visitor being walked through ninety seconds of it. So
  // every strip carries the lab tag, the hero's included: in the short route the strip
  // shares all twenty-seven of its distinct words with the `.thesis` block a third of a
  // screen above it, and a presenter reading the same sentence to the room twice inside
  // the opening twenty seconds is the repetition chad.md asked to remove. Nothing is lost
  // by it — the full claim and its precise form are both still on screen, larger, in the
  // block this strip was only ever a travelling copy of. The attribute name is written
  // literally so this helpers file stays free of a dependency on the mode.
  strip.dataset.depth = 'lab';
  return [
    el('p', { class: 'act-kicker', text: kicker }),
    el('h2', { id: `${id}-heading`, text: title }),
    el('p', { class: 'act-lede', text: lede }),
    strip,
  ];
}

/** Yield to the browser so a long computation can paint a progress update. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
