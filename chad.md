# Token Tell: the 10/10 demo plan

Audit date: 2026-08-19

## Executive verdict

Token Tell is already a high-end technical lab. The cryptography is real, the limits are
stated honestly, the claims are independently checked, and the core idea is important.
The gap is not more rigor. The gap is staging.

Right now the page asks a first-time visitor to consume the lab in the same shape an expert
would audit it. A 10/10 demo should expose the conclusion in 20 seconds, prove it in 90
seconds, and then let an expert descend into every calculation.

My target experience would be:

1. **See the claim:** same bytes, different key, different watermark verdict.
2. **Run the proof:** one obvious action produces the three outcomes.
3. **Feel the contrast:** sign those bytes, change one byte, then remove the manifest.
4. **Land the lesson:** neither mechanism proves authorship or truth.
5. **Inspect everything:** expand the math, vectors, attacks, provenance, and limitations.

That means building a short **Demo route** over the existing **Full lab**, not deleting the
full lab or weakening its evidence.

## What is already excellent

- The thesis is precise and socially consequential. The schools, courts, and newsrooms
  framing gives the work stakes without sensationalizing it.
- The hero experiment uses byte-identical input, prints the hashes, changes only the key,
  and includes an unwatermarked control. That is the right experiment.
- The app runs the actual detector and real WebCrypto ECDSA rather than animating canned
  answers.
- The distinction between symmetric-secret watermark verification and asymmetric-public
  signature verification is unusually clear.
- The app labels paper-faithful, reference-faithful, pinned, and demo-simplified material.
- The claims suite checks what the page says, not merely whether components mounted.
- The project has an independent verifier and differential vectors from both published
  implementations.
- The limitations are not buried in legal copy. The page admits that its C2PA manifest is
  shaped rather than conformant and that a signature can authenticate a lie.
- Accessibility has clearly been treated as engineering, including contrast arithmetic,
  live regions, keyboard-visible focus, a skip link, and text alongside color.

These are the hard parts. I would preserve all of them.

## What the rendered app revealed

This audit inspected the local app in a real browser, not only the source.

| View | Observation | Why it matters |
| --- | --- | --- |
| 1052 x 923 desktop | The document was 27,445 px tall. Act VII began around 19,917 px. | The conceptual payoff is about 22 viewports away. |
| 1052 x 923 desktop | The first actionable control was around 3,607 px down. | The page explains before it lets the visitor do. |
| 1052 px desktop | Values in the three hero score cards wrapped one character per line. | The most important result becomes visually broken at a normal laptop width. |
| 1440 x 900 desktop | The cards were 384 px wide, but `Binomial(...)` and the p-value still wrapped awkwardly. | This is a content hierarchy problem, not only a narrow breakpoint problem. |
| 390 x 844 mobile | The document grew to 58,185 px. The experiment started around 1,326 px. | Mobile visitors spend more than a viewport reaching the proof. |
| 390 x 844 mobile | The section chip cloud was 322 px tall. | Navigation displaces the thing it is meant to navigate to. |
| 390 x 844 mobile | A large blank gap appeared between the hero description and the why-it-matters panel. | The desktop flex basis becomes vertical space after the layout switches to a column. |

The current smoke test deliberately avoids screenshots. That explains how a page can pass
functional and accessibility gates while the hero's values render vertically.

## The product decision: Demo mode and Lab mode

I would add a compact segmented control near the title:

- **Demo**: the 90-second path, selected by default for new visitors.
- **Full lab**: today's complete sequence, with every act and reference panel.

This is progressive disclosure without a modal, tutorial overlay, or explanatory video.
The first fold already explains the problem well. It needs a direct action and a shorter
route, not another layer of prose.

The Demo route should contain only these beats:

1. Same bytes, correct key versus wrong key versus control.
2. Sign the same bytes, flip one byte, strip the manifest.
3. Sign a false statement and watch verification pass.
4. Show the three-mechanism comparison with **Who can verify?** emphasized.
5. Offer clear branches into detector internals, entropy, attacks, math, and sources.

The Full lab should keep the current Act I through Act VII structure.

## P0: fix the hero before adding anything

### 1. Turn the three score cards into result cards

The hero currently makes every audit field compete with the verdict. Each card should show:

- the scenario name;
- a large verdict;
- mean score;
- threshold;
- exact p-value;
- one sentence explaining what changed;
- **Show calculation** disclosure for all remaining metrics and caveats.

Keep the hashes directly above the cards, but compress them to one strong statement:
`Runs 1 and 2: same SHA-256` with a copy/reveal affordance for the full digest.

The visual comparison should read instantly:

| Correct key | Wrong key, same bytes | Control |
| --- | --- | --- |
| Evidence | No evidence | No evidence |
| 0.5975 | 0.5030 | 0.4970 |
| Same input hash as center | Same input hash as left | Different input |

Files: [src/ui/hero-experiment.ts](src/ui/hero-experiment.ts),
[src/ui/score-card.ts](src/ui/score-card.ts), and [src/style.css](src/style.css).

### 2. Fix the score-card responsive contract

Do not allow three dense definition lists to auto-fit into cards around 300-380 px wide.
Use one of these contracts:

- summary cards stay three-up at wide desktop and become one-up below about 900 px; or
- summary cards remain three-up, while calculation detail spans the full width below them.

Definition values need a useful minimum such as `minmax(8ch, auto)`. Long math expressions
should wrap at semantic boundaries or occupy a full-width row, never one character per line.

### 3. Remove the mobile hero spacer

When `.cl-hero` changes to `flex-direction: column`, reset `.cl-hero-main` from its desktop
`flex: 1 1 22rem` sizing to `flex: 0 1 auto`. In the column direction, that basis creates
vertical space instead of width.

### 4. Replace the mobile chip cloud

At mobile sizes, replace the nine stacked section chips with one compact chapter selector
and previous/next controls. On desktop, keep a compact sticky chapter control with the
current section highlighted. Do not make the full two-row chip cloud sticky.

## P1: stage the 90-second proof

### 1. Put one real action in the first viewport

Add a primary **Run the proof** button below the thesis. It should scroll to the summary
cards and replay their result reveal. The computation stays real; the animation only stages
when the already-computed result becomes visible.

The reveal order should be:

1. Lock the hash for runs 1 and 2.
2. Show the correct-key verdict.
3. Change only the key.
4. Show the evidence disappear.
5. Reveal the unwatermarked control.

This is the page's visual asset. It should be the memorable visual, not generic crypto art.

### 2. Move the comparison into the short route

The **Who can verify?** row is the load-bearing claim, but it currently arrives after about
20,000 px of desktop scrolling. In Demo mode, show a four-row comparison:

- who can verify;
- statistical or binary;
- survives metadata removal;
- proves factual truth.

The complete ten-row table remains in Full lab.

### 3. Make Act VII's disclosure compact

Ten dedicated `Why?` rows nearly double the table height. Make the question itself the
disclosure trigger, use an adjacent chevron icon, and expand one full-width explanation
only when requested.

At mobile widths, the existing focus buttons should become a true segmented control that
shows one mechanism column at a time. Tinting one of four horizontally scrolling columns
does not meaningfully focus it on a phone.

File: [src/ui/act7-compare.ts](src/ui/act7-compare.ts).

### 4. End every short-route beat with a consequence

Use one line, not another card:

- **Changed only the secret -> the watermark verdict disappeared.**
- **Changed one byte -> integrity verification failed.**
- **Removed the manifest -> there was nothing left to verify.**
- **Signed a lie -> integrity passed; truth remained unanswered.**

This gives each interaction closure and makes the final comparison feel earned.

## P1: make demo state impossible to derail

The app is deterministic, which is excellent, but a presenter can leave an act in a
tampered or stripped state. Add:

- **Reset act** beside mutable experiments;
- one global reset icon with a clear tooltip;
- disabled mutation controls until signing completes;
- `aria-busy` and visible busy text during WebCrypto work;
- user-facing recovery if WebCrypto or an async calculation throws;
- deep links that preserve act, sample, and selected scenario.

A presenter should be able to open links such as `?mode=demo#sign` and know exactly what
state the audience will see.

Files: [src/ui/act5-sign.ts](src/ui/act5-sign.ts), [src/main.ts](src/main.ts), and the shared
DOM helpers in [src/ui/dom.ts](src/ui/dom.ts).

## P2: visual and sharing polish

### Keep the visual language, improve hierarchy

I would not rebrand this into a glossy landing page. The quiet lab aesthetic is right.
I would make these focused changes:

- use the sans face for explanation and labels, and reserve monospace for tokens, hashes,
  statistics, and provenance tags;
- increase the visual difference between verdict, decisive metric, and audit detail;
- reduce repeated thesis strips once Demo mode establishes the claim;
- give every act one dominant result instead of several equal-weight panels;
- use charts as explanatory figures with a one-sentence takeaway above them;
- keep green, yellow, and pink semantic colors, but reduce decorative purple borders around
  low-priority containers.

### Make links look finished

The page has Open Graph text but no preview image. Add:

- a 1200 x 630 social image showing the three verdicts;
- `og:image`, `og:image:alt`, and a `summary_large_image` Twitter card;
- a stable non-emoji favicon and app icon;
- a short share action that copies the current deep link.

Files: [index.html](index.html), [public](public), and [public/manifest.webmanifest](public/manifest.webmanifest).

## Testing required for 10/10

Keep all current correctness, claims, verification, and accessibility gates. Add a small
visual contract suite because the existing tests cannot see the hero failure.

### Required viewports

- 390 x 844 phone;
- 768 x 1024 tablet;
- 1052 x 923 laptop, because this exposed the card failure;
- 1440 x 900 presentation desktop.

### Required visual assertions

- first viewport has no accidental blank region;
- `Run the proof` is visible without scrolling on desktop and phone;
- no score value renders narrower than 8 characters;
- summary cards never wrap values character by character;
- the mobile chapter control stays under 56 px tall;
- the comparison has no page-level horizontal overflow;
- sticky controls never cover a heading or result;
- focus, busy, error, tampered, stripped, and reset states all have screenshots;
- reduced-motion mode shows the final result without depending on animation.

Add focused screenshots for the hero summary, signing experiment, and comparison rather
than snapshotting the entire 27,000-58,000 px document.

Files: [e2e/smoke.spec.ts](e2e/smoke.spec.ts), [playwright.config.ts](playwright.config.ts),
and a focused visual spec under [e2e](e2e).

## The demo script I would design for

### 0:00 - Hook

"These two runs receive the exact same bytes. I am changing only the detector key."

Press **Run the proof**. Show evidence under the configured key, then no evidence under the
wrong key. Point to the unchanged digest.

### 0:25 - Contrast

"Now I will sign those same bytes. This is a different kind of claim."

Sign, flip one byte, and show the hard binding fail. Reset, strip the manifest, and show
that the asset is unchanged but nothing remains to verify.

### 0:55 - Boundary

Sign the false 1687 statement. Let the red "verification passed" result do the work.

"A signature proves integrity relative to a key. It is not a fact-check."

### 1:15 - Payoff

Show the compact comparison and emphasize:

- watermark verification needs the secret configuration;
- signature verification uses the public key;
- watermark evidence is statistical;
- integrity is binary;
- neither mechanism proves that a statement is true.

### 1:40 - Choose the depth

Offer three branches based on the audience:

- **How does the hidden token choice work?** -> tournament sampling.
- **How robust is it?** -> entropy and attacks.
- **Can I verify the claims?** -> vectors, math, manifest, and independent verifier.

## Implementation order

### Day 1: remove visible failure

- Fix hero card layout and mobile flex sizing.
- Split result summaries from calculation details.
- Add 390, 1052, and 1440 visual regression coverage.

### Day 2: build the short route

- Add Demo / Full lab mode.
- Add Run the proof and a compact chapter control.
- Place signing, signed lie, and the four-row comparison in Demo mode.

### Day 3: presentation reliability

- Add reset, busy, disabled, and error states.
- Add deterministic deep links for key demo beats.
- Test the full script by keyboard, touch, and projector-sized viewport.

### Day 4: finish

- Make the Act VII comparison responsive.
- Add the social preview and stable icons.
- Tighten typography and repeated copy.
- Run every unit, verifier, manifest, claims, accessibility, and visual gate.

## What I would not do

- I would not add another act.
- I would not lead with a modal or a tutorial video.
- I would not replace the evidence with a canned animation.
- I would not hide the C2PA qualification or the implementation divergence.
- I would not turn the page into marketing cards, generic crypto imagery, or decorative 3D.
- I would not remove the full calculation trail to make the page shorter.
- I would not claim that the watermark or signature establishes human authorship or truth.

## Definition of done

This is a 10/10 demo when a new visitor can:

- state the difference between watermark evidence and signature integrity after 90 seconds;
- run the central proof from the first viewport;
- reach any demo beat in one action;
- reset every experiment without reloading;
- use the comparison comfortably on a phone;
- inspect every number and source without the audit trail dominating the default view;
- share a link that opens to the exact scenario being discussed;
- see no clipped, vertical, overlapping, or hidden result at any supported viewport;
- reproduce the claims with the existing independent verification path.

The shortest summary is: **keep the lab, add a show.**