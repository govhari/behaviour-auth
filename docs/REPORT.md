# BioPrint — Behavior-Based Login Security

**Track:** Event 2, BioPrint: Behavior-Based Login Security · **Team submission report (1–2 pages)**

## 1. The idea

Passwords prove what you know. BioPrint proves *who is typing*. A normal username/password form is observed from the moment it renders: the rhythm of the keystrokes, the path the pointer takes to the button, the click itself, and the pauses between them. The password is checked separately by the host application and is deleted before the behavioral engine sees the request; the fingerprint is independent of the password by construction (password keys are never recorded, only their timing and ordinal position).

A login has one of three outcomes and none of them is an OTP:

| Outcome | When | What the user sees |
| --- | --- | --- |
| **ACCEPT** | correct password, behavior matches the enrolled profile on a known device, evidence is complete, human and fresh | logged in, typically in a few milliseconds of server time |
| **STEP-UP** | correct password but behavior uncertain (new device, thin evidence, identity below the user's bar) | one 10-second active check: type a short phrase, click three randomized targets. The final decision fuses both and is ACCEPT or REJECT |
| **REJECT / BLOCKED** | replayed input, scripted/bot input, hard identity mismatch after step-up, or wrong password | blocked, with a plain-English explanation of which signals failed |

Bots and replays are a **distinct fraud signal**, never averaged into the identity score: a perfect imitation of the timing is still blocked if it was dispatched by a script.

## 2. The fingerprint (core logic)

Every capture is reduced to robust statistics per modality. Full detail: `docs/ALGORITHM.md`.

- **Username rhythm:** key hold (dwell), inter-key interval (flight), release-to-press gap, overlap, corrections, pauses, bursts, Shift/modifier use, and **per-key hold times and digraph latencies** of the (non-secret) username.
- **Password rhythm:** the same timing statistics over ordinal, category-only key events. No key, code or value is ever captured or stored.
- **Pointer:** speed and entry speed normalized by the chord (so target distance is not identity), acceleration, straightness, turning angle, curvature, overshoot, correction rate, approach angle.
- **Click:** hold time, hover-before-click, position within the button.
- **Cross-modal:** username→password pause, last-key→first-move gap, travel time, Tab-vs-click field changes.

**Per-user model.** Each feature gets a centre (median) and scale (1.4826 × MAD, floored at a physical minimum) from the enrollment rounds, plus a reliability weight. Medians and MAD are used instead of mean and standard deviation so one distracted round cannot move the model. This is the *scaled-Manhattan* family that Killourhy & Maxion (DSN 2009) found best on the CMU keystroke benchmark.

**Similarity and fusion.** Each feature scores `exp(−z²/2)`, z clipped at 4 scales. Modality scores are weighted **geometric means** of feature scores; the identity score is the geometric mean over modalities (username 0.2, password 0.3, pointer 0.25, click 0.1, cross-modal 0.15) times the evidence quality actually captured. A geometric mean cannot be carried by one strong modality: a wrong password rhythm drags the score down even if the mouse looks right. Missing modalities (autofill, no pointer) lower quality; they never renormalize confidence upward.

**Per-user threshold.** Leave-one-round-out calibration scores each enrollment round against the others and sets the bar at `median − 3·MAD`, clamped to [0.85, 0.97]. Each user carries their own threshold, calibrated to their own consistency.

**Four separate gates.** Identity (score ≥ threshold), evidence quality (≥ 0.75), humanity (≥ 0.8 and no hard automation rule), freshness (single-use server challenge, no exact/near replay). They are deliberately not fused: low identity means "ask again", a failed humanity or freshness gate means "fraud".

**Bot / replay rules (human-readable, independent of identity):** uniform inter-key timing (MAD < 1 ms), low-entropy intervals, implausible speed (hold < 8 ms), mathematically straight pointer path sampled on a metronome, every event `isTrusted=false`, no hand-over pause between keyboard and pointer; exact replay via SHA-256 of the canonical origin-shifted event list; near replay via scale-normalized timing and path comparison against the user's last 128 recordings.

**Active step-up matcher.** Same feature families over a known phrase and randomized targets, plus dynamic time warping (Sakoe–Chiba band) against up to 24 enrollment exemplars, fused with the statistical score and digraph context.

**Explainability.** `server/explain.js` reads back the terms the matcher computed and produces a headline, a summary, one signal per modality/gate with the value seen vs the enrolled median ("password inter-key interval 52% longer than enrolled, 243 ms vs 160 ms, 2.8 scales off"), and a fraud list. Nothing in it decides anything.

## 3. Evidence

{{BENCHMARK_SECTION}}

Latency: server decision compute time is reported on every result (`latencyMs`); measured p50 ≈ 3 ms, p95 ≈ 3 ms over 200 passive logins, ≈ 5 ms for a fused step-up decision.

## 4. Enrollment and demo

Enrollment is the user's own login, repeated: 8 natural logins (10 recommended) calibrate the passive model; 6 short phrase-and-targets rounds (8 recommended) calibrate the step-up model. The wizard auto-advances and reports readiness from the server (`readyToComplete`). The demo page shows: a genuine enrollment and login (ACCEPT, with the confidence meter and the per-signal explanation), a teammate typing the correct password (mismatch signals → step-up or block), a **scripted bot login** dispatched by a page script through the same capture path (REJECT, `AUTOMATION_RISK`), and a **replay** of the last captured login (REJECT, `EXACT_REPLAY`).

Stretch goals covered: confidence score and live dashboard, human-readable explanation of every decision, multiple modalities in one profile (keyboard, mouse/trackpad, touch/pen drag challenge, optional motion), quarantined profile adaptation (four consistent high-confidence samples, ≥10 minutes apart, thresholds never lowered).

## 5. Why not a neural network

A per-user robust-statistics model is fully determined by ten logins, is explainable by construction, decides in milliseconds with zero dependencies, and matches the strongest detectors on the CMU benchmark at small enrollment sizes. Limits we state plainly: thresholds from leave-one-round-out estimate genuine variation, not impostor rates; the advanced DTW matcher and adaptation are gated behind a recorded, session-separated evaluation report rather than switched on by synthetic data.

**References.** Killourhy & Maxion 2009 (DSN); Monrose & Rubin 2000 (FGCS); Gamboa & Fred 2004 (SPIE); Ahmed & Traore 2007 (IEEE TDSC); Zheng, Paloski & Wang 2011 (CCS); Sakoe & Chiba 1978 (IEEE TASSP); Bours 2012 (ISTR).
