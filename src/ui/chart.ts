/**
 * Small inline SVG charts.
 *
 * Drawn rather than imported so nothing on this page depends on a chart library reading
 * the numbers correctly. Every chart carries a text alternative that states the same
 * facts, because a picture of a distribution is not accessible on its own.
 */

import { el, fixed } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export interface HistogramOptions {
  readonly values: number[];
  readonly marker: { value: number; label: string } | null;
  readonly secondaryMarker?: { value: number; label: string } | null;
  readonly binCount?: number;
  readonly title: string;
  readonly xLabel: string;
}

/** A histogram of null scores with the observed score marked on the same axis. */
export function histogram(options: HistogramOptions): HTMLElement {
  const { values, marker, secondaryMarker } = options;
  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 16, bottom: 42, left: 46 };

  const candidates = [...values];
  if (marker) candidates.push(marker.value);
  if (secondaryMarker) candidates.push(secondaryMarker.value);
  const rawMin = Math.min(...candidates);
  const rawMax = Math.max(...candidates);
  const span = Math.max(rawMax - rawMin, 0.01);
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const binCount = options.binCount ?? 24;
  const bins = new Array(binCount).fill(0);
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor(((value - min) / (max - min)) * binCount));
    bins[index] += 1;
  }
  const peak = Math.max(1, ...bins);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xOf = (value: number) => padding.left + ((value - min) / (max - min)) * plotWidth;

  // The figcaption below states the same facts in text, so labelling the drawing too
  // would announce the sentence twice. The caption is the accessible version.
  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  bins.forEach((count, index) => {
    if (!count) return;
    const barWidth = plotWidth / binCount;
    const barHeight = (count / peak) * plotHeight;
    svg.append(svgEl('rect', {
      class: 'bar',
      x: String(padding.left + index * barWidth + 0.5),
      y: String(padding.top + plotHeight - barHeight),
      width: String(Math.max(1, barWidth - 1)),
      height: String(barHeight),
    }));
  });

  svg.append(svgEl('line', {
    class: 'axis',
    x1: String(padding.left), y1: String(padding.top + plotHeight),
    x2: String(padding.left + plotWidth), y2: String(padding.top + plotHeight),
  }));

  for (const tick of [min, (min + max) / 2, max]) {
    const x = xOf(tick);
    const label = svgEl('text', {
      x: String(x), y: String(height - 24), 'text-anchor': 'middle',
    });
    label.textContent = fixed(tick, 3);
    svg.append(label);
  }

  const axisLabel = svgEl('text', {
    x: String(padding.left + plotWidth / 2), y: String(height - 8), 'text-anchor': 'middle',
  });
  axisLabel.textContent = options.xLabel;
  svg.append(axisLabel);

  const yLabel = svgEl('text', {
    x: '12', y: String(padding.top + 8), 'text-anchor': 'start',
  });
  yLabel.textContent = `n=${values.length}`;
  svg.append(yLabel);

  const drawMarker = (value: number, label: string, className: string) => {
    const x = xOf(value);
    svg.append(svgEl('line', {
      class: className,
      x1: String(x), y1: String(padding.top - 6),
      x2: String(x), y2: String(padding.top + plotHeight),
    }));
    const text = svgEl('text', {
      x: String(Math.min(x + 4, width - 4)),
      y: String(padding.top - 8),
      'text-anchor': x > width * 0.7 ? 'end' : 'start',
    });
    text.textContent = label;
    svg.append(text);
  };

  if (secondaryMarker) drawMarker(secondaryMarker.value, secondaryMarker.label, 'marker-alt');
  if (marker) drawMarker(marker.value, marker.label, 'marker');

  return el('figure', { style: 'margin:0' }, [
    svg as unknown as Node,
    el('figcaption', { class: 'note', text: describeHistogram(options) }),
  ]);
}

function describeHistogram(options: HistogramOptions): string {
  const { values, marker } = options;
  if (!values.length) return `${options.title}: no samples yet.`;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const parts = [
    `${options.title}: ${values.length} values ranging ${fixed(sorted[0])} to ` +
    `${fixed(sorted[sorted.length - 1])}, mean ${fixed(mean)}.`,
  ];
  if (marker) {
    const above = values.filter((value) => value >= marker.value).length;
    parts.push(`${marker.label} sits at ${fixed(marker.value)}, with ${above} of ` +
      `${values.length} null values at or above it.`);
  }
  return parts.join(' ');
}

export interface LineChartSeries {
  readonly label: string;
  readonly className: string;
  readonly points: { x: number; y: number }[];
}

export interface LineChartOptions {
  readonly series: LineChartSeries[];
  readonly band?: { x: number; low: number; high: number }[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly title: string;
  readonly description: string;
}

/** A line chart on a linear x axis, used for score against text length. */
export function lineChart(options: LineChartOptions): HTMLElement {
  const width = 680;
  const height = 260;
  const padding = { top: 20, right: 18, bottom: 46, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allPoints = options.series.flatMap((series) => series.points);
  const bandPoints = (options.band ?? []).flatMap((b) => [
    { x: b.x, y: b.low }, { x: b.x, y: b.high },
  ]);
  const xs = [...allPoints, ...bandPoints].map((p) => p.x);
  const ys = [...allPoints, ...bandPoints].map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) - 0.01;
  const yMax = Math.max(...ys) + 0.01;

  const xOf = (x: number) => padding.left + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * plotWidth;
  const yOf = (y: number) =>
    padding.top + plotHeight - ((y - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;

  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  if (options.band?.length) {
    const upper = options.band.map((b) => `${xOf(b.x)},${yOf(b.high)}`).join(' ');
    const lower = [...options.band].reverse().map((b) => `${xOf(b.x)},${yOf(b.low)}`).join(' ');
    svg.append(svgEl('polygon', { class: 'band', points: `${upper} ${lower}` }));
  }

  for (const series of options.series) {
    if (!series.points.length) continue;
    svg.append(svgEl('polyline', {
      class: series.className,
      points: series.points.map((p) => `${xOf(p.x)},${yOf(p.y)}`).join(' '),
    }));
    for (const point of series.points) {
      svg.append(svgEl('circle', {
        class: 'point', cx: String(xOf(point.x)), cy: String(yOf(point.y)), r: '2.5',
      }));
    }
  }

  svg.append(svgEl('line', {
    class: 'axis',
    x1: String(padding.left), y1: String(padding.top + plotHeight),
    x2: String(padding.left + plotWidth), y2: String(padding.top + plotHeight),
  }));
  svg.append(svgEl('line', {
    class: 'axis',
    x1: String(padding.left), y1: String(padding.top),
    x2: String(padding.left), y2: String(padding.top + plotHeight),
  }));

  for (const x of [xMin, (xMin + xMax) / 2, xMax]) {
    const text = svgEl('text', {
      x: String(xOf(x)), y: String(height - 26), 'text-anchor': 'middle',
    });
    text.textContent = String(Math.round(x));
    svg.append(text);
  }
  for (const y of [yMin, (yMin + yMax) / 2, yMax]) {
    const text = svgEl('text', {
      x: String(padding.left - 6), y: String(yOf(y) + 3), 'text-anchor': 'end',
    });
    text.textContent = fixed(y, 3);
    svg.append(text);
  }

  const xTitle = svgEl('text', {
    x: String(padding.left + plotWidth / 2), y: String(height - 8), 'text-anchor': 'middle',
  });
  xTitle.textContent = options.xLabel;
  svg.append(xTitle);

  const yTitle = svgEl('text', { x: '10', y: String(padding.top - 6), 'text-anchor': 'start' });
  yTitle.textContent = options.yLabel;
  svg.append(yTitle);

  return el('figure', { style: 'margin:0' }, [
    svg as unknown as Node,
    el('figcaption', { class: 'note', text: options.description }),
  ]);
}
