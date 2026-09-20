# BioPrint: how a login is decided

BioPrint authenticates people by *how* they log in, not only by what they know. A correct password is the ticket to the door; behavior decides whether the door opens. There is no OTP fallback: when behavior does not match, the person gets an active challenge, and when the input is not a person at all, the attempt is flagged as fraud and blocked outright.

## Pipeline

```
ambient (pre-login, optional)  ->  passive login  ->  active step-up (only if needed)  ->  monitoring
   free-form typing/mouse          username, password,     type a phrase, click       30 s windows of
   on the page before any          pointer path to the     randomised targets         ordinary activity,
   identity is claimed             button, the click                                  renewed by evidence
```

1. **Passive login.** The browser records the timing of the username and password keystrokes (never password keys), the pointer path to the submit button and the click itself. The server verifies the password through the host application's own callback, then scores the behavior against the user's enrolled profile. Outcome: `ACCEPT`, `STEP_UP` or `REJECT`.
2. **Active step-up.** Only on `STEP_UP`. One challenge, bound to the same login attempt, cookie, user and device: type a short known phrase and click three or four randomly placed targets. The final decision fuses the passive and active scores, active-dominant (`0.35 x passive quality` vs `0.65 x active quality`), and cannot rescue a failed active gate.
3. **Monitoring.** After an accepted login, free-form activity is scored in nonce-bound windows. Monitoring can only *shorten* a session, never extend authority: three consecutive mismatches or five stale minutes force a fresh login.
4. **Ambient evidence** collected before any identity is claimed is attacker-controlled, so it may only withhold confidence (object) and never supply it.

Every stage runs the same four **separate gates**: identity, evidence quality, humanity and freshness. They are deliberately not fused into one number, because a low identity score means "ask again" while a failed humanity or freshness gate means "this is fraud".

## The fingerprint

Each capture is reduced to a fixed vocabulary of robust statistics per modality:

| Modality | Features (medians unless stated) |
| --- | --- |
| Username rhythm | key hold (dwell), inter-key interval (flight), release-to-press gap, overlap rate, correction rate, pause rate/length/spread, burst length, modifier and Shift use, **per-key hold time and digraph latency** for the letters and letter pairs of the (non-secret) username. Trigraph latencies were dropped in passive-4: a trigraph is the sum of two digraphs already in the model, so it added correlated noise, while per-key hold time is the most discriminative keystroke family and was missing |
| Password rhythm | the same timing features from ordinal key events only, plus **per-position hold and press-to-press latency** (`pos:3:dwell`, `pos:3-4:dd`): the recorder keeps the slot and the category of a password key, never the key, so the model learns how *this* person types the third character without knowing what it is. On CMU this is the difference between 18.4% and 8.2% EER |
| Pointer movement | speed and entry speed (normalised by the chord so target distance is not identity), acceleration, path straightness, turning angle, curvature, overshoot, direction-correction rate, approach angle |
| Click | hold time, hover before click, position across and down the button |
| Cross-modal | username-to-password pause, last-key-to-first-move gap, travel time, Tab vs click to change fields |

The active challenge adds the same families over a known phrase and randomised targets, plus per-segment sequences (velocity profile, curvature, movement-normalised trajectory) for the exemplar matcher.

**Per-user model.** For every feature the enrollment rounds give a *centre* (median) and a *scale* (`1.4826 x MAD`, floored at a physical minimum such as 15 ms for dwell) and a reliability weight `floor/scale` in `[0.25, 1]`. Medians and MAD are used instead of mean and standard deviation because a single distracted round must not move the model; this is the "scaled Manhattan" family that Killourhy and Maxion (2009) found to be the best-performing detector on the CMU keystroke benchmark, and the robust-statistics choice goes back to Monrose and Rubin (2000).

**Similarity.** Each feature scores `exp(-z^2/2)` with `z = |value - centre| / scale`, clipped at four scales. A modality score is the weight-weighted **geometric mean** of its feature scores; the identity score is the geometric mean over modalities, weighted by a static table (`username 0.2, password 0.3, pointer 0.25, click 0.1, cross-modal 0.15`) times the evidence quality each modality actually carried. A geometric mean cannot be carried by one strong modality: a badly wrong password rhythm pulls the whole score down even if the mouse looks right. Modalities with no evidence (autofill, no pointer) drop out of the mean and *lower the quality*; they never renormalise confidence upward.

**Per-user bars: the three-band decision.** A geometric mean of per-feature kernels has no absolute scale: the more features a modality carries, the lower *everyone* scores (real typists score 0.15-0.6 on a 30-feature field, 0.85+ is what synthetic fixtures produce). So both bars come from the person's own enrollment. Each round is scored against a model built from the other rounds (leave-one-round-out, LOO), and:

| Bar | Rule | Meaning |
| --- | --- | --- |
| **accept** | `clamp(p10(LOO), 0.40, 0.90)` — with ten rounds, the lowest of your own rounds | "at least as close as your worst enrollment round" |
| **reject** | `min(0.4 x p10(LOO), accept - 0.1)` (raw LOO units, no floor) | "far below anything your own rounds ever scored" |
| **active** | `clamp(p10(LOO), 0.65, 0.90)` on the four-feature challenge model | same rule, its own scale |
| **final** | the passive and active bars fused with the same weights as the scores: `(w_p·T_p + w_a·T_a)/(w_p+w_a)` | each stage is held to its own bar |

score >= accept → `ACCEPT`; score < reject with complete, good-quality evidence on a trusted device → `REJECT` (`IDENTITY_MISMATCH`: blocked on behavior alone, no OTP, no challenge); in between → `STEP_UP`, the active challenge decides. Older profiles keep their model and have both bars recomputed from the LOO scores they already store, so nothing hides behind a floor that no longer exists.

Why these rules, measured (genuine step-up rate / impostor passive accept; `tools/benchmark-cmu.js` on 51 real CMU typists, keystroke-only single field, and `tools/simulate.js`, 30 personas through the full login):

| Accept rule | Simulation | CMU 10 rounds, password field | CMU 10 rounds, username field | CMU 200 rounds, password field |
| --- | --- | --- | --- | --- |
| old: `max(0.85, median-3·MAD)` | 96.5% / 0.0% | 60.8% / 1.6% | 95.8% / 0.0% | 59.0% / 3.9% |
| `p10(LOO)` unclamped | 4.5% / 7.9% | 19.1% / 7.9% | 11.7% / 18.1% | 8.2% / 11.7% |
| `median - 2·MAD` clamp [.4,.9] | 12.3% / 2.4% | 46.7% / 0.4% | 44.6% / 1.5% | 18.0% / 5.0% |
| **`p10(LOO)` clamp [.4,.9]** (passive-4) | **6.8% / 2.9%** | **30.4% / 1.1%** | **29.0% / 1.3%** | **13.4% / 6.6%** |
| fixed 0.5 | 29.5% / 0.5% | 41.5% / 0.4% | 49.5% / 0.7% | 26.0% / 2.9% |

The non-bold rows were measured on passive-3, before the username field learned per-key hold times; the username-field scale moved with the feature count (the same fixed 0.5 now steps up 78% of genuine ten-round CMU logins there), which is itself the argument for per-user bars. The percentile rule dominates every `median - k·MAD` rule at equal FAR; the 0.40 floor exists because a 30-feature modality has LOO minima near 0.15, where 18% of impostors would pass. The reject bar at `0.4 x p10`: genuine hard-blocks 0.0% (simulation), 0.5-0.6% (CMU, 200 rounds), 2.0-2.6% (CMU, 10 rounds, test sessions days later: the worst case for drift); zero-effort impostors blocked outright 43% (simulation, where they otherwise step up), 54-73% (CMU); humanity-passing randomised bots 80%; 50%-mimics 2.2%. The CMU single-field numbers bound the product from below: the real login fuses five modalities, which is what the simulation column measures.

**Mouse features** follow Gamboa and Fred (2004) and Ahmed and Traore (2007): speed, acceleration, straightness and click timing over normalised segments; the angle-based features (turning angle, curvature, approach angle) follow Zheng, Paloski and Wang (2011), who showed angle statistics are stable across sessions and hard to imitate.

**Exemplar matching (advanced matcher).** The active verifier also keeps up to 24 phrase-balanced enrollment recordings and compares sequences with **dynamic time warping** (Sakoe and Chiba, 1978) inside a Sakoe-Chiba band, fusing the DTW distance with the statistical score and digraph context. It runs in shadow by default and is only switched on by a recorded, session-separated evaluation report, because synthetic data cannot licence a matcher.

## The four gates

| Gate | Question | Passes when |
| --- | --- | --- |
| Identity | Does this behavior match this user? | fused score >= the user's accept bar; below the reject bar it is a hard block (see three-band decision) |
| Evidence quality | Is there enough comparable evidence to judge? | quality >= 0.75 passive, 1.0 active, complete and uninterrupted capture |
| Humanity | Was this produced by a hand? | human score >= 0.8 passive / 0.6 active, and no hard automation rule fired |
| Freshness | Is this a new performance? | one-time challenge consumed; no exact or near replay against recent recordings |

A trusted device is required for passive `ACCEPT` and for the identity `REJECT` band; a new browser installation always steps up. Automation and replay reject regardless of identity. An Enter-key submit is a complete capture: the held Enter is the expected shape, quality is judged against the evidence a keyboard submit can carry (no pointer approach, no click), and identity then rests on the two keystroke modalities plus the field transition.

## Bot and replay detection

Fraud is decided by rules a judge can read back, independent of identity:

- **Uniform timing**: inter-key intervals with a MAD under 1 ms (a script on `setTimeout`), or low-entropy intervals falling into a few bins.
- **Implausible speed**: median key hold under 8 ms or interval under 20 ms.
- **Synthetic pointer path**: a mathematically straight path (`straightness > 0.9999`, turning < 0.001 rad) *sampled on a metronome* (interval MAD < 0.1 ms). Either alone is a weak hint; together they are hard automation.
- **Script-dispatched events**: every keystroke and pointer event carrying `isTrusted=false` is hard automation; a few such events are only a hint, so an extension cannot lock a person out.
- **No hand-over pause**: pointer motion within 5 ms of the last keystroke.
- **Replay**: an exact replay is a SHA-256 over the canonical, origin-shifted event list; a near replay compares scale-normalised timing deltas and the pointer path against the last 128 recordings for that user. Both are hard rejects.

Each weak hint deducts from a humanity budget; several hints together (below 0.45) also become hard automation. The result carries `fraudSignals` (the codes) and `hardSignals` (the rules that fired) so the UI can show fraud as its own lane, separate from the identity meter.

## Explainability

`server/explain.js` turns every decision into `result.explanation`: a verdict, a one-sentence headline, a 1-3 sentence summary, the displayed confidence, one signal per modality and gate, and a fraud list. Nothing in it decides anything; it reads back the terms the matcher already computed. With the `explain` option on (the demo server), each modality signal quotes the features that moved its score: the value seen, the enrolled median and how many scales off, e.g. *"Password inter-key interval was 52% longer than the enrolled median (243 ms vs 160 ms, 2.8 scales off)."* Without the option, only score-versus-threshold is described, because the centres and scales are the profile itself. `latencyMs` on every result is the decision time alone (parse, match, decide), typically 1-5 ms.

## Enrollment cost

| Stage | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Passive rounds (natural logins) | 8 | 10 | On the synthetic personas ten rounds accept the owner 87% of the time, eight rounds 83%. Eight is allowed only when the rounds already agree with each other: the unclamped calibrated threshold is at least 0.8 and at most one round would itself have stepped up. That gate lifts the eight-round subset to about 86%. The trade is two fewer logins on stage against roughly one extra step-up in thirty logins; a step-up is friction, not a lockout. |
| Active rounds (phrase + targets) | 6 | 8 | The four-feature active model has physical scale floors, so its leave-one-out threshold is flat from five rounds up (median LOO score 0.96 at five, six and eight). The extra rounds bought exemplars for the shadow DTW matcher, not a better threshold; the enrollment phrase corpus is narrowed to two phrases so six rounds still give three exemplars per phrase. |

Every enrollment response reports `passiveRoundsRequired`, `passiveRoundsRecommended`, `activeRoundsRequired` and `activeRoundsRecommended`; each accepted passive sample reports `readyToComplete` and the `roundsRequired` at which completion is next possible. Nothing about challenge consumption, binding, replay detection or the separation of humanity from identity changes with the count.

## Adaptive drift

An accepted passive login whose score sits half way between the person's accept bar and a perfect score (`T + 0.5·(1-T)`; the old fixed 0.97 was above anything a human scores) enters a quarantine: four such samples, each at least ten minutes apart, each as close to the others as it must be to the profile (scored on the anchor's own scales), are then folded into the device model. The original enrollment stays as an immutable anchor, bars never decrease, and only the trusted device model moves. Off by default (`passiveAdaptation` policy flag).

## Why no machine-learning model

- **Ten samples.** A per-user robust-statistics model is fully determined by ten logins; a classifier that needs hundreds of samples per user, or an impostor population to train against, cannot enroll a new user in a minute on stage.
- **Explainable by construction.** Every score is a product of per-feature terms with a physical unit, so the explanation *is* the computation, not a post-hoc approximation of it.
- **Millisecond latency.** Scoring is a few hundred exponentials over a JSON object: 1-5 ms per decision, no model serving, no dependencies.
- **Competitive.** On the CMU benchmark the scaled-Manhattan family matched or beat the neural and SVM detectors evaluated by Killourhy and Maxion (2009) at small enrollment sizes, and continuous-authentication trust models such as Bours (2012) are built on exactly these per-sample similarity scores.
- **Honest limits.** Bars derived from leave-one-round-out estimate the person's own variation, not impostor rates; the clamps carry the impostor evidence from CMU and the simulation. Real multi-modal FAR/FRR require recorded, session-separated human data (CMU is keystroke-only), which is why the advanced matcher and adaptation are gated on an evaluation report rather than switched on.

## References

- Killourhy, K. S. and Maxion, R. A. (2009). Comparing anomaly-detection algorithms for keystroke dynamics. *DSN 2009*.
- Monrose, F. and Rubin, A. D. (2000). Keystroke dynamics as a biometric for authentication. *Future Generation Computer Systems* 16(4).
- Gamboa, H. and Fred, A. (2004). A behavioral biometric system based on human-computer interaction. *SPIE 5404*.
- Ahmed, A. A. E. and Traore, I. (2007). A new biometric technology based on mouse dynamics. *IEEE TDSC* 4(3).
- Zheng, N., Paloski, A. and Wang, H. (2011). An efficient user verification system via mouse movements. *ACM CCS 2011*.
- Sakoe, H. and Chiba, S. (1978). Dynamic programming algorithm optimization for spoken word recognition. *IEEE TASSP* 26(1).
- Bours, P. (2012). Continuous keystroke dynamics: a different perspective towards biometric evaluation. *Information Security Technical Report* 17(1-2).
