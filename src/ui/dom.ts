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

/** The implementation-provenance label every component on this page has to carry. */
export function provenanceTag(kind: ProvenanceKind, detail?: string): HTMLElement {
  const label = PROVENANCE_LABELS[kind] + (detail ? ` · ${detail}` : '');
  return el('span', { class: `provenance-tag ${kind}`, title: label, text: label });
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

/** A definition-list readout. Every displayed statistic goes through here. */
export function readout(rows: [string, string][], ariaLabel?: string): HTMLElement {
  const dl = el('dl');
  for (const [term, value] of rows) {
    dl.append(el('dt', { text: term }), el('dd', { text: value }));
  }
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

/** A horizontally scrollable region, which needs a role, a label and a tab stop. */
export function scroller(ariaLabel: string, children: Node[]): HTMLElement {
  return el('div', {
    class: 'scroller',
    role: 'region',
    'aria-label': ariaLabel,
    tabindex: '0',
  }, children);
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
  return [
    el('p', { class: 'act-kicker', text: kicker }),
    el('h2', { id: `${id}-heading`, text: title }),
    el('p', { class: 'act-lede', text: lede }),
    thesisStrip(),
  ];
}

/** Yield to the browser so a long computation can paint a progress update. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
