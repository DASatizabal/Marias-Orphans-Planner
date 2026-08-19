// Multi-select date grid for Maria's Orphans Planner.
//
// Two halves, deliberately kept apart:
//   - a PURE CORE (grid math) with no DOM, no Quarter, no CONFIG, so
//     tests/logic.test.js can require this file straight off disk
//   - a WIDGET that paints one month at a time and handles pointer + keyboard
//
// THE DRAG PAINTS A RECTANGLE, NOT A RUN OF DAYS.
// Press Wed Aug 5, drag down-right to Fri Aug 28, release: you get every Wed,
// Thu and Fri in those four weeks -- twelve dates -- not the twenty-four days
// in between. That is the shape a group actually proposes ("the next few
// Wednesday-to-Friday evenings"), and a linear run is not.
//
// TIMEZONE DISCIPLINE, same rule as js/quarter.js: every date here is a
// local-time YYYY-MM-DD string, and every step below is arithmetic on the day
// NUMBER. Never add 86400000 to advance a day -- that silently skips or repeats
// one across a DST boundary, and the whole quarter would drift with it.

const Calendar = {

    // =====================================================================
    // Pure core -- no DOM, no dependencies. Tested in tests/logic.test.js.
    // =====================================================================

    /** [y, m, d] from "2026-08-05". m is 1-12, not a Date month index. */
    _parts(s) {
        return String(s).split('-').map(Number);
    },

    _str(y, m, d) {
        return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    },

    /** Days in month m (1-12). Day 0 of the next month is the last of this one. */
    daysInMonth(y, m) {
        return new Date(y, m, 0).getDate();
    },

    /** Weekday of the 1st. 0 = Sunday, matching Date.getDay(). */
    firstWeekday(y, m) {
        return new Date(y, m - 1, 1).getDay();
    },

    /**
     * Where a date sits in its month grid.
     *   index = (day - 1) + weekday of the 1st
     *   col   = index % 7        (0 = Sunday, the leftmost column)
     *   row   = floor(index / 7)
     */
    cellOf(dateStr) {
        const [y, m, d] = this._parts(dateStr);
        const index = (d - 1) + this.firstWeekday(y, m);
        return { y, m, d, index, row: Math.floor(index / 7), col: index % 7 };
    },

    /**
     * Every date inside the rectangle spanned by two cells.
     *
     * Order-independent: rectBetween(28th, 5th) === rectBetween(5th, 28th).
     * Empty if the two dates are in different months -- a drag can never cross
     * one, because only a single month is ever on screen.
     */
    rectBetween(aStr, bStr) {
        const a = this.cellOf(aStr);
        const b = this.cellOf(bStr);
        if (a.y !== b.y || a.m !== b.m) return [];

        const rowMin = Math.min(a.row, b.row), rowMax = Math.max(a.row, b.row);
        const colMin = Math.min(a.col, b.col), colMax = Math.max(a.col, b.col);

        const first = this.firstWeekday(a.y, a.m);
        const last = this.daysInMonth(a.y, a.m);
        const out = [];
        for (let d = 1; d <= last; d++) {
            const i = (d - 1) + first;
            const row = Math.floor(i / 7), col = i % 7;
            if (row >= rowMin && row <= rowMax && col >= colMin && col <= colMax) {
                out.push(this._str(a.y, a.m, d));
            }
        }
        return out;
    },

    /**
     * Slots for a month grid, row-major, Sunday first: a date string per real
     * day and null for the leading and trailing blanks. Trailing all-blank
     * weeks are trimmed, so a February starting on a Sunday is four rows and
     * not six of mostly nothing.
     */
    monthCells(y, m) {
        const first = this.firstWeekday(y, m);
        const days = this.daysInMonth(y, m);
        const slots = Math.ceil((first + days) / 7) * 7;
        const out = [];
        for (let i = 0; i < slots; i++) {
            const d = i - first + 1;
            out.push(d >= 1 && d <= days ? this._str(y, m, d) : null);
        }
        return out;
    },

    /** Months as one comparable integer, for clamping the arrows to the quarter. */
    monthIndex(y, m) {
        return y * 12 + (m - 1);
    },

    // =====================================================================
    // Widget -- browser only. None of the below is reachable from node.
    // =====================================================================

    _el: null,
    _sel: null,         // Set of YYYY-MM-DD: the committed selection
    _base: null,        // snapshot of _sel taken when a drag starts
    _anchor: null,      // the cell a drag or shift-click is measured from
    _focus: null,       // cell under the finger, and the roving tabindex target
    _mode: 'add',       // 'add' | 'remove' -- decided by the anchor's own state
    _dragging: false,
    _suppress: false,   // ignore the click a finished pointer sequence trails
    _y: 0, _m: 0,       // month on screen
    _min: null, _max: null,
    _taken: null,       // dates already proposed at the currently chosen time
    _takenKey: '',
    _onChange: null,
    _wired: false,

    /** Called once. opts.onChange(datesArray) fires whenever the set changes. */
    mount(el, opts) {
        this._el = el;
        this._sel = new Set();
        this._taken = new Set();
        this._onChange = (opts && opts.onChange) || function () {};
        if (!this._wired) { this._wire(); this._wired = true; }
    },

    isDragging() {
        return this._dragging;
    },

    /** Sorted, so the write order and the toast both read chronologically. */
    selected() {
        return [...this._sel].sort();
    },

    clear() {
        this._sel.clear();
        this._anchor = null;
        this.paint();
        this._onChange([]);
    },

    /**
     * New bounds, or a new set of already-proposed dates. Repaints only when
     * something actually changed, and never while a finger is down -- a friend
     * casting a vote pushes a snapshot to everyone, and rebuilding the grid
     * mid-drag would drop the selection out from under their hand.
     */
    refresh(o) {
        if (!this._el) return;
        const taken = o.taken || new Set();
        const takenKey = [...taken].sort().join(',');
        const changed = o.min !== this._min || o.max !== this._max || takenKey !== this._takenKey;

        this._min = o.min;
        this._max = o.max;
        this._taken = taken;
        this._takenKey = takenKey;

        // First paint opens on the month holding the earliest proposable day.
        if (!this._y) {
            const [y, m] = this._parts(o.min);
            this._y = y; this._m = m;
        }

        // A tab left open across midnight can be holding a date that just went
        // stale. Drop it rather than letting submit reject the whole batch.
        let pruned = false;
        [...this._sel].forEach(d => {
            if (d < this._min || d > this._max) { this._sel.delete(d); pruned = true; }
        });

        if (this._dragging) return;
        if (changed || pruned) this.paint();
        if (pruned) this._onChange(this.selected());
    },

    // ---- painting -------------------------------------------------------

    paint() {
        if (!this._el || !this._min) return;

        const y = this._y, m = this._m;
        const today = Quarter.today();
        const label = new Date(y, m - 1, 1)
            .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

        // Exactly one cell is tabbable at a time and the arrows move between
        // them. Thirty-odd tab stops inside a form is not navigation, it is a
        // maze.
        const cells = this.monthCells(y, m);
        const enabled = cells.filter(ds => ds && ds >= this._min && ds <= this._max);
        const roving = (this._focus && enabled.includes(this._focus)) ? this._focus : enabled[0];

        this._el.innerHTML =
            '<div class="flex items-center justify-between mb-2.5">' +
              '<button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month"' +
                (this._canGo(-1) ? '' : ' disabled') + '>&lsaquo;</button>' +
              '<span class="text-sm font-semibold">' + label + '</span>' +
              '<button type="button" class="cal-nav" data-nav="1" aria-label="Next month"' +
                (this._canGo(1) ? '' : ' disabled') + '>&rsaquo;</button>' +
            '</div>' +
            '<div class="cal-dow">' + dow.map(d => '<span>' + d + '</span>').join('') + '</div>' +
            '<div class="cal-grid" role="group" aria-label="Choose one or more dates">' +
                cells.map(ds => {
                    if (!ds) return '<span class="cal-blank"></span>';
                    const off = ds < this._min || ds > this._max;
                    const on = this._sel.has(ds);
                    const cls = ['cal-day'];
                    if (off) cls.push('is-disabled');
                    if (on) cls.push('is-selected');
                    if (this._taken.has(ds)) cls.push('has-proposal');
                    if (ds === today) cls.push('is-today');
                    return '<button type="button" class="' + cls.join(' ') + '"' +
                           ' data-date="' + ds + '"' + (off ? ' disabled' : '') +
                           ' tabindex="' + (ds === roving ? '0' : '-1') + '"' +
                           ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
                           ' aria-label="' + Quarter.longDate(ds) + '">' +
                           this._parts(ds)[2] + '</button>';
                }).join('') +
            '</div>';
    },

    /**
     * Repaint selection state onto the cells already in the DOM. This is every
     * frame of a drag: forty-odd class toggles, no innerHTML, so the grid never
     * blinks and focus never moves out from under the pointer.
     */
    _paintSet(set) {
        this._el.querySelectorAll('.cal-day').forEach(b => {
            const on = set.has(b.dataset.date);
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    },

    // ---- month nav ------------------------------------------------------

    _canGo(dir) {
        const [minY, minM] = this._parts(this._min);
        const [maxY, maxM] = this._parts(this._max);
        const target = this.monthIndex(this._y, this._m) + dir;
        return target >= this.monthIndex(minY, minM) && target <= this.monthIndex(maxY, maxM);
    },

    _go(dir) {
        if (!this._canGo(dir)) return;
        const i = this.monthIndex(this._y, this._m) + dir;
        this._y = Math.floor(i / 12);
        this._m = (i % 12) + 1;
        this._focus = null;
        this.paint();
    },

    // ---- selection ------------------------------------------------------

    /** _base with the anchor-to-focus rectangle added or removed. */
    _compute(focusDate) {
        const out = new Set(this._base);
        this.rectBetween(this._anchor, focusDate)
            .filter(d => d >= this._min && d <= this._max)   // a drag skips past days
            .forEach(d => { if (this._mode === 'remove') out.delete(d); else out.add(d); });
        return out;
    },

    _startFrom(date) {
        this._base = new Set(this._sel);
        this._anchor = date;
        // Starting on a date you already picked erases; starting anywhere else
        // paints. That is what makes a lone tap a toggle with no extra branch.
        this._mode = this._sel.has(date) ? 'remove' : 'add';
    },

    _commit(set) {
        this._sel = set;
        this._paintSet(this._sel);
        this._onChange(this.selected());
    },

    /** Click and keyboard path. extend = shift held: rectangle from the anchor. */
    _apply(date, extend) {
        if (extend && this._anchor) {
            this._base = new Set(this._sel);
            this._mode = 'add';
        } else {
            this._startFrom(date);
        }
        this._focus = date;
        this._commit(this._compute(date));
    },

    // ---- events ---------------------------------------------------------

    _wire() {
        const el = this._el;

        el.addEventListener('click', e => {
            const nav = e.target.closest('[data-nav]');
            if (nav) { this._go(Number(nav.dataset.nav)); return; }

            const cell = e.target.closest('.cal-day');
            if (!cell || cell.disabled) return;
            // Mouse and touch were already handled by the pointer sequence
            // below; this branch is for Enter and Space, which fire a click
            // with no pointer behind it.
            if (this._suppress || e.detail !== 0) return;
            this._apply(cell.dataset.date, e.shiftKey);
        });

        el.addEventListener('pointerdown', e => {
            const cell = e.target.closest('.cal-day');
            if (!cell || cell.disabled) return;
            // Stops text selection on desktop and the long-press loupe on iOS.
            // It also stops focus moving, so move it by hand.
            e.preventDefault();
            cell.focus();
            this._roving(cell);

            const date = cell.dataset.date;
            if (e.shiftKey && this._anchor) { this._apply(date, true); return; }

            this._dragging = true;
            this._startFrom(date);
            this._focus = date;
            this._paintSet(this._compute(date));
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* older Safari */ }
        });

        el.addEventListener('pointermove', e => {
            if (!this._dragging) return;
            // Pointer capture retargets every move to the grid, so e.target is
            // the grid and not the cell under the finger. Hit-test by hand.
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const cell = under && under.closest && under.closest('.cal-day');
            if (!cell || cell.disabled || !el.contains(cell)) return;
            if (cell.dataset.date === this._focus) return;
            this._focus = cell.dataset.date;
            this._paintSet(this._compute(this._focus));
        });

        el.addEventListener('pointerup', e => {
            if (!this._dragging) return;
            this._dragging = false;
            try { el.releasePointerCapture(e.pointerId); } catch (_) {}
            this._commit(this._compute(this._focus || this._anchor));
            // Touch trails a click a moment later, and on some browsers that
            // click carries detail 0 -- indistinguishable from Enter without
            // this flag, which would toggle the date straight back off.
            this._suppress = true;
            setTimeout(() => { this._suppress = false; }, 0);
        });

        el.addEventListener('pointercancel', e => {
            if (!this._dragging) return;
            this._dragging = false;
            try { el.releasePointerCapture(e.pointerId); } catch (_) {}
            this._sel = new Set(this._base);
            this._paintSet(this._sel);
        });

        el.addEventListener('keydown', e => {
            const cell = e.target.closest && e.target.closest('.cal-day');
            if (!cell) return;
            const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
            if (!step) return;
            e.preventDefault();
            // Walk the grid's children, blanks included -- the blanks are what
            // make +/-7 land in the same column one row away.
            const all = [...el.querySelector('.cal-grid').children];
            const next = all[all.indexOf(cell) + step];
            if (!next || !next.classList.contains('cal-day') || next.disabled) return;
            next.focus();
            this._roving(next);
        });
    },

    _roving(cell) {
        this._focus = cell.dataset.date;
        this._el.querySelectorAll('.cal-day').forEach(b => {
            b.tabIndex = b === cell ? 0 : -1;
        });
    }
};

// Node (tests) and browser both.
if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
