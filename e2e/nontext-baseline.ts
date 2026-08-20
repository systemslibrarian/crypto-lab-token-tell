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
 * IT IS EMPTY BECAUSE NOTHING WAS FOUND. That is a different statement from
 * the one that stood here while it had never been captured, and it is still not
 * a clean bill of health in perpetuity — it is a fact about the stylesheet as
 * it stands. `auditNonText` runs from inside `scan()` rather than from a
 * logging wrapper, so it judged every state `driveAllStates` reaches, at both
 * depths and both viewports: arrival and the staged reveal; the depth control
 * focused, hovered and pressed in both directions; the chapter control, which
 * is the link row at 1280 and the chooser with its two step buttons at 380,
 * each end of its range disabled in turn; the three calculation trails open at
 * once; the digests revealed and the clipboard refused; the wrong-key sweep
 * busy and settled; Act V's mutation controls disabled with no manifest to
 * break; the corpus and attack sweeps; the mechanism control at each of its
 * four settings; and a browser that gives the page no WebCrypto. Both runs
 * passed with this file empty.
 *
 * That covers every control this lab paints: `button` and `button.primary`, the
 * two segmented controls, `select` (which carries `appearance: none` and two
 * `linear-gradient()` arrow sprites in its own fill), the three textareas, the
 * share, copy and reset controls, and the shared top bar's two
 * `<a class="cl-btn">` links. `input[type="range"]` declares `border: none;
 * background: transparent` and so never reaches the judged set. Their edges
 * come from `--border-control`, from `--accent` on the primary and hover
 * states, and from `--cl-ink` on the top bar.
 *
 * So the file stays, and stays empty. The first control that fails 1.4.11 fails
 * the run, and the answer is to fix `src/style.css` and leave this empty rather
 * than to write the finding down here. A run with `NT_BASELINE_CAPTURE=1` set
 * prints every finding through this same path and asserts nothing, which is how
 * this file would be regenerated if that ever became necessary — and the third
 * rule above is what would then make the list shrink again.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
