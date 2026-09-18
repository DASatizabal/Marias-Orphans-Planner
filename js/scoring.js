// Scoring, ranking and consensus for Maria's Orphans Planner.
//
// Pure functions only: no DOM, no Firebase.
//
// Every one of the six phones runs this against the same snapshot, so the
// ordering must be totally deterministic -- the tie-break chain runs all the
// way down to the document id so two people never see different winners.

const Scoring = (() => {

    const WEIGHTS = (typeof CONFIG !== 'undefined' && CONFIG.VOTE_WEIGHTS)
        ? CONFIG.VOTE_WEIGHTS
        : { yes: 2, maybe: 1, no: 0 };

    const MIN_CONFIDENT = (typeof CONFIG !== 'undefined' && CONFIG.MIN_VOTERS_FOR_CONFIDENCE)
        ? CONFIG.MIN_VOTERS_FOR_CONFIDENCE
        : 3;

    /**
     * Votes cast by anyone not on the roster are ignored everywhere.
     * Firestore rules cannot validate map keys, so this is where a stray
     * writer gets filtered out. See README.md > "Security model".
     */
    function rosterVotes(votes, roster) {
        const out = {};
        Object.keys(votes || {}).forEach(name => {
            if (roster.includes(name) && WEIGHTS[votes[name]] !== undefined) {
                out[name] = votes[name];
            }
        });
        return out;
    }

    /** Tally one proposal's votes into score + per-value counts. */
    function tally(proposal, roster) {
        const votes = rosterVotes(proposal.votes, roster);
        const t = {
            score: 0, yes: [], maybe: [], no: [], voters: [], missing: []
        };
        Object.keys(votes).forEach(name => {
            t.score += WEIGHTS[votes[name]];
            t[votes[name]].push(name);
            t.voters.push(name);
        });
        t.missing = roster.filter(n => !t.voters.includes(n));
        // Best score this proposal could still reach if everyone who has not
        // voted yet votes yes.
        t.maxReachable = t.score + WEIGHTS.yes * t.missing.length;
        return t;
    }

    /**
     * Rank date proposals best-first.
     *
     * Tie-break chain, in order:
     *   1. higher score
     *   2. more yes votes    (two keen yeses beat four lukewarm maybes)
     *   3. fewer no votes    (fewer hard blockers)
     *   4. earlier date      (sooner beats later for a night out)
     *   5. earlier createdAt, then id  (absolute determinism; never reached)
     */
    function rankProposals(proposals, roster) {
        return Object.entries(proposals || {})
            .map(([id, p]) => ({ id, ...p, ...tally(p, roster) }))
            .sort((a, b) =>
                b.score - a.score
                || b.yes.length - a.yes.length
                || a.no.length - b.no.length
                || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
                || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
                || a.id.localeCompare(b.id)
            );
    }

    /** Rank venues by upvote count, then creation order, then id. */
    function rankVenues(venues, roster) {
        return Object.entries(venues || {})
            .map(([id, v]) => {
                const up = Object.keys(v.upvotes || {}).filter(n => roster.includes(n));
                return { id, ...v, upvoters: up, count: up.length };
            })
            .sort((a, b) =>
                b.count - a.count
                || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
                || a.id.localeCompare(b.id)
            );
    }

    /**
     * Which past nights are dead weight, and which one has to stay.
     *
     * A night whose date has gone is no longer an option, and leaving a pile of
     * them on the board buries the ones people can still take. But exactly one
     * past night is not clutter: the best-scoring one is the night the group
     * actually went out, and it is what Store.archiveIfStale() freezes into the
     * quarter's history. Sweep that and the quarter ends up with no record that
     * anything happened.
     *
     * So the survivor is ranked among the PAST nights only, never against the
     * whole board. Otherwise a next-quarter date pulling five yeses -- which
     * the lookahead makes ordinary in the last month of a quarter -- would make
     * every night the group ever met "non-winning" and sweep the lot.
     *
     * BEING THE BEST PAST NIGHT IS NOT ENOUGH TO SURVIVE. The best of a bad lot
     * is still a bad lot: a night one person proposed and nobody else answered
     * is a dead suggestion, not a record of an evening, and protecting it gives
     * it permanent tenure on the board -- it can only ever be displaced by
     * another past night, which is exactly the clutter the sweep exists to
     * remove. So the survivor must also clear `keepMinVoters`. Below that bar
     * nothing is protected and every spent night goes.
     *
     * `cutoff` is how far back a night must be before it is old enough to go,
     * and `keepMinVoters` how many of the roster must have voted on a night
     * before it counts as the record. Both are passed in rather than computed
     * here so this file stays free of CONFIG and of Quarter (tests require the
     * two straight off disk, in separate scopes). keepMinVoters defaults to 0,
     * which protects the best past night unconditionally -- the older, more
     * cautious behaviour, and the safer thing to fall back to.
     */
    function sweepable(proposals, todayStr, cutoffStr, roster, keepMinVoters) {
        const pastDue = {};
        Object.keys(proposals || {}).forEach(id => {
            const p = proposals[id];
            if (p && p.date < todayStr) pastDue[id] = p;
        });

        const ids = Object.keys(pastDue);
        if (!ids.length) return [];

        const min = Number.isFinite(keepMinVoters) ? keepMinVoters : 0;
        const best = rankProposals(pastDue, roster)[0];
        const keepId = (best && best.voters.length >= min) ? best.id : null;

        return ids
            .filter(id => id !== keepId && pastDue[id].date <= cutoffStr)
            .sort();
    }

    /** Roster members who have not voted on a single proposal all quarter. */
    function waitingOn(proposals, roster) {
        const seen = new Set();
        Object.values(proposals || {}).forEach(p => {
            Object.keys(rosterVotes(p.votes, roster)).forEach(n => seen.add(n));
        });
        return roster.filter(n => !seen.has(n));
    }

    /**
     * How much to trust the current leader. Four states, not two -- showing a
     * one-vote lead with the same confidence as a unanimous result is how the
     * page starts lying to people.
     *
     *   none     nothing to go on yet
     *   thin     a leader exists but too few have weighed in
     *   leading  a real front-runner, voting still open
     *   all-in   every roster member has voted on the leader
     *
     * `decisive` is separate from the state: it means no combination of the
     * remaining unvoted ballots can overtake the leader, assuming nobody
     * changes an existing vote. That is the genuinely satisfying thing to
     * tell the group, and it can be true well before everyone has voted.
     */
    function confidence(ranked, roster) {
        const leader = ranked[0];
        if (!leader || leader.voters.length === 0) {
            return { state: 'none', leader: leader || null, decisive: false };
        }

        // Requires at least one rival: with a single proposal on the board the
        // claim would be vacuously true, and it would also be a lie, because
        // anyone can still propose a new date.
        const decisive = ranked.length > 1
            && ranked.slice(1).every(r => leader.score > r.maxReachable);

        let state;
        if (leader.voters.length >= roster.length) state = 'all-in';
        else if (leader.voters.length < MIN_CONFIDENT) state = 'thin';
        else state = 'leading';

        return {
            state,
            leader,
            decisive,
            votedCount: leader.voters.length,
            rosterCount: roster.length,
            // Anyone who said no to the winning date. Surfaced deliberately:
            // a winner nobody checks the no-list on is how you leave a friend
            // behind.
            blockers: leader.no
        };
    }

    return { tally, rankProposals, rankVenues, sweepable, waitingOn, confidence, WEIGHTS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Scoring;
