// Configuration for Maria's Orphans Planner
// Quarterly happy-hour date + venue voting for a fixed group of friends.

const APP_VERSION = '1.0.0';

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
const PASSCODE_SHA256 = '6efd735ab8920ba21e5e5dd3e5c461d02588657cc24b4c6b5cd1503855f9e8f2';

// ---------------------------------------------------------------------------
// FIREBASE
// ---------------------------------------------------------------------------
// To set up (about 10 minutes, one time):
// 1. Go to https://console.firebase.google.com -> Add project
//    Name it "happy-hour-planner". DISABLE Google Analytics.
// 2. Build > Authentication > Get started > Sign-in method > Anonymous > Enable
//    (Skipping this yields auth/operation-not-allowed and a blank app.)
// 3. Build > Firestore Database > Create database > PRODUCTION MODE (not test)
//    Location: nam5 (us-central). This is permanent and cannot be changed.
// 4. Gear icon > Project settings > Your apps > Web </> > register the app.
//    Do NOT enable Firebase Hosting. Copy the six values into the object below.
// 5. Authentication > Settings > Authorized domains > Add: dasatizabal.github.io
// 6. Firestore > Rules tab > paste the contents of firestore.rules > Publish
const FIREBASE_CONFIG = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
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
