# Maria's Orphans Planner

A one-page app for six friends who keep saying they should get a drink and never
manage to pick a night.

**Live:** https://dasatizabal.github.io/Marias-Orphans-Planner/

Open the link, enter the group passcode, tap your name, and vote. Anyone can put
a date on the board or suggest a bar. The page tallies everything live and shows
the winning date and venue as they emerge — nobody has to chase the group chat
or count anything. One outing per calendar quarter; finished quarters are
archived so you keep a record of where you went.

## How it works

- **Roster, not logins.** Six names, tap yours. Your pick is remembered on that
  device. No accounts, no Google sign-in, no friction.
- **Passcode.** One shared passcode gates the page. It is a UX gate, not
  security — see [Security model](#security-model).
- **Dates.** Anyone proposes a date and an evening time inside the current
  quarter, from today forward. Everyone marks **Yes / Maybe / No**. Votes are
  changeable at any time — tap the value you already picked to clear it.
- **Venues.** Anyone suggests a place with an optional note and link. Everyone
  upvotes. Suggesting counts as an upvote.
- **The winner is automatic.** Yes = 2 points, Maybe = 1, No = 0. Highest score
  wins. No organizer step, no "lock it in" button.
- **Live.** Everything is one Firestore listener, so a vote cast on one phone
  appears on the other five without a refresh.

### How ties break

In order, so all six phones always agree on the same winner:

1. Higher score
2. More `yes` votes — two keen yeses beat four lukewarm maybes
3. Fewer `no` votes — fewer hard blockers
4. **Earlier date** — sooner beats later for a night out
5. Earlier creation time, then document id (never reached in practice)

### What the winner card is telling you

| State | Meaning |
| --- | --- |
| *Nothing on the board yet* | No proposals, or nobody has voted |
| **Early days — 2 of 6 have voted** | A leader exists but too few have weighed in to call it |
| **Leading** | A real front-runner, voting still open |
| **All 6 voted** | Everyone has weighed in on the leading date |

Two extra lines show up when they are true, and they are the useful part:

- *"Nothing left to vote can change this."* — no combination of the remaining
  unvoted ballots can overtake the leader. This is often true well before
  everyone has voted.
- *"Bernice can't make Sep 12."* — the winning date has a `no` on it. Surfaced
  deliberately: a winner nobody checks the no-list on is how you leave a friend
  behind.

## Setup

One-time, roughly fifteen minutes.

### 1. Firebase

> **Console navigation note.** Firebase reorganized its left nav into *Product
> categories*; there is no longer a **Build** section, which is what most
> tutorials still tell you to look for. Authentication now lives under
> **Security**, and Firestore under **Databases & Storage**. The
> *Search for products* box at the top of the nav is the fastest route either
> way — type "authentication" or "firestore".

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   → name it `happy-hour-planner` → **disable** Google Analytics (it is on by
   default and you do not need it). Note the real project ID Firebase assigns —
   if the name is taken it appends a suffix.
2. **Security → Authentication → Get started → Sign-in method** tab →
   **Anonymous** (near the bottom of the native providers) → **Enable** → **Save**.
   This is the step everyone skips. Without it the page loads and then sits
   there, and the console says `auth/operation-not-allowed`.
3. **Databases & Storage → Firestore Database → Create database** →
   location **`nam5 (us-central)`** (permanent, cannot be changed later) →
   **Production mode**, not test mode. Test mode writes a rule that expires in
   30 days, so the app would work fine and then abruptly stop mid-quarter.
   Stay on the **Spark (free)** plan.
4. **Settings → Project settings → Your apps → Web `</>`** → nickname it →
   **do not** tick "Also set up Firebase Hosting" (this app is on GitHub Pages;
   Hosting only gives you a second, confusingly empty deploy target) →
   **Register app** → copy the six values into `FIREBASE_CONFIG` in
   [`js/config.js`](js/config.js).
5. **Security → Authentication → Settings** tab → **Authorized domains** →
   **Add domain** → `dasatizabal.github.io`. (`localhost` is there by default.)
   Skip this and you get `auth/unauthorized-domain`.
6. **Databases & Storage → Firestore Database → Rules** tab → replace everything
   with [`firestore.rules`](firestore.rules) → **Publish**. The editor keeps an
   unsaved draft locally and looks saved when it is not, so confirm the Publish
   actually went through.
   (`firebase.json` and `.firebaserc` ship too, so
   `firebase deploy --only firestore:rules` works later if you want it repeatable.
   Put your real project id in `.firebaserc` first.)

The API key ends up in this public repo, which is fine: Firebase web API keys
identify the project, they do not authorize anything. The rules in step 6 are
what actually controls access.

### 2. GitHub Pages

Push to `main`, then **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**.
No build step, no workflow, no `.nojekyll`, no CNAME — same as every other app in
this workspace.

### 3. Tell your friends

Send them the link and the passcode. The **share button** in the header copies
both, formatted for pasting into the group text.

The plaintext passcode is deliberately **not** anywhere in this repository — the
repo is public, and a passcode written next to its own hash is not a passcode.
The share button reads it from whatever that device typed at the gate, so only
someone already inside can pass it on.

## Changing things

### The roster

Edit `ROSTER` in [`js/config.js`](js/config.js).

> **Also update `roster()` in [`firestore.rules`](firestore.rules) and re-publish
> the rules.** The two lists are a keep-in-sync pair. Rules cannot read config,
> and making every page load fetch a config document costs more than it is worth
> for six people.

Anyone removed from the roster has their existing votes ignored in the tally
automatically — nothing needs cleaning up.

### The passcode

Generate a new digest in any browser console:

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR-PASSCODE'))
  .then(b => console.log([...new Uint8Array(b)]
    .map(x => x.toString(16).padStart(2, '0')).join('')))
```

Paste it into `PASSCODE_SHA256` in `js/config.js` — the digest only, never the
passcode itself. Nothing else needs changing; the share button picks up the new
passcode the next time someone types it at the gate.

Friends already on the inside stay in, because the gate only runs once per
device. To force everyone back through it, change the `LS_GATE` key in
`CONFIG`.

### Times, limits, quarter behaviour

All in the `CONFIG` object in `js/config.js`: the time slots offered, the event
duration used for calendar export, how many voters before the winner is shown as
confident, and the size caps.

## Security model

Read this before you assume the passcode protects anything.

Firestore rules **cannot** validate a client-side passcode. The Firebase config
is public — it is in this repo, and it is public by design in every web Firebase
app. Anyone who finds this repository can copy the config, call
`signInAnonymously()`, and write to the quarter document. That is the unavoidable
cost of voting with no login, which is the trade that makes the app usable.

So the rules limit the **blast radius** rather than access:

- `allow delete: if false` — history can never be destroyed
- `hasOnly()` on top-level keys — the schema cannot be injected into
- `size() <= 40` caps on proposals and venues — nobody can run up a bill
- Quarter identity and date bounds are immutable after creation
- The client ignores any voter name not in `ROSTER`, so stray writes do not
  affect the tally

Worst realistic case is someone scribbling on the current quarter: visible,
weird, and fixable from the Firebase console in thirty seconds. `Store.exportJson('2026-Q3')`
in the browser console dumps a backup first.

The passcode hash is a decency measure so a casual browser of this repo cannot
read the passcode off line 12. An unsalted SHA-256 of a short human passcode is
brute-forceable in seconds by anyone who cares. Do not reuse a passcode you use
anywhere else.

## Notes for future maintainers

**Never `set()` the whole quarter document from the client.** Every write in
`js/store.js` is an `update()` addressed with a `firebase.firestore.FieldPath`,
which merges server-side. A whole-document write is last-writer-wins and would
silently eat votes when two people tap at the same moment — nothing errors, the
tally just quietly drifts. `FieldPath` objects rather than dotted strings,
because a roster name with a period or an accent breaks dotted paths.

**The service worker is network-first on purpose.** Do not convert it to
cache-first. This app's whole value is freshness, and a cache-first worker on
GitHub Pages is the most reliable way to strand your friends on a stale build.
Firebase hosts are skipped entirely so the Firestore SDK's own transport and
offline persistence are left alone.

**Dates are local-time `YYYY-MM-DD` strings, always.** Never `toISOString()`
them, never `new Date('2026-09-30')`. The first shifts to UTC and pushes a Sep 30
evening into Q4; the second parses as UTC midnight and renders as Sep 29 in US
timezones. Format with `Quarter.fmtDate()`, parse with `Quarter.parseDate()`.

**Quarter rollover and archiving need no cron.** Whoever opens the app first
after a quarter ends archives the previous one and freezes its winner into
`result`, so history cannot drift if the scoring code changes. It is idempotent;
everyone else no-ops.

## Layout

```
index.html          markup + CDN tags
css/styles.css      what Tailwind utilities cannot express
js/config.js        roster, passcode hash, Firebase config, settings   <- the file you edit
js/quarter.js       pure: quarter math, local-date formatting
js/scoring.js       pure: ranking, tie-breaks, confidence
js/store.js         the only file that touches Firebase
js/ics.js           calendar export
js/app.js           state, rendering, events
firestore.rules     security rules (paste into the console)
tests/logic.test.js node tests/logic.test.js -- no dependencies
sw.js               network-first only
```

## Tests

The parts most worth being right — quarter math and the tie-break chain — are
pure functions with no dependencies:

```bash
node tests/logic.test.js
```

## Local development

```bash
python -m http.server 8000
```

Then open **http://localhost:8000/** — not a LAN IP. `crypto.subtle` needs a
secure context, so the passcode gate silently cannot work over plain `http://`
on `192.168.x.x`, and `file://` breaks Firebase Auth outright.

To simulate several friends, open a normal window, an incognito window, and a
second browser. Each gets its own `localStorage` and its own anonymous uid,
which is exactly how production behaves.

To view or test a specific quarter, add `?q=2026-Q4` to the URL. That is the same
mechanism the History list uses.
