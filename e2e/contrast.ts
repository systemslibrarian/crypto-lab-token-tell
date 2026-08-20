import type { Page } from '@playwright/test';

/**
 * Composite-aware WCAG 1.4.3 contrast measurement, for THIS lab.
 *
 * This exists because axe is not a complete contrast oracle. Two classes of
 * text never reach the `violations` array a gate asserts on:
 *
 *  - TEXT OVER A SURFACE AXE DECLINES TO RESOLVE — a `color-mix()` over an
 *    unknown backdrop. Every surface that carries this lab's MEANING is one:
 *    all four verdict tones are `color-mix(in oklab, tone 10%, transparent)`
 *    (`.verdict.evidence`, `.verdict.alarm`, `.verdict.caution`, with
 *    `.verdict.none` the flat-`--raised` exception), and so are the `.thesis`
 *    block and the `.thesis-strip` that repeats it on every panel, the
 *    `.warn-box`, the hero aside's `.cl-hero-why` accent wash, the
 *    `.token.counted-high` / `.token.counted-low` highlights that mark which
 *    positions the detector actually scored, the `.compare-table
 *    tr.load-bearing` row, and the SVG charts' `.bar` and `.band` fills. Those
 *    surfaces hold every detection verdict, every signature verdict and the
 *    per-token evidence this whole lab is about. The shared top bar adds
 *    `color-mix(in srgb, ...)` for its `--cl-ink` and for the `.cl-btn` edge.
 *    A violations-only gate therefore measured the contrast of almost none of
 *    this lab's readouts.
 *
 *  - TEXT FADED BY AN ANCESTOR'S `opacity` — axe reads the declared `color`,
 *    which is not the colour that lands on screen. THIS LAB HAS NO SUCH TEXT
 *    TODAY, and that was grepped rather than assumed: `opacity` is not
 *    declared anywhere in `src/style.css`, in `index.html`'s inline top-bar
 *    style, or in any `src/ui/*.ts` renderer. The stylesheet's own header says
 *    why — "Muted text lowers lightness rather than using opacity, because
 *    opacity is invisible to a contrast oracle" (`style.css:1-4`) — which is
 *    also why `--text-dim` and `--text-muted` are separate tokens rather than
 *    one token at two alphas. Disabled controls fade by ink too
 *    (`button:disabled` swaps `color` to `--text-muted` and nothing else) and
 *    are exempt anyway as inactive components, skipped below for that reason.
 *    The opacity model stays whole because a single `opacity:` declaration
 *    would silently move this lab back into the class axe cannot see.
 *
 * So: walk every element that owns text, composite the real painted result
 * (translucent colours, gradient stops and opacity groups included), and
 * compute the ratio against the surface the text is genuinely sitting on
 * rather than against white. A gradient is judged at the text's own location.
 *
 * Opacity is modelled the way the compositor actually does it: an element with
 * `opacity < 1` renders its subtree into a group, then composites the group
 * over the backdrop. That means the *text* and the *background beside it* fade
 * onto the same backdrop independently — which is why both are carried through
 * the walk as a pair rather than fading the foreground alone.
 *
 * The ancestor walk is geometry-aware, because DOM ancestry is not the same
 * thing as "painted underneath". An absolutely positioned child can render
 * entirely outside its parent's box, and then the parent's background is simply
 * not behind it. So an ancestor's own paint is applied only when its border box
 * actually intersects the text's box; a partial intersection still counts, so
 * the judgement stays worst-case. Opacity is unconditional either way.
 *
 * Three things beyond that, each of which otherwise makes the helper report a
 * ratio nothing on screen has:
 *
 *  - TEXT SCROLLED OUT OF A CLIPPING ANCESTOR PAINTS NOTHING. This page is
 *    the opposite of scroller-free. `.scroller { overflow-x: auto }`
 *    (`style.css:192-198`) is the stylesheet's ONE author overflow rule, and
 *    `dom.ts`'s `scroller()` helper stamps it out at nineteen call sites
 *    across `src/ui/`: the tournament bracket and its per-layer tables, the
 *    scored token stream, the per-position g-value table, the entropy tables,
 *    the C2PA manifest and the signed claim bytes, the mechanism comparison,
 *    the pinned-attack results, and the before/after text inside each attack
 *    disclosure. Every one of them holds real measured text, so this guard is
 *    LIVE here rather than insurance. Content scrolled past a clipper is not
 *    dimmed or partly drawn; it is absent from the frame, and asking what
 *    colour it sits on has no answer. Its rect is outside every ancestor's
 *    box, so the walk would find nothing behind it and fall through to WHITE,
 *    inventing a failure for a wide table's right-hand columns on every scan.
 *
 *  - TRANSPARENT TEXT PAINTS NOTHING. Anything drawn `color: transparent` lays
 *    no ink down; compositing a zero-alpha foreground returns the backdrop and
 *    reports a fixed 1:1.
 *
 *  - SVG PAINTS IN DOCUMENT ORDER, SO SIBLINGS CAN BE THE BACKGROUND. This
 *    lab draws its own SVG and that SVG OWNS TEXT: `src/ui/chart.ts` builds a
 *    histogram and a line chart with `document.createElementNS`, and both set
 *    `textContent` on `<text>` nodes for the axis ticks, the `n=` count, the
 *    axis titles and the score-marker labels — all painted in
 *    `fill: var(--text-dim)` at `font-size: 10px` (`style.css:253`), which is
 *    small text needing 4.5:1. Those `<text>` nodes are later siblings of
 *    filled `<rect class="bar">`, `<polygon class="band">` and
 *    `<circle class="point">` shapes, so the underlay walk below is live. It
 *    is also exactly the shape the `FILLED` guard exists for: the same charts
 *    draw their axes and score markers as stroke-only `<line>`s and their
 *    series as `<polyline>`s, none of which declare a `fill`, and SVG's
 *    initial `fill` is black — `getComputedStyle` reports black for
 *    stroke-only geometry too — so an unguarded walk would treat every axis
 *    rule as an opaque black rectangle across the plot. The shared header's
 *    two `aria-hidden` marks (the Menu hamburger's three `<line>`s and the
 *    GitHub `<path>`) carry no character data at all.
 *
 * TWO THINGS THIS WALK CANNOT SEE, stated so neither is mistaken for coverage.
 *
 * FIRST, generated content. The walk iterates ELEMENTS, and a
 * `::before`/`::after` is not one — nor is it one to axe's `color-contrast`
 * rule. `nontext.ts` covers that class separately. This stylesheet declares
 * no `content` at all today — grepped, not assumed. The page's only generated
 * mark is the `<summary>` disclosure triangle, which is `::marker` (the UA's
 * own, recoloured to `var(--accent)` at `style.css:299`) and not a
 * `::before`/`::after`, so that half of `nontext.ts` is inert here. It runs at
 * every state anyway, because the first author-declared `content` on this page
 * will arrive without anyone re-reading this file.
 *
 * SECOND, `aria-hidden` text that is still painted — see the `ariaHidden` note
 * below. This page hides exactly one kind of text: the `.verdict .glyph` span
 * that prefixes every verdict with `[+]`, `[ ]`, `[x]` or `[!]` beside the
 * word saying the same thing. Those glyphs are painted in the semantic inks on
 * the `color-mix()` verdict tints, so `gate.ts` measures every `aria-hidden`
 * subtree explicitly with that exemption lifted rather than reasoning about
 * which glyphs matter.
 */

export interface ContrastFailure {
  selector: string;
  text: string;
  foreground: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  required: number;
  ratio: number;
}

/**
 * `within` narrows the walk to one subtree; `includeAriaHidden` lifts the
 * accessibility-tree exemption for that walk.
 *
 * The default pair — whole page, `aria-hidden` skipped — matches axe's own
 * boundary and is what `scan()` uses for the page at large.
 *
 * The second form exists because of a real gap. SC 1.4.3 is about what a reader
 * SEES, and `aria-hidden` changes only what a reader HEARS, so painted text
 * inside an `aria-hidden` subtree still has to clear its ratio — yet axe skips
 * it and, by default, so does this walk. What this page hides is its verdict
 * glyphs — `[+]` / `[ ]` / `[x]` / `[!]`, emitted by `verdict()` in
 * `src/ui/dom.ts` — each painted in a semantic ink (`--ok`, `--alarm`,
 * `--warn`, or `--text-dim` for the neutral tone) on its own `color-mix()`
 * verdict tint, which is the state this lab exists to show — so `scan()` calls
 * this a second time as
 * `auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)`.
 */
export async function auditContrast(
  page: Page,
  within = 'body *',
  includeAriaHidden = false
): Promise<ContrastFailure[]> {
  return page.evaluate(([rootSelector, allowAriaHidden]: [string, boolean]) => {
    interface RGBA {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
    const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

    /**
     * Resolve ANY CSS colour to straight-alpha sRGB via a 1×1 canvas.
     *
     * A hand-rolled `rgba()` regex is not enough here: every tint on this page
     * is authored with `color-mix()` — the hero aside, the thesis block and its
     * per-panel strip, all four verdict tones, the warn box, the counted-token
     * highlights, the load-bearing comparison row and the charts' bar and band
     * fills — and Chromium reports that to `getComputedStyle` unchanged rather
     * than converting it to sRGB. A
     * regex that only understands `rgb()/rgba()` sees `null` for every one of
     * them and the walk then falls through to the wrong backdrop — which
     * fabricates failures (dark-on-light read as dark-on-dark) and, far worse,
     * could hide a real one. The 2D canvas is the browser's own colour
     * pipeline: assigning `fillStyle` converts any valid CSS colour — oklab,
     * color-mix, hwb, named, hex — to sRGB, and a painted pixel carries the
     * straight alpha back. Invalid input (a gradient direction keyword fed in by
     * mistake) is rejected by the two-sentinel check so it cannot masquerade as
     * black.
     */
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const colorCache = new Map<string, RGBA | null>();
    const resolve = (c: string): RGBA | null => {
      if (!c) return null;
      const cached = colorCache.get(c);
      if (cached !== undefined) return cached;
      let rgba: RGBA | null = null;
      // A valid colour normalises to the same value from either sentinel; an
      // invalid string leaves each sentinel in place and the two disagree.
      ctx.fillStyle = '#000';
      ctx.fillStyle = c;
      const fromBlack = ctx.fillStyle;
      ctx.fillStyle = '#fff';
      ctx.fillStyle = c;
      const fromWhite = ctx.fillStyle;
      if (fromBlack === fromWhite) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        rgba = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
      colorCache.set(c, rgba);
      return rgba;
    };

    /** Split on a separator char that sits at paren-nesting depth 0. */
    const splitTopLevel = (str: string, sep: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of str) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === sep && depth === 0) {
          out.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) out.push(cur);
      return out;
    };

    /** Standard source-over compositing of a (possibly translucent) src on dst. */
    const over = (src: RGBA, dst: RGBA): RGBA => {
      const a = src.a + dst.a * (1 - src.a);
      if (a === 0) return TRANSPARENT;
      return {
        r: (src.r * src.a + dst.r * dst.a * (1 - src.a)) / a,
        g: (src.g * src.a + dst.g * dst.a * (1 - src.a)) / a,
        b: (src.b * src.a + dst.b * dst.a * (1 - src.a)) / a,
        a,
      };
    };

    const fade = (c: RGBA, o: number): RGBA => (o >= 1 ? c : { ...c, a: c.a * o });

    const luminance = (c: RGBA): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };

    const ratio = (a: RGBA, b: RGBA): number => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    interface Point {
      x: number;
      y: number;
    }
    interface Stop {
      color: RGBA;
      pos: number;
    }

    const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

    /**
     * Interpolate a gradient's stop list at fraction `t`, in premultiplied
     * straight-alpha, the way the compositor blends a fade-to-`transparent`.
     */
    const colorAt = (stops: Stop[], t: number): RGBA => {
      if (!stops.length) return TRANSPARENT;
      if (t <= stops[0].pos) return stops[0].color;
      const last = stops[stops.length - 1];
      if (t >= last.pos) return last.color;
      let i = 0;
      while (i < stops.length - 1 && stops[i + 1].pos < t) i++;
      const a = stops[i];
      const b = stops[i + 1];
      const span = b.pos - a.pos;
      const f = span <= 0 ? 0 : (t - a.pos) / span;
      const al = a.color.a + (b.color.a - a.color.a) * f;
      const pr = a.color.r * a.color.a + (b.color.r * b.color.a - a.color.r * a.color.a) * f;
      const pg = a.color.g * a.color.a + (b.color.g * b.color.a - a.color.g * a.color.a) * f;
      const pb = a.color.b * a.color.a + (b.color.b * b.color.a - a.color.b * a.color.a) * f;
      return al === 0 ? TRANSPARENT : { r: pr / al, g: pg / al, b: pb / al, a: al };
    };

    /** Parse the colour-stop list of a gradient, normalising positions to 0..1. */
    const parseStops = (parts: string[]): Stop[] => {
      const raw: { color: RGBA; pos: number | null }[] = [];
      for (const part of parts) {
        const tokens = splitTopLevel(part.trim(), ' ').filter(Boolean);
        let color: RGBA | null = null;
        const positions: number[] = [];
        for (const tok of tokens) {
          const c = resolve(tok);
          if (c && !color) color = c;
          else if (tok.endsWith('%')) positions.push(parseFloat(tok) / 100);
        }
        if (!color) continue;
        // A stop may carry two positions (a hard band); emit one per position.
        if (positions.length === 0) raw.push({ color, pos: null });
        else for (const p of positions) raw.push({ color, pos: p });
      }
      if (!raw.length) return [];
      if (raw[0].pos === null) raw[0].pos = 0;
      if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
      for (let i = 1; i < raw.length - 1; i++) {
        if (raw[i].pos !== null) continue;
        let j = i;
        while (j < raw.length && raw[j].pos === null) j++;
        const lo = raw[i - 1].pos as number;
        const hi = (raw[j]?.pos as number) ?? 1;
        for (let k = i; k < j; k++) raw[k].pos = lo + ((hi - lo) * (k - i + 1)) / (j - i + 1);
      }
      // CSS clamps positions to be non-decreasing.
      let run = 0;
      return raw.map((s) => {
        run = Math.max(run, s.pos as number);
        return { color: s.color, pos: run };
      });
    };

    const axisValue = (tok: string, origin: number, extent: number): number => {
      if (tok === 'left' || tok === 'top') return origin;
      if (tok === 'right' || tok === 'bottom') return origin + extent;
      if (tok === 'center') return origin + extent / 2;
      if (tok.endsWith('%')) return origin + (parseFloat(tok) / 100) * extent;
      if (tok.endsWith('px')) return origin + parseFloat(tok);
      return origin + extent / 2;
    };

    const VERT = new Set(['top', 'bottom']);
    const HORZ = new Set(['left', 'right']);

    /**
     * Evaluate one background-image layer at a document point.
     *
     * An earlier gate judged every gradient at its worst *stop*, assuming that
     * stop covered the text wherever the text sat. That is right only for a
     * gradient whose worst stop spans its element — elsewhere in this fleet a
     * `linear-gradient` running the full height of a several-screen document
     * put text near the top on a different surface than text near the bottom.
     * So each gradient is *sampled* at the text's real location instead:
     * linear by projecting onto the gradient line, radial by distance from the
     * centre over the farthest-corner radius. A non-gradient layer (`url()`,
     * `none`) is unmeasurable and paints nothing.
     *
     * THIS SAMPLER IS LIVE HERE — the sentence this file used to carry, that
     * the lab declared no gradient, is false of Token Tell. `src/style.css`
     * declares gradients in two places and a renderer adds a third: `select`
     * paints its dropdown arrow as two `linear-gradient()` sprites
     * (`style.css:158-159`), and `.token.masked` paints a
     * `repeating-linear-gradient` hatch (`style.css:245`) UNDER the token's own
     * characters — text this walk measures — while the matching legend swatch
     * (`act2-detector.ts:178`) repeats the hatch inline but holds no text. So
     * the masked tokens in Act II's scored stream are judged through this code
     * path, not through `resolve`.
     *
     * Two approximations, stated rather than hidden. `parseStops` reads only
     * `%` stop positions, so the hatch's `3px`/`6px` stops are spread evenly
     * across the box instead of repeating at their real pitch; and
     * `background-position`, `-size` and `-repeat` are not modelled at all.
     * Both give a blend of the declared stops rather than the exact pixel under
     * the glyph. Neither was hand-checked against a screenshot for this lab, so
     * a `.token.masked` finding should be measured by hand before it is acted
     * on.
     */
    const sampleLayer = (layer: string, rect: DOMRect, p: Point): RGBA => {
      if (!/gradient/.test(layer)) return TRANSPARENT;
      const inner = layer.slice(layer.indexOf('(') + 1, layer.lastIndexOf(')'));
      const parts = splitTopLevel(inner, ',').map((s) => s.trim());
      const radial = /radial-gradient/.test(layer);
      // The first part is configuration (angle / shape / position) exactly when
      // it holds no resolvable colour.
      const firstColour = parts[0]
        ? splitTopLevel(parts[0], ' ').some((t) => resolve(t.trim()))
        : false;
      const config = firstColour ? '' : parts[0] ?? '';
      const stops = parseStops(firstColour ? parts : parts.slice(1));
      if (!stops.length) return TRANSPARENT;

      if (radial) {
        // Centre: `... at X Y`. Default centre of the box.
        let cx = rect.left + rect.width / 2;
        let cy = rect.top + rect.height / 2;
        const at = config.split(/\s+at\s+/)[1];
        if (at) {
          const toks = at.split(/\s+/).filter(Boolean);
          const kw = toks.filter((t) => VERT.has(t) || HORZ.has(t) || t === 'center');
          const vals = toks.filter((t) => !kw.includes(t));
          for (const t of toks) {
            if (HORZ.has(t)) cx = axisValue(t, rect.left, rect.width);
            else if (VERT.has(t)) cy = axisValue(t, rect.top, rect.height);
          }
          if (vals[0]) cx = axisValue(vals[0], rect.left, rect.width);
          if (vals[1]) cy = axisValue(vals[1], rect.top, rect.height);
        }
        // Default ending shape is farthest-corner.
        const corners = [
          [rect.left, rect.top],
          [rect.right, rect.top],
          [rect.left, rect.bottom],
          [rect.right, rect.bottom],
        ];
        const radius = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        const t = radius <= 0 ? 0 : Math.hypot(p.x - cx, p.y - cy) / radius;
        return colorAt(stops, clamp01(t));
      }

      // Linear. Default direction is `to bottom` (180deg).
      let angle = 180;
      if (/deg/.test(config)) angle = parseFloat(config);
      else if (/to\s+top/.test(config)) angle = 0;
      else if (/to\s+right/.test(config)) angle = 90;
      else if (/to\s+left/.test(config)) angle = 270;
      const rad = (angle * Math.PI) / 180;
      const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
      const len = Math.abs(rect.width * Math.sin(rad)) + Math.abs(rect.height * Math.cos(rad));
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const d = (p.x - cx) * dir.x + (p.y - cy) * dir.y;
      const t = len <= 0 ? 0.5 : 0.5 + d / len;
      return colorAt(stops, clamp01(t));
    };

    /**
     * The colour this element's own box paints at the text point: its
     * background-color with every background-image layer sampled and composited
     * in paint order (first-listed layer on top).
     */
    const paintAt = (cs: CSSStyleDeclaration, rect: DOMRect, p: Point): RGBA => {
      let result = resolve(cs.backgroundColor) ?? TRANSPARENT;
      const bi = cs.backgroundImage;
      if (!bi || bi === 'none') return result;
      const layers = splitTopLevel(bi, ',').map((s) => s.trim());
      // Composite bottom (last-listed) up to top (first-listed).
      for (let i = layers.length - 1; i >= 0; i--) {
        result = over(sampleLayer(layers[i], rect, p), result);
      }
      return result;
    };

    /** Do two border boxes share any painted area at all? */
    const intersects = (a: DOMRect, b: DOMRect): boolean =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 0 &&
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 0;

    /** Does `a` sit entirely inside `b`? */
    const contains = (outer: DOMRect, inner: DOMRect): boolean =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;

    /**
     * Style and geometry are memoised per element for one pass.
     *
     * A driven pass here walks a nine-section document — the hero experiment,
     * Acts I to VII and the reference section, each rendered into its own
     * `<section class="act">` by `src/main.ts` — and the expensive part is Act
     * II's scored token stream, which emits one `<span class="token">` per
     * token across a several-hundred-token sample, every one of them a sibling
     * re-walking the same ancestors up to `<body>`. Act I's tournament bracket,
     * the per-position g-value tables and Act IV's two pinned-attack
     * disclosures (each holding two full-text scrollers) repeat the shape.
     * Without the caches the pass re-reads the same computed styles and rects
     * tens of thousands of times. Nothing mutates the DOM during the pass, so
     * the cached values cannot go stale.
     */
    const styleCache = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (el: Element): CSSStyleDeclaration => {
      let cs = styleCache.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styleCache.set(el, cs);
      }
      return cs;
    };
    const rectCache = new Map<Element, DOMRect>();
    const rectOf = (el: Element): DOMRect => {
      let r = rectCache.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        rectCache.set(el, r);
      }
      return r;
    };

    /**
     * Every container that clips its overflow, with the box it clips to.
     *
     * An `overflow: auto` container paints only what falls inside that box.
     * Content scrolled beyond it is not dimmed or partly drawn — it is absent
     * from the frame, and asking what colour it sits on has no answer. Here
     * that is `.scroller { overflow-x: auto }` (`style.css:192-198`), the
     * stylesheet's one author overflow rule, instantiated at nineteen
     * `scroller(...)` call sites across `src/ui/` — wide tables, the scored
     * token stream, the manifest and signed-claim byte dumps, and the
     * before/after text inside each pinned-attack disclosure. The collection is
     * built from the live DOM rather than from that list, so a scroller added
     * later joins it without an edit here, and UA-clipped boxes (`textarea`,
     * `select`) are picked up on their computed values too.
     */
    const clippers = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const cs = styleOf(el);
      return /auto|scroll|hidden|clip/.test(cs.overflowX + ' ' + cs.overflowY);
    });

    const clippedAway = (el: Element, box: DOMRect): boolean =>
      clippers.some((c) => c !== el && c.contains(el) && !intersects(box, rectOf(c)));

    /**
     * SVG has no `background-color`: shapes paint in document order, so the
     * surface under a `<text>` is whichever earlier sibling shape lies beneath
     * it. Composite those, innermost-last, before the ancestor walk starts.
     */
    const svgUnderlay = (el: Element, box: DOMRect): RGBA => {
      let bg = TRANSPARENT;
      let sib = el.previousElementSibling;
      const stack: Element[] = [];
      while (sib) {
        stack.push(sib);
        sib = sib.previousElementSibling;
      }
      // Earliest sibling first — that is the order the compositor paints in.
      // Only shapes that actually PAINT A FILL can be a backdrop. SVG's initial
      // `fill` is black, and `getComputedStyle` reports that for stroke-only
      // geometry too — so a <line> used as a grid rule or axis reads as an
      // opaque black rectangle covering whatever it crosses. Compositing that
      // invented a 3.82:1 failure elsewhere in this fleet for labels whose real
      // ratio was 6.15:1. This lab is that case, live: `src/ui/chart.ts` draws
      // its axes and score markers as stroke-only <line>s and its series as
      // <polyline>s (`.chart .axis`, `.marker`, `.marker-alt`, `.series-null`,
      // `.series-wm` — stroke only, with `fill: none` or no fill declared), and
      // it labels all of them with real <text>. Neither `line` nor `polyline`
      // is in FILLED, so both are skipped; the genuinely filled
      // <rect class="bar">, <polygon class="band"> and <circle class="point">
      // are composited, and only where they actually CONTAIN the label's box.
      const FILLED = ['rect', 'circle', 'ellipse', 'polygon', 'path'];
      for (const s of stack.reverse()) {
        if (!FILLED.includes(s.tagName.toLowerCase())) continue;
        if (!contains(rectOf(s), box)) continue;
        const scs = styleOf(s);
        const fill = resolve(scs.fill);
        if (!fill) continue;
        const op = parseFloat(scs.fillOpacity || '1') * parseFloat(scs.opacity || '1');
        bg = over(fade(fill, Number.isFinite(op) ? op : 1), bg);
      }
      return bg;
    };

    /**
     * Does this element's own `clip` / `clip-path` reduce it to zero area?
     *
     * `clip: rect(t, r, b, l)` applies only to absolutely positioned boxes and
     * is what the classic `.sr-only` recipe uses; `clip-path: inset(50%)` is
     * the modern spelling of the same trick. Either one at zero area means the
     * compositor draws nothing, so there is no painted ink to measure.
     */
    const clippedToNothing = (cs: CSSStyleDeclaration): boolean => {
      const clip = cs.clip;
      if (clip && clip !== 'auto') {
        const nums = clip.match(/-?[\d.]+/g)?.map(Number);
        if (nums && nums.length === 4) {
          // Tuple-typed: under `noUncheckedIndexedAccess` a plain destructure of
          // `number[]` yields `number | undefined` for each name, which fails
          // `tsc --noEmit` in the repos whose build typechecks the e2e tree.
          const [top, right, bottom, left] = nums as [number, number, number, number];
          if (bottom - top <= 0 || right - left <= 0) return true;
        }
      }
      // `inset(50%)` (and anything >= 50% on both axes) collapses to nothing.
      const path = cs.clipPath;
      if (path && path.startsWith('inset(')) {
        const pct = path.match(/([\d.]+)%/g)?.map((v) => parseFloat(v)) ?? [];
        if (pct.length && pct.every((v) => v >= 50)) return true;
      }
      return false;
    };

    const isVisible = (el: Element): boolean => {
      const cs = styleOf(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      // A closed <details> hides its body with `content-visibility: hidden`,
      // not `display: none`, and Chromium keeps the last laid-out geometry for
      // that subtree — so the `display`/rect tests above all pass for text
      // that paints nothing. `checkVisibility()` catches it. This page ships
      // two closed <details>, one per pinned transformation in Act IV
      // (`act4-attacks.ts:246`, driven by the two entries in
      // `src/data/pinned/attacks.json`), and each holds a provenance readout,
      // two headings and two full-text scrollers — several hundred characters
      // apiece that lay out and then paint nothing. The
      // gate opens them by clicking their <summary>, which is the route a
      // reader has, rather than setting `.open` from script — which is what
      // the gate this replaces did, to every <details> on the page, before its
      // only scan.
      if ((el as HTMLElement).checkVisibility?.() === false) return false;
      const r = rectOf(el);
      if (r.width <= 0 || r.height <= 0) return false;
      // Text parked off the left/top edge of the page paints no pixels. This is
      // the WCAG-sanctioned "visually hidden until focused" idiom: the shared
      // header's `.cl-skip-link` — the page's only one — parks at `top:-3rem`
      // and slides in only on focus. Measuring the parked copy invents a failure
      // for text that is not on screen; the focused rendering is a real state
      // and the gate scans it explicitly instead.
      // Document space, NOT viewport space. `getBoundingClientRect()` is
      // relative to the viewport, so after Playwright scrolls a control into
      // view every element ABOVE the viewport has `bottom <= 0` and this guard
      // silently dropped it from the walk. On a page taller than the viewport
      // that is most of the document, and it is why a green contrast run on a
      // long page could not be trusted. Adding the scroll offset restores the
      // original intent — text parked off the top/left of the DOCUMENT, the
      // "visually hidden until focused" idiom — without hiding the page.
      if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false;
      // Scrolled out of an `overflow: auto` container — clipped, not painted.
      if (clippedAway(el, r)) return false;
      // Clipped to nothing by the element's own `clip` / `clip-path`. This is
      // the OTHER WCAG-sanctioned visually-hidden idiom: `position: absolute;
      // width: 1px; height: 1px; clip: rect(0 0 0 0)` paints nothing at all —
      // the box has a rect and passes `checkVisibility()`, but the compositor
      // draws zero pixels of it — and its modern spelling `clip-path:
      // inset(50%)` does the same. Measuring either reports a ratio for ink
      // that was never laid down.
      //
      // This lab DOES use the idiom, and this guard is now load-bearing rather
      // than defensive. `.sr-only` (`src/style.css:66`: 1x1, `overflow:
      // hidden`, `clip-path: inset(50%)`) is applied by `dom.ts`'s `srOnly()`
      // helper and by hand in `index.html`, and the elements carrying it fall
      // into three kinds:
      //
      //   - announcers that speak what a visible region shows in a form worth
      //     hearing — the reset status in `index.html:217`, the depth switch's,
      //     the copy-link one, the hero sweep's and Act VII's;
      //   - names and descriptions for controls whose visible text is not
      //     enough on its own: the chapter chooser's label, the three
      //     `Show calculation` suffixes that tell one card's disclosure from
      //     another's, and the two `title`-replacing notes on Copy link and
      //     the global reset;
      //   - the `leads to` in `dom.ts:108`, which says out loud what the
      //     consequence line draws as an arrow.
      //
      // Every one of those paints zero pixels, so measuring any of them would
      // report a phantom ratio — and, worse, a FAILING one, since the idiom
      // sets no colours of its own and simply inherits whatever it sits in.
      // The visible live regions are still measured for real: the ten
      // `liveRegion(...)` readouts from `dom.ts` (detector results and the
      // recomputed statistics, the wrong-key distribution, corpus-scale
      // entropy, the attack sweep, both signature statuses, and the stripping
      // and regeneration results) and the four `.progress` paragraphs that
      // still carry `role="status"` — Act V's two and Act VII's two. The other
      // four `.progress` lines dropped their live semantics deliberately, so
      // that a chunked sweep announces twice rather than once per chunk; they
      // are plain visible text and this walk measures them like any other.
      //
      // It is deliberately narrow: only a ZERO-AREA clip qualifies, so a
      // partially clipped element is still measured, worst case.
      if (clippedToNothing(cs)) return false;
      return true;
    };

    const ownText = (el: Element): string => {
      let t = '';
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? '';
      }
      return t.trim();
    };

    const describe = (el: Element): string => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      const cls = el.getAttribute('class');
      if (cls) s += `.${cls.trim().split(/\s+/).join('.')}`;
      return s;
    };

    /**
     * WCAG 1.4.3 exempts text that is part of an *inactive* user-interface
     * component, and axe skips disabled controls for the same reason. Honour
     * that here so a deliberately dimmed disabled control is not reported as a
     * failure the spec does not actually require fixing.
     */
    const inactive = (el: Element): boolean => {
      let n: Element | null = el;
      while (n) {
        if ((n as HTMLInputElement).disabled === true) return true;
        if (n.getAttribute('aria-disabled') === 'true') return true;
        n = n.parentElement;
      }
      return false;
    };

    /**
     * `aria-hidden` text is removed from the accessibility tree, so axe's own
     * `color-contrast` rule skips it — and this arithmetic oracle exists to
     * catch what axe *misses* among exposed text (gradients, opacity), not to be
     * stricter than axe on decorative content. Honour the same boundary.
     *
     * The boundary cuts both ways and is a known gap: text that is
     * `aria-hidden` but still painted is skipped by BOTH oracles. So what this
     * lab hides was enumerated rather than assumed, and everything in it that
     * carries CHARACTERS is measured for real — see `includeAriaHidden` and the
     * `[aria-hidden="true"]` call in `gate.ts`'s `scan()`.
     *
     * The entire `aria-hidden` inventory of this page is three elements, and it
     * was enumerated by grepping `src/` and `index.html` for the attribute
     * rather than inferred. In app code there is exactly ONE: the
     * `.verdict .glyph` span emitted by `verdict()` (`src/ui/dom.ts:79`),
     * carrying `[+]` for evidence, `[ ]` for none, `[x]` for alarm and `[!]`
     * for caution. In the shared top bar there are two, both SVG and both
     * text-free: the Menu hamburger and the GitHub mark. The glyph duplicates
     * the `.label` word directly beside it, but it is painted in a SEMANTIC ink
     * (`--ok`, `--alarm`, `--warn`, or `--text-dim` for the neutral tone) on
     * its own `color-mix()` verdict tint, which is why `scan()` runs the whole
     * `aria-hidden` set through this walk with the exemption lifted rather than
     * arguing any of them is merely decorative.
     *
     * Nothing on this page hides a VALUE — re-checked against THIS lab's DOM,
     * not inherited from the lab this file was copied from. Every number the
     * lab produces stays in the accessibility tree: the detector score, its
     * p-value and threshold, the scored-position counts, the per-token mean
     * g-values, the entropy figures, the manifest and claim hashes and the
     * ECDSA verdicts are all rendered through `readout()`, `liveRegion()`, a
     * `<table>` cell, or the `.verdict .label` / `.detail` spans, none of which
     * are hidden. That matters because this is the shared blind spot where both
     * oracles stop looking, and it is the one place a live readout can hide
     * from a whole accessibility gate.
     */
    const ariaHidden = (el: Element): boolean => {
      if (allowAriaHidden) return false;
      let n: Element | null = el;
      while (n) {
        if (n.getAttribute('aria-hidden') === 'true') return true;
        n = n.parentElement;
      }
      return false;
    };

    /**
     * SVG renders character data only inside `<text>` / `<tspan>`. Text sitting
     * directly in a `<g>`, `<svg>` or shape element is in the DOM but paints
     * nothing, so it has no colour and no contrast requirement.
     *
     * This lab DOES own SVG text, so the positive half of this rule is live:
     * `src/ui/chart.ts` sets `textContent` only on nodes it created as `<text>`,
     * and those are measured for real, against `fill` rather than `color` (see
     * the `svgText` branch in the walk below). The guard covers the negative
     * half, and the usual way that mistake arrives is a template literal:
     * interpolating a string ARRAY into one makes JS join it with commas,
     * leaving a run of "," text nodes inside whatever element wraps it — and
     * inside a `<g>`, or directly under `<svg>`, those render nothing, while a
     * walk that measured them would report a 1:1 failure describing ink that
     * was never laid down. The shared header's two `aria-hidden` marks are the
     * other side of it: shapes only, no character data at all.
     * never laid down.
     */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const nonRenderingSvgText = (el: Element): boolean =>
      el.namespaceURI === SVG_NS && !['text', 'tspan'].includes(el.tagName.toLowerCase());

    /**
     * The CANVAS background — what is painted behind everything.
     *
     * The ancestor walk is geometry-aware, which is right for ordinary boxes: a
     * parent whose border box does not overlap the text paints nothing behind
     * it. Applied to the ROOT it is wrong, and wrong in the direction that
     * FABRICATES failures. CSS propagates the root element's background to the
     * canvas and paints it over the whole canvas regardless of the root's own
     * box (CSS Backgrounds 3, "The Canvas Background"); if the root's own
     * background is transparent the value is taken from `<body>` instead.
     *
     * The failure this prevents is not hypothetical — it cost a run elsewhere in
     * this fleet. A lab that sets `html, body { height: 100% }` has both boxes
     * exactly one viewport tall while the document runs several viewports long,
     * so every element below the fold intersects neither, the walk ends with a
     * transparent backdrop, and it falls through to WHITE. In a dark theme that
     * reports muted footer text against a white page that does not exist — 34 of
     * 38 findings in one run elsewhere in this fleet — and it can mask a real
     * failure in the other direction just as easily.
     *
     * Today it is close to a no-op here, and that was verified rather than
     * assumed: `src/style.css` paints a flat `background-color: var(--bg)`
     * LONGHAND on `html` (`style.css:28-30`) and again on `body`
     * (`style.css:32-38`), so the root resolves opaque on the first try and the
     * `<body>` fallback never runs. Both halves stay because either declaration
     * is one refactor away from vanishing, and because whether it is a no-op
     * depends on declarations that are easy to change and easy to miss: this
     * page runs nine sections and many screens deep, so the day a
     * `height: 100%` appears on `html` or `body`, everything below the first
     * screen would report against a white page that does not exist — in a lab
     * whose only canvas is `#0b0f14`.
     */
    const canvasBackground = ((): RGBA => {
      const rootCs = styleOf(document.documentElement);
      const rootRect = rectOf(document.documentElement);
      const rootPaint = paintAt(rootCs, rootRect, {
        x: rootRect.left + rootRect.width / 2,
        y: rootRect.top + rootRect.height / 2,
      });
      if (rootPaint.a > 0) return rootPaint;
      const body = document.body;
      if (!body) return TRANSPARENT;
      const bodyRect = rectOf(body);
      return paintAt(styleOf(body), bodyRect, {
        x: bodyRect.left + bodyRect.width / 2,
        y: bodyRect.top + bodyRect.height / 2,
      });
    })();

    const failures: unknown[] = [];
    for (const el of Array.from(document.querySelectorAll(rootSelector))) {
      const text = ownText(el);
      if (!text) continue;
      if (!isVisible(el)) continue;
      if (inactive(el)) continue;
      if (ariaHidden(el)) continue;
      if (nonRenderingSvgText(el)) continue;

      const cs = styleOf(el);
      // SVG text takes its ink from `fill`, not `color`. Reading `color` on an
      // SVG <text>
      // measures an inherited value the glyphs are not painted in.
      const svgText = el.namespaceURI === 'http://www.w3.org/2000/svg';
      const fgRaw = resolve(svgText ? cs.fill : cs.color);
      if (!fgRaw) continue;
      // `color: transparent` lays no ink down at all; compositing a zero-alpha
      // foreground just returns the backdrop and reports a fixed 1:1.
      if (fgRaw.a === 0) continue;

      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;

      // Carry (text, adjacent background) as a pair up the ancestor chain,
      // sampling each ancestor's own background at the text point beneath both
      // and applying that ancestor's opacity to both, exactly as the compositor
      // would. The point is the text box centre.
      const textBox = rectOf(el);
      const point: Point = {
        x: (textBox.left + textBox.right) / 2,
        y: (textBox.top + textBox.bottom) / 2,
      };
      // For SVG text the first thing beneath the glyphs is a sibling shape, not
      // an ancestor's background — see the header note on the SVG figures.
      let fg = fgRaw;
      let bg = svgText ? svgUnderlay(el, textBox) : TRANSPARENT;
      let node: Element | null = el;
      while (node) {
        const ncs = styleOf(node);
        const opacity = parseFloat(ncs.opacity);
        // An ancestor that does not overlap the text paints nothing behind it.
        const paint =
          node === el || intersects(textBox, rectOf(node))
            ? paintAt(ncs, rectOf(node), point)
            : TRANSPARENT;
        fg = fade(over(fg, paint), opacity);
        bg = fade(over(bg, paint), opacity);
        // Stop once the accumulated backdrop is fully opaque: nothing further
        // out can change the painted result.
        if (bg.a >= 1) break;
        node = node.parentElement;
      }

      const fgFinal = over(over(fg, canvasBackground), WHITE);
      const bgFinal = over(over(bg, canvasBackground), WHITE);
      const worst = { r: ratio(fgFinal, bgFinal), fg: fgFinal, bg: bgFinal };

      // Round to 2dp before comparing so a value that is exactly on the floor
      // (e.g. 4.50) is not failed by float noise, and one just under it is not
      // rounded up into a pass.
      const rounded = Math.round(worst.r * 100) / 100;
      if (rounded >= required) continue;

      const show = (c: RGBA): string =>
        `rgb(${[c.r, c.g, c.b].map((v) => Math.round(v)).join(', ')})`;

      failures.push({
        selector: describe(el),
        text: text.slice(0, 60),
        foreground: show(worst.fg),
        background: show(worst.bg),
        fontSize: size,
        fontWeight: weight,
        required,
        ratio: rounded,
      });
    }
    return failures as never;
  }, [within, includeAriaHidden] as [string, boolean]);
}

/** Render failures as short strings so an assertion diff is readable. */
export function formatContrastFailures(failures: ContrastFailure[]): string[] {
  return failures.map(
    (f) =>
      `${f.ratio}:1 (needs ${f.required}:1) ${f.selector} — fg ${f.foreground} on ${f.background} — "${f.text}"`
  );
}
