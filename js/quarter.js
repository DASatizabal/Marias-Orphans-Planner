// Quarter math for Maria's Orphans Planner.
//
// Pure functions only: no DOM, no Firebase, no globals beyond CONFIG.
//
// TIMEZONE DISCIPLINE - read before editing:
//   Never use toISOString() on these dates, and never use new Date('2026-09-30').
//   toISOString() converts to UTC, so a local Sep 30 becomes Oct 1 and a date
//   proposal silently falls out of its own quarter. new Date('2026-09-30')
//   parses as UTC midnight and renders as Sep 29 in US timezones.
//   Every date in this app is a local-time "YYYY-MM-DD" string. Format with
//   fmtDate(), parse with parseDate(). No exceptions.

const Quarter = {

    /** Format a Date as a local-time YYYY-MM-DD string. */
    fmtDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    /** Parse a YYYY-MM-DD string into a local-midnight Date. */
    parseDate(s) {
        const [y, m, d] = String(s).split('-').map(Number);
        return new Date(y, m - 1, d);
    },

    /** Today as YYYY-MM-DD, local time. */
    today() {
        return this.fmtDate(new Date());
    },

    /** Quarter number (1-4) for a Date. */
    quarterOf(d) {
        return Math.floor(d.getMonth() / 3) + 1;
    },

    /**
     * Full descriptor for the quarter containing `d` (defaults to now).
     * quarterId sorts lexicographically, which is also chronological order --
     * that is what makes the History view a single orderBy with no index.
     */
    info(d = new Date()) {
        const year = d.getFullYear();
        const q = this.quarterOf(d);
        return {
            quarterId: `${year}-Q${q}`,
            label: `Q${q} ${year}`,
            year,
            quarter: q,
            startDate: this.fmtDate(new Date(year, (q - 1) * 3, 1)),
            // Day 0 of the next month is the last day of this one.
            endDate: this.fmtDate(new Date(year, q * 3, 0))
        };
    },

    /** Descriptor for a "2026-Q3" id, or null if malformed. */
    fromId(quarterId) {
        const m = /^(\d{4})-Q([1-4])$/.exec(String(quarterId || ''));
        if (!m) return null;
        const year = Number(m[1]);
        const q = Number(m[2]);
        return this.info(new Date(year, (q - 1) * 3, 1));
    },

    /** Descriptor for the quarter before the given one. */
    previous(quarterId) {
        const info = this.fromId(quarterId);
        if (!info) return null;
        // Day 0 of the quarter's first month = last day of the previous quarter.
        return this.info(new Date(info.year, (info.quarter - 1) * 3, 0));
    },

    /** Descriptor for the quarter after the given one. */
    next(quarterId) {
        const info = this.fromId(quarterId);
        if (!info) return null;
        // Day 1 of the month after this quarter's last month is the next
        // quarter's first day. Month index 12 rolls the year over on its own.
        return this.info(new Date(info.year, info.quarter * 3, 1));
    },

    /** First day of the quarter's last month: "2026-09-01" for Q3 2026. */
    lastMonthStart(info) {
        return this.fmtDate(new Date(info.year, (info.quarter - 1) * 3 + 2, 1));
    },

    /**
     * Whether the next-quarter lookahead is switched on. Reads CONFIG when it
     * is present and defaults ON when it is not, so tests/logic.test.js can
     * require this file straight off disk and still exercise the behaviour.
     */
    lookaheadEnabled() {
        return (typeof CONFIG !== 'undefined' && CONFIG.LOOKAHEAD_FROM_LAST_MONTH !== undefined)
            ? !!CONFIG.LOOKAHEAD_FROM_LAST_MONTH
            : true;
    },

    /**
     * Bounds for the date input: [today or quarter start, end of the window].
     * A quarter that has already ended returns proposable: false.
     *
     * THE LOOKAHEAD: from the first day of the quarter's last month onward, the
     * window runs through the end of the FOLLOWING quarter. Sep 1 opens October,
     * November and December to a Q3 group. The point is runway -- a date that
     * falls through in the closing weeks of a quarter leaves almost nowhere to
     * move it to, and nobody should have to wait for the rollover to pick a
     * night that actually works.
     *
     * Note what this deliberately does NOT change. Proposals still live in the
     * CURRENT quarter's document, and archiving is still driven by that
     * quarter's own endDate (Store.archiveIfStale). So a next-quarter date that
     * wins is frozen into this quarter's result at the rollover and the new
     * quarter opens empty. See README > "The next-quarter lookahead".
     */
    proposalBounds(info, todayStr = this.today()) {
        const min = todayStr > info.startDate ? todayStr : info.startDate;
        const ahead = this.lookaheadEnabled() && todayStr >= this.lastMonthStart(info)
            ? this.next(info.quarterId)
            : null;
        const max = ahead ? ahead.endDate : info.endDate;
        return {
            min,
            max,
            proposable: min <= max,
            lookahead: !!ahead,
            // Which quarter the far edge belongs to, for the "ends ..." message.
            maxLabel: ahead ? ahead.label : info.label
        };
    },

    /**
     * Validate a proposed date string against the quarter bounds.
     * Mobile browsers do not always enforce the input's min/max when the user
     * types rather than picking, so this runs again on submit.
     */
    validateDate(dateStr, info, todayStr = this.today()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
            return { ok: false, error: 'Pick a date.' };
        }
        const bounds = this.proposalBounds(info, todayStr);
        if (dateStr < bounds.min) {
            return {
                ok: false,
                error: dateStr < todayStr
                    ? "That date has already passed."
                    : `That is before ${info.label} starts.`
            };
        }
        if (dateStr > bounds.max) {
            return { ok: false, error: `${bounds.maxLabel} ends ${this.prettyDate(bounds.max)}.` };
        }
        return { ok: true };
    },

    /** "Fri, Sep 12" */
    prettyDate(dateStr) {
        return this.parseDate(dateStr).toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
        });
    },

    /** "Friday, September 12" */
    longDate(dateStr) {
        return this.parseDate(dateStr).toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric'
        });
    },

    /** "6:30 PM" from "18:30" */
    prettyTime(timeStr) {
        const [h, m] = String(timeStr || '').split(':').map(Number);
        if (Number.isNaN(h)) return '';
        const d = new Date(2000, 0, 1, h, m || 0);
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    },

    /** Whole days from today until dateStr. Negative if past. */
    daysUntil(dateStr, todayStr = this.today()) {
        const ms = this.parseDate(dateStr) - this.parseDate(todayStr);
        return Math.round(ms / 86400000);
    }
};

// Node (tests) and browser both.
if (typeof module !== 'undefined' && module.exports) module.exports = Quarter;
