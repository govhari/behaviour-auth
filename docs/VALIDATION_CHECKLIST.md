# Remaining empirical validation

Synthetic, HTTP and browser coverage exercises the implementation; none of it is a biometric recognition result. The following needs consenting participants and real hardware; none is claimed complete.

## Data collection

- Explain which behavior is retained and obtain participant agreement. Use demonstration accounts and non-secret training strings; protect SQLite files and exports.
- Enroll at least two participants, then collect separate-visit/day genuine sessions and every supported attack category. Choose meaningful sample counts before reviewing outcomes.
- Keep each participant/visit in exactly one split. Label true subject, claimed account, input device, credential correctness and protocol validity independently of ACCEPT/REJECT.
- Collect paired active evidence whenever candidate policies might request it, including study attempts that the default policy would accept passively. Do not invent missing outcomes.
- Review aggregate and per-user FAR/FRR, step-up rates, attack coverage and uncertainty before enabling a policy. Synthetic labels must remain `origin: synthetic`.

## Physical/browser acquisition

- Desktop mouse and trackpad: capitals/Shift-release ordering, Tab and field-click transitions, correction, target sizes, wheel versus inertial scrolling.
- Mobile touch and pen: on-screen input, drag targets, pressure/tilt/twist support, device-class separation and new-device enrollment.
- Sensors: grant/deny motion permission explicitly; verify accelerometer, gyroscope and unavailable/null readings on real devices. Do not treat missing readings as zero motion.
- Autofill/password managers, IME/composition, reduced timestamp precision, background tabs, browser blur, pointer cancellation and network interruption.
- Verify that telemetry contains no password key/code/value and no continuous text/key names; denied or stopped capture must remove listeners.

## Longitudinal behavior

- Exercise passive adaptation over genuine server-time-separated sessions, not edited client labels. Verify no promotion from one login, unknown devices, inconsistent samples, replay or low-quality evidence.
- Compare drift against the immutable anchor; inspect poisoning attempts and threshold changes. A frozen-model login report does not establish adaptation safety.
- Exercise page-wide monitoring after real accepted logins. Verify idle/low-evidence behavior, mismatch reauthentication, 15-minute expiry and explicit stop.
- Assess continuous false-alarm rates separately. Its provisional general-timing heuristic is not certified by the login evaluator.

## Ambient collection (v0.5)

- Measure the step-up rate ambient evidence adds for genuine users. It cannot raise the accept rate by construction, so FAR is not the question; the cost is friction, and it is currently unmeasured.
- Calibrate the ambient threshold against real between-session variance. Synthetic windows produced a leave-one-out threshold pinned at the 0.92 clamp ceiling, which tells you nothing about a real spread.
- Check that six enrollment-time windows are actually reachable in a real enrollment, and how often a participant finishes with no ambient model at all.
- Confirm ambient behavior separates people on a real device before trusting the mismatch trigger. Different browsing tasks are not the same as different people.
- Exercise ambient capture with page navigation, tab switching, background throttling, autofill, IME, touch scrolling and reduced timer precision. Verify the drain boundary under real rapid typing.
- Verify the site-wide collector stays out of every password and sensitive field in the integrating application, not only this demo's form.
- Capture ambient windows alongside the paired passive/active recordings so `evaluate-login` can measure them. Its `ambient.stepUpCost` is the number that decides whether ambient is worth its friction; nothing about it is known without real sessions.
- Ambient weight is selected in a second stage, not jointly with the passive parameters. Check whether a joint search changes the chosen policy before relying on it.

## Deployment gate

- Keep the fixed local enrollment key/password for this local demo only. A real integration needs its own credential verifier, authorization and protected-session framework.
- Run `evaluate-login` with the same active policy intended for deployment; check the report's version and eligibility reasons.
- Set explicit acceptable FAR and minimum genuine/impostor counts in an operator-owned policy; run `check-policy` before startup.
- Back up sensitive recordings before retention/migration. Never enable advanced matching or adaptation based on the temporary smoke fixtures.
