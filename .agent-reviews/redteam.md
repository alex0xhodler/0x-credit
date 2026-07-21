# Header and Footer UX Red-Team Review

Date: 2026-07-11

## Round 1: assurance spine

### H1

- ID: H1
- Date: 2026-07-11
- Proposal: Replace the external tagline and footer with a vertical assurance spine.
- Objection: A 44–60px rail would take width from the projection chart near the 860px two-column breakpoint.
- Impact: high
- Evidence or missing evidence: The builder is fixed-width and the chart receives the remainder; no 861px or 1024px proof existed.
- Builder response: Abandoned the vertical rail. The replacement seam uses the existing header width and adds no grid column.
- Status: resolved

### H2

- ID: H2
- Date: 2026-07-11
- Proposal: Stack the product mark and four partner logos in a slim vertical rail, then collapse them into a 40–44px mobile strip.
- Objection: Wide partner wordmarks would become illegible, while three separate mobile groups would not fit at 320px or 200% text scaling.
- Impact: high
- Evidence or missing evidence: Current KPK and Beefy assets are wide wordmarks; the original proposal had no measured mobile composition.
- Builder response: Removed logo geometry from the chrome. Desktop uses a passive text route stack in the existing seam. At 600px and below, row one is one provenance sentence (`0x.credit / route: Gearbox · KPK · Beefy · Curve`) and row two is the strategy selector. At 200% scaling the seam may grow and reflow; text may not truncate or create horizontal scrolling.
- Status: resolved

### H3

- ID: H3
- Date: 2026-07-11
- Proposal: Present all partner marks together as reassurance.
- Objection: “Powered by” and unlabeled logos imply sponsorship or endorsement even though the systems play different route roles.
- Impact: high
- Evidence or missing evidence: The current UI calls all four systems “Powered by,” while route copy identifies different lending, optimization, and venue roles.
- Builder response: Replace endorsement styling with passive, factual `Route stack` text. Remove logo cards, hover behavior, and the “Powered by” label. Verification must confirm all four systems participate in displayed routes.
- Status: resolved

### H4

- ID: H4
- Date: 2026-07-11
- Proposal: Use a visually novel full-height perimeter rail.
- Objection: A full reading-edge treatment could attract more attention than the chart and builder.
- Impact: high
- Evidence or missing evidence: The original rail would span the entire card and retain the high-contrast product mark.
- Builder response: Replace it with one bounded seam, passive far-edge copy, no animation, no hover reveal, and no saturated partner treatment. Browser verification includes a grayscale/squint hierarchy comparison.
- Status: resolved

### H5

- ID: H5
- Date: 2026-07-11
- Proposal: Reduce the internal header while keeping strategy tabs.
- Objection: Existing tabs already lack visible focus, roving focus, arrow/Home/End behavior, panel linkage, and 44px targets; further compaction could worsen the core selector.
- Impact: high
- Evidence or missing evidence: `TransactionCockpit.tsx` uses `role="tab"` and `aria-selected` only; tests exercise mouse clicks only.
- Builder response: Preserve strategy selection as the primary header control, require 44px targets and visible `:focus-visible` styling, and implement/test complete keyboard behavior and panel semantics.
- Status: resolved

### M1

- ID: M1
- Date: 2026-07-11
- Proposal: Remove the footer landmark and move reassurance into visual chrome.
- Objection: Assistive technology could receive an unexplained sequence of company names.
- Impact: medium
- Evidence or missing evidence: The current footer has `role="contentinfo"`, but no relationship label beyond “Powered by.”
- Builder response: Give the route-stack group an explicit accessible label and keep the visible relationship wording factual.
- Status: resolved

### M2

- ID: M2
- Date: 2026-07-11
- Proposal: Continue using partner images in the combined chrome.
- Objection: Curve is loaded from a third-party URL, weakening reassurance when the asset or CSP fails.
- Impact: medium
- Evidence or missing evidence: A local Curve asset exists but is not used by the current footer.
- Builder response: The route seam uses text rather than partner images, eliminating image availability and layout-shift risk in this surface.
- Status: resolved

### M3

- ID: M3
- Date: 2026-07-11
- Proposal: Reuse the existing `.powered-by-*` classes for the new treatment.
- Objection: Legacy generic selectors would restore card borders, padding, and heights outside the current footer context.
- Impact: medium
- Evidence or missing evidence: Generic and cockpit-specific powered-by selectors currently overlap in `App.css`.
- Builder response: Use component-scoped seam classes and remove the obsolete cockpit footer rules touched by this change.
- Status: resolved

### M4

- ID: M4
- Date: 2026-07-11
- Proposal: Rely on existing component tests while changing the chrome.
- Objection: Existing tests do not cover responsive overflow, focus, landmarks, or keyboard selection.
- Impact: medium
- Evidence or missing evidence: The current test only checks brand text, two partner images, selected state, and mouse clicks.
- Builder response: Add semantic and keyboard regression tests first, then real-browser checks at 320, 375, 861, 1024, and 1440px plus 200% scaling.
- Status: resolved

### M5

- ID: M5
- Date: 2026-07-11
- Proposal: Collapse the spine into a mobile strip while retaining a separate strategy header.
- Objection: Two independent chrome rows could consume almost as much vertical space as the current layout.
- Impact: medium
- Evidence or missing evidence: The original proposal had no mobile chrome budget.
- Builder response: Use one mobile seam with a single provenance row and a strategy row; target no more than 88px at normal 320px width, while allowing accessible growth at 200% scaling.
- Status: resolved

### L1

- ID: L1
- Date: 2026-07-11
- Proposal: Apply the seam only to the default cockpit branch.
- Objection: The invested state returns through a separate shell, so reassurance remains inconsistent after commitment.
- Impact: low
- Evidence or missing evidence: `TransactionCockpit` returns early for `manageUrl` before the cockpit wrapper.
- Builder response: Keep the invested state out of this first-pass chrome scope to avoid widening the change into widget/state redesign; audit it in the planned deeper pass.
- Status: accepted

### L2

- ID: L2
- Date: 2026-07-11
- Proposal: Remove the visible tagline.
- Objection: The default cockpit already lacks a page-level heading because the tagline is a paragraph.
- Impact: low
- Evidence or missing evidence: The default branch has no `h1`.
- Builder response: Add a visually hidden page-level heading and ensure the main region is labelled.
- Status: resolved

## Round 2: route seam

Proposal: Use one top route seam inside the existing card width. Keep the horizontal product brand, make strategy tabs the primary interactive group, and render a passive `Route stack / Gearbox · KPK · Beefy · Curve` label on the far edge. Remove the external tagline and footer.

- H1 resolved because the seam adds no content column and is capped below the current header height.
- H2 reopened because three groups still could not fit in two rows at 320px and 200% scaling.
- H3 resolved by factual route wording and removal of endorsement-style logo treatment.
- H4 resolved architecturally by the bounded, non-animated, low-salience seam.
- H5 resolved architecturally by explicit target-size, focus, keyboard, and tab-panel requirements.

## Round 3: mobile composition

Proposal amendment: At 600px and below, combine brand and provenance into one visible sentence on row one and reserve row two for strategy selection. Permit height growth under text scaling instead of truncating or scrolling horizontally.

- H2 resolved architecturally.
- No high-impact objection remains open.

## Final decision

Proceed with the route-seam design, subject to user approval and implementation verification.

Resolved objections: H1–H5, M1–M5, L2.

Accepted objections: L1 (invested-state consistency is deferred to the deeper widget/state audit).

Verification evidence available now:

- Latest `origin/main` fetched at `296c7d5`.
- Clean baseline worktree created at `codex/ux-header-footer-audit`.
- Baseline component suite passes: 56 tests across 7 files.
- Current desktop measurement at 1440×900 shows the external tagline, 67px header, and 68px footer consuming approximately 156px of vertical chrome.
- Current horizon and preset controls measure about 23–26px high; the approved design explicitly forbids shrinking the strategy selector and requires 44px targets.

Required verification before completion:

- Render at 320, 375, 861, 1024, and 1440px.
- Check 200% text scaling/reflow with no truncation or horizontal overflow.
- Prove desktop seam height is no more than 52px and normal 320px mobile seam is no more than 88px.
- Verify roving focus, Arrow Left/Right, Home/End, selected state, panel association, focus visibility, passive-text contrast, and first-fixation hierarchy.

Stalemate: none.

---

## Round 4: selected-strategy provenance

### RP-01

- ID: RP-01
- Date: 2026-07-12
- Proposal: Remove the static header partner strip and show a selected-route provenance line below the projection title.
- Objection: `OpportunityView` contains no provenance; rendering Gearbox, KPK, Beefy, or Curve from a global list would make an unsupported claim for a selected route.
- Impact: high
- Evidence or missing evidence: `ROUTE_PARTNERS` is static in `poc/src/TransactionCockpit.tsx`; live opportunity data only carries route economics and collateral information.
- Builder response: Add an explicit optional `routeSteps` field to each displayed `OpportunityView`. The UI will render only supplied steps and omit the line entirely when they are absent. It will not infer providers from strategy names, tokens, or chains.
- Status: resolved

### RP-02

- ID: RP-02
- Date: 2026-07-12
- Proposal: Use named partner roles in the provenance line.
- Objection: Role labels can overstate the relationship if they are derived from generic copy.
- Impact: high
- Evidence or missing evidence: The existing screen makes different hard-coded claims about providers without a typed mapping to the displayed route.
- Builder response: Treat route steps as explicit product configuration. First pass contains only the route facts confirmed for the Mainnet Curve strategy; unknown providers are omitted. No “trusted by,” security, audit, or protection claim is introduced.
- Status: resolved

### RP-03

- ID: RP-03
- Date: 2026-07-12
- Proposal: Put route provenance in the chart’s first area.
- Objection: A four-part sentence could overwhelm chart controls at narrow widths.
- Impact: medium
- Evidence or missing evidence: The former header already grew to three rows at 320px.
- Builder response: Render provenance as its own wrapping row below the chart title and horizon controls, not inside the title. It is text-first and passive; the 44px strategy controls remain unchanged.
- Status: resolved

### RP-04

- ID: RP-04
- Date: 2026-07-12
- Proposal: Include deposit collateral alongside route providers.
- Objection: Collateral is a user transaction fact, not a third-party trust signal.
- Impact: medium
- Evidence or missing evidence: Combining them without a label could obscure causal order.
- Builder response: Begin the row with `Route` and `You deposit: {token}`, then list provider roles. The presentation makes the user input distinct from the route components.
- Status: resolved

### RP-05

- ID: RP-05
- Date: 2026-07-12
- Proposal: Reuse strategy ID to attach provenance.
- Objection: Several collateral routes can share a strategy ID and therefore show the wrong route provenance.
- Impact: medium
- Evidence or missing evidence: `App.tsx` creates multiple `OpportunityView` values for routes under one strategy.
- Builder response: Attach `routeSteps` to the final `OpportunityView` instance, not to `strategyId`; regression tests cover both rendering supplied data and omitting unknown data.
- Status: resolved

### RP-06

- ID: RP-06
- Date: 2026-07-12
- Proposal: Keep provider logos in the provenance row.
- Objection: Icons would be redundant once role/provider text is explicit and would consume narrow-screen width.
- Impact: low
- Evidence or missing evidence: The grayscale header logos were not legible proof in the supplied screen.
- Builder response: Use text only in this pass; defer logos unless later evidence shows a scanning benefit.
- Status: resolved

## Round 4 final decision

Proceed with the selected-strategy provenance row only when its entries come from structured `OpportunityView.routeSteps` data. Remove the global logo strip. No high-impact objection remains open.

### Verification update

- The initial implementation tried to show Beefy and Curve through a broad strategy mapping. Independent review reopened RP-01 because the live route does not provide evidence for those claims.
- The mapping was narrowed to the one fact guaranteed by the Gearbox route-loading path: `Borrowing protocol: Gearbox`.
- The UI renders no provenance when `routeSteps` is absent, and component regression coverage verifies that it never invents the removed Beefy or Curve roles.
- Independent follow-up review found no remaining high-severity issue.

---

## Round 5: selected Strategy Shelf + Editorial composition

### R1

- ID: R1
- Date: 2026-07-12
- Proposal: Make Strategy Shelf and Editorial the default composition and show Manager, Protocol, and Pool route roles.
- Objection: A shared route list would incorrectly attach the selected route's claims to future strategies or chains.
- Impact: high
- Evidence or missing evidence: Existing route steps were assigned through a shared fallback list.
- Builder response: Added a named Ethereum/Mainnet strategy registry. It returns provenance only for `wmooCurveETH+-WETH` on Ethereum; unrelated strategy/chain inputs return no provenance and render no row.
- Status: resolved

### R2

- ID: R2
- Date: 2026-07-12
- Proposal: Render `Pool: Beefy on Curve`.
- Objection: The wording could overstate Beefy's operational role.
- Impact: high
- Evidence or missing evidence: Previous UI said Optimized by Beefy, while Curve was the named venue.
- Builder response: The user supplied the exact product-authoritative wording for the confirmed Mainnet route. It remains scoped to that route and is paired with explicit Manager and Protocol labels; no generic endorsement or logo claim is added.
- Status: accepted

### R3

- ID: R3
- Date: 2026-07-12
- Proposal: Use a four-part provenance line at narrow widths.
- Objection: role/value pairs might separate on wrap.
- Impact: medium
- Evidence or missing evidence: Dot-separated inline content wraps at mobile widths.
- Builder response: Each pair is an atomic non-wrapping span; mobile verification is required before completion.
- Status: resolved

## Round 5 final decision

Proceed with the user-selected Strategy Shelf and Editorial defaults. Route provenance is explicitly scoped; one wording concern is accepted on the user's product authority.

---

## Round 6: yield-comparison chart

### YC-01

- ID: YC-01
- Date: 2026-07-13
- Proposal: Compare the selected strategy, WETH, LST, and LRT lines directly in their native token units.
- Objection: Those units do not represent interchangeable starting value. Wrapping ratios, depegs, entry and exit costs, and leverage make native-token lines look like a fair performance comparison when they are not.
- Impact: high
- Evidence or missing evidence: The selected strategy is denominated in wstETH while the requested alternatives include WETH, stETH, and weETH; no price or conversion model is currently implemented.
- Builder response: The proposed first pass is a clearly labelled, same-starting-value ETH-equivalent yield illustration. It excludes price, depeg, gas, swap, and slippage effects, and must not be called performance or total return.
- Status: resolved

### YC-02

- ID: YC-02
- Date: 2026-07-13
- Proposal: Project each series forward by compounding the current displayed APY.
- Objection: A smooth curve based on a point-in-time APY reads as a forecast or promise, especially over one year.
- Impact: high
- Evidence or missing evidence: DefiLlama exposes annualised current APY and its components, not future realised return.
- Builder response: Title the display `If today's net APY held`, surface per-series APY and fetched-at time, state that rates vary, and remove the current invented ±30% scenario band. Historical APY remains separate from the forward illustration.
- Status: resolved

### YC-03

- ID: YC-03
- Date: 2026-07-13
- Proposal: Find LST and LRT comparisons by token symbol from DefiLlama's pool list.
- Objection: Identical symbols can describe lending markets, LPs, wrappers, and pools on different chains; a dynamic match can select a wrong yield source.
- Impact: high
- Evidence or missing evidence: The live list contains numerous WSTETH and WEETH lending pools in addition to direct primitive holdings.
- Builder response: Pin and validate immutable Ethereum benchmark mappings: Lido stETH pool `747c1d2a-c668-4682-b9f9-296708a3dd90` and ether.fi weETH pool `46bd2bdf-6d92-4066-b482-e885ee172264`. Reject mismatched chain, project, symbol, exposure, invalid/outlier APY, and unavailable data; never substitute a symbol match or fabricated fallback.
- Status: resolved

### YC-04

- ID: YC-04
- Date: 2026-07-13
- Proposal: Compare the app strategy APY with DefiLlama APYs as equivalent numbers.
- Objection: The strategy rate may include leverage and borrow costs while external APYs can include reward components, creating a gross-versus-net comparison.
- Impact: high
- Evidence or missing evidence: The current app exposes strategy APY and borrow rate separately; DefiLlama exposes `apyBase` and `apyReward` separately.
- Builder response: Reopened after live-route inspection. The calculation passed the raw base rate instead of applying Gearbox's `feeInterest`, while the visible 1.20% excluded both that fee and the quota rate. For the inspected wstETH route, the effective cost is about 1.62%; for the comparable WETH route, about 2.88%. `calculateEffectiveBorrowRate` now applies both fee and quota before the APY formula; a regression test uses the live wstETH figures.
- Status: resolved

## Round 6 interim decision

Proceed with one continuous balance chart. It compounds pinned historical APY from the selected starting deposit through `Now`, then carries every series forward using its current rate. The selected strategy's historic half uses the underlying Beefy pool APY; its forward half uses the corrected net Gearbox APY. The chart discloses that distinction, and the entered deposit resets its baseline after a 300ms debounce. No high-impact objection remains open.

---

# Advisor Onboarding & Dashboard Rebuild Red-Team Review

Date: 2026-07-21

## Proposal under review

Rebuild the `?view=advisor` experience as a two-phase SPA: a 4-step agent
onboarding wizard (Portfolio → Borrow → Mandate → Review & activate) as the
primary state, and a restructured dashboard (stat tiles → prioritized agent
feed → right rail) as the post-activation state. New pure module
`lib/advisor/onboarding/intent.ts` translates onboarding intent into engine
positions with validation (weights, max-LTV, share caps, private-equity min
HF, USDe peg). Live HF meter on the borrow step and a pre-activation agent
preview ("your agent is already watching") as the two aha moments. Engine and
existing cockpit untouched; in-memory state; existing dashboard tests ported
via a skip-demo path. Builder: Sonnet code agent from spec; verification:
supervisor gate (vitest, tsc, eslint, build, real-browser screenshots).

## Round 1: independent critic

(objections recorded below after critic pass)

### A1

- ID: A1
- Date: 2026-07-21
- Proposal: Port the 8 dashboard tests via a skip-demo path while onboarding uses a new intent builder.
- Objection: Skip and activate produce divergent PositionStates; ported tests would only cover the non-product path, and the intent builder structurally cannot reproduce HERO_COLLATERAL (Ondo score-4 NVDA split, stale-NAV SpaceX token), making "all 8 pass" unattainable as written.
- Impact: high
- Evidence or missing evidence: heroScenario.ts:48-63 (two-provider NVDA, NAV token priceAsOf HERO_NOW-1h); three of eight tests depend on that exact structure. The plan never stated which source skip-demo uses.
- Builder response: Single construction path. Skip-demo routes through buildCollateralFromIntent(DEFAULT_INTENT); PROVIDER_SPLITS encodes the exact hero tokens (bNVDA 60/oNVDA 40, NAV token with priceAsOf = HERO_NOW − 1h). A required intent test asserts buildCollateralFromIntent(defaults, 12.5M) deep-equals HERO_COLLATERAL (order-insensitive) and buildDebtsFromIntent(defaults) equals HERO_DEBTS — the equivalence is pinned by a test, not asserted.
- Status: resolved

### A2

- ID: A2
- Date: 2026-07-21
- Proposal: Step-4 "agent already watching" preview as the second aha.
- Objection: The preview is hard-wired to the single NVDA earnings signal; any user who rebalances away from NVDA gets an empty marquee panel, collapsing the aha for real wizard interaction.
- Impact: high
- Evidence or missing evidence: engine gates per-underlying proposals on one NVDA-only feed (STRONG_SIGNAL 0.6); no spec for arbitrary intents.
- Builder response: Preview renders the TOP proposal of ANY kind from assessPosition (provider-concentration findings fire for nearly every constructible basket, since SPY/AAPL/SPACEX are single-provider), with kind-appropriate copy, plus an always-present "what your agent watches" list (registered signals, thresholds, drift bands). Graceful empty state retained as final fallback. Aha reframed from "earnings catch" to "agent has already assessed your configured position."
- Status: resolved

### A3

- ID: A3
- Date: 2026-07-21
- Proposal: Collapse non-first proposals by CSS so DOM nodes persist for ported tests.
- Objection: Testing anti-pattern — asserts on content users cannot see, shapes production markup for test convenience, and is contradictory under accessibility (aria-hidden vs queryable).
- Impact: high
- Evidence or missing evidence: CLAUDE.md testing-anti-patterns mandate; test 5 clicks a button inside a proposal body.
- Builder response: Dropped. Collapsed proposals conditionally render header-only (disclosure pattern: button with aria-expanded controlling a region). Ported tests are amended honestly with an expandProposal(testid) helper that clicks the disclosure first — tests now interact as users do.
- Status: resolved

### A4

- ID: A4
- Date: 2026-07-21
- Proposal: "Port the 8 tests" unchanged against a reshuffled DOM (first-expanded feed, grouped diversify card, right-rail borrow panel).
- Objection: Silent testid/ordering coupling: NVDA reduce_weight must be first-and-expanded for getByLabelText to work; engine ordering, not UI, decides.
- Impact: high
- Evidence or missing evidence: engine sorts urgency desc then HF delta; current tests reach inputs directly.
- Builder response: Ordering verified from engine code: base demo → reduce_weight (medium) sorts above provider_diversify (low), so NVDA is first-and-expanded; reflexive mode → refinance (high) is first. Tests no longer depend on ordering regardless, via the A3 expand helper. Grouped diversify card keeps per-proposal sub-rows with unchanged testids; borrow-panel testid stays on the rail panel. Ported tests are acknowledged as re-authored against the new DOM; their behavioral assertions (HF math, approve/dismiss effects, reflexive flow) are the preserved contract, not the DOM shape.
- Status: resolved

### A5

- ID: A5
- Date: 2026-07-21
- Proposal: Deliver the whole rebuild in one code-agent pass.
- Objection: Surface area roughly triples the current screen plus a new math module; realistic outcome is partial or subtly wrong delivery at the engine seams.
- Impact: high
- Evidence or missing evidence: current screen ~293 lines with eight interacting behaviors.
- Builder response: Split into two sequential passes with a supervisor verification gate between. Pass A: intent module (TDD) + AdvisorApp container + onboarding wizard + wizard tests + design tokens. Gate A: full test/type/lint/build + browser screenshots of every step. Pass B: dashboard restructure + honest test port + integration. Gate B: same plus end-to-end flow screenshots.
- Status: resolved

### A6

- ID: A6
- Date: 2026-07-21
- Proposal: Add HERO_BORROW_APR and HERO_USDE_PEG to the fixture; domain untouched.
- Objection: STABLECOIN_CONFIG has no APR field, forcing either a domain edit or a second source of truth; a separate peg constant can disagree with HERO_DEBTS' 0.999.
- Impact: medium
- Evidence or missing evidence: stablecoin.ts:24-28; heroScenario.ts:69.
- Builder response: APR is demo data, not domain truth — it lives only in the fixture as HERO_BORROW_APR with a comment marking it v2-RateModel territory; intent.ts and UI read it from the fixture. Peg: no second constant; export HERO_USDE_PRICE = 0.999 and use it inside HERO_DEBTS so there is exactly one source.
- Status: resolved

### A7

- ID: A7
- Date: 2026-07-21
- Proposal: maxBorrowUsd = Σ haircut-adjusted value × maxLtv beside a liquidation-threshold HF meter.
- Objection: The two Step-2 widgets measure different ratios without reconciliation; Σ×maxLtv is ill-defined per-underlying since maxLtv is per token.
- Impact: medium
- Evidence or missing evidence: ltv.ts:28-39 (per-token step-down); healthFactor.ts uses liquidationThreshold.
- Builder response: Intentional and now explicit: capacity = origination limit (max LTV, computed per TOKEN position then summed), meter = liquidation distance. Copy labels the bar "of origination limit". Borrowing to 100% of capacity yields HF ≈ 1.13-1.15 — inside the amber intervention zone on the meter, which is the honest, coherent story and is stated in the spec.
- Status: resolved

### A8

- ID: A8
- Date: 2026-07-21
- Proposal: "Reconfigure" returns to a prefilled wizard.
- Objection: No inverse mapping exists from a mutated position back to intent; prefilling from original intent discards approved changes.
- Impact: medium
- Evidence or missing evidence: forward transform is lossy by design.
- Builder response: Accepted with mitigation. Reconfigure prefills from the last confirmed intent; if the position was mutated since activation, step 1 shows a notice ("Your agent has applied N approved changes since activation; reconfiguring restarts from your last confirmed mandate."). True inverse derivation is real-product scope, out of demo scope — documented.
- Status: accepted

### A9

- ID: A9
- Date: 2026-07-21
- Proposal: Onboarding wizard as the primary state.
- Objection: A demo screen should lead with insight, not a configuration gate; wizard-first resembles signup flows, not familiar DeFi patterns; the skip link is an admission of friction; the reflexive differentiator is demoted behind onboarding.
- Impact: medium
- Evidence or missing evidence: App.tsx labels the screen a fixture demo; Aave/Morpho land on live views.
- Builder response: Accepted as an explicit product-owner mandate ("focus on the onboarding experience of the agent, that should be the primary state of this screen"). Mitigations adopted: both aha moments moved INTO the wizard (live risk meter, pre-activation agent preview) so the wizard is the insight rather than friction before it; skip-demo stays one click; reflexive toggle remains post-activation (noted as a candidate for a future guided-scenario entry).
- Status: accepted

### A10

- ID: A10
- Date: 2026-07-21
- Proposal: Custom sliders, meter, selectable cards, toggles.
- Objection: No accessibility or test-affordance contract; div-based widgets break both screen readers and RTL interaction.
- Impact: medium
- Evidence or missing evidence: current tests drive a native number input via getByLabelText.
- Builder response: Spec now mandates native controls under all styling: input[type=range] for sliders, visually-hidden native radio/checkbox inputs for mode cards and permission toggles, label/aria-labelledby on every input, the HF meter as role="meter" with aria-valuemin/max/now, disclosure buttons with aria-expanded. Tests drive only native inputs and accessible roles.
- Status: resolved

## Round 1 summary

All four high-impact objections resolved with verifiable spec changes (A1
equivalence pinned by a required test; A3 anti-pattern removed; A4 ordering
verified from engine sort logic; A5 rollout split into two gated passes).
A8/A9 accepted with documented rationale — A9 by explicit product-owner
mandate. Proceeding to a targeted critic reopen pass on the adjudications.

## Round 2: critic reopen pass

The critic independently recomputed the three load-bearing claims against the
repo rather than trusting builder assertions:

- A1 fixture reproducibility: all intent products land on exactly-representable
  values (bNVDA $3M/qty 30000, oNVDA $2M/qty 20000, SPACEX qty 12500 with
  priceAsOf HERO_NOW−1h); equivalence is attainable and pinned by a required test.
- A4 ordering: URGENCY_RANK + comparator prove reduce_weight:NVDA first in base
  mode and refinance_stablecoin:USDe first in reflexive mode; no tie hazard.
- A7 arithmetic: capacity $8,115,000; HF numerator $9,335,000; HF at 100%
  capacity ∈ [1.137, 1.150] — matches the claimed 1.13–1.15 amber-zone story.

All ten adjudications UPHELD; zero reopened. Non-blocking note: the A1
deep-equal requires the builder to preserve exact per-provider sub-values —
enforced by the pinned equivalence test.

## Decision

Build proceeds on the revised plan. Resolved: A1-A7, A10 (verifiable spec and
rollout changes). Accepted with documented rationale: A8 (lossy reconfigure,
demo scope), A9 (wizard-first by explicit product-owner mandate, aha moved into
the wizard). No stalemate. Rollout: two sequential code passes (A: intent
module + wizard; B: dashboard restructure) with a supervisor verification gate
(tests, types, lint, build, real-browser screenshots) after each.

## Outcome

Shipped in two gated passes as decided. Gate A: 188 tests, wizard verified
step-by-step in a real browser (two visual-defect fix rounds: unstyled CTAs
from a cross-stylesheet .advisor-btn collision, meter tick placement/overlap).
Gate B: 189 tests, dashboard restructure verified end-to-end including the
skip-demo reflexive scenario (banner + high-urgency refinance proposal) and
the wizard-path case where no USDe debt exists and the loop correctly does
not fire. All engine behavior preserved; old dashboard files removed.
