// Configuration for Maria's Orphans Planner
// Quarterly happy-hour date + venue voting for a fixed group of friends.

const APP_VERSION = '1.0.1';

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

    // How many past quarters the History view lists.
    HISTORY_LIMIT: 12,

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
