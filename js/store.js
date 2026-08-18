// Firestore access layer for Maria's Orphans Planner.
// This is the ONLY file that touches Firebase. Everything else is pure or DOM.
//
// ===========================================================================
// THE ONE RULE: NEVER set() THE WHOLE DOCUMENT AFTER CREATION.
// ===========================================================================
// Every write below is an update() addressed with a firebase.firestore.FieldPath.
// Field-path updates merge server-side, so Maria voting on proposal A and Luz
// voting on proposal B in the same second do not clobber each other. A
// whole-document write is last-writer-wins and would silently eat votes -- the
// worst kind of bug here, because nothing errors and the tally just quietly
// drifts.
//
// FieldPath objects, not dotted strings: the roster is user-editable, and a
// name containing a period or an accent breaks dotted paths while FieldPath
// handles it correctly.

const Store = {
    _db: null,
    _auth: null,
    _unsub: null,
    _status: 'idle',
    _statusListeners: [],

    // ----- setup -------------------------------------------------------

    isConfigured() {
        return !!(FIREBASE_CONFIG
            && FIREBASE_CONFIG.apiKey
            && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY'
            && FIREBASE_CONFIG.projectId
            && FIREBASE_CONFIG.projectId !== 'YOUR_PROJECT_ID');
    },

    /** Initialize Firebase, sign in anonymously, enable offline persistence. */
    async init() {
        if (!this.isConfigured()) {
            throw new Error('Firebase is not configured. See the setup steps in js/config.js.');
        }
        firebase.initializeApp(FIREBASE_CONFIG);
        this._db = firebase.firestore();
        this._auth = firebase.auth();

        // Offline support. Fails in Safari private mode and in some multi-tab
        // situations -- degrade quietly rather than blocking startup.
        try {
            await this._db.enablePersistence({ synchronizeTabs: true });
        } catch (err) {
            console.warn('Offline persistence unavailable:', err.code || err.message);
        }

        await this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await this._auth.signInAnonymously();

        // Firestore queues writes offline and flushes on reconnect, so browser
        // connectivity is a good proxy for the sync chip.
        window.addEventListener('online', () => this._setStatus('synced'));
        window.addEventListener('offline', () => this._setStatus('offline'));
        return true;
    },

    _doc(quarterId) {
        return this._db.collection(CONFIG.COLLECTION).doc(quarterId);
    },

    // ----- sync status -------------------------------------------------

    onStatusChange(cb) { this._statusListeners.push(cb); cb(this._status); },

    _setStatus(s) {
        if (this._status === s) return;
        this._status = s;
        this._statusListeners.forEach(cb => cb(s));
    },

    // ----- reads -------------------------------------------------------

    /**
     * Create the quarter document if this is the first person to open the app
     * this quarter. Wrapped in a transaction so two simultaneous first-loaders
     * cannot both write -- harmless here since the skeleton is identical and
     * empty, but five lines to remove the question entirely.
     */
    async ensureQuarter(info, createdBy) {
        const ref = this._doc(info.quarterId);
        await this._db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists) return;
            tx.set(ref, {
                quarterId: info.quarterId,
                label: info.label,
                year: info.year,
                quarter: info.quarter,
                startDate: info.startDate,
                endDate: info.endDate,
                status: 'active',
                schemaVersion: 1,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: createdBy || 'auto',
                dateProposals: {},
                venues: {},
                result: null,
                archivedAt: null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    },

    /** The single live listener. Everything the UI renders comes through here. */
    watchQuarter(quarterId, cb) {
        this.stopWatching();
        this._setStatus('syncing');
        this._unsub = this._doc(quarterId).onSnapshot(
            snap => {
                const data = snap.exists ? snap.data() : null;
                if (data) this._mirror(quarterId, data);
                this._setStatus(snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'synced');
                cb(data);
            },
            err => {
                console.error('Snapshot error:', err);
                this._setStatus('error');
                cb(this.readMirror(quarterId), err);
            }
        );
        return this._unsub;
    },

    stopWatching() {
        if (this._unsub) { this._unsub(); this._unsub = null; }
    },

    async getQuarter(quarterId) {
        const snap = await this._doc(quarterId).get();
        return snap.exists ? snap.data() : null;
    },

    /**
     * Past quarters, newest first. Document ids sort lexicographically in
     * chronological order, which is why this needs no composite index.
     */
    async listHistory(beforeQuarterId, limit) {
        const snap = await this._db.collection(CONFIG.COLLECTION)
            .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
            .startAfter(beforeQuarterId)
            .limit(limit || CONFIG.HISTORY_LIMIT)
            .get();
        return snap.docs.map(d => d.data());
    },

    // ----- first-paint mirror ------------------------------------------
    // Firestore's own persistence handles real offline behaviour. This mirror
    // exists only so the page paints instantly on a cold load instead of
    // flashing empty while auth completes.

    _mirror(quarterId, data) {
        try {
            localStorage.setItem(CONFIG.LS_MIRROR, JSON.stringify({ quarterId, data }));
        } catch (_) { /* quota or private mode; not worth surfacing */ }
    },

    readMirror(quarterId) {
        try {
            const raw = JSON.parse(localStorage.getItem(CONFIG.LS_MIRROR) || 'null');
            return raw && raw.quarterId === quarterId ? raw.data : null;
        } catch (_) { return null; }
    },

    // ----- writes ------------------------------------------------------

    _id(prefix) {
        return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    _touch() {
        return firebase.firestore.FieldValue.serverTimestamp();
    },

    async addProposal(quarterId, opts) {
        const id = this._id('d_');
        const votes = {};
        // The proposer's own yes is implied -- nobody suggests a date they
        // cannot make, and making them tap twice is friction for no information.
        votes[opts.proposedBy] = 'yes';
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('dateProposals', id), {
                date: opts.date,
                time: opts.time,
                proposedBy: opts.proposedBy,
                createdAt: new Date().toISOString(),
                votes: votes
            },
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
        return id;
    },

    async removeProposal(quarterId, proposalId) {
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('dateProposals', proposalId),
            firebase.firestore.FieldValue.delete(),
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
    },

    /** value is 'yes' | 'maybe' | 'no', or null to clear the vote entirely. */
    async castVote(quarterId, proposalId, name, value) {
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('dateProposals', proposalId, 'votes', name),
            value === null ? firebase.firestore.FieldValue.delete() : value,
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
    },

    async addVenue(quarterId, opts) {
        const id = this._id('v_');
        const upvotes = {};
        upvotes[opts.suggestedBy] = true;
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('venues', id), {
                name: opts.name,
                note: opts.note || '',
                url: opts.url || '',
                suggestedBy: opts.suggestedBy,
                createdAt: new Date().toISOString(),
                upvotes: upvotes
            },
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
        return id;
    },

    async removeVenue(quarterId, venueId) {
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('venues', venueId),
            firebase.firestore.FieldValue.delete(),
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
    },

    async toggleUpvote(quarterId, venueId, name, on) {
        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('venues', venueId, 'upvotes', name),
            on ? true : firebase.firestore.FieldValue.delete(),
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
    },

    /**
     * Close out a quarter that has ended, freezing its winner into `result` so
     * history cannot drift as the scoring code evolves.
     *
     * Idempotent: whoever opens the app first after the quarter ends does this,
     * everyone else no-ops. No cron, no Cloud Function, no organizer action.
     */
    async archiveIfStale(quarterId, todayStr, roster) {
        const data = await this.getQuarter(quarterId);
        if (!data || data.status !== 'active') return null;
        if (!(data.endDate < todayStr)) return null;

        const ranked = Scoring.rankProposals(data.dateProposals, roster);
        const venues = Scoring.rankVenues(data.venues, roster);
        const win = ranked[0] || null;
        const venue = venues[0] || null;

        const result = win ? {
            date: win.date,
            time: win.time || '',
            dateProposalId: win.id,
            dateScore: win.score,
            voterCount: win.voters.length,
            venueName: venue ? venue.name : null,
            venueId: venue ? venue.id : null,
            venueUpvotes: venue ? venue.count : 0,
            frozenAt: new Date().toISOString()
        } : null;

        await this._doc(quarterId).update(
            new firebase.firestore.FieldPath('status'), 'archived',
            new firebase.firestore.FieldPath('result'), result,
            new firebase.firestore.FieldPath('archivedAt'), this._touch(),
            new firebase.firestore.FieldPath('updatedAt'), this._touch()
        );
        return result;
    },

    /** Console helper: Store.exportJson('2026-Q3') for a backup before poking at data. */
    async exportJson(quarterId) {
        const data = await this.getQuarter(quarterId);
        console.log(JSON.stringify(data, null, 2));
        return data;
    }
};
