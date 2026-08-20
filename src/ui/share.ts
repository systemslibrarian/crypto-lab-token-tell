/**
 * Copy the link to what is currently on screen.
 *
 * The address bar is already a working deep link — the mode is written into it on every
 * change and the chapter control keeps the anchor current — so sharing is a copy, not a
 * link builder. What it must not do is fail silently: `navigator.clipboard` is absent
 * outside a secure context and rejects without a user gesture or a permission, and an
 * unhandled rejection from a copy button is both a broken affordance and a console error
 * the accessibility gate treats as a failed run.
 *
 * So the failure path is a real one rather than an apology: the link is rendered as
 * selectable text the reader can copy by hand. Either way the outcome is stated in words
 * through a polite live region, because a button that changes colour for a second is not
 * a confirmation.
 */

import { button, el } from './dom.ts';

const LINK_ID = 'share-link';
const REVERT_MS = 4000;

function currentLink(): string {
  return window.location.href;
}

export function renderShareControl(): HTMLElement {
  const status = el('p', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
  });
  const fallback = el('div', { class: 'share-fallback' });
  let timer = 0;

  const revert = (label: string): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      copy.textContent = label;
      status.textContent = '';
    }, REVERT_MS);
  };

  const showFallback = (): void => {
    while (fallback.firstChild) fallback.removeChild(fallback.firstChild);
    const input = el('input', {
      id: LINK_ID,
      type: 'text',
      class: 'share-link',
      readonly: '',
      value: currentLink(),
    });
    fallback.append(
      el('label', { class: 'sr-only', for: LINK_ID, text: 'Link to this view' }),
      input,
    );
    input.select();
  };

  const onCopy = (): void => {
    const link = currentLink();
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      copy.textContent = 'Copy this link';
      status.textContent = 'This browser would not give the page the clipboard. The link is '
        + 'selected below, ready to copy.';
      showFallback();
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        while (fallback.firstChild) fallback.removeChild(fallback.firstChild);
        copy.textContent = 'Link copied';
        status.textContent = 'Link copied.';
        revert('Copy link');
      },
      () => {
        // Deliberately not console.error: a refused clipboard is an expected outcome,
        // and it is answered on the page rather than in the developer tools.
        copy.textContent = 'Copy this link';
        status.textContent = 'The clipboard was refused. The link is selected below, ready '
          + 'to copy.';
        showFallback();
      },
    );
  };

  const copy = button('Copy link', onCopy);
  copy.classList.add('share-button');
  copy.title = 'Copies the address of this view, including the depth and the section.';

  return el('div', { class: 'share-control' }, [copy, fallback, status]);
}
