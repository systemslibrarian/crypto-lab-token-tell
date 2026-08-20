/**
 * The guard every asynchronous experiment runs behind.
 *
 * Each long run on this page was written as `disable the button, do the work, enable the
 * button`, which is correct exactly until the work throws. WebCrypto really can reject:
 * `crypto.subtle` is undefined outside a secure context, so a lab opened over plain HTTP
 * on a conference network loses the whole signing half of the page — and without a guard
 * the only trace is a permanently disabled control beside a half-written panel. That is
 * the state a presenter cannot recover from without reloading, which is the one thing the
 * demo route promises never to need.
 *
 * So the guard owns three things a caller keeps forgetting: the control is re-enabled on
 * the failing path as well as the succeeding one, the region carries `aria-busy` for
 * exactly as long as the work runs, and a throw is rendered as something a reader can act
 * on rather than swallowed. The busy signal is text, not a spinner, because a spinner is
 * invisible to a screen reader and to a contrast oracle alike.
 */

import { button, clear, el, verdict } from './dom.ts';

export interface GuardOptions {
  /** Disabled for the duration, and restored to whatever they were before it started. */
  readonly controls?: HTMLElement[];
  /** Carries aria-busy while the work runs, and the recovery block if it throws. */
  readonly region?: HTMLElement;
  /** Carries the visible busy text, and is emptied when the work settles. */
  readonly progress?: HTMLElement;
  readonly busyText?: string;
  readonly onError?: (error: unknown) => void;
}

type Disableable = HTMLElement & { disabled: boolean };

function disableable(node: HTMLElement): node is Disableable {
  return 'disabled' in node;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error);
  return text === '[object Object]' ? 'The browser gave no reason.' : text;
}

function renderRecovery(region: HTMLElement, error: unknown, retry: () => void): void {
  // The half-built panel is worse than an empty one: it reads as a result. Replace it.
  clear(region);
  region.append(
    verdict(
      'alarm',
      'This run did not finish',
      `${describe(error)} Nothing on the page was changed by the attempt.`,
    ),
    el('div', { class: 'controls' }, [button('Try again', retry)]),
  );
}

export async function runGuarded(
  action: () => Promise<void> | void,
  options: GuardOptions,
): Promise<void> {
  const controls = options.controls ?? [];
  // Remember what was already disabled, so a control another panel had deliberately
  // switched off is not switched back on as a side effect of this run finishing.
  const restore = controls.map((node) => (disableable(node) ? node.disabled : true));
  for (const node of controls) if (disableable(node)) node.disabled = true;
  options.region?.setAttribute('aria-busy', 'true');
  if (options.progress) options.progress.textContent = options.busyText ?? 'Working…';

  try {
    await action();
  } catch (error) {
    options.onError?.(error);
    const region = options.region;
    if (region) {
      // The retry clears the failure notice before running: a second attempt that succeeds
      // must not leave the page still saying the first one failed.
      renderRecovery(region, error, () => {
        clear(region);
        void runGuarded(action, options);
      });
    }
  } finally {
    controls.forEach((node, index) => {
      if (disableable(node)) node.disabled = restore[index] ?? false;
    });
    options.region?.removeAttribute('aria-busy');
    if (options.progress) options.progress.textContent = '';
  }
}

/**
 * A reset beside every mutable experiment. Presenters tamper with this page on purpose;
 * the way back has to be one control away rather than a reload, because a reload also
 * discards the mode, the anchor and the scroll position the audience was looking at.
 */
export function resetButton(label: string, onReset: () => void): HTMLButtonElement {
  const node = button(label, onReset);
  node.classList.add('reset-control');
  return node;
}
