# Integrating BioPrint into an application

There are two client layers. Pick one deliberately.

| Layer | Module | Shape | Use it when |
|---|---|---|---|
| Transport | `client/sdk.js` — `BioPrintSDK` | One method per HTTP endpoint | A research harness, or a host that wants to sequence everything itself |
| Integration | `client/bioprint.js` — `createBioPrint` | Four objects: a page, a login form, a sign-up, a session | An ordinary application |

The façade decides nothing. It sequences challenge → capture → submit → step-up →
monitor and hands the server's decision back unchanged.

`examples/shop` is a complete worked integration: `npm run example:shop`.

## The host owns identity; BioPrint owns behavior

`createHandler` takes three callbacks and nothing else from the host application.

```js
import { createHandler } from 'bioprint/server';

const handler = createHandler(core, {
  basePath:'/bioprint',
  verifyPassword: (user, password) => accounts.verify(user, password),
  authorizeEnrollment: (req, body) => sessionOf(req)?.enrolling === body.userId,
  onDecision: async ({req, res, route, body, result}) => { /* mint your session */ },
});
```

- **`verifyPassword(user, password)`** — required in practice: without it every password fails closed (the standalone demo supplies its own via `demoAccounts`). The credential is checked here and deleted
  before the behavioral verifier sees the payload. It never reaches audit records
  or session storage.
- **`authorizeEnrollment(req, body)`** — returning true supplies the core's own
  enrollment key on the browser's behalf, so no shared secret has to be shipped to
  the page. The shop example answers it from its own sign-up session, which means
  a browser may train exactly one account: the one it just created.
- **`onDecision({req, res, route, body, result})`** — awaited before the response is
  sent, so the host sees the outcome first and may still fail the request. An
  accepted behavioral decision is not a signed-in user until the host says so. Use
  it to mint a session on `/login/verify` and `/login/complete`, and to revoke one
  when `/monitor/sample` returns `reauthenticationRequired`.

`serveDemo` now defaults to **false**: the library no longer serves the research
lab's UI into a host application. `node server/http.js` passes `serveDemo:true`
for the loopback demo.

## Ambient collection

```js
const bp = createBioPrint({endpoint:'/bioprint', view:'catalog', ambient:true, onAmbient:render});
bp.setView('product');   // on every route change
```

Collection starts on first paint, for every visitor, before anyone has signed in
or registered. The session carries no identity; the server attributes it to an
account only when a login references it. `setView` takes an **opaque token**
matching `[a-zA-Z0-9_-]{1,32}` — not a URL, because ambient recordings carry no
addresses, text, key names or key codes.

Pre-login evidence can withhold confidence but never supply it: a passive score
below its own threshold is never rescued by it. See `docs/AMBIENT_SDK.md`.

## The login form

```js
const handle = bp.watchLogin({form, username, password, submit});
form.onsubmit = async event => {
  const result = await handle.submit({password: password.value, event});
  if (result.unavailable) return yourOwnFallback();   // no profile enrolled yet
  if (result.allowed) return yourOwnSession(result);
};
```

Observation starts when the form is **rendered**, not when the account is known —
a visitor types the username into the form already being watched. The handle
claims an account on the username field's `change` event, or through
`handle.identify(name)`.

Three outcomes the host must handle:

- `{unavailable:true}` — the account has no behavioral profile. The SDK does not
  decide the fallback; the shop signs in on the password alone and says so.
- `decision:'STEP_UP'` — returned directly, or resolved into a final decision when
  a `stepUp` presenter is configured.
- `allowed:true` — the server accepted. Your own session comes from `onDecision`.

A challenge is single-use, so a retry needs a fresh `watchLogin`.

### Presenting the step-up

`client/stepup.js` builds the active challenge — phrase, typing field, pointer
arena, scroll panel — with its own scoped stylesheet, so a host does not have to
know that `sdk.capture` needs three particular elements laid out in particular
ways.

```js
createBioPrint({
  stepUp:{
    mount(element, {challenge, reasons}) { modal.open(element, {dismissable:false}); },
    dismiss() { modal.close(); },
  },
});
```

Theme it by setting `--bp-surface`, `--bp-line`, `--bp-fg`, `--bp-muted`,
`--bp-accent` and `--bp-accent-fg` on the widget or any ancestor. The widget's
defaults live on `:root` precisely so a host's own values win.

A dismissed widget is a declined step-up, not an acceptance.

## Registration

```js
const wizard = await bp.beginEnrollment({userId});
wizard.progress();                         // {stage, passive:{done,required}, active:{done,required}}
await wizard.passiveRound({form, username, password, submit, expectedText});
await wizard.activeRound({mount});
await wizard.complete();
```

Enrollment is genuinely a multi-round exercise — ten typing rounds and eight
movement rounds for a new account — and `progress()` exists so an application
shows that honestly rather than implying it is instant. `complete()` folds in the
ambient windows collected while the visitor worked through the rounds, so there is
no separate collection step. If the server reports that the samples disagree, the
wizard raises its own target and the next `progress()` asks for another round.

## After sign-in

```js
const monitor = bp.startMonitoring({userId, loginId, roots:[document], onReauthentication});
monitor.stop();
```

Monitoring never grants access and never extends trust on its own. It observes,
renews its own lifetime from corroborating evidence, and can require a fresh
login — the one thing it can do to a session is take it away.
