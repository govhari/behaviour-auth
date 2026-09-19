# Recording, evaluation and activation

> v0.3 adds passive-first login. The A–F runner described here evaluates active recordings only. Export passive captures separately with `node tools/research.js export-passive data/bioprint.sqlite`; use `loginId` to pair them with active step-ups. Do not feed password-field timing events into the active challenge parser. Passive policy and final fusion still require their own real-participant validation; an eligible active report does not validate them. See `ACTIVE_PASSIVE_IMPLEMENTATION.md`.

## Collect and label

The demo generates **Recording session label** automatically for each user and browser-tab visit, preserving it across rounds, retries and reloads. A new visit starts after 30 minutes of inactivity or in a fresh tab session. These labels group recordings; they do not prove that collection occurred on separate days. Enroll each participant, then record genuine attempts and attacks on independent visits. Do not split adjacent events or rounds from the same visit across enrollment/validation/test, even if their automatic labels differ.

Export with `node tools/research.js export data/bioprint.sqlite > recordings.json`. This includes sensitive raw events; keep it local and access-controlled. Challenge nonces and session-cookie bindings are omitted. The export does not infer labels from ACCEPT/REJECT: that would bias evaluation.

Fill in every record's labels:

```json
{
  "schemaVersion": 1,
  "origin": "recorded",
  "records": [{
    "id": "unique-record-id",
    "subjectId": "actual-participant-or-attacker",
    "claimedUserId": "alice",
    "studySessionId": "participant-day3",
    "split": "validation",
    "attack": "zero-effort",
    "challenge": {"phrase": "...", "targets": []},
    "events": []
  }]
}
```

The challenge/events above are placeholders: retain the real exported values. `split` is `enroll`, `validation`, or `test`. Enrollment must have at least eight valid genuine rounds per user. A `(subjectId, studySessionId)` cannot appear in multiple splits. `genuine` requires the actual participant to equal the claimed user.

Attack values: `genuine`, `zero-effort`, `mimic`, `fixed-bot`, `random-bot`, `synthetic`, `exact-replay`, `perturbed-replay`, `webdriver`. Label controlled attacks explicitly. A WebDriver trace may still contain trusted browser events. Use `origin: "synthetic"` for generated smoke datasets; they can exercise reporting but never qualify for activation. For replay-protocol attempts whose freshness fails outside raw event analysis, include `protocolValid: false`.

## Report

Run `node tools/research.js evaluate labeled-recordings.json > evaluation.json`.

| Variant | Comparison |
|---|---|
| A | Existing robust four-feature baseline |
| B | A plus nearest-three exemplar statistics |
| C | B plus bounded DTW |
| D | Rich multimodal statistics, DTW and contextual keys |
| E | D plus cross-modal timing |
| F | E plus historical exact/near replay and labeled protocol freshness |

Every variant keeps task validation, complete evidence and humanity checks. A–E omit replay detection deliberately for ablation. Missing compatible sequences produce MORE_DATA in the relevant variants. The final active fusion equals F. Replay comparison in evaluation uses the enrollment reference bank, not later test records, so it cannot learn from the test set; label attacks against other historical records with `protocolValid: false` where appropriate.

Each variant selects one operating threshold from validation records by minimizing FAR+FRR (ties favor lower FAR), then freezes it for test reporting. Reports include the test EER as a discrete approximation, aggregate and per-user FAR/FRR, MORE_DATA counts, attack counts/rates, and p50/p95 latency. FRR counts all genuine attempts not accepted, including MORE_DATA. Null means the required denominator/data is absent. EER is descriptive, not the deployed threshold.

Latency is analysis and matching time, not HTTP/network/SQLite latency. B–F share the total bounded advanced-matcher measurement; use live `verificationMs` for a practical server-side comparison. The query bank is capped at 24 representatives and each DTW sequence at 64 points (pointer segments at 32), with a bounded warping window. Online near-replay checks use at most 128 recent fingerprints for the claimed user.

## Activate deliberately

Default runtime behavior is baseline decisions with shadow advanced scores. An eligible report requires recorded data, at least two enrolled users, all eight attack categories in the held-out test set, and advanced FAR/FRR no worse than baseline with at least one strictly improved. These checks are an engineering gate, not a statistical significance claim; operators must assess sample sizes and per-user errors.

Create a policy file alongside the report:

```json
{
  "report": "evaluation.json",
  "advanced": true,
  "adaptation": false
}
```

Start with `BIOPRINT_POLICY=/absolute/path/policy.json npm start`. Unsupported/missing reports fail startup. The active threshold comes from F's validation operating point, never from client data. Thresholds outside 0.25–0.99 fail activation.

To enable quarantine after reviewing false accepts, set `adaptation: true` and `maximumFAR` to an explicit acceptable ceiling between 0 and 0.05. The measured held-out FAR must meet it. Promotion requires quality 1, humanity at least 0.85, identity at least `max(0.9, threshold + 0.1)`, and four pairwise-consistent attempts at least ten minutes apart. Separate server timestamps are required; client study labels cannot accelerate promotion. The immutable shared enrollment model remains the comparison anchor.

## Still requires real participants

No human recognition results are included in this increment. Collect separate-day genuine sessions, other participants, mimics, scripted distributions, replays and WebDriver attempts before claiming improved discrimination. Validate new hardware, touch/pen paths, reduced timers, focus loss, browser coalescing and IME/accessibility behavior explicitly. Unsupported acquisition should remain MORE_DATA rather than lowering thresholds.

## Complete passive-first login evaluation

Run `node tools/research.js export-login database.sqlite` to export both phases, then `node tools/research.js evaluate-login labeled-logins.json`. The export is read-only and omits nonce/cookie binding and credentials. It intentionally leaves study labels unset. The dataset needs `schemaVersion: 1`, `mode: "login"`, `origin: "recorded"` (or `"synthetic"`), and `records`.

Each record needs unique `id`, `phase` (`passive`/`active`), `subjectId`, `claimedUserId`, `studySessionId`, `split` (`enroll`/`validation`/`test`), `attack`, numeric `recordedAt`, `challenge` including its device, and raw `events`. Use the same attack vocabulary as A–F. Genuine subjects must match their claims. Enrollment is genuine-only and must precede evaluated attempts. Keep each subject/visit in one split. Choose an initial enrollment bank with six usable passive rounds per enrolled passive device and at least eight active rounds, within the runtime's enrollment limits; curate out later device-training sessions rather than mislabeling them as initial enrollment.

Non-enrollment records additionally require `loginId` and boolean `protocolValid`; passive records require boolean `passwordValid`. These are independently annotated outcomes, not credentials. Pair phases by login ID, identity, device, study visit and split. Standalone active records are not login pairs and must be excluded. Malformed identity/split labels, orphan active records, future enrollment and session leakage are refused.

Calibration tries passive thresholds 0.85/0.90/0.95/0.97, final floors 0.75/0.85/0.95, and passive weights 0.20/0.35/0.50. It minimizes validation FAR+FRR, then FAR, then step-up rate. The active baseline threshold and all quality, humanity, freshness and active-acceptance gates remain enforced. It freezes the selected parameters before evaluating test attempts. Results include baseline-policy comparison, passive accept/step-up/reject rates, final FAR/FRR, per-user and attack breakdowns, latency and per-attempt outcomes. Null rates mean no denominator; this report does not compute a scalar EER for the multi-stage policy.

Every candidate that requests step-up needs a corresponding active recording. A routine export may lack active traces for passively accepted logins; collect a separately bound active trace in the study protocol and annotate its pairing, or narrow the study before running. The evaluator refuses missing traces rather than inventing a successful response or counting an unobserved result as a rejection.

The evaluator replays the actual server methods in fresh in-memory databases, separately for validation and test. Cookies/nonces are simulated; annotated `protocolValid: false` supplies original protocol failures. Exact/near raw-trace checks and chronological replay history still run. No model adaptation occurs. Synthetic/incomplete reports remain ineligible. The A–F report alone still cannot validate passive/final-login settings.

## Deploy a reviewed calibrated login policy

Login reports now carry `policyVersion`, `activePolicy`, `deploymentEligible` and explanatory `deploymentIssues`. Eligibility requires current matcher versions, recorded session-separated data, at least two enrolled users, genuine/impostor measurements for every enrolled user, all eight held-out attack categories and no held-out FAR/FRR regression against the default login policy with the same active matcher. These are engineering checks, not a statistical-significance claim. Report provenance and labels still require researcher review.

For baseline active mode, run `evaluate-login labeled-logins.json`. To evaluate with the approved advanced matcher, run `evaluate-login labeled-logins.json active-policy.json`; the third argument must pass the existing active-policy gate. Adaptation is disabled during evaluation. The exact active mode and identity threshold are recorded and must match deployment; mixing an advanced runtime with a baseline-only login report is refused.

Example policy (choose FAR and sample-count limits for your study, not blindly from this example):

```json
{
  "login": true,
  "loginReport": "login-evaluation.json",
  "maximumLoginFAR": 0.01,
  "minimumLoginGenuine": 100,
  "minimumLoginImpostors": 100,
  "passiveAdaptation": false
}
```

Run `node tools/research.js check-policy policy.json`, then start explicitly with `BIOPRINT_POLICY=/absolute/path/policy.json npm start`. Startup independently checks report eligibility and the explicit sample-count/FAR ceilings; it does not trust the report's eligibility boolean alone. Parameters are read from the validated report, never from browser requests. Add the existing `advanced`/`report` fields only if the login report evaluated that exact advanced configuration. Both report paths resolve relative to the policy file. No policy is activated by default.

`passiveAdaptation: true` is separately opt-in and requires calibrated login approval. It quarantines four high-quality, high-humanity, anchor-matching samples with ten-minute server-time gaps and pairwise consistency. Candidates expire after 30 days. Promotion keeps the original device model as `anchorModel`, preserves the shared passive profile and never lowers the device threshold. Only already trained devices can adapt; monitoring windows never enter this pipeline. Frozen-policy reports do not establish adaptation safety: evaluate longitudinal drift/poisoning separately before deployment.

Optional sensors expanded the active matcher to `exemplar-dtw-3` / feature schema 4. Old activation reports must be rerun. Continuous monitoring is an opt-in, provisional reauthentication heuristic with separate uncontrolled-activity evidence; login calibration does not certify its thresholds.

## Ambient evidence

`evaluate-login` measures ambient evidence when the dataset carries `phase:'ambient'` records. Each needs `id`, `subjectId`, `claimedUserId`, `studySessionId`, `split`, `attack`, `recordedAt`, a `device` matching its login's device, an `events` array, and — outside enrollment — the `loginId` it belongs to. Several windows may share one `loginId`; passive and active remain one each. Windows must not be recorded after their login. Enrollment ambient windows train `profile.ambient`; at least six usable ones are required or there is no model.

`export-login` emits ambient windows with the login that consumed them. Windows are replayed through the real ingest path, so nonce rotation, replay detection and consumption apply exactly as they would live.

Reports carry `ambientEvaluated` and an `ambient` block with held-out usage, the genuine/impostor split of ambient-forced step-ups, and `disabledTest`: the same frozen policy with ambient switched off. `ambient.stepUpCost` is the step-up rate ambient adds.

`disabledTest` isolates ambient's effect on that policy. It is **not** what the system would do without ambient, because the policy was selected with ambient in play; evaluate an ambient-free dataset separately for that.

Acceptance requires the passive score to clear its own threshold independently of ambient fusion, so ambient cannot raise the accept rate. A report showing a higher FAR with ambient enabled is refused as a defect. Ambient-evaluated reports additionally need a calibrated `ambientWeight` and held-out attempts that carried windows.
