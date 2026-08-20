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
 * So the guard owns four things a caller keeps forgetting: the control is re-enabled on
 * the failing path as well as the succeeding one, the region carries `aria-busy` for
 * exactly as long as the work runs, a throw is rendered as something a reader can act on
 * rather than swallowed, and the keyboard gets its place back — disabling the button that
 * is holding focus drops the reader on `<body>`, which is the middle of nowhere. The busy
 * signal is text, not a spinner, because a spinner is invisible to a screen reader and to
 * a contrast oracle alike.
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
  /**
   * Runs once the controls have been restored, on every path out of the run — including
   * the retry below, which calls back into the guard without passing through whatever
   * wrapper the caller wrote. A caller whose controls depend on what the run decided
   * settles them here rather than after its own `await`, because that `await` is the one
   * line the retry never reaches.
   */
  readonly onSettled?: () => void;
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

/**
 * The notice claims nothing about what the failed attempt left behind, because the guard
 * cannot know: an action is free to write its own state before the await that throws — Act
 * V's tamper does exactly that, replacing the asset bytes and the text in the box before
 * the validation it is waiting on fails. So the notice says what the panel is showing and
 * where the two ways back are, both of which are true of every action this guard runs.
 */
function renderRecovery(
  region: HTMLElement,
  error: unknown,
  retry: (from: HTMLElement) => void,
): HTMLElement {
  // The retry hands its own node back to the run it starts. Retrying empties this region
  // first, which takes the focused button out of the document before the new run can read
  // where the keyboard was — so the run is told, rather than left to look.
  const again: HTMLButtonElement = button('Try again', () => retry(again));
  // The half-built panel is worse than an empty one: it reads as a result. Replace it.
  clear(region);
  region.append(
    verdict(
      'alarm',
      'This run did not finish',
      `${describe(error)} This panel is showing an error, not a result — press Try again, `
      + 'or use the reset beside this experiment to return it to a known state.',
    ),
    el('div', { class: 'controls' }, [again]),
  );
  return again;
}

function isDisabled(node: HTMLElement): boolean {
  return disableable(node) && node.disabled;
}

/**
 * Put the keyboard back where it was, or somewhere it can carry on from.
 *
 * A run that nobody started from the keyboard — the render-time pass every act makes on
 * load — has no focus to restore, and taking one would scroll the page to a panel the
 * reader has not asked for, so those runs are left alone. Everything else is a control the
 * reader pressed, and the guard switched it off underneath them.
 *
 * Deferred by a turn of the event loop so it lands after `onSettled` has decided which
 * controls are available: the button that was pressed may be the one the run just made
 * meaningless, and focus has to go to a control that still works.
 */
function restoreFocus(
  returnTo: Element | null,
  recovery: HTMLElement | null,
  options: GuardOptions,
): void {
  if (!(returnTo instanceof HTMLElement) || returnTo === document.body) return;
  window.setTimeout(() => {
    // Anything that took focus in the meantime — a reader who tabbed on, an action that
    // moved it deliberately — outranks a restoration of where they used to be.
    if (document.activeElement !== document.body) return;
    const usable = (node: HTMLElement): boolean => node.isConnected && !isDisabled(node);
    // A failed run has somewhere specific to send them: the retry is the next step, and on
    // a second failure it is a freshly built button the old focus target no longer names.
    const target = recovery?.isConnected === true ? recovery
      : usable(returnTo) ? returnTo
      : (options.controls ?? []).find(usable) ?? options.region;
    target?.focus();
  }, 0);
}

export async function runGuarded(
  action: () => Promise<void> | void,
  options: GuardOptions,
): Promise<void> {
  // Read before anything is switched off: disabling a focused control is what sends the
  // reader to <body>, so by the time the run ends the answer has already been destroyed.
  return guarded(action, options, document.activeElement);
}

async function guarded(
  action: () => Promise<void> | void,
  options: GuardOptions,
  returnTo: Element | null,
): Promise<void> {
  const controls = options.controls ?? [];
  // Remember what was already disabled, so a control another panel had deliberately
  // switched off is not switched back on as a side effect of this run finishing.
  const restore = controls.map((node) => (disableable(node) ? node.disabled : true));
  for (const node of controls) if (disableable(node)) node.disabled = true;
  options.region?.setAttribute('aria-busy', 'true');
  if (options.progress) options.progress.textContent = options.busyText ?? 'Working…';

  let recovery: HTMLElement | null = null;
  try {
    await action();
  } catch (error) {
    options.onError?.(error);
    const region = options.region;
    if (region) {
      // The retry clears the failure notice before running: a second attempt that succeeds
      // must not leave the page still saying the first one failed.
      recovery = renderRecovery(region, error, (from) => {
        clear(region);
        void guarded(action, options, from);
      });
    }
  } finally {
    controls.forEach((node, index) => {
      if (disableable(node)) node.disabled = restore[index] ?? false;
    });
    options.region?.removeAttribute('aria-busy');
    if (options.progress) options.progress.textContent = '';
    options.onSettled?.();
    restoreFocus(returnTo, recovery, options);
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
