# BioPrint — log in with the way you type and move

Behavior-based login security. A normal username/password form is observed from the moment it renders: keystroke rhythm, the pointer's path to the button, the click, and the pauses between them. The password is verified separately and deleted before the behavioral engine sees the request. If the behavior does not match the account's enrolled profile, the login is blocked or challenged, with no OTP fallback. Scripted, bot-driven and replayed logins are flagged as a **separate fraud signal** and blocked outright.

Zero dependencies. Node 24+ built-ins only (HTTP, SQLite, crypto). Decisions take single-digit milliseconds, and every one comes with a plain-English explanation.

## Quick start

Requirements: Node 24 or newer (`node --version`), Chrome, and a physical keyboard with a mouse or trackpad. There is nothing to install.

```bash
npm start
```

Open <http://127.0.0.1:3000>: the demo login page.

```bash
npm run example:shop
```

Open <http://localhost:3210>: Verdant, a small shop that mounts BioPrint the way a real application would.

Put `HOST=0.0.0.0` in front of either command to open it to other devices on the same network, at `http://<your-lan-ip>:<port>`.

Three things to know before you type:

1. **Enrollment is a person typing.** Scripted or automated typing is detected and rejected by design, and pasted text carries no rhythm to learn from, so the profile has to come from someone at the keyboard. Eight ordinary logins plus six short phrase-and-targets rounds, about two minutes.
2. **Enroll and log in on the same machine.** Key hold times are keyboard-specific; a profile trained on one laptop legitimately fails on another. A new browser install always gets the step-up check. Test the impostor case by handing the same keyboard to someone else.
3. **Start clean.** Open **Manage users** on the demo page and click **Clear everything** so every profile is trained on the current matcher.

## The demo login page

**Enroll.** Type a username, choose a password (at least eight characters), click **Enroll**. The login card switches to *Enrolling* and walks through the rounds:

- **Typing rounds, 8.** One ordinary login per round: type the username, type the password, move to the button, click. This is the passive profile, the one every real login is checked against.
- **Movement rounds, 6.** Type a short phrase and click the targets. This is the step-up profile, used only when a login is uncertain.

The counters are fixed. If the server finds two rounds that disagree it asks for one more, shown as *Extra typing round 1*, and the target never grows. When both profiles are saved the card flips back to *Log in* with an **ENROLLED · LOG IN NOW** badge.

**Log in.** Type the username and password and press the button. The verdict panel shows ACCEPTED, STEP-UP (one ten-second active check) or BLOCKED, the identity confidence against your personal threshold, the decision latency, and one line per signal saying what was seen against what was enrolled.

**Impostor test.** Hand the keyboard to a teammate. Same password, different rhythm; the mismatched signals appear in the verdict panel and the login is stepped up or blocked.

**What BioPrint sees.** Under the form, a live strip shows the keystroke intervals and pointer samples as they are captured: timing and motion only, never the password itself.

**Manage users** (under the account card) lists every account with its enrollment state, deletes one (account, profile and every recording together) or clears everything.

URL hook for a rehearsed opening: `?auto=enroll&user=NAME`.


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

