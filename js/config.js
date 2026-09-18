// Configuration for Maria's Orphans Planner
// Quarterly happy-hour date + venue voting for a fixed group of friends.

// !! Shown on the gate screen and in the footer, and repeated at the top of
// README.md. Bump both together -- a README that disagrees with the running app
// is how you end up debugging a deploy that was fine all along.
const APP_VERSION = '1.5.0';

// ---------------------------------------------------------------------------
// THE ROSTER
// ---------------------------------------------------------------------------
// Order here is the order the name chips appear in.
//
// !! IMPORTANT !! If you change this list, also update the roster() function in
// firestore.rules and re-publish the rules. The two are a keep-in-sync pair.
// See README.md > "Changing the roster".
const ROSTER = ['David', 'Maria', 'Luz', 'Laura', 'Bernice', 'Crisveth'];

// ---------------------------------------------------------------------------
// GROUP PASSCODE
// ---------------------------------------------------------------------------
// SHA-256 hex digest of the shared passcode. The plaintext must never appear
// anywhere in this repository -- it is public, and writing the passcode in a
// comment next to its own hash would make the hash pointless. The share button
// gets the plaintext from whatever the person typed at the gate, which is
// proof enough that they already know it.
//
// To change it, run this in any browser console and paste the result below:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR-PASSCODE'))
//     .then(b => console.log([...new Uint8Array(b)]
//       .map(x => x.toString(16).padStart(2, '0')).join('')))
//
// Be clear-eyed about what this is: an unsalted SHA-256 of a short human
// passcode is brute-forceable by anyone motivated. It exists so a casual
// browser of this public repo can't read the passcode straight off the line.
// It is a UX gate, not security. See README.md > "Security model".
const PASSCODE_SHA256 = 'c344156e1fb7d2b7d99a217976b853ede0d1d4a7ce3e11827d6e0b99f1115abf';

// ---------------------------------------------------------------------------
// FIREBASE
// ---------------------------------------------------------------------------
// To set up (about 15 minutes, one time):
//
// NAV NOTE: the Firebase console has no "Build" section any more -- the left nav
// is grouped into "Product categories". Authentication is under SECURITY, and
// Firestore is under DATABASES & STORAGE. Most tutorials still say "Build".
// The "Search for products" box at the top of the nav is faster either way.
//
// 1. https://console.firebase.google.com -> Add project
//    Name it "happy-hour-planner". DISABLE Google Analytics (on by default).
// 2. Security > Authentication > Get started > Sign-in method tab >
//    Anonymous > Enable > Save.
//    (Skipping this yields auth/operation-not-allowed and an app that hangs.)
// 3. Databases & Storage > Firestore Database > Create database.
//    Location nam5 (us-central) -- permanent, cannot be changed later.
//    PRODUCTION MODE, not test mode: test mode expires after 30 days and would
//    break the app mid-quarter. Stay on the Spark (free) plan.
// 4. Settings > Project settings > Your apps > Web </> > Register app.
//    Do NOT tick "Also set up Firebase Hosting" -- this app is on GitHub Pages.
//    Copy the six values into the object below.
// 5. Security > Authentication > Settings tab > Authorized domains >
//    Add domain: dasatizabal.github.io
// 6. Databases & Storage > Firestore Database > Rules tab >
//    paste the contents of firestore.rules > PUBLISH (the editor holds an
//    unsaved draft locally and looks saved when it is not).
//
// The apiKey below is public, and that is fine -- Firebase web API keys identify
// the project, they do not authorize anything. The rules file is the access
// control.
// NOTE: the Firebase console hands you this block as `const firebaseConfig`.
// The app reads FIREBASE_CONFIG, so keep this name when you paste a new one --
// otherwise Store.isConfigured() throws a ReferenceError and nothing loads.
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDLMTaUWx0cG3HHKexihQGqZ77XUCnzGjQ',
    authDomain: 'happy-hour-planner.firebaseapp.com',
    projectId: 'happy-hour-planner',
    storageBucket: 'happy-hour-planner.firebasestorage.app',
    messagingSenderId: '1029129273055',
    appId: '1:1029129273055:web:e0de843a21c558a1ee336a'
};

// ---------------------------------------------------------------------------
// APP SETTINGS
// ---------------------------------------------------------------------------
const CONFIG = {
    // Firestore collection holding one document per calendar quarter.
    COLLECTION: 'happy_hours',

    // Vote weights used to score a date proposal.
    VOTE_WEIGHTS: { yes: 2, maybe: 1, no: 0 },

    // Below this many voters on the leading proposal, the winner is shown as
    // tentative ("Early days") rather than as a decision.
    MIN_VOTERS_FOR_CONFIDENCE: 3,

    // NEXT-QUARTER LOOKAHEAD.
    // With this on, the date picker stops stopping at the quarter line once the
    // quarter's last month begins: from Sep 1 a Q3 group can propose any night
    // through Dec 31. It exists for the case where a date falls through late in
    // a quarter and there is no room left to move it.
    //
    // A night put up this way is not stranded on the wrong side of the quarter
    // line: at the rollover it moves into the new quarter with its votes, by
    // CARRY_POLL_ON_ROLLOVER below.
    //
    // Set to false to go back to a hard quarter boundary.
    LOOKAHEAD_FROM_LAST_MONTH: true,

    // CARRY THE POLL ACROSS THE ROLLOVER.
    // When a quarter ends, its board splits at its own closing date. Nights
    // that fell inside it stay put and the winner among them is frozen into
    // that quarter's history. Nights beyond it move into the new quarter with
    // every vote intact, so a group that settled on Oct 23 back in September
    // opens October to a board that already says Oct 23. Nobody re-votes.
    //
    // Venues come along too, copied rather than moved, and only when there are
    // dates to carry. A quarter that ended with nothing outstanding still hands
    // the next one a clean slate.
    //
    // Set to false and a quarter ends the old way: everything is frozen where
    // it sits and the new quarter opens empty.
    // See README.md > "Rollover: what carries and what freezes".
    CARRY_POLL_ON_ROLLOVER: true,

    // Time options offered when proposing a date, in 24h HH:MM.
    TIME_SLOTS: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'],
    DEFAULT_TIME: '18:00',

    // How long the calendar event runs, in hours.
    EVENT_DURATION_HOURS: 2,

    // Guard rails, mirrored as size() caps in firestore.rules.
    MAX_PROPOSALS: 40,
    MAX_VENUES: 40,
    MAX_VENUE_NAME: 80,
    MAX_VENUE_NOTE: 200,

    // SWEEPING PAST NIGHTS.
    // A night whose date has gone is not an option any more, and a pile of them
    // buries the ones people can still take. Whoever opens the app clears them.
    //
    // Exactly one past night always survives: the best-scoring one, which is
    // the night the group actually went out and the one archiveIfStale()
    // freezes into history. The survivor is ranked among PAST nights only --
    // rank it against the whole board and a next-quarter date pulling five
    // yeses would sweep every night the group ever met.
    //
    // SWEEP_GRACE_DAYS is how long a spent night lingers first, so somebody who
    // has not opened the app in a couple of days can still see how the vote
    // landed before it goes. 0 sweeps from the next day.
    // SWEEP_KEEP_MIN_VOTERS is the bar a past night must clear to count as the
    // record and be spared. Being the best of a bad lot is not enough: a night
    // one person proposed and nobody answered is a dead suggestion, and
    // protecting it hands it permanent tenure on the board.
    //
    // KNOW THE TRADE AT 5. It is near-unanimous for a roster of six, so a night
    // the group took on a quiet four-vote yes is NOT protected -- it sweeps
    // three days later, and if that was the quarter's only outing the quarter
    // then archives with no result and History reads "Never settled on
    // anything". Lower it to 3 to match MIN_VOTERS_FOR_CONFIDENCE, or to 0 to
    // protect the best past night unconditionally.
    //
    // Clamped to the roster size at runtime, so a bar nobody can clear cannot
    // silently disable the protection for good.
    SWEEP_PAST_DUE: true,
    SWEEP_GRACE_DAYS: 3,
    SWEEP_KEEP_MIN_VOTERS: 5,

    // How many past quarters the History view lists.
    //
    // Four years of them. It used to be twelve, on the reasoning that a quarter
    // is an outing and three years of outings is plenty to scroll. Carrying the
    // poll across a rollover broke that one-to-one: a quarter whose nights all
    // moved into the next one is a real row in this list with no happy hour
    // behind it. Sixteen keeps roughly the same number of ACTUAL outings in
    // view once a few of those rows appear.
    HISTORY_LIMIT: 16,

    // Public URL, used by the Share button.
    APP_URL: 'https://dasatizabal.github.io/Marias-Orphans-Planner/',
    APP_NAME: "Maria's Orphans Planner",
    EVENT_TITLE: "Maria's Orphans Happy Hour",

    // localStorage keys.
    LS_GATE: 'mop_gate_ok',
    LS_IDENTITY: 'mop_identity',
    LS_PASS: 'mop_pass',
    LS_MIRROR: 'mop_quarter_mirror'
};
