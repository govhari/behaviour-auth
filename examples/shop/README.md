# Verdant — a shop that mounts BioPrint

A worked integration. The shop has **no backend of its own**: the catalogue and
the basket live in the browser. What it does have is the two halves of a real
deployment — an account system it owns, and a mount point where BioPrint is
handed three callbacks.

```bash
npm run example:shop
```

Then open <http://localhost:3210>. `HOST=0.0.0.0` serves it to the local
network as well. The database defaults to a file in your temporary directory;
set `BIOPRINT_SHOP_DB` to move it. The project's own
`data/bioprint.sqlite` is never touched.

## What to try

1. **Just browse.** Search, filter, open a product, scroll. The inspector in the
   corner counts ambient windows as they are accepted. Nothing has asked who you
   are, and the windows carry no identity yet.
2. **Create an account,** then work through the enrollment wizard: eight typing
   rounds, then eight movement rounds. This is the honest cost of a behavioral
   profile, shown as a progress bar rather than hidden.
3. **Sign out and sign back in.** If the evidence is strong the login is accepted
   outright; if it is thin, the active challenge appears in a modal. Either way
   the *shop's* session is minted server-side, in `onDecision`.
4. **Keep shopping.** Monitoring runs over the whole page. It can ask for a fresh
   login; it can never grant one.
5. **Clean up.** The account page has **Delete this account** (the shop account,
   the behavioral profile and every recording go together; the sign-in form
   offers the same with the password, for an owner whose behavioral sign-in
   keeps failing) and **Clear everything**, which wipes every account, session,
   profile and recording on the demo server.

## The integration, in four places

| File | What it shows |
|---|---|
| `server.js` | `verifyPassword`, `authorizeEnrollment`, `onDecision` — the entire server-side surface; `/api/account/delete` and `/api/reset` call `core.deleteUser` and `core.reset` |
| `public/identity.js` | `watchLogin`, `beginEnrollment`, `runStepUp`, `startMonitoring` |
| `public/store.js` | One line: `setView(token)` on every route change |
| `public/main.js` | Wiring, including the step-up presenter |

`docs/INTEGRATION.md` is the reference.

### Enrollment needs no key in the page

The enrollment key is generated at boot and never leaves the server process.
`authorizeEnrollment` answers from the shop's own sign-up session, so a browser
can train exactly one account — the one it just created. Asking to enroll anyone
else returns `ENROLLMENT_UNAUTHORIZED`.

### An accepted decision is not a session

`onDecision` runs before the browser is told anything. The shop mints its cookie
there, and clears it when monitoring reports `reauthenticationRequired`. BioPrint
never mints a session for the host.

### No profile yet? The host decides

`watchLogin` returns `{unavailable:true}` when an account has no behavioral
profile. The SDK does not choose the fallback. This shop signs in on the password
alone, labels the session as unverified, and offers to train a profile — and
`/api/signin/password` refuses once a profile *does* exist, so the fallback cannot
be used to step around behavioral verification.

## Demo simplifications

- Accounts, password hashes and sign-in sessions live in a SQLite file beside
  BioPrint's (`<BIOPRINT_SHOP_DB>-accounts.sqlite`), so they survive a restart
  together with the profiles. Wipe both files or neither: a profile for an
  account the shop has forgotten cannot be used or re-enrolled.
- The enrollment wizard keeps the password you registered with in page memory for
  the length of the wizard, so it can tell you when a training round did not match
  it. A deployment that would rather not hold it can train on a displayed phrase
  instead, as the research lab does — pass `expectedText:null`.
- Usernames are `[a-zA-Z0-9_-]{3,64}` because BioPrint profiles are keyed that
  way. A real shop would map its own account IDs onto that.
- There is no payment, no inventory and no order history. Checkout prints a
  confirmation and empties the basket.
