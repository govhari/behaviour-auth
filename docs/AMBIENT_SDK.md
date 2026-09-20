# Ambient collection and the mountable SDK — v0.5

Three additions on top of the passive-first verifier:

- **A.** The server is a mountable handler with cross-origin support, so it can sit inside an existing application instead of only serving its own demo.
- **B.** A page-wide *ambient* collector runs from page load, before anyone has claimed an identity, and is attributed to an account at login.
- **C.** Post-login activity monitoring is rescored against the same free-form model instead of a three-median heuristic, can observe wider scopes, and renews its own lifetime from corroborating evidence.

B and C are the same problem — recognizing free-form behavior with no known phrase and no fixed targets — so they share one model (`server/ambient.js`) and one browser collector (`client/behavior.js`). They cannot drift apart.

## A. Mounting

```js
import { createHandler, middleware, makeServer, BioPrint } from 'bioprint/server';

const core = new BioPrint('data/bioprint.sqlite', process.env.ENROLLMENT_KEY);

app.use(middleware(core, {
  basePath: '/bioprint',
  serveDemo: false,                           // the default; shown for clarity
  verifyPassword: (userId, password) => myAuth.check(userId, password),
  authorizeEnrollment: async (req) => myAuth.isOperator(req),
  onDecision: async ({route, result}) => myAuth.applyDecision(route, result),
  allowedOrigins: ['https://app.example'],   // omit for same-origin only
  crossSite: true,                            // SameSite=None; Secure
}));
```

`docs/INTEGRATION.md` covers the host callbacks and the client-side integration façade in full, and `examples/shop` is a complete worked integration.

`createHandler` resolves to `true` when it handled the request and `false` otherwise, so unmatched paths fall through to the host application. `makeServer` remains for the loopback demo.

`authorizeEnrollment` replaces the demo's `X-Enrollment-Key` header; when it approves, the core's own key is supplied on its behalf, so the core's authorization invariant is unchanged. `onDecision` is awaited before the response is sent, so the host sees each decision first and mints or revokes its own session: an accepted behavioral decision is not a signed-in user until the host says so.

**Cookies and CSRF.** The session cookie stays HTTP-only and scoped to the mount path. A separate `bioprint_csrf` double-submit token is readable and page-wide, and the SDK sends it as `X-BioPrint-CSRF`. It is deliberately readable so that the first concurrent requests of a fresh page cannot race each other for a token. Cross-origin, the enforced `application/json` content type already forces a preflight, which is itself the CSRF defense; the token covers the same-site case.

## B. Ambient pre-login evidence

`client/behavior.js` observes the whole page: pointer movement (decimated to ~25 Hz), clicks, scroll depth and wheel, key **timing** and generic action categories, focus changes and an opaque integrator-supplied view token. It never records text, key names, key codes or URLs, and it stays out of password fields entirely — those already have their own dedicated collector.

Collection is flushed in nonce-bound windows to `/ambient/ingest`. The session carries no identity. At login the client passes its `ambientId`; the server verifies the cookie binding and device, aggregates the session's unconsumed, non-training, non-stale windows, and matches them against `profile.ambient`.

A press or click straddling a window boundary is dropped rather than split: half a press would be either an invalid sequence or invented timing.

### What ambient evidence is allowed to do

This is the load-bearing part. Ambient evidence is collected before any identity is claimed, which means an attacker controls its content for an arbitrary window. It is therefore **allowed to withhold confidence and never to supply it**:

- Acceptance requires the passive score to clear its own threshold **and** the fused score to clear it. A passive score below threshold is never rescued by pre-login behavior; the attempt is reported with `AMBIENT_CANNOT_RESCUE`.
- A clear ambient mismatch forces step-up even when the passive evidence would have accepted.
- Its fusion weight is capped (default 0.2, scaled by matching quality).
- Every completed attempt consumes its windows, so one good buffer cannot be retried until an attempt happens to pass.
- Windows are single-use and nonce-bound, exact-replay checked globally and near-replay checked within the session. A replayed window forces step-up and is not erased by passing the active challenge.
- Enrollment training windows are excluded from verification evidence.
- Evidence older than 15 minutes is stale and ignored.

The consequence worth stating plainly: ambient evidence is **structurally unable to raise the accept rate**, so it cannot inflate FAR. What it can do is add friction — its effect on step-up rate and FRR is a real cost and is unmeasured. Set `ambient:false` to disable it entirely.

Ambient objects only when a score is clearly off (default margin 0.1 below threshold), not merely short of it, because a false objection costs a genuine user an extra challenge.

### Training

The ambient model is calibrated from the windows captured while the participant completes the ordinary enrollment rounds — no extra collection step. At least six usable windows are required; fewer simply means no ambient model, and ambient then contributes nothing. The model is scoped to one device class and is not used for another.

## C. Activity monitoring

Monitoring now scores windows with `matchAmbient` against the same enrolled `profile.ambient`, replacing the previous dwell/flight/click medians. It reports per-modality scores and evidence quality like the other phases.

`captureContinuous` accepts `roots`, so the observed scope can be several regions or the whole document rather than one fixed element; the regions merge into a single ordered timeline.

The session starts at 15 minutes and **renews itself from corroborating evidence** — a window that clears identity, quality and humanity extends it — bounded by an absolute one-hour lifetime from the original login. Renewal is earned, never requested. Three sufficiently informative mismatches, five minutes without corroboration, replay, hard automation or an invalid window still require a fresh login. `allowed` remains `false` always: monitoring never grants or renews access.

Options: `monitorTtlMs`, `monitorMaxTtlMs`, `monitorIdleMs`, `ambientThreshold`, `ambientMismatchMargin`.

## Storage, migration and research

New tables `ambient_sessions` and `ambient_windows`. Unattributed browsing is pruned; training windows are retained like other trusted recordings. Both tables are included in encrypted archives.

`profile.ambient` is versioned (`AMBIENT_SCHEMA_VERSION` / `AMBIENT_VERSION`) and migrated independently of the active and passive halves by `research.js migrate`, rebuilt from retained trusted windows, with thresholds using `max(existing, recalibrated)` so they never decrease.

`export-ambient` exports sanitized windows with training/consumed/replayed labels.

### Evaluation

`evaluate-login` measures ambient evidence when the dataset carries it. Ambient windows are labelled `phase:'ambient'` with a `loginId` and `device`, and `export-login` emits them alongside the passive/active records; `consumeAmbient` records which login consumed each window so the pairing does not have to be reconstructed.

The runner replays windows through the real ingest path — nonce rotation, replay detection and window consumption all apply. Ambient weight is selected on validation only, in a second stage after the passive parameters, so the joint optimum is not searched.

The report carries an `ambient` block: how many held-out attempts carried windows, how often ambient was used, the rate at which it forced step-up split by genuine and impostor, and `disabledTest` — **the same frozen policy with ambient switched off**. `ambient.stepUpCost` is the step-up rate ambient adds, which is the cost to weigh.

Read `disabledTest` carefully. It isolates ambient's effect *on that policy*; it is not what the system would do without ambient, because the policy was selected with ambient in play. For that question, evaluate an ambient-free dataset separately.

Because ambient cannot raise the accept rate, a report showing a higher FAR with ambient enabled indicates a defect rather than a trade-off, and `loginReportIssues` refuses it. Ambient-evaluated reports must also carry a calibrated `ambientWeight` and held-out attempts that actually carried windows.

`ambient:false` in a policy file disables it; `ambient:true` requires a report that measured it and adopts its calibrated weight. Ambient is on by default because it cannot grant access.

## Verification performed

Synthetic in-memory checks cover ambient ingest and nonce rotation, binding, enrollment calibration, fused acceptance, window consumption, foreign-person ambient, the no-rescue rule, replay across the step-up boundary, device mismatch, staleness, scripted browsing, monitoring, earned renewal and sustained-mismatch reauthentication. HTTP checks cover the routes, CSRF, origin allowlisting, preflight, custom base paths, fall-through and `serveDemo:false`. A persistent-SQLite run exercised `export-ambient`, `prune`, `archive` and ambient schema migration.

In a real browser: ambient collection starts on load and flushes windows; the password-exclusion filter was exercised directly and captured **zero** of eight password-field presses while capturing all six text-field presses; no `key` or `code` field exists in any captured event; and window-boundary presses are dropped leaving both windows well-formed.

A synthetic 264-record login dataset (two users, eight attack categories, 148 ambient windows) exercises the full evaluator: ambient weight selection, the isolation run, the ambient report block and every ambient deployment-gate rejection. On that dataset ambient held FAR at 0 where the same frozen policy without it sat at 0.5625, and forced step-up on 100% of impostor attempts and 0% of genuine ones — but this reflects how the generator differs between its two synthetic "people", not how real people differ. The step-up cost it reports (+40.9 points) is likewise a property of that generator.

Synthetic separation figures are not recognition performance. No participant study, physical device or sensor validation has been performed, and the ambient threshold clamp was never exercised against real between-session variance.
