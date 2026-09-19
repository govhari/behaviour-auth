# BioPrint — log in with the way you type and move

Behavior-based login security. A normal username/password form is observed from the moment it renders: keystroke rhythm, the pointer's path to the button, the click, and the pauses between them. The password is verified separately and deleted before the behavioral engine sees the request. If the behavior does not match the account's enrolled profile, the login is blocked or challenged, with no OTP fallback. Scripted, bot-driven and replayed logins are flagged as a **separate fraud signal** and blocked outright.

Zero dependencies. Node 24+ built-ins only (HTTP, SQLite, crypto). Decisions take single-digit milliseconds, and every one comes with a plain-English explanation.

## How it works

Full description: [docs/ALGORITHM.md](docs/ALGORITHM.md). Submission report: [docs/REPORT.md](docs/REPORT.md).

```
ambient (pre-login, optional) -> passive login -> active step-up (only if needed) -> monitoring
```

- **Fingerprint.** Robust statistics per modality: username rhythm (per-key hold, digraph latencies, flight, pauses), password rhythm (timing and ordinal position only, never keys), pointer dynamics (chord-normalized speed, acceleration, curvature, turning angle, overshoot, approach angle), click (hold, hover, position in button), and cross-modal pauses.
- **Per-user model.** Median centre and MAD scale per feature, Gaussian similarity per feature, weighted geometric-mean fusion so no single modality can carry a mismatch, and a per-user threshold from leave-one-round-out calibration of the person's own enrollment.
- **Four separate gates.** Identity, evidence quality, humanity, freshness. Low identity means "ask again" (step-up) or "block" (clear mismatch); a failed humanity or freshness gate is fraud.
- **Bot and replay detection.** Uniform inter-key timing, implausible speed, metronomic straight pointer paths, script-dispatched (`isTrusted=false`) events, no keyboard-to-pointer hand-over pause; exact replay by canonical hash, near replay by normalized timing and path comparison.
- **Explainability.** Every decision carries `explanation` (headline, summary, one signal per modality and gate with the value seen versus the enrolled median, and a fraud list), `fraudSignals` and `latencyMs`.
- **Step-up.** One active challenge bound to the same login, cookie, user and device; passive and active scores are fused active-dominant, and the final answer is ACCEPT or REJECT.
- **Devices.** Profiles are per device. A known device can be accepted on the passive stage alone; a new browser install always steps up.
- **Also built.** Live dashboard with confidence and explanation; keyboard, mouse/trackpad, touch/pen drag and optional motion sensors in one profile; quarantined profile adaptation (four consistent high-confidence samples at least ten minutes apart, thresholds never lowered); post-login monitoring that can only shorten a session.

