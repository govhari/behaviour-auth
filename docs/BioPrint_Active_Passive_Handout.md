# BioPrint Handout — Passive-First, Active-Step-Up Behavioral Authentication

## 1. Core idea

BioPrint should not force every user through a behavioral challenge on every login.

```text
Normal Login Behavior
        ↓
Passive Verification
        ↓
┌────────────────┬───────────────────┬────────────────────┐
│ High confidence│ Uncertain         │ Hard security fail │
│                │                   │                    │
│ ACCEPT         │ ACTIVE CHALLENGE  │ REJECT             │
└────────────────┴───────────────────┴────────────────────┘
```

The active challenge is not a second factor. It is simply more behavioral evidence from the same behavioral authenticator.

---

## 2. Authentication dimensions

BioPrint keeps four values separate:

\[
S_I = \text{Identity similarity}
\]

\[
S_H = \text{Human / liveness score}
\]

\[
Q = \text{Evidence quality}
\]

\[
F = \text{Freshness / replay validity}
\]

Do not internally collapse these into one number.

Example:

```text
Identity similarity    92%
Evidence quality       24%
Human score            97%
Freshness              PASS
```

This should **not** be interpreted as “92% confidence.” The identity similarity is high, but there is insufficient evidence.

The policy engine therefore evaluates:

\[
Decision = f(S_I, S_H, Q, F)
\]

---

## 3. Overall user flow

```text
                  LOGIN PAGE
                      │
                      ▼
            Username + Password
                      │
         Passive behavior collection
                      │
                Submit click
                      │
                      ▼
              Password correct?
                /           \
              no             yes
              │               │
           REJECT             ▼
                        Passive BioPrint
                              │
              ┌───────────────┼────────────────┐
              │               │                │
         HIGH CONF.        UNCERTAIN        HARD FAIL
              │               │                │
              ▼               ▼                ▼
           ACCEPT       Active Challenge     REJECT
                              │
                  Collect stronger evidence
                              │
                              ▼
                        Final BioPrint
                         /          \
                     ACCEPT        REJECT
```

---

## 4. Phase 1 — Passive BioPrint

The user sees a normal login form:

```text
Username
[________________]

Password
[________________]

          [ Log in ]
```

The JavaScript SDK silently records the interaction.

No extra challenge is shown if the passive evidence is sufficient.

---

## 5. Passive signals

### 5.1 Username typing

Because the username is known text, retain the full sequence:

```text
keydown
keyup
key/code
timestamp
corrections
modifier usage
```

Useful derived features:

\[
D_i = t_i^{up} - t_i^{down}
\]

Key dwell time.

\[
DD_i = t_{i+1}^{down} - t_i^{down}
\]

Down-down latency.

\[
UD_i = t_{i+1}^{down} - t_i^{up}
\]

Up-down flight time.

Also measure:

- digraph timings
- trigraph timings
- key overlap
- typing bursts
- pause distribution
- backspace/correction behavior
- Shift usage
- complete timing sequence

Produces:

\[
S_{username}
\]

### 5.2 Password-field typing

The behavioral fingerprint remains independent of the password value itself.

Record timing and interaction metadata such as:

```text
keydown timestamp
keyup timestamp
sequence position
pause
overlap
correction
```

Do not use the actual password characters as identity features.

Produces:

\[
S_{password}
\]

### 5.3 Username → password transition

Measure:

\[
T_{usernameEnd \rightarrow passwordStart}
\]

and how the transition happened:

```text
Tab key
mouse movement
field click
pause
start typing
```

These become part of the cross-interaction profile.

### 5.4 Submit-button approach

For pointer events:

\[
p_i = (x_i, y_i, t_i)
\]

derive:

\[
v_i =
\frac{\|p_i-p_{i-1}\|}{\Delta t_i}
\]

\[
a_i =
\frac{v_i-v_{i-1}}{\Delta t_i}
\]

and optionally jerk.

Also use:

- curvature
- direction changes
- path efficiency
- micro-corrections
- overshoot
- approach angle
- target-entry velocity
- pause before click

Produces:

\[
S_{pointer}
\]

### 5.5 Submit click

Measure:

\[
T_{down \rightarrow up}
\]

and:

\[
T_{arrival \rightarrow down}
\]

Also retain:

- pointer velocity before click
- final micro-corrections
- click location inside the button
- press duration

Produces:

\[
S_{click}
\]

---

## 6. Cross-modal rhythm

Measure transitions such as:

\[
T_{lastPasswordKeyUp \rightarrow pointerMove}
\]

\[
T_{pointerStart \rightarrow buttonArrival}
\]

\[
T_{buttonArrival \rightarrow mouseDown}
\]

\[
T_{mouseDown \rightarrow mouseUp}
\]

Example:

```text
Password final key-up
       │
       │ 164 ms
       ▼
Pointer begins moving
       │
       │ 438 ms
       ▼
Button reached
       │
       │ 87 ms
       ▼
Mouse down
       │
       │ 102 ms
       ▼
Mouse up
```

Produces:

\[
S_X = \text{cross-modal similarity}
\]

The purpose is to evaluate whether the whole interaction forms one coherent behavioral sequence, not just whether keyboard and mouse individually look plausible.

---

## 7. Passive identity score

Let:

\[
S_U = \text{username typing similarity}
\]

\[
S_P = \text{password timing similarity}
\]

\[
S_M = \text{pointer similarity}
\]

\[
S_C = \text{click similarity}
\]

\[
S_X = \text{cross-modal similarity}
\]

Use quality-aware score fusion:

\[
S_{passive}
=
\exp
\left(
\frac{
\sum_i w_i q_i \ln(S_i+\epsilon)
}{
\sum_i w_i q_i
}
\right)
\]

where:

- \(w_i\) = reliability weight for that user/modality
- \(q_i\) = evidence quality/availability

---

## 8. Evidence quality

Similarity and evidence volume are different.

Define:

\[
Q \in [0,1]
\]

### Keyboard quality

Example:

\[
q_K =
\min
\left(
1,
\frac{N_{usableKeys}}{N_{target}}
\right)
\]

### Pointer quality

May depend on:

- trajectory duration
- sample count
- movement distance
- number of directional changes

### Cross-modal quality

Depends on how many usable modality transitions were observed.

---

## 9. Missing evidence is not mismatch

If the browser autofills username and password, there may be almost no keyboard evidence.

Do **not** set:

\[
S_{keyboard}=0
\]

Instead set:

\[
q_{keyboard}=0
\]

and renormalize over the available evidence.

Example:

```text
Pointer similarity      94%
Click similarity        91%
Keyboard evidence       UNAVAILABLE
Cross-modal evidence    WEAK
Evidence quality        LOW
```

Result:

```text
MORE EVIDENCE REQUIRED
```

rather than immediate rejection.

---

## 10. Passive human/bot analysis

In parallel compute:

\[
S_H = \text{Human / liveness score}
\]

Check for:

- extremely constant key intervals
- unusually low timing entropy
- impossible reaction times
- perfectly straight or synthetic pointer motion
- perfectly periodic pointer sampling
- repeated identical traces
- inconsistent cross-modal timing
- synthetic event indicators
- WebDriver hints

No single indicator proves automation.

`navigator.webdriver === false` does **not** prove humanity.

`event.isTrusted === true` does **not** prove humanity.

---

## 11. Freshness and replay checks

Every passive login attempt is tied to a server-side session containing:

```text
session ID
nonce
expiration
```

Check:

- session exists
- session is unused
- session is unexpired
- behavior belongs to the current session
- payload is not an exact replay
- payload is not a near-exact replay

Replay is a hard failure.

---

## 12. Passive decision zones

Use three policy outcomes.

### Accept

Require all of:

\[
S_{passive} \ge \tau_{accept}
\]

\[
Q \ge Q_{accept}
\]

\[
S_H \ge \tau_H
\]

\[
Fresh = true
\]

### Step-up

Triggered by ordinary uncertainty, including:

- medium identity score
- low evidence quality
- high similarity but insufficient data
- new device
- changed input modality
- unusual but not clearly malicious behavior

### Reject

Reserved for strong security failures such as:

- replay
- expired challenge
- reused nonce
- malformed event stream
- clear automation
- impossible event sequence

Example initial policy:

```text
Identity >= 0.85
Quality  >= 0.75
Human    >= 0.80
Freshness PASS
        → ACCEPT

Ordinary uncertainty
        → ACTIVE CHALLENGE

Replay / invalid session / clear automation
        → REJECT
```

These thresholds are placeholders and must be calibrated from validation data.

---

## 13. Why low identity should normally trigger step-up

Example:

```text
Identity       41%
Quality        85%
Human          98%
```

This could be an impostor, but it could also be a genuine user on:

- a new keyboard
- a trackpad instead of mouse
- a new device
- an unusual posture
- a slower-than-normal session

Therefore:

\[
\boxed{
\text{ordinary behavioral uncertainty}
\rightarrow
\text{active challenge}
}
\]

---

# 14. Phase 2 — Active BioPrint

The active challenge is a short controlled behavioral test shown only when passive confidence is insufficient.

Example:

```text
Behavior check

Type:

    blue forest 27

Then hit the targets:

      ●

                       ●

             ●
```

It should take only a few seconds.

---

## 15. Controlled typing challenge

The server selects a short, non-secret phrase.

Example:

```text
blue forest 27
```

This yields:

- 15–25 keystrokes
- known key sequence
- dwell times
- flight times
- digraph/trigraph timing
- pauses
- corrections
- complete timing sequence

Because the phrase is known, comparison can be contextual.

---

## 16. Challenge phrase design

Prefer phrases containing useful transitions:

```text
th
he
er
ing
left-hand → right-hand
right-hand → left-hand
double letters
spaces
digits
Shift transitions
```

This enables matching:

\[
P(\Delta t \mid "th", u)
\]

rather than only:

\[
P(\Delta t \mid u)
\]

---

## 17. Pointer/touch challenge

Generate 2–4 randomized targets.

Randomize:

- position
- size
- order
- distance
- direction

Record:

\[
(x,y,t)
\]

throughout.

Extract:

- reaction time
- trajectory shape
- velocity curve
- acceleration
- jerk
- curvature
- approach angle
- overshoot
- micro-corrections
- target-entry speed
- click dwell

On mobile, use touch equivalents.

---

## 18. Active challenge freshness

Each active challenge contains:

```text
challengeId
nonce
random phrase
random target geometry
expiry
```

The verifier therefore evaluates:

\[
P(B \mid U, C)
\]

where:

- \(B\) = observed behavior
- \(U\) = claimed user
- \(C\) = current challenge

instead of only:

\[
P(B \mid U)
\]

This reduces replay usefulness.

---

## 19. Active statistical matching

For feature \(j\):

\[
m_j = median(x_j)
\]

\[
MAD_j =
median(|x_j-m_j|)
\]

Then:

\[
z_j =
\frac{|q_j-m_j|}
{1.4826MAD_j+\epsilon}
\]

Map normalized distance to similarity:

\[
s_j =
e^{-\frac{1}{2}z_j^2}
\]

This measures whether today's values fall inside the user's historical range.

---

## 20. Active raw-exemplar matching

Retain full historical recordings.

For user \(u\):

\[
\mathcal{R}_u =
\{R_1,R_2,\ldots,R_n\}
\]

For current query \(Q\):

\[
d_i = D(Q,R_i)
\]

Use a robust nearest-exemplar score such as:

\[
D_E =
median(d_{(1)}, d_{(2)}, d_{(3)})
\]

where \(d_{(1)}, d_{(2)}, d_{(3)}\) are the three closest genuine historical traces.

---

## 21. Dynamic Time Warping

Use DTW for sequences that can stretch or compress in time:

- keyboard timing sequences
- pointer velocity curves
- curvature profiles
- touch trajectories
- cross-modal timing sequences

Recurrence:

\[
DTW(i,j)
=
d(x_i,y_j)
+
\min
\begin{cases}
DTW(i-1,j)\\
DTW(i,j-1)\\
DTW(i-1,j-1)
\end{cases}
\]

This lets similar behavior performed slightly faster or slower still match.

---

## 22. Active identity score

Combine:

\[
S_{typing}
\]

\[
S_{pointer/touch}
\]

\[
S_{crossmodal}
\]

\[
S_{statistics}
\]

\[
S_{exemplar}
\]

to produce:

\[
S_{active}
\]

Because the active challenge is controlled and information-rich, it should generally carry greater weight than the passive sample.

---

## 23. Final identity score

If step-up occurs:

\[
S_{final}
=
Fusion(S_{passive},S_{active})
\]

An initial implementation might use:

\[
S_{final}
=
0.35S_{passive}
+
0.65S_{active}
\]

but these coefficients should be calibrated empirically.

Quality-aware fusion is preferable to fixed coefficients.

---

## 24. Final decision

After step-up:

\[
\boxed{
Accept
\iff
S_{final}>\tau_I
\land
S_H>\tau_H
\land
Fresh=true
\land
Q\ge Q_{minimum}
}
\]

Otherwise:

\[
REJECT
\]

There is no OTP fallback.

---

# 25. Enrollment architecture

Enrollment must prepare the user for both passive and active verification.

Store:

\[
Profile_u =
\{
PassiveProfile_u,
ActiveProfile_u,
DeviceProfiles_u
\}
\]

---

## 26. Passive enrollment

Collect several login-style repetitions:

```text
username
password-like training string
submit
```

Capture:

- username timing
- password timing
- field transitions
- pointer-to-submit trajectory
- click behavior
- cross-modal timing

The training password-like string does not need to be the user's actual password.

---

## 27. Active enrollment

Also collect controlled challenge rounds:

```text
known phrase
random targets
optional scroll
```

This builds the high-information active profile.

---

## 28. Enrollment flow

```text
             ACCOUNT CREATED
                    │
                    ▼
           BioPrint enrollment
                    │
                    ▼
           Capability detection
                    │
       ┌────────────┴────────────┐
       │                         │
       ▼                         ▼
Passive training           Active training
       │                         │
login-style flow          controlled phrases
username/password         pointer/touch targets
submit button             varied geometry
       │                         │
       └────────────┬────────────┘
                    ▼
               Build profiles
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
Passive profile Active profile Device profile
      │             │              │
      └─────────────┼──────────────┘
                    ▼
               calibration
                    │
                    ▼
               enrollment done
```

---

# 29. Known-device flow

```text
username/password
       ↓
passive capture
       ↓
high confidence
       ↓
ACCEPT
```

The ideal experience is indistinguishable from a normal login.

---

# 30. New-device flow

```text
username/password
       ↓
passive BioPrint
       ↓
device unknown
       ↓
require stronger evidence
       ↓
active challenge
       ↓
shared/cross-device behavior match
       ↓
accept/reject
```

After success:

```text
new device
   ↓
candidate profile
```

Do not immediately treat the new device profile as trusted.

---

# 31. Autofill flow

```text
username autofilled
password autofilled
       ↓
little/no keyboard evidence
       ↓
pointer/click evidence only
       ↓
Q = low
       ↓
active challenge
```

Autofill therefore causes **more evidence collection**, not rejection.

---

# 32. Human impostor flow

Attacker knows the correct password.

```text
Password                 PASS

Passive identity          32%
Passive quality           91%
Human                     98%

→ ACTIVE CHALLENGE
```

Then:

```text
Active identity           28%
Final identity            30%

→ REJECT
```

---

# 33. Bot flow

```text
Password                 PASS

Passive identity          58%
Human                     09%

Automation signals:
- near-constant key intervals
- unrealistic reaction time
- synthetic pointer geometry

→ REJECT
```

Hard automation evidence does not need step-up.

---

# 34. Replay flow

A replay may produce:

```text
Identity                  97%
Human                     95%
```

but:

```text
Replay                    DETECTED
Freshness                 FAIL

→ REJECT
```

Freshness is therefore independent of identity similarity.

---

# 35. Explainability dashboard

## Passive acceptance

```text
BIOPRINT
────────────────────────────────

Password                  PASS

PASSIVE VERIFICATION
Username rhythm            92%
Password rhythm            89%
Pointer behavior           91%
Click behavior             87%
Cross-modal rhythm         93%

Identity                   91%
Evidence quality           88%
Human                      98%
Freshness                  PASS

ACTIVE CHALLENGE            NOT REQUIRED

RESULT                     ACCEPT
```

## Step-up

```text
PASSIVE VERIFICATION
────────────────────────────────

Identity                   71%
Evidence quality           64%
Human                      97%

RESULT                     MORE EVIDENCE REQUIRED


ACTIVE VERIFICATION
────────────────────────────────

Typing challenge           93%
Pointer challenge          89%
Cross-modal                92%
Historical similarity      91%

Active identity            91%

FINAL RESULT               ACCEPT
```

---

# 36. Policy matrix

| Passive result | Quality | Human | Freshness | Action |
|---|---:|---:|---|---|
| High similarity | High | High | Pass | Accept |
| High similarity | Low | High | Pass | Active challenge |
| Medium similarity | Any | High | Pass | Active challenge |
| Low similarity | High | High | Pass | Active challenge |
| Any | Any | Low but inconclusive | Pass | Challenge or reject by severity |
| Any | Any | Hard automation evidence | Pass | Reject |
| Any | Any | Any | Replay/expired | Reject |

---

# 37. System architecture

```text
Browser
│
├── Passive Collector
│   ├── keyboard
│   ├── pointer
│   ├── click
│   └── cross-modal
│
├── Active Challenge UI
│   ├── controlled typing
│   └── randomized targets
│
└── Transport
          │
          ▼
Server
│
├── Session/Freshness Validator
├── Passive Verifier
├── Active Verifier
├── Statistical Matcher
├── Exemplar / DTW Matcher
├── Human/Bot Detector
├── Replay Detector
├── Device Profile Manager
└── Policy Engine
```

---

# 38. Data model

```text
User
│
├── Passive Profile
│   ├── username timing
│   ├── password timing
│   ├── pointer-to-submit
│   ├── click dynamics
│   └── cross-modal timing
│
├── Active Profile
│   ├── typing challenge
│   ├── pointer/touch challenge
│   ├── cross-modal
│   └── raw exemplars
│
├── Device Profiles
│   ├── Laptop A
│   ├── Desktop B
│   └── Phone C
│
└── Historical Sessions
    ├── raw event streams
    ├── derived features
    ├── score
    └── decision
```

---

# 39. Implementation priority

For the competition build:

1. Passive username/password timing capture
2. Submit-pointer/click capture
3. Cross-modal timing
4. Passive identity scoring
5. Evidence-quality scoring
6. Three-zone policy: accept / challenge / hard reject
7. Active typing challenge
8. Random target challenge
9. Statistical matching
10. Raw exemplar + DTW matching
11. Rule-based bot detection
12. Replay/freshness checks
13. Known/new-device handling
14. Explainability dashboard

Optional/stretch:

- accelerometer/gyroscope
- advanced scroll fingerprinting
- continuous post-login authentication
- automatic behavioral drift adaptation
- stylus/pen biometrics

---

# 40. Final design principle

Challenge-every-time gives strong evidence but unnecessary friction.

Passive-only gives low friction but can suffer from insufficient evidence.

The preferred architecture is:

\[
\boxed{
\text{low friction when passive evidence is strong}
+
\text{active verification only when evidence is weak}
}
\]

The mental model is:

\[
\boxed{
\text{Observe first. Ask for more only when necessary.}
}
\]

Normal case:

\[
Password + PassiveBehavior \rightarrow Accept
\]

Uncertain case:

\[
Password + PassiveBehavior + ActiveBehavior \rightarrow Accept/Reject
\]

Attack case:

\[
Password + Replay/Bot/FraudEvidence \rightarrow Reject
\]

The system therefore implements **adaptive friction**: behavioral verification becomes stronger only when the current session does not provide enough trustworthy evidence.
