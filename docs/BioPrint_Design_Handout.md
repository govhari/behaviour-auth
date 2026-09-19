---
title: "BioPrint: Deterministic Behavioral Authentication SDK"
subtitle: "Complete architecture, enrollment, matching, device migration, anti-spoofing, evaluation, and implementation handout"
author: "Design handout"
date: "19 September 2026"
geometry: margin=0.72in
fontsize: 10pt
toc: true
toc-depth: 3
colorlinks: true
linkcolor: NavyBlue
urlcolor: Blue
header-includes:
  - \usepackage{booktabs}
  - \usepackage{longtable}
  - \usepackage{array}
  - \usepackage{microtype}
  - \usepackage{xcolor}
  - \usepackage{enumitem}
  - \setlist{nosep}
---

# Executive summary

BioPrint should be implemented as a **deterministic behavioral verification system**, not as a classifier and not as a browser/device fingerprinting system. A website integrates a JavaScript SDK that records a fresh, server-issued behavioral challenge. The server retains complete trusted behavioral recordings, derives robust statistical features, compares time-series recordings against a bank of prior genuine exemplars, evaluates separate human/automation and replay signals, and applies a hard-gated decision policy.

The central decision rule is:

$$
\boxed{
Accept \iff
S_{identity} > \tau_I
\land S_{human} > \tau_H
\land Fresh
\land Quality \ge q_{min}
}
$$

The design deliberately keeps four concepts separate:

1. **Identity similarity** - does the trace resemble the claimed user's previous behavior?
2. **Humanity / automation risk** - does the trace look like a live human interaction rather than a script?
3. **Freshness** - is this a new response to the current server challenge rather than a replay?
4. **Device context** - which previously observed device/modality profile, if any, should be used?

This separation follows the Event 2 requirement to distinguish genuine users, impostors with the correct password, and non-human/replayed attempts [R1]. It is also consistent with attack literature showing that human mimicry, synthetic forgery, and replay are distinct failure modes rather than one generic "bad login" class [R7, R10, R11].

The system stores both **raw trusted sessions** and **derived profiles**:

$$
Profile_u = \{Shared_u, DeviceProfiles_u, RawHistory_u, Calibration_u\}
$$

This is intentionally more information-rich than a centroid-only behavioral template. Sequence-oriented keystroke work has shown that preserving temporal signal structure and using alignment methods such as Dynamic Time Warping (DTW) can improve discrimination over simpler representations in the studied datasets; the magnitude is dataset-specific and must be measured locally [R12].

> **Mental model:** BioPrint does not ask "is this vector Alice?" It asks: **"Is this fresh response statistically and sequentially consistent with the ways Alice has behaved before, under this input modality and this challenge?"**

# 1. Scope and event alignment

The Event 2 brief requires: an enrollment flow; a password-independent behavioral fingerprint; a live comparison that can reject an impostor even when the password is correct; distinct detection of bots/scripts/replayed input; and a demo showing genuine acceptance and impostor/bot rejection. Multiple modalities, confidence/explainability, and adaptive profiles are listed as stretch goals [R1].

The proposed system is therefore scoped as follows:

| Requirement | BioPrint implementation |
|---|---|
| Enrollment | 8-12 randomized behavioral rounds, then per-user calibration |
| Password-independent profile | challenge behavior, not password content, forms the biometric profile |
| Live verification | server-side statistical + exemplar + sequence comparison |
| No OTP fallback | insufficient evidence triggers more behavioral interaction, not OTP |
| Bot/script signal | independent deterministic humanity/risk engine |
| Replay detection | fresh nonce/challenge + exact/near-replay checks |
| Multiple modalities | keyboard + pointer/touch + scroll + optional motion + cross-modal timing |
| Explainability | per-modality scores and reason codes |
| New devices | shared profile + longer bootstrap challenge + candidate device profile |

**Design decision D1 - Treat this as probabilistic verification, not proof of identity.** Behavioral biometric literature reports non-zero false accept and false reject rates even under controlled protocols, and evaluation conditions materially change reported performance [R2, R6]. The architecture must therefore expose uncertainty, thresholds, and an `INSUFFICIENT_EVIDENCE` outcome rather than pretending each interaction is definitive.

# 2. Threat model and explicit non-goals

BioPrint evaluates the following attackers:

| Attacker | Capability | Primary defense |
|---|---|---|
| A0: zero-effort human | knows password, behaves normally | identity mismatch |
| A1: informed mimic | observes/practices target behavior | multimodal + sequence + cross-modal matching |
| A2: naive automation | fixed/random timing, scripted pointer | humanity heuristics + identity mismatch |
| A3: replay attacker | possesses a genuine recorded event stream | fresh challenge + replay detector |
| A4: statistical synthesizer | samples target timing distributions | higher-order sequence/context + challenge conditioning |
| A5: browser automation | WebDriver or browser-level action dispatch | behavior/challenge checks; webdriver only a weak hint |
| A6: fully compromised endpoint | can modify JS/browser/OS and synthesize arbitrary input | **not fully solvable by a JS plugin** |

Mimicry attacks against smartphone keystroke authentication demonstrate that targeted attackers can materially improve their ability to imitate behavioral features [R7]. Synthetic-forgery research likewise shows that the correct threat model must include programmatically generated behavior rather than only human impostors [R10, R13]. Replay attacks are a specific known weakness of unbound keystroke-dynamics protocols [R11].

**Design decision D2 - Do not claim endpoint attestation or cryptographic liveness.** WebDriver is specified to dispatch trusted events that are intended to be indistinguishable from user-generated browser events, including `isTrusted=true` for activation triggers [R18]. A JavaScript SDK therefore observes browser events, not an independently trusted physical human. The product goal is to increase spoofing cost and detect common attacks, not to prove that every event originated from a human hand.

# 3. System architecture

```text
                         Integrating website
                               |
                        BioPrint JS SDK
                               |
             +-----------------+-----------------+
             |                                   |
       Passive collection                 Active challenge
       keyboard / pointer                 typing / target
       touch / scroll                     scroll / reaction
       focus / motion                     randomized geometry
             |                                   |
             +-----------------+-----------------+
                               |
                      raw event payload
                               |
                               v
                       BioPrint server
        +----------------------+----------------------+
        |                      |                      |
 challenge service      profile repository      verifier
 nonce/expiry/use       raw trusted history     features
 randomized task        device subprofiles      DTW/exemplar
                                                stats/fusion
        |                      |                      |
        +----------------------+----------------------+
                               |
                      policy / decision
                               |
                ACCEPT / REJECT / MORE_DATA
```

**Design decision D3 - The SDK records; the server decides.** The integrating page and its JavaScript execution environment are attacker-modifiable. Final scoring thresholds, enrolled templates, trusted history, challenge state, and authorization decisions therefore remain server-side. This is a standard web-security trust-boundary decision. It is especially important here because WebDriver and browser automation can generate browser-trusted events [R18].

Recommended public SDK surface:

```javascript
const bp = BioPrint.init({ endpoint: "/api/bioprint" });

await bp.enroll({ userId: "alice" });

const result = await bp.authenticate({ userId: "alice" });
```

Recommended server API:

```text
POST /bioprint/enroll/start
POST /bioprint/enroll/sample
POST /bioprint/enroll/complete
POST /bioprint/auth/challenge
POST /bioprint/auth/verify
GET  /bioprint/profile/:userId/status
```

# 4. Browser data acquisition

## 4.1 Pointer and touch

Pointer Events provide a hardware-agnostic event family for mouse, pen, and touch. The standard exposes coordinates and, where supported, contact geometry, pressure, tilt, and coalesced high-frequency movement data [R16]. The standardized `pointerType` values are `mouse`, `pen`, and `touch`; a browser page should **not** assume it can reliably distinguish a laptop trackpad from an external mouse solely through `pointerType` [R16].

Capture, when available:

```text
pointerdown / pointermove / pointerup / pointerrawupdate
clientX, clientY, event.timeStamp
pointerType, buttons
width, height, pressure
tiltX, tiltY, twist
getCoalescedEvents()
```

**Design decision D4 - Prefer Pointer Events as the common pointer/touch collection API, with capability detection.** This minimizes device-specific client code while preserving touch/pen-specific fields when the browser exposes them [R16]. Missing sensor fields are `UNAVAILABLE`; they must not be numerically treated as behavioral zeros.

**Gotcha:** Pointer movement may be coalesced by the browser. `getCoalescedEvents()` can recover more granular samples where supported, but support and sampling behavior remain browser/device dependent [R16].

## 4.2 Keyboard

For each non-secret challenge character, record:

```text
keydown / keyup
key or code
repeat
modifier state
event.timeStamp
```

Core timing primitives are:

$$
D_i = t^{up}_i - t^{down}_i
$$

$$
DD_i = t^{down}_{i+1} - t^{down}_i
$$

$$
UD_i = t^{down}_{i+1} - t^{up}_i
$$

The classic Killourhy-Maxion benchmark used repeated fixed-text password samples and demonstrated both that keystroke timing is discriminative and that error rates remain substantial enough to require careful evaluation rather than treating typing rhythm as a perfect identifier [R2].

**Design decision D5 - Use generated non-secret challenge phrases for rich key-context features; do not rely on password contents.** This preserves password independence as required by the brief [R1] and allows transition-specific statistics such as `th`, `ing`, `space->letter`, or left-hand/right-hand alternation without turning the password itself into the biometric template.

## 4.3 Scroll, focus, and optional motion

Record wheel/scroll deltas and timestamps, document visibility/focus transitions, and - only when available and explicitly supported by the browser/device - motion/orientation streams.

HMOG showed that hand movement, orientation, and grasp-related smartphone behavior can complement tap and keystroke features, with multimodal combinations outperforming individual studied modalities in that dataset [R4].

**Design decision D6 - Treat motion and scroll as secondary modalities, not mandatory gates.** Their availability and hardware dependence are higher than keyboard or pointer behavior. A missing modality reduces evidence quantity; it does not constitute a mismatch. This follows the broader multimodal continuous-authentication literature, where usable modality sets depend on device and user context [R4, R15].

## 4.4 Timing source

`Event.timeStamp` is a `DOMHighResTimeStamp`, but browsers may reduce precision for security/fingerprinting reasons. Current browser behavior can range from sub-millisecond precision to much coarser values under privacy protections [R20].

**Design decision D7 - Design features on human-scale timing (typically tens to hundreds of milliseconds), not microsecond assumptions.** Browser scheduling, event coalescing, timer quantization, device latency, and main-thread load are nuisance variables. Robust statistics and sequence shape matter more than extremely fine timing precision [R16, R20].

# 5. Behavioral signals and derived features

## 5.1 Keyboard features

Store both complete event sequences and derived features:

- dwell/hold time distribution;
- DD/UD/UU flight times;
- digraph/trigraph timing keyed by known challenge text;
- overlap ratio (next key pressed before prior key release);
- pause quantiles and burst lengths;
- correction/backspace frequency and correction latency;
- modifier use and shift-release timing;
- sequence-level timing vector.

**Design decision D8 - Preserve transition context rather than reducing typing to WPM or one global mean.** Keystroke research relies on multiple timing dimensions, and sequence-oriented work reports improved discrimination when richer temporal structure is retained [R2, R12].

## 5.2 Pointer/touch features

Normalize coordinates to the rendered challenge region:

$$
x'_i = \frac{x_i-x_0}{W}, \qquad
y'_i = \frac{y_i-y_0}{H}
$$

For a trajectory $p_i=(x_i,y_i)$:

$$
v_i = \frac{\lVert p_i-p_{i-1}\rVert}{\Delta t_i}
$$

$$
a_i = \frac{v_i-v_{i-1}}{\Delta t_i}
$$

$$
j_i = \frac{a_i-a_{i-1}}{\Delta t_i}
$$

Path efficiency:

$$
E = \frac{\lVert p_{end}-p_{start}\rVert}
{\sum_i \lVert p_i-p_{i-1}\rVert}
$$

Additional features:

- curvature and turn-angle distributions;
- acceleration/deceleration profile;
- overshoot and corrective submovements;
- target approach angle;
- arrival-to-click latency;
- click dwell (`pointerdown` to `pointerup`);
- touch contact width/height and pressure when meaningful;
- complete velocity and curvature time series.

Mouse-dynamics literature includes trajectory, movement, click, temporal, curvature, velocity, acceleration, and fusion features, and recent survey work emphasizes that practical effectiveness depends strongly on collection protocol and evaluation design [R9, R14]. Touchalytics similarly showed that ordinary touch trajectories contain discriminative behavioral information but vary across sessions and time [R3].

**Design decision D9 - Match trajectory shape and temporal profile, not raw screen pixels.** Normalization reduces dependence on viewport size and challenge placement; retaining the full normalized time series preserves micro-corrections that summary statistics discard [R3, R9].

## 5.3 Cross-modal features

Record synchronization across streams and derive transitions such as:

$$
T_{last\ keyup \rightarrow first\ pointer\ movement}
$$

$$
T_{target\ visible \rightarrow first\ movement}
$$

$$
T_{pointer\ arrival \rightarrow pointerdown}
$$

$$
T_{pointerdown \rightarrow pointerup}
$$

$$
T_{scroll\ end \rightarrow selection}
$$

**Design decision D10 - Preserve cross-modal timing rather than fusing only final modality scores.** Research supports multimodal fusion broadly [R4, R15]; the explicit cross-stream timing layer is an engineering extension intended to make independent synthetic generators harder to coordinate. It must be validated through ablation rather than assumed beneficial.

# 6. Profile model: raw history plus robust statistics

For each user:

```text
UserProfile
|-- SharedProfile
|   |-- transferable feature distributions
|   `-- cross-modal distributions
|
|-- DeviceProfiles
|   |-- device/profile A: desktop-pointer
|   |-- device/profile B: touch
|   `-- ...
|
|-- RawHistory
|   |-- enrollment sessions
|   `-- later high-confidence trusted sessions
|
`-- Calibration
    |-- per-modality weights
    |-- thresholds
    `-- quality requirements
```

**Design decision D11 - Store a bank of complete trusted sessions in addition to statistical summaries.** Sequence-preserving keystroke work using DTW/time-frequency representations reported materially lower EER than its compared baselines on the studied datasets, showing that a full temporal representation can contain discriminative information that a small feature vector loses [R12]. This does **not** imply a fixed percentage improvement for BioPrint; the local benefit must be measured using the ablation plan in Section 16.

Security consequence: raw behavioral history is also valuable training material to an attacker who steals it. Privacy is intentionally out of scope here, but compromise of the profile store remains a security concern because it can improve imitation/synthesis attacks [R7, R10, R13].

# 7. Enrollment flow

Recommended enrollment is 8-12 short rounds rather than one long interaction:

```text
Start enrollment
      |
      v
Capability detection
      |
      v
Round 1: phrase + randomized target sequence
Round 2: different phrase + different geometry
Round 3: phrase + target + short scroll task
...
Round 8-12
      |
      v
Within-user consistency check
      |\
      | +--> too noisy / insufficient --> collect more
      v
Build raw exemplar bank
Build statistical distributions
Calibrate user/device threshold
      |
      v
Enrollment complete
```

Each round should contain a **known, non-secret typing phrase** plus an **active motor challenge**. Example:

```text
Type: "silent amber river 42"
Then acquire three randomized targets A -> B -> C.
Then scroll until a highlighted marker is visible and select it.
```

The server stores the exact challenge definition with the response:

```json
{
  "challengeId": "...",
  "nonce": "...",
  "phrase": "silent amber river 42",
  "targets": [...],
  "scrollTarget": 0.64,
  "expiresAt": "..."
}
```

**Design decision D12 - Use repeated controlled-but-varied challenges.** Repetition estimates genuine within-user variation; controlled tasks make sequences comparable; variation prevents the enrolled profile from being tied to one exact trajectory. Fixed/repeated enrollment is standard in keystroke benchmark design, while touch studies show meaningful session-to-session variation that must be captured rather than ignored [R2, R3].

**Engineering starting point:** 8-12 rounds is a hackathon/usability tradeoff, not a universal research optimum. Measure whether the profile stabilizes; if additional rounds stop improving validation FRR/FAR, stop collecting.

# 8. Authentication and fresh behavioral challenge-response

Every authentication begins on the server:

```text
CLIENT                                 SERVER
  |                                      |
  |------ start authentication --------->|
  |                                      | create nonce N
  |                                      | create randomized challenge C
  |                                      | set expiry; mark unused
  |<----------- N, C, id ----------------|
  |                                      |
  | perform challenge; capture E         |
  |                                      |
  |--------- id, N, E ------------------>|
  |                                      | verify unused + expiry
  |                                      | verify task consistency
  |                                      | replay checks
  |                                      | identity score
  |                                      | humanity score
  |                                      | decision
  |<---------- result -------------------|
```

The relevant model is:

$$
P(B \mid U,C)
$$

rather than only:

$$
P(B \mid U)
$$

where $B$ is behavior, $U$ the claimed user, and $C$ the fresh challenge.

**Design decision D13 - Bind behavioral evidence to a single-use, expiring, randomized server challenge.** Replay literature demonstrates that a captured genuine keystroke-dynamics session can otherwise be replayed as genuine behavior [R11]. The specific randomized motor challenge is BioPrint's engineering mechanism for making old traces task-incompatible with new authentication attempts.

The challenge should randomize at least two of:

- phrase selection from a designed challenge corpus;
- target positions;
- target size;
- order of targets;
- scroll target/location;
- direction or path geometry.

A challenge must be single-use even after failure.

# 9. Deterministic matching algorithms (no ML)

## 9.1 Robust statistical profile

For feature $j$, enrollment values are $x_{1j},...,x_{nj}$.

Use median:

$$
m_j = median(x_{ij})
$$

and median absolute deviation:

$$
MAD_j = median(|x_{ij}-m_j|)
$$

with robust scale approximation:

$$
\sigma_j = 1.4826\,MAD_j
$$

Login deviation:

$$
z_j = \frac{|q_j-m_j|}{\sigma_j+\epsilon_j}
$$

Map deviation to a bounded similarity:

$$
s_j = e^{-\frac{1}{2}\min(z_j,z_{max})^2}
$$

**Design decision D14 - Use robust location/scale statistics rather than mean/std-only templates.** Browser behavioral data contains hesitations, scheduling noise, corrections, interruptions, and sensor outliers. Median/MAD is a standard robust-statistics engineering choice; it is not claimed as a uniquely optimal biometric algorithm.

## 9.2 Personalized feature reliability

Estimate feature reliability from enrollment stability. A simple starting rule:

$$
r_j = \frac{1}{MAD_j+\epsilon}
$$

then cap and normalize:

$$
w_j = \min(r_j,w_{max})
$$

This makes a stable feature matter more for the user who exhibits it consistently.

**Design decision D15 - Personalize feature weights from observed stability rather than assigning one global feature ranking.** Behavioral biometric performance varies by subject and feature set, and evaluation work warns that aggregate averages can hide users with systematically different error behavior [R6]. The exact weighting formula is an engineering hypothesis and must be ablated against equal weights.

## 9.3 Exemplar bank

Keep all trusted exemplars:

$$
\mathcal{R}_u=\{R_1,R_2,...,R_n\}
$$

For query $Q$, compute distance to a compatible subset of genuine exemplars:

$$
d_i=D(Q,R_i)
$$

Do not use only `min(d_i)`. A safer starting aggregator is the median of the nearest three compatible exemplars:

$$
D_{exemplar}=median(d_{(1)},d_{(2)},d_{(3)})
$$

**Design decision D16 - Use several nearest genuine exemplars rather than a single nearest match.** The aim is to represent multiple legitimate behavioral modes without allowing one accidental near-match to dominate. `k=3` is an engineering starting value and must be tuned on validation data.

## 9.4 Dynamic Time Warping

For variable-speed sequences, DTW aligns local temporal stretch/compression:

$$
DTW(i,j)=d(x_i,y_j)+\min
\begin{cases}
DTW(i-1,j)\\
DTW(i,j-1)\\
DTW(i-1,j-1)
\end{cases}
$$

Use DTW on normalized sequence representations such as:

- key timing vectors for comparable challenge text;
- pointer velocity sequence;
- pointer curvature/turn sequence;
- normalized touch trajectory;
- cross-modal transition sequence.

DTW has been used directly in keystroke authentication and related behavioral biometric sequence matching; Toosi and Akhaee use DTW to align keystroke-dynamics signals before similarity analysis and report improved EER relative to their compared methods [R12].

**Design decision D17 - Use DTW only after challenge and modality normalization.** Blind DTW over absolute pixel coordinates would reward the wrong invariances. First normalize position/geometry and select compatible challenge segments; then align temporal variation.

## 9.5 Contextual keystroke distributions

For generated challenge text, maintain contextual distributions:

$$
P(\Delta t \mid transition, u, deviceClass)
$$

Example:

```text
Alice / desktop keyboard
"th": 84, 91, 87, 94, ... ms
"he": 108, 101, 112, ... ms
space->letter: ...
```

This adds transition structure beyond a global typing-speed estimate [R2, R12].

# 10. Multimodal fusion and missing evidence

Compute modality scores:

$$
S_K, S_P, S_T, S_S, S_X, S_E
$$

for keyboard, pointer, touch, scroll, cross-modal, and exemplar sequence similarity.

Associate each with evidence quality $q_m\in[0,1]$. Example:

$$
q_K=\min(1,N_{keys}/N_{target})
$$

A weighted geometric fusion is a useful starting rule:

$$
S_{ID}=
\exp\left(
\frac{\sum_m q_mw_m\ln(S_m+\epsilon)}
{\sum_m q_mw_m}
\right)
$$

**Design decision D18 - Score-level fusion with explicit quality weights.** HMOG and broader survey literature support combining multiple behavioral/sensor modalities [R4, R15]. Score-level fusion also lets a device omit unsupported modalities without fabricating a mismatch.

**Design decision D19 - Missing is not zero.** If a phone has touch but no meaningful mouse trajectory, set `q_pointer=0` and exclude it from the denominator. Treating missing evidence as a zero score would systematically reject legitimate modality changes. Cross-device datasets show that available signals and their distributions differ across desktop, tablet, and phone [R8].

# 11. Separate human/automation risk engine

Compute `S_human` independently from `S_identity`.

Deterministic signals can include:

| Signal | Suspicious pattern | Interpretation |
|---|---|---|
| key interval regularity | near-constant intervals over sufficient length | weak automation evidence |
| timing entropy | unrealistically low | weak automation evidence |
| reaction latency | input at/near rendering boundary repeatedly | automation evidence |
| pointer path | perfect/overly smooth geometry, no correction | weak automation evidence |
| sampling periodicity | exact periodic intervals | automation evidence |
| task consistency | events do not fit challenge geometry/order | strong invalidity signal |
| `isTrusted=false` | synthetic JS-dispatched event | useful for trivial injection |
| `navigator.webdriver=true` | declared WebDriver automation | useful weak signal |
| cross-modal coupling | impossible or implausibly perfect transitions | automation evidence |

Synthetic forgery studies motivate explicit testing against generated behavior, not only human impostors [R10, R13]. However, no simple heuristic is proof of a human.

**Design decision D20 - `navigator.webdriver` and `isTrusted` are hints, never acceptance criteria.** `navigator.webdriver` only reports cooperative automation state [R19]. WebDriver explicitly dispatches trusted events, so `isTrusted=true` cannot prove human origin [R18].

A simple rule engine can assign penalties rather than binary decisions for weak signals, while challenge invalidity and exact replay remain hard failures.

# 12. Replay detection

Use three layers:

1. **Challenge freshness** - nonce, expiry, unused challenge.
2. **Challenge compatibility** - trace must match current phrase/target/scroll task.
3. **Historical duplicate detection** - exact and near-exact trace comparison.

Canonicalize a trace into quantized deltas:

```text
(eventType, dt, dx, dy, key-transition-class, target-id, ...)
```

Hash exact canonical sequences:

$$
H=SHA256(challengeClass \parallel canonicalTrace)
$$

and compare near-duplicates with a replay-specific sequence distance such as normalized DTW.

**Design decision D21 - Treat an implausibly exact behavioral duplicate as fraud evidence, not as a strong identity match.** Replay research identifies the core problem: replaying authentic behavioral measurements can preserve the victim's biometric match unless the protocol adds freshness [R11]. Genuine repeated behavior should be similar but should not reproduce long high-resolution timing/trajectory sequences exactly.

# 13. Device and modality handling

## 13.1 Device identity is context, not user identity

Generate an installation identifier such as `crypto.randomUUID()` and store it locally. This means only "this browser installation has been seen before." It is a profile selector, not identity proof.

Browser context/device attributes can help choose normalization and risk policy, but should not be treated as the user biometric.

## 13.2 Hierarchical profile

$$
Profile_u=\{Shared_u,Device_{u,1},...,Device_{u,n}\}
$$

Shared features should emphasize normalized timing/interaction structure. Device profiles can preserve hardware-specific distributions.

Cross-device research directly studies bootstrapping authentication on a new device from an existing behavioral model [R5]. BB-MAS provides same-subject desktop/tablet/phone data and reports systematic device-related shifts in key-hold and inter-key timing [R8].

**Design decision D22 - One person, several behavioral dialects.** Do not average desktop, phone, mouse, trackpad, and touch behavior into one broad centroid; device effects can inflate genuine variance and weaken discrimination [R5, R8].

## 13.3 New-device flow

```text
Unknown device
    |
    v
Detect available modality set
    |
    v
Use compatible shared profile
    |
    v
Issue longer / richer challenge
    |
    v
Enough high-confidence evidence?
   / \
 yes  no
  |    |
accept  collect more behavior / reject
  |
  v
create candidate device profile
```

**Design decision D23 - Unknown device means different evidence requirements, not a lower threshold.** A new device should not be an automatic rejection, but neither should "device changed" become a reason to waive behavioral mismatch. Cross-device work supports transfer/bootstrap as possible but imperfect [R5, R8].

If the new modality has no meaningful correspondence to enrollment (for example desktop-only enrollment followed by first-ever touch-only login), the system may genuinely lack enough information. The correct result is `MORE_DATA` or rejection, not fabricated confidence.

## 13.4 Candidate device promotion

A newly accepted device profile starts as `candidate`, not `trusted`.

Example policy:

```text
candidate 0.25 -> 0.50 -> 0.75 -> trusted
```

Promotion requires multiple high-confidence, high-quality, non-replayed sessions. This limits poisoning from one borderline acceptance.

# 14. Adaptive profile updates

Behavior changes over time, and touch/keystroke research documents session/time variability [R3, R15]. Adaptation can reduce stale-profile errors but creates a poisoning surface.

Recommended update rule:

$$
Update \iff
S_{ID}>\tau_{veryHigh}
\land S_{human}>\tau_{veryHigh}
\land Quality>q_{high}
\land deviceState\in\{trusted,candidateHigh\}
$$

Do not update immediately. Buffer several trusted sessions and update only if they are mutually consistent.

**Design decision D24 - Conservative, quarantined adaptation.** The event brief explicitly rewards adaptive profiles [R1], but security takes precedence over rapid drift tracking. Adaptation from borderline logins would let an attacker gradually move the profile toward their behavior.

# 15. Decision policy and explainability

Hard failures execute before behavioral fusion:

```javascript
if (!challenge.valid) reject("INVALID_CHALLENGE");
if (challenge.used) reject("REPLAYED_CHALLENGE");
if (challenge.expired) reject("EXPIRED_CHALLENGE");
if (!quality.sufficient) moreData("INSUFFICIENT_EVIDENCE");
if (replay.exact) reject("EXACT_REPLAY");

if (identity.score < identity.threshold)
  reject("IDENTITY_MISMATCH");

if (human.score < human.threshold)
  reject("AUTOMATION_RISK");

accept();
```

**Design decision D25 - Hard security gates must not be averaged away.** A perfect identity match on an already-used challenge is still a replay. A strong keyboard match must not compensate for a malformed task response. Score fusion is for uncertain biometric evidence; protocol validity remains Boolean.

Return explainable evidence:

```json
{
  "allowed": false,
  "identityScore": 0.31,
  "humanScore": 0.96,
  "fresh": true,
  "quality": 0.91,
  "modalities": {
    "keyboard": 0.35,
    "pointer": 0.24,
    "crossModal": 0.41
  },
  "reasons": [
    "KEYBOARD_SEQUENCE_MISMATCH",
    "POINTER_DYNAMICS_MISMATCH"
  ]
}
```

Explainability is an explicit stretch goal in the event brief [R1].

# 16. Calibration and evaluation

## 16.1 Metrics

Do not report simple accuracy alone.

$$
FAR=\frac{impostor\ attempts\ accepted}{all\ impostor\ attempts}
$$

$$
FRR=\frac{genuine\ attempts\ rejected}{all\ genuine\ attempts}
$$

EER is the operating point where:

$$
FAR(\tau)=FRR(\tau)
$$

Also report per-user:

$$
FAR_u,\quad FRR_u
$$

Eberz et al. show that behavioral-biometric evaluation needs more care than one aggregate FAR/FRR number; systematic user-specific errors can be hidden by averages [R6]. Jorgensen and Yu similarly question overly optimistic mouse-dynamics conclusions when experimental protocols do not reflect practical conditions [R14].

**Design decision D26 - Thresholds must be calibrated on session-separated validation data and evaluated per user as well as globally.** Never randomly split adjacent events from the same session into enrollment and test sets; this can leak session/device conditions and produce optimistic results.

## 16.2 Leave-one-out enrollment calibration

For enrollment samples $R_1,...,R_n$, score each $R_i$ against the profile made from the other $n-1$ samples. This estimates genuine variation before deployment.

A robust starting threshold can be expressed in distance form:

$$
D_c=median(D_i)
$$

$$
D_s=1.4826MAD(D_i)
$$

$$
\tau_D=D_c+kD_s
$$

Then tune $k$ using independent genuine and impostor validation attempts.

## 16.3 Attack evaluation matrix

The minimum useful matrix is:

| Test | What it measures |
|---|---|
| genuine, same device, later session | normal FRR |
| genuine, new similar device | cross-device degradation |
| genuine, new modality | transfer/insufficient-evidence behavior |
| zero-effort human impostor | baseline FAR |
| informed human mimic | robustness to practice/observation |
| fixed-delay keyboard bot | trivial automation |
| randomized keyboard bot | simple synthetic forgery |
| straight/perfect pointer bot | naive pointer automation |
| human-like scripted trajectory | harder automation |
| exact genuine replay | replay protocol |
| time-scaled/perturbed replay | near-replay robustness |
| WebDriver-generated interaction | limits of browser trust signals |

Mimicry, synthetic forgery, and replay research each justify a separate row in this matrix [R7, R10, R11, R13].

## 16.4 Required ablation study

Evaluate progressively:

```text
A  robust statistics only
B  A + raw exemplar bank
C  B + DTW sequence matching
D  C + multimodal score fusion
E  D + cross-modal timing
F  E + challenge freshness/replay detector
```

For each, report FAR, FRR, EER, and server verification latency.

**Design decision D27 - Measure the value of raw recording rather than assuming it.** Sequence-oriented literature provides evidence that richer temporal matching can improve results [R12], but the improvement is protocol- and dataset-dependent. The ablation gives BioPrint its own defensible answer.

# 17. Performance and latency

DTW is more expensive than summary-statistic comparison. Use a two-stage verifier:

```text
raw query
   |
cheap statistical/profile screen
   |
select compatible top-K historical exemplars
   |
DTW / detailed sequence comparison
   |
fusion
```

Practical optimizations:

- resample pointer paths to a bounded number of points;
- compare only challenge-compatible exemplars;
- separate device-specific and shared exemplar pools;
- keep a bounded representative history for online matching while retaining archival sessions separately;
- cache derived velocity/curvature/timing sequences;
- apply a warping window to DTW when justified by challenge structure.

The event brief explicitly rewards low authentication latency [R1].

**Engineering target:** after interaction collection, server-side verification should feel immediate (target tens of milliseconds to low hundreds, depending on history size). Treat this as a performance target, not a research guarantee.

# 18. Suggested storage schema

```javascript
UserProfile {
  userId,

  shared: {
    distributions: {...},
    crossModal: {...}
  },

  devices: {
    "profile-id": {
      installIdHash,
      class: "desktop-pointer",
      status: "trusted",
      statistics: {
        keyboard: {...},
        pointer: {...},
        scroll: {...}
      },
      representativeSessions: [sessionId, ...]
    }
  },

  calibration: {
    identityThreshold,
    humanThreshold,
    qualityMinimum,
    featureWeights: {...}
  },

  profileVersion
}
```

```javascript
BehaviorSession {
  sessionId,
  challengeId,
  userId,
  deviceProfileId,
  challengeDefinition,

  events: {
    keyboard: [...],
    pointer: [...],
    scroll: [...],
    motion: [...],
    focus: [...]
  },

  derived: {...},
  replaySignature,
  quality,
  decision,
  trustedForAdaptation
}
```

# 19. Suggested source tree

```text
bioprint/
|-- client/
|   |-- index.js
|   |-- session.js
|   |-- challenge.js
|   |-- device.js
|   |-- collectors/
|   |   |-- keyboard.js
|   |   |-- pointer.js
|   |   |-- scroll.js
|   |   |-- motion.js
|   |   `-- focus.js
|   `-- transport.js
|
`-- server/
    |-- challenge/
    |   `-- generator.js
    |-- features/
    |   |-- keyboard.js
    |   |-- pointer.js
    |   |-- crossmodal.js
    |   `-- quality.js
    |-- matching/
    |   |-- robust-stats.js
    |   |-- dtw.js
    |   |-- exemplar.js
    |   `-- fusion.js
    |-- security/
    |   |-- replay.js
    |   |-- automation.js
    |   `-- challenge-validator.js
    |-- profiles/
    |   `-- repository.js
    `-- policy/
        `-- decision.js
```

# 20. What will break, and how the system should fail

| Failure mode | Expected effect | Required behavior |
|---|---|---|
| new keyboard | timing distribution shifts | rely more on shared/challenge evidence; build candidate subprofile |
| mouse -> trackpad | pointer mechanics shift | do not use old pointer profile as hard gate |
| desktop -> phone | modality changes | shared profile + longer bootstrap; possibly `MORE_DATA` |
| fatigue/stress/injury | genuine behavior drifts | higher FRR; conservative adaptation later |
| autofill | little typing evidence | lower `q_keyboard`; use active challenge |
| short password | little passive typing | irrelevant because challenge text supplies evidence |
| browser privacy timer reduction | timing quantized | use robust, human-scale timing features [R20] |
| event coalescing | trajectory detail lost | use coalesced events when available [R16] |
| main-thread jank | distorted event timing | quality downgrade / more data |
| scripted `dispatchEvent` | untrusted events | weak automation flag |
| WebDriver | may produce trusted events | behavior challenge still required [R18] |
| raw-template breach | attacker gets high-quality target traces | outside privacy scope but materially raises synthesis risk [R7, R10] |
| one bad accepted session | poisoning risk | candidate buffer; no immediate profile update |
| one modality unavailable | evidence missing | exclude, do not score zero |

# 21. Production-standard caveat

The hackathon intentionally asks for behavior-only verification. Current NIST SP 800-63B-4 does **not** recognize a biometric characteristic as an authenticator by itself; biometric comparison is used with a physical authenticator in NIST's digital identity model [R17]. NIST explicitly includes behavioral examples such as keystroke patterns, typing speed, mouse movements, smartphone holding angle, and gait in its discussion of biometrics [R17].

Therefore the defensible claim is:

> BioPrint is a research/hackathon behavioral verifier built to satisfy the Event 2 constraint of behavior-only authentication and to explore robustness against impostors, automation, device changes, and replay.

It should **not** be presented as a standards-compliant replacement for production MFA in high-assurance systems.

# 22. Final implementation specification

The complete verifier is:

$$
E=\{K,P,T,S,M,X\}
$$

where:

- $K$: keyboard sequence;
- $P$: pointer sequence;
- $T$: touch-specific measurements;
- $S$: scroll behavior;
- $M$: optional motion/orientation;
- $X$: cross-modal relationships.

Profile:

$$
Profile_u=\{Shared_u,DeviceProfiles_u,RawHistory_u,Calibration_u\}
$$

Identity:

$$
S_{stat}=RobustSimilarity(E,Profile_u)
$$

$$
S_{seq}=ExemplarDTWSimilarity(E,RawHistory_u)
$$

$$
S_{challenge}=ChallengeConditionedSimilarity(E,C)
$$

$$
S_{ID}=Fusion(S_{stat},S_{seq},S_{challenge})
$$

Independent automation/liveness score:

$$
S_H=DeterministicHumanityChecks(E,C)
$$

Freshness:

$$
Fresh=NonceValid\land Unused\land NotExpired\land NoReplay
$$

Decision:

$$
\boxed{
Accept=
(S_{ID}>\tau_I)
\land(S_H>\tau_H)
\land Fresh
\land(Quality\ge q_{min})
}
$$

The implementation priority should be:

1. server challenge state + event collector;
2. keyboard and pointer/touch raw history;
3. robust statistics and per-user calibration;
4. exemplar/DTW matching;
5. fresh randomized challenge and replay detection;
6. independent automation heuristics;
7. shared/device-specific profile hierarchy;
8. explainability dashboard;
9. cross-modal timing and conservative adaptation.

That ordering gives the highest chance of a stable 36-hour demo while preserving a technically defensible architecture.

# References

**[R1] ROOT 36 Problem Statements.** Event 2: *BioPrint: Behavior-Based Login Security*, pp. 3-4. Hackathon brief supplied with this project. Requirements include enrollment, password-independent behavioral profiling, live mismatch rejection, distinct bot/replay detection, and no OTP fallback; stretch goals include adaptive profiles, confidence/explainability, and multiple modalities.

**[R2] Killourhy, K. S., & Maxion, R. A. (2009).** Comparing Anomaly-Detection Algorithms for Keystroke Dynamics. *39th Annual IEEE/IFIP International Conference on Dependable Systems and Networks (DSN)*. DOI: 10.1109/DSN.2009.5270346. https://www.cs.cmu.edu/~keystroke/KillourhyMaxion09.pdf

**[R3] Frank, M., Biedert, R., Ma, E., Martinovic, I., & Song, D. (2013).** Touchalytics: On the Applicability of Touchscreen Input as a Behavioral Biometric for Continuous Authentication. *IEEE Transactions on Information Forensics and Security, 8*(1), 136-148. DOI: 10.1109/TIFS.2012.2225048. https://doi.org/10.1109/TIFS.2012.2225048

**[R4] Sitova, Z., Sedenka, J., Yang, Q., Peng, G., Zhou, G., Gasti, P., & Balagani, K. S. (2016).** HMOG: New Behavioral Biometric Features for Continuous Authentication of Smartphone Users. *IEEE Transactions on Information Forensics and Security, 11*(5), 877-892. DOI: 10.1109/TIFS.2015.2506542. https://doi.org/10.1109/TIFS.2015.2506542

**[R5] Wang, X., Yu, T., Mengshoel, O. J., & Tague, P. (2017).** Towards Continuous and Passive Authentication Across Mobile Devices: An Empirical Study. *Proceedings of the 10th ACM Conference on Security and Privacy in Wireless and Mobile Networks (WiSec '17)*, 35-45. DOI: 10.1145/3098243.3098244. https://doi.org/10.1145/3098243.3098244

**[R6] Eberz, S., Rasmussen, K. B., Lenders, V., & Martinovic, I. (2017).** Evaluating Behavioral Biometrics for Continuous Authentication: Challenges and Metrics. *Proceedings of the 2017 ACM on Asia Conference on Computer and Communications Security (AsiaCCS)*, 386-399. DOI: 10.1145/3052973.3053032. https://doi.org/10.1145/3052973.3053032

**[R7] Khan, H., Hengartner, U., & Vogel, D. (2020).** Mimicry Attacks on Smartphone Keystroke Authentication. *ACM Transactions on Privacy and Security, 23*(1), Article 2, 34 pages. DOI: 10.1145/3372420. https://doi.org/10.1145/3372420

**[R8] Belman, A. K., Wang, L., Iyengar, S. S., Sniatala, P., Wright, R., Dora, R., Baldwin, J., Jin, Z., & Phoha, V. V. (2019).** Insights from BB-MAS - A Large Dataset for Typing, Gait and Swipes of the Same Person on Desktop, Tablet and Phone. arXiv:1912.02736. https://arxiv.org/abs/1912.02736

**[R9] Khan, S., Devlen, C., Manno, M., & Hou, D. (2024).** Mouse Dynamics Behavioral Biometrics: A Survey. *ACM Computing Surveys, 56*(6), Article 154, 1-33. DOI: 10.1145/3640311. https://doi.org/10.1145/3640311

**[R10] Stefan, D., Shu, X., & Yao, D. D. (2012).** Robustness of Keystroke-Dynamics Based Biometrics Against Synthetic Forgeries. *Computers & Security, 31*(1), 109-121. DOI: 10.1016/j.cose.2011.10.001. https://doi.org/10.1016/j.cose.2011.10.001

**[R11] Hazan, I., Margalit, O., & Rokach, L. (2019).** Securing Keystroke Dynamics from Replay Attacks. *Applied Soft Computing, 85*, 105798. DOI: 10.1016/j.asoc.2019.105798. https://doi.org/10.1016/j.asoc.2019.105798

**[R12] Toosi, R., & Akhaee, M. A. (2021).** Time-Frequency Analysis of Keystroke Dynamics for User Authentication. *Future Generation Computer Systems, 115*, 438-447. DOI: 10.1016/j.future.2020.09.027. https://doi.org/10.1016/j.future.2020.09.027

**[R13] Sun, Y., & Upadhyaya, S. (2018).** Synthetic Forgery Attack Against Continuous Keystroke Authentication Systems. *27th International Conference on Computer Communication and Networks (ICCCN)*. DOI: 10.1109/ICCCN.2018.8487341. https://doi.org/10.1109/ICCCN.2018.8487341

**[R14] Jorgensen, Z., & Yu, T. (2011).** On Mouse Dynamics as a Behavioral Biometric for Authentication. *Proceedings of the 6th ACM Symposium on Information, Computer and Communications Security (ASIACCS)*. DOI: 10.1145/1966913.1966983. https://doi.org/10.1145/1966913.1966983

**[R15] Abuhamad, M., Abusnaina, A., Nyang, D., & Mohaisen, D. (2021).** Sensor-Based Continuous Authentication of Smartphones' Users Using Behavioral Biometrics: A Contemporary Survey. *IEEE Internet of Things Journal, 8*(1), 65-84. DOI: 10.1109/JIOT.2020.3020076. https://doi.org/10.1109/JIOT.2020.3020076

**[R16] W3C (2026).** *Pointer Events Level 3*, W3C Recommendation, 30 June 2026. Pointer type, contact geometry, pressure, `pointerrawupdate`, and coalesced-event semantics. https://www.w3.org/TR/pointerevents3/

**[R17] NIST (2025).** *NIST SP 800-63B-4: Digital Identity Guidelines - Authentication and Authenticator Management*. DOI: 10.6028/NIST.SP.800-63b-4. See "Use of Biometrics" and authenticator requirements. https://pages.nist.gov/800-63-4/sp800-63b.html

**[R18] W3C (2026).** *WebDriver*. Input action dispatch requirements specify trusted events and note that WebDriver activation triggers have `isTrusted=true`. https://www.w3.org/TR/webdriver2/

**[R19] MDN Web Docs (2024).** `Navigator.webdriver`. Indicates whether a user agent declares that it is controlled by WebDriver automation. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver

**[R20] MDN Web Docs (2026).** `Event.timeStamp` and reduced time precision. Documents browser-dependent timestamp rounding and privacy-related precision reduction. https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp

**[R21] Baig, A. F., & Eskeland, S. (2021).** Security, Privacy, and Usability in Continuous Authentication: A Survey. *Sensors, 21*(17), 5967. DOI: 10.3390/s21175967. https://doi.org/10.3390/s21175967
