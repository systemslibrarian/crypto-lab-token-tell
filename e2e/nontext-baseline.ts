/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * IT IS EMPTY BECAUSE IT HAS NOT BEEN CAPTURED YET FOR THIS LAB — this is a
 * starting state, not the terminal one, and it must not be read as a clean bill
 * of health. The file arrived with the rest of the gate from another lab in
 * this fleet; that lab's entries were DELETED rather than copied, because a
 * baseline naming selectors this repo does not have fails
 * `expectBaselineNotStale()` on every run by the third rule above. Nothing here
 * has been measured against Token Tell's own DOM.
 *
 * Capture it, then read the result against what this lab actually paints: the
 * judged controls are `button` and `button.primary`, `select` (which carries
 * `appearance: none` and two `linear-gradient()` arrow sprites in its own
 * fill), `textarea`, and the shared top bar's two `<a class="cl-btn">` links.
 * `input[type="range"]` declares `border: none; background: transparent` and so
 * never reaches the judged set. Their edges come from `--border-control`, from
 * `--accent` on the primary and hover states, and from `--cl-ink` on the top
 * bar.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this
 * same path and asserts nothing, which is how this file is regenerated. Fix
 * what it prints in `src/style.css` wherever you can and list only what you
 * cannot — the third rule above is what makes the list shrink.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
