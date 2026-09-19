# Passive-first implementation — v0.4

Passive-first login built on top of the active verifier. Run `npm start`; the database migration only adds tables. Existing active profiles remain usable.

## User flow

- Enrollment: six login-style repetitions using a non-secret training string, then eight active rounds. Existing active-only profiles need only the passive phase. Enrollment tokens authorize both training phases independently.
- Login: select the demo account, start login, then enter username/password naturally. The selected account supplies the server binding; the typed username must match it.
- A known-device, high-quality passive match returns ACCEPT and never issues an active challenge.
- Low identity, low quality, autofill/composition, new devices or a missing passive profile return STEP_UP.
- Invalid credentials, malformed evidence, clear automation, expiry, consumed nonces and replay return REJECT.
- STEP_UP issues one active challenge bound to the original login, user, browser cookie and input device. The final decision is ACCEPT or REJECT. A failed active attempt requires a fresh login, not a repeat of the old challenge.

The fixed local credential is `abc-bioprint-login`; the automatic enrollment key remains `abc-bioprint-local`. These are demo conveniences. An integrating application supplies its own trusted `verifyPassword(userId, password)` callback to `makeServer`.

## Collection and privacy

`client/passive.js` observes only the supplied username/password fields and login form. Username events retain known non-secret key context. Password events retain timestamp, ordinal pairing position and a generic category (character/correction/modifier/navigation), never the key or code. Input metadata records typing/autofill/composition without a value. Credential verification is a separate HTTP boundary; plaintext credentials are never sent into biometric storage or logs.

The server uses an event allowlist and rejects unexpected password properties with PASSWORD_DATA_FORBIDDEN before persistence. Tab and Shift key releases remain paired even when focus switches fields. Pointer capture records the normalized submit approach, click hold, button-relative click location and target-entry timing. Focus interruption, incomplete releases and missing modalities reduce quality. `isTrusted` and WebDriver are weak hints and never identity proof.

## Profiles and policy

Passive profiles live under `profile.passive`, separate from the existing active/shared/device models. They model username rhythm/context, generic password timing, pointer dynamics, click behavior and cross-modal delays using robust median/MAD statistics and bounded per-feature reliability weights. Six enrollment repetitions seed the model; leave-one-round-out scores set a provisional threshold clamped to 0.85–0.97.

Passive acceptance requires all of:

- identity at least the user's threshold;
- matching evidence quality at least 0.75;
- human score at least 0.80;
- a trusted passive device profile and complete, fresh evidence.

Evidence quantity does not renormalize upwards just because keyboard evidence is missing. Score fusion excludes unavailable modalities, but pointer/click-only evidence remains insufficient for passive acceptance. `observedQuality` reports raw capture quality; `quality` is bounded by the quality of features that have an enrolled comparison. No passive profile therefore yields no matching confidence.

Clear automation requires multiple signals and a human score below 0.45. Other low-humanity observations step up. Ordinary low identity never becomes a passive hard reject. Exact and near-replay detection are separate hard gates; short/empty autofill captures are not mistaken for repeated biometric traces simply because they contain few events.

After active step-up, identity uses weights `0.35 * passiveQuality` and `0.65 * activeQuality`; incompatible or absent passive identity receives no weight. Final identity must exceed `max(0.75, activeThreshold)`, final humanity must be at least 0.80, active quality must be 1, and both freshness gates must pass. The active verifier must itself accept: passive similarity cannot rescue invalid or mismatched active evidence. DTW remains in shadow mode unless the existing evaluation-backed policy enables it.

By default, no passive-login trace trains the profile. Optional passive adaptation is described below; active adaptation runs only after final acceptance and remains governed by its existing opt-in quarantine policy. New devices start as candidates, not trusted passive devices. The Enroll this device action provides explicit operator-authorized passive training: ten rounds bound to one device and browser, within 30 minutes. It preserves the shared anchor and all other device/active profiles. Until completion the device continues to step up. Expired training can be restarted; old training recordings remain retained.

Touch/pen enrollment may retain thin login-style evidence (quality at least 0.1); this does not lower the 0.75 passive acceptance requirement. Thus mobile autofill usually relies on the active drag challenge rather than invented keyboard timing.

## Persistence and research

New tables: `passive_enrollments`, `passive_sessions`, `passive_replay`, `login_attempts`. Passive replay hot-path history is limited to 128 fingerprints per claimed user. Raw trusted enrollment traces remain available separately. Challenge consumption and login-state transitions are transactional. A bound step-up cannot be verified through the standalone active endpoint.

`export-passive` exports sanitized passive recordings; the normal `export` command remains active-only. Their `loginId` fields link corresponding phases. Encrypted archives include all new tables; retention preview/apply includes old untrusted passive captures and expired login state.

The A–F runner is explicitly active-only. `export-login` and `evaluate-login` support separately labeled paired passive/active recordings, with validation-only threshold/weight selection and held-out complete-login reporting. See EVALUATION.md for required labels, paired-capture limitations and the opt-in report-backed deployment gate. Real session-separated data is still needed. The handout's example percentages are not measured results, and active-matcher reports do not validate passive thresholds.

## Passive model versioning and migration

`calibratePassive` stamps both `featureSchemaVersion` (`PASSIVE_SCHEMA_VERSION`) and `matcherVersion` (`PASSIVE_VERSION`) on the shared model and on every device model. The pair exists because the two move independently: the passive features below were extended without changing the matcher, which older profiles had no way to detect. `status()` exposes the pair and a `passiveMigrationRequired` flag.

`migrate` now handles the active and passive halves separately; a profile can be stale in one and current in the other. The passive half rebuilds from retained `trusted=1` passive recordings, always re-deriving rather than trusting a stored stamp:

- The shared model is rebuilt from the **first** enrollment's rounds only, so a later device enrollment cannot redefine it. If `passiveCreatedAt` does not agree that those are the original rounds, the shared rebuild is skipped and reported.
- Each existing trusted device is rebuilt from its own training rounds. Devices are never created, removed or promoted, and `class`, `status` and `promotedAt` are preserved.
- A device that has drifted keeps an `anchorModel` rebuilt from its enrollment rounds **alone**, while its live model also includes the already-promoted samples. The anchor therefore keeps its poisoning-guard meaning, expressed in current features.
- Thresholds, `qualityMinimum` and `humanMinimum` are taken as `max(existing, recalibrated)` and never decrease.
- A rebuild whose numbers are unchanged is stamped without bumping `profile.version`; only a real change bumps it, once per half.
- A model whose recordings are missing, pruned or no longer parse under the current allowlist is left untouched and reported in `reasons`, never rebuilt from partial evidence. `migrate` is therefore safe to re-run and is a no-op once nothing further can be rebuilt.

Each migrated profile writes a metadata-only `passive_schema_migration` audit row. `PASSIVE_VERSION` is unchanged by this work, so existing calibrated login reports remain valid; a future matcher change still requires a fresh eligible report.

## Feature coverage

Passive v2 adds up–down latency, pause median/spread, burst length, generic modifier ratio, username Shift ratio, median repeated digraph/trigraph timings, field-click versus Tab observations, curvature, approach angle and a movement-away/overshoot proxy. Low entropy and implausibly fast cross-modal timing add weak bot signals. Quality/autofill handling and password privacy are unchanged. Old enrolled feature models keep their original fields until explicitly retrained; missing new fields are not mismatches.

Active v3 adds target radius to server geometry and uses the same normalized elliptical hit region in the UI and verifier. Positions, traversal direction/distance and radii vary per challenge. New phrases include capitals and double letters; existing profiles authenticate with their stored phrase corpus. Shift release is paired by physical code, preserving the original character even if Shift is released first.

Active features now include inter-action reaction-delay proxies, curvature, entry speed, approach angle, movement-away ratio and correction ratio. Bounded DTW includes curvature, movement-normalized touch trajectories and cross-interaction timing sequences alongside keyboard and velocity sequences. Old exemplars simply omit channels they lack. The richer matcher still runs in shadow by default. Curvature and overshoot are mathematical proxies, not independently validated physiological measurements.

## Optional/stretch implementation

Active schema 4 / `exemplar-dtw-3` adds available linear acceleration and gyroscope magnitude/variability, scroll cadence/burst duration/reversals/overshoot/wheel magnitude, and pen pressure variation/tilt/twist/contact height. Motion remains explicit-permission only. Optional fields are range-validated, and absent hardware is excluded. Actual sensor support and discrimination need physical-device validation.

Passive drift adaptation is disabled by default and gated by a reviewed calibrated-login report. Four mutually consistent samples, each high-quality/high-humanity and matching the immutable original device model, must arrive at least ten minutes apart. Promotion changes only the trusted passive device's model; the shared profile and original anchor remain unchanged. Thresholds never decrease. New devices still require explicit enrollment. `passive_quarantine` is included in archive/retention.

Continuous monitoring starts automatically after a recent accepted login (never after enrollment or an unfinished step-up). It binds the cookie/user/device, permits one monitoring session per accepted login, and expires after 15 minutes. Each 30-second UI capture uses a server nonce with a 45-second expiry. The demo and example both observe the whole page; the collector still accepts any scope the integrator passes. Key timing uses ordinal IDs with no key/code/text; strict server allowlists reject content fields. Only bounded relative-timing/path replay fingerprints and summary audits are retained, not raw continuous event arrays.

Continuous comparison uses available enrolled dwell/down-down/click timing as a provisional reference, not known-phrase DTW on arbitrary text. Missing/partial/blurred input reduces quality. Three consecutive sufficiently informative mismatches or five minutes without strong corroboration require a fresh normal login. Hard automation, invalid windows or replay stop the monitoring session. `OBSERVE` does not grant or renew login authority; `allowed` is always false. Touch-only activity often has insufficient comparable evidence and eventually requires login. Monitoring never trains any profile and is not a protected-resource/session framework for another application. Client stop removes listeners/timers, server stop revokes further windows, and expired/stopped sessions cannot be restarted from the same login.

## Verification performed

Synthetic coverage spans combined enrollment, passive acceptance, autofill step-up with active acceptance, low passive identity with active rejection, wrong password, replay, malformed password telemetry, cookie binding, repeated step-up rejection and unknown-device candidate creation. The HTTP tests cover the separate password boundary and confirm that the demo credential is absent from stored passive sessions. Browser checks cover the normal form and the automatic transition to an active panel after an autofill-style attempt.
