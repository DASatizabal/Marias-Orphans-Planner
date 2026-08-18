// Main controller for Maria's Orphans Planner.
//
// Boot order: passcode gate -> identity -> Firebase -> quarter -> live listener
// -> render. Everything the UI shows comes from a single onSnapshot, so there
// is exactly one path into render() and no partial states to reason about.

const App = {

    state: {
        quarterId: null,
        info: null,       // Quarter.info() descriptor
        data: null,       // the raw Firestore document
        me: null,         // claimed roster name
        readOnly: false,  // true for archived quarters and history views
        override: null,   // ?q=2026-Q4, used by History and by rollover testing
        historyOpen: false
    },

    _pendingRender: false,

    // =====================================================================
    // Boot
    // =====================================================================

    async start() {
        document.getElementById('app-version').textContent = APP_VERSION;
        this.wireStaticEvents();
        this.registerServiceWorker();

        // ?q=2026-Q4 views a specific quarter. Not a debug hatch bolted on --
        // it is the same mechanism the History view uses to open a past quarter.
        const q = new URLSearchParams(location.search).get('q');
        if (q && Quarter.fromId(q)) this.state.override = q;

        if (localStorage.getItem(CONFIG.LS_GATE) === '1') {
            this.showIdentityOrBoot();
        } else {
            this.showGate();
        }
    },

    /**
     * The worker is network-first and skips Firebase hosts entirely -- see the
     * comment at the top of sw.js before changing anything here. It exists for
     * add-to-homescreen and a readable offline fallback, not for speed.
     */
    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (location.protocol === 'file:') return;
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .catch(err => console.warn('Service worker registration failed:', err));
        });
    },

    // ---- passcode gate --------------------------------------------------

    showGate() {
        const gate = document.getElementById('gate');
        gate.classList.remove('hidden');
        gate.classList.add('flex');
        setTimeout(() => document.getElementById('gate-input').focus(), 100);
        this.icons();
    },

    async checkPasscode(entered) {
        // crypto.subtle only exists in a secure context: https:// or
        // http://localhost. It is absent over plain http on a LAN IP, which is
        // exactly how someone testing from their phone would hit this.
        if (!window.crypto || !crypto.subtle) {
            return { ok: false, error: 'Open this page over https:// or on localhost.' };
        }
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entered.trim()));
        const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
        return hex === PASSCODE_SHA256
            ? { ok: true }
            : { ok: false, error: "That's not it. Ask in the group chat." };
    },

    // ---- identity -------------------------------------------------------

    showIdentityOrBoot() {
        const saved = localStorage.getItem(CONFIG.LS_IDENTITY);
        if (saved && ROSTER.includes(saved)) {
            this.state.me = saved;
            this.boot();
        } else {
            this.showIdentity();
        }
    },

    showIdentity() {
        const el = document.getElementById('identity');
        document.getElementById('identity-list').innerHTML = ROSTER
            .map(n => `<button class="name-chip" data-act="claim" data-name="${this.esc(n)}">${this.esc(n)}</button>`)
            .join('');
        el.classList.remove('hidden');
        el.classList.add('flex');
        this.icons();
    },

    claim(name) {
        if (!ROSTER.includes(name)) return;
        this.state.me = name;
        localStorage.setItem(CONFIG.LS_IDENTITY, name);
        const el = document.getElementById('identity');
        el.classList.add('hidden');
        el.classList.remove('flex');
        if (this.state.data) this.render(); else this.boot();
    },

    // ---- main boot ------------------------------------------------------

    async boot() {
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('identity-name').textContent = this.state.me;

        Store.onStatusChange(s => this.renderSync(s));

        if (!Store.isConfigured()) {
            this.banner('error',
                'Firebase is not set up yet. Follow the numbered steps in <code class="text-slate-300">js/config.js</code>, then reload.');
            return;
        }

        try {
            await Store.init();
        } catch (err) {
            console.error(err);
            this.banner('error', `Could not reach Firebase: ${this.esc(err.message || err.code || 'unknown error')}`);
            return;
        }

        const info = this.state.override ? Quarter.fromId(this.state.override) : Quarter.info();
        this.state.info = info;
        this.state.quarterId = info.quarterId;

        // Paint immediately from the mirror so a cold load on a phone is not a
        // blank screen while auth and the first snapshot land.
        const mirror = Store.readMirror(info.quarterId);
        if (mirror) { this.state.data = mirror; this.render(); }

        try {
            await Store.ensureQuarter(info, this.state.me);
        } catch (err) {
            // A past quarter that was never created is a legitimate miss, not
            // an error worth shouting about.
            console.warn('ensureQuarter:', err.code || err.message);
        }

        Store.watchQuarter(info.quarterId, (data, err) => {
            this.state.data = data;
            if (err) this.banner('error', 'Lost the connection. Showing the last version you saw.');
            this.render();
        });

        // Close out the previous quarter if it ran out while nobody was looking.
        this.closeOutPreviousQuarter();

        // A tab left open across Sep 30 -> Oct 1 would otherwise keep voting on
        // a quarter that has ended.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden || this.state.override) return;
            if (Quarter.info().quarterId !== this.state.quarterId) location.reload();
        });
    },

    async closeOutPreviousQuarter() {
        const prev = Quarter.previous(this.state.quarterId);
        if (!prev) return;
        try {
            await Store.archiveIfStale(prev.quarterId, Quarter.today(), ROSTER);
        } catch (err) {
            console.warn('archiveIfStale:', err.code || err.message);
        }
    },

    // =====================================================================
    // Render
    // =====================================================================

    /**
     * Never re-render while someone is typing. A friend casting a vote pushes a
     * snapshot to everyone, and without this guard that snapshot yanks the
     * venue name out from under whoever is mid-sentence.
     */
    render() {
        const el = document.activeElement;
        if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
            this._pendingRender = true;
            return;
        }
        this._pendingRender = false;
        this._render();
    },

    _render() {
        const d = this.state.data;
        const info = this.state.info;
        if (!info) return;

        this.state.readOnly = !!(d && d.status === 'archived') || info.quarterId !== Quarter.info().quarterId;

        const proposals = (d && d.dateProposals) || {};
        const venues = (d && d.venues) || {};
        const ranked = Scoring.rankProposals(proposals, ROSTER);
        const rankedVenues = Scoring.rankVenues(venues, ROSTER);
        const conf = Scoring.confidence(ranked, ROSTER);

        document.getElementById('quarter-label').textContent =
            this.state.readOnly ? `${info.label} · wrapped` : `${info.label} happy hour`;

        this.renderWaiting(Scoring.waitingOn(proposals, ROSTER), ranked.length);
        this.renderWinner(conf, rankedVenues[0], d);
        this.renderDates(ranked);
        this.renderVenues(rankedVenues);
        this.renderFormAvailability();
        this.icons();
    },

    renderFormAvailability() {
        const bounds = Quarter.proposalBounds(this.state.info);
        const hide = this.state.readOnly || !bounds.proposable;
        ['add-date-btn', 'add-venue-btn'].forEach(id => {
            document.getElementById(id).classList.toggle('hidden', hide);
        });
        if (hide) {
            document.getElementById('date-form').classList.add('hidden');
            document.getElementById('venue-form').classList.add('hidden');
        }
        const di = document.getElementById('date-input');
        di.min = bounds.min;
        di.max = bounds.max;
    },

    // ---- waiting on -----------------------------------------------------

    renderWaiting(waiting, proposalCount) {
        const el = document.getElementById('waiting-on');
        if (this.state.readOnly || proposalCount === 0 || waiting.length === 0) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="text-slate-400">Still waiting on</span>
                ${waiting.map(n => `
                    <span class="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs font-medium">
                        ${this.esc(n)}
                    </span>`).join('')}
            </div>`;
    },

    // ---- winner ---------------------------------------------------------

    renderWinner(conf, topVenue, data) {
        const el = document.getElementById('winner');

        // A wrapped quarter shows what was frozen at archive time, not a fresh
        // recount -- history must not drift when the scoring code changes.
        if (this.state.readOnly && data && data.result) {
            const r = data.result;
            el.innerHTML = `
                <div class="glass rounded-2xl p-5">
                    <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">How it ended</p>
                    <h2 class="text-xl font-bold">${this.esc(Quarter.longDate(r.date))}</h2>
                    <p class="text-slate-400 mt-0.5">${this.esc(Quarter.prettyTime(r.time))}${
                        r.venueName ? ` · ${this.esc(r.venueName)}` : ''}</p>
                    <p class="text-xs text-slate-500 mt-3">${r.voterCount} of ${ROSTER.length} voted · ${r.dateScore} points</p>
                </div>`;
            return;
        }

        if (conf.state === 'none') {
            el.innerHTML = `
                <div class="rounded-2xl p-6 border border-dashed border-white/12 text-center">
                    <i data-lucide="calendar-plus" class="w-7 h-7 mx-auto mb-3 text-slate-600"></i>
                    <p class="font-medium text-slate-300">Nothing on the board yet</p>
                    <p class="text-sm text-slate-500 mt-1">Propose a date and the rest will follow.</p>
                </div>`;
            return;
        }

        const w = conf.leader;
        const allIn = conf.state === 'all-in';
        const thin = conf.state === 'thin';

        const wrapper = allIn
            ? 'rounded-2xl p-5 bg-gradient-to-br from-violet-600/25 to-cyan-600/20 border border-violet-500/40 winner-glow'
            : thin
                ? 'glass rounded-2xl p-5 opacity-80'
                : 'glass rounded-2xl p-5 border-violet-500/25';

        const label = allIn
            ? `All ${ROSTER.length} voted`
            : thin
                ? `Early days — ${conf.votedCount} of ${conf.rosterCount} have voted`
                : 'Leading';

        el.innerHTML = `
            <div class="${wrapper}">
                <div class="flex items-center gap-2 mb-2.5">
                    <i data-lucide="${allIn ? 'party-popper' : thin ? 'hourglass' : 'trending-up'}"
                       class="w-4 h-4 ${allIn ? 'text-violet-200' : 'text-slate-400'}"></i>
                    <p class="text-xs uppercase tracking-wider ${allIn ? 'text-violet-200' : 'text-slate-500'}">${this.esc(label)}</p>
                </div>

                <h2 class="text-2xl font-bold leading-tight">${this.esc(Quarter.longDate(w.date))}</h2>
                <p class="text-slate-300 mt-0.5">
                    ${this.esc(Quarter.prettyTime(w.time))}${topVenue ? ` · ${this.esc(topVenue.name)}` : ''}
                </p>

                ${conf.decisive && !allIn && !thin ? `
                    <p class="text-sm text-emerald-300/90 mt-3 flex items-center gap-1.5">
                        <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                        Nothing left to vote can change this.
                    </p>` : ''}

                ${conf.blockers.length ? `
                    <p class="text-sm text-rose-300/90 mt-3 flex items-center gap-1.5">
                        <i data-lucide="user-x" class="w-4 h-4 shrink-0"></i>
                        ${this.esc(this.list(conf.blockers))} can't make ${this.esc(Quarter.prettyDate(w.date))}.
                    </p>` : ''}

                ${!topVenue ? `
                    <p class="text-sm text-slate-400 mt-3">No bar suggested yet.</p>` : ''}

                ${thin ? '' : `
                    <div class="flex flex-wrap gap-2 mt-4">
                        <button data-act="ics" class="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/15 transition">
                            <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i> Add to calendar
                        </button>
                        <a data-act="gcal" href="#" target="_blank" rel="noopener"
                           class="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/15 transition">
                            <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Google Calendar
                        </a>
                    </div>`}
            </div>`;

        if (!thin) {
            const ev = {
                date: w.date,
                time: w.time,
                venue: topVenue ? topVenue.name : '',
                description: `${CONFIG.APP_NAME} — ${CONFIG.APP_URL}`
            };
            el.querySelector('[data-act="gcal"]').href = Ics.googleUrl(ev);
            this._event = ev;
        }
    },

    // ---- dates ----------------------------------------------------------

    renderDates(ranked) {
        const el = document.getElementById('date-list');
        if (!ranked.length) {
            el.innerHTML = this.empty('calendar-days', 'No dates proposed yet.');
            return;
        }
        const me = this.state.me;
        el.innerHTML = ranked.map((p, i) => {
            const mine = p.votes && p.votes[me];
            return `
            <article class="glass rounded-2xl p-4">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            ${i === 0 && p.score > 0
                                ? '<span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">Top</span>'
                                : ''}
                            <h3 class="font-semibold">${this.esc(Quarter.prettyDate(p.date))}</h3>
                            <span class="text-slate-400 text-sm">${this.esc(Quarter.prettyTime(p.time))}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            by ${this.esc(p.proposedBy)} · ${p.voters.length}/${ROSTER.length} voted
                        </p>
                    </div>
                    <div class="text-right shrink-0 flex items-start gap-3">
                        <div>
                            <div class="text-xl font-bold leading-none">${p.score}</div>
                            <div class="text-[10px] uppercase tracking-wider text-slate-500 mt-1">pts</div>
                        </div>
                        ${!this.state.readOnly && p.proposedBy === me ? `
                            <button data-act="del-date" data-id="${p.id}" title="Remove this date"
                                    class="p-1.5 -mt-1 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>` : ''}
                    </div>
                </div>

                <div class="flex flex-wrap gap-1.5 mb-3">
                    ${ROSTER.map(n => {
                        const v = (p.votes && ROSTER.includes(n)) ? p.votes[n] : null;
                        const cls = ['yes', 'maybe', 'no'].includes(v) ? v : 'none';
                        return `<span class="avatar ${cls}" title="${this.esc(n)}${v ? ': ' + v : ': no vote yet'}">${this.esc(this.initials(n))}</span>`;
                    }).join('')}
                </div>

                ${this.state.readOnly ? '' : `
                    <div class="vote-group">
                        ${[['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']].map(([v, lbl]) => `
                            <button class="vote-btn ${mine === v ? 'on-' + v : ''}"
                                    data-act="vote" data-id="${p.id}" data-vote="${v}">${lbl}</button>`).join('')}
                    </div>`}
            </article>`;
        }).join('');
    },

    // ---- venues ---------------------------------------------------------

    renderVenues(ranked) {
        const el = document.getElementById('venue-list');
        if (!ranked.length) {
            el.innerHTML = this.empty('map-pin', 'No spots suggested yet.');
            return;
        }
        const me = this.state.me;
        el.innerHTML = ranked.map((v, i) => {
            const mine = !!(v.upvotes && v.upvotes[me]);
            const url = this.safeUrl(v.url);
            return `
            <article class="glass rounded-2xl p-4 flex items-start gap-3.5">
                ${this.state.readOnly ? `
                    <div class="shrink-0 w-12 text-center">
                        <div class="text-lg font-bold leading-none">${v.count}</div>
                        <div class="text-[10px] uppercase tracking-wider text-slate-500 mt-1">votes</div>
                    </div>` : `
                    <button data-act="upvote" data-id="${v.id}" data-on="${mine ? '0' : '1'}"
                            class="shrink-0 w-12 py-2 rounded-xl border transition ${mine
                                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}">
                        <i data-lucide="chevron-up" class="w-4 h-4 mx-auto pointer-events-none"></i>
                        <div class="text-sm font-bold mt-0.5 pointer-events-none">${v.count}</div>
                    </button>`}

                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        ${i === 0 && v.count > 0
                            ? '<span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">Top</span>'
                            : ''}
                        <h3 class="font-semibold truncate">${this.esc(v.name)}</h3>
                        ${url ? `<a href="${this.esc(url)}" target="_blank" rel="noopener noreferrer"
                                     class="text-slate-500 hover:text-cyan-400 transition shrink-0" title="Open link">
                                    <i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>` : ''}
                    </div>
                    ${v.note ? `<p class="text-sm text-slate-400 mt-1">${this.esc(v.note)}</p>` : ''}
                    <p class="text-xs text-slate-500 mt-1.5">
                        by ${this.esc(v.suggestedBy)}${v.count ? ` · ${this.esc(this.list(v.upvoters))} in` : ''}
                    </p>
                </div>

                ${!this.state.readOnly && v.suggestedBy === me ? `
                    <button data-act="del-venue" data-id="${v.id}" title="Remove this spot"
                            class="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>` : ''}
            </article>`;
        }).join('');
    },

    // ---- history --------------------------------------------------------

    async toggleHistory() {
        this.state.historyOpen = !this.state.historyOpen;
        const list = document.getElementById('history-list');
        const chev = document.getElementById('history-chevron');
        list.classList.toggle('hidden', !this.state.historyOpen);
        chev.style.transform = this.state.historyOpen ? 'rotate(180deg)' : '';
        if (!this.state.historyOpen) return;

        list.innerHTML = '<p class="text-sm text-slate-500">Loading…</p>';
        try {
            const past = await Store.listHistory(this.state.quarterId);
            list.innerHTML = past.length
                ? past.map(q => {
                    const r = q.result;
                    return `
                    <a href="?q=${this.esc(q.quarterId)}" class="block glass rounded-2xl p-4 hover:bg-white/[0.07] transition">
                        <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <p class="font-semibold">${this.esc(q.label)}</p>
                                <p class="text-sm text-slate-400 truncate">${
                                    r ? `${this.esc(Quarter.prettyDate(r.date))}${r.venueName ? ' · ' + this.esc(r.venueName) : ''}`
                                      : 'Never settled on anything'}</p>
                            </div>
                            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 shrink-0"></i>
                        </div>
                    </a>`;
                }).join('')
                : '<p class="text-sm text-slate-500">Nothing before this quarter yet.</p>';
        } catch (err) {
            console.error(err);
            list.innerHTML = '<p class="text-sm text-rose-400">Could not load past quarters.</p>';
        }
        this.icons();
    },

    // =====================================================================
    // Events
    // =====================================================================

    wireStaticEvents() {
        document.getElementById('gate-form').addEventListener('submit', async e => {
            e.preventDefault();
            const input = document.getElementById('gate-input');
            const err = document.getElementById('gate-error');
            const res = await this.checkPasscode(input.value);
            if (res.ok) {
                localStorage.setItem(CONFIG.LS_GATE, '1');
                const gate = document.getElementById('gate');
                gate.classList.add('hidden');
                gate.classList.remove('flex');
                this.showIdentityOrBoot();
            } else {
                err.textContent = res.error;
                err.classList.remove('hidden');
                input.value = '';
                input.closest('.glass').classList.add('shake');
                setTimeout(() => input.closest('.glass').classList.remove('shake'), 600);
            }
        });

        document.getElementById('identity-btn').addEventListener('click', () => this.showIdentity());

        document.getElementById('share-btn').addEventListener('click', () => this.share());
        document.getElementById('history-btn').addEventListener('click', () => this.toggleHistory());

        // Date form
        const dateForm = document.getElementById('date-form');
        document.getElementById('add-date-btn').addEventListener('click', () => {
            dateForm.classList.toggle('hidden');
            if (!dateForm.classList.contains('hidden')) {
                const b = Quarter.proposalBounds(this.state.info);
                const di = document.getElementById('date-input');
                di.min = b.min; di.max = b.max;
                di.focus();
            }
        });
        document.getElementById('date-cancel').addEventListener('click', () => {
            dateForm.classList.add('hidden');
            this.hideError('date-error');
        });
        dateForm.addEventListener('submit', e => { e.preventDefault(); this.submitDate(); });

        // Venue form
        const venueForm = document.getElementById('venue-form');
        document.getElementById('add-venue-btn').addEventListener('click', () => {
            venueForm.classList.toggle('hidden');
            if (!venueForm.classList.contains('hidden')) document.getElementById('venue-name').focus();
        });
        document.getElementById('venue-cancel').addEventListener('click', () => {
            venueForm.classList.add('hidden');
            this.hideError('venue-error');
        });
        venueForm.addEventListener('submit', e => { e.preventDefault(); this.submitVenue(); });

        // Time slots
        const sel = document.getElementById('time-input');
        sel.innerHTML = CONFIG.TIME_SLOTS
            .map(t => `<option value="${t}"${t === CONFIG.DEFAULT_TIME ? ' selected' : ''}>${Quarter.prettyTime(t)}</option>`)
            .join('');

        // Flush any render that was held back while someone was typing.
        document.addEventListener('focusout', () => {
            setTimeout(() => {
                const el = document.activeElement;
                const stillTyping = el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
                if (this._pendingRender && !stillTyping) this.render();
            }, 0);
        });

        // Delegated actions, so re-rendering never has to re-bind anything.
        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;

            if (act === 'claim')      { this.claim(btn.dataset.name); }
            else if (act === 'vote')  { this.vote(btn.dataset.id, btn.dataset.vote); }
            else if (act === 'upvote'){ this.upvote(btn.dataset.id, btn.dataset.on === '1'); }
            else if (act === 'del-date')  { this.deleteProposal(btn.dataset.id); }
            else if (act === 'del-venue') { this.deleteVenue(btn.dataset.id); }
            else if (act === 'ics')   { if (this._event) Ics.download(this._event); }
        });
    },

    // ---- write actions --------------------------------------------------

    async vote(proposalId, value) {
        const p = this.state.data && this.state.data.dateProposals[proposalId];
        if (!p) return;
        // Tapping the value you already have clears it -- that is the un-vote.
        const next = (p.votes && p.votes[this.state.me]) === value ? null : value;
        try {
            await Store.castVote(this.state.quarterId, proposalId, this.state.me, next);
        } catch (err) { this.writeFailed(err); }
    },

    async upvote(venueId, on) {
        try {
            await Store.toggleUpvote(this.state.quarterId, venueId, this.state.me, on);
        } catch (err) { this.writeFailed(err); }
    },

    async submitDate() {
        const date = document.getElementById('date-input').value;
        const time = document.getElementById('time-input').value;
        const check = Quarter.validateDate(date, this.state.info);
        if (!check.ok) return this.showError('date-error', check.error);

        const existing = Object.values(this.state.data ? this.state.data.dateProposals : {});
        if (existing.some(p => p.date === date && p.time === time)) {
            return this.showError('date-error', 'That exact date and time is already up there.');
        }
        if (existing.length >= CONFIG.MAX_PROPOSALS) {
            return this.showError('date-error', 'That is plenty of dates already.');
        }

        this.hideError('date-error');
        try {
            await Store.addProposal(this.state.quarterId, { date, time, proposedBy: this.state.me });
            document.getElementById('date-form').classList.add('hidden');
            document.getElementById('date-input').value = '';
            this.toast('Date added — you are down as a yes.');
        } catch (err) { this.writeFailed(err); }
    },

    async submitVenue() {
        const name = document.getElementById('venue-name').value.trim();
        const note = document.getElementById('venue-note').value.trim();
        const raw  = document.getElementById('venue-url').value.trim();

        if (!name) return this.showError('venue-error', 'Give the place a name.');
        if (name.length > CONFIG.MAX_VENUE_NAME) return this.showError('venue-error', 'That name is too long.');
        if (note.length > CONFIG.MAX_VENUE_NOTE) return this.showError('venue-error', 'Keep the note shorter.');
        if (raw && !this.safeUrl(raw)) return this.showError('venue-error', 'Links need to start with http:// or https://');

        const existing = Object.values(this.state.data ? this.state.data.venues : {});
        if (existing.some(v => v.name.toLowerCase() === name.toLowerCase())) {
            return this.showError('venue-error', 'Someone already suggested that one.');
        }
        if (existing.length >= CONFIG.MAX_VENUES) {
            return this.showError('venue-error', 'That is plenty of options already.');
        }

        this.hideError('venue-error');
        try {
            await Store.addVenue(this.state.quarterId, { name, note, url: raw, suggestedBy: this.state.me });
            document.getElementById('venue-form').classList.add('hidden');
            ['venue-name', 'venue-note', 'venue-url'].forEach(id => { document.getElementById(id).value = ''; });
            this.toast('Spot added — and upvoted by you.');
        } catch (err) { this.writeFailed(err); }
    },

    async deleteProposal(id) {
        const p = this.state.data && this.state.data.dateProposals[id];
        if (!p || p.proposedBy !== this.state.me) return;
        const others = Object.keys(p.votes || {}).filter(n => n !== this.state.me).length;
        if (others && !confirm(`${others} ${others === 1 ? 'person has' : 'people have'} already voted on this date. Remove it anyway?`)) return;
        try {
            await Store.removeProposal(this.state.quarterId, id);
            this.toast('Date removed.');
        } catch (err) { this.writeFailed(err); }
    },

    async deleteVenue(id) {
        const v = this.state.data && this.state.data.venues[id];
        if (!v || v.suggestedBy !== this.state.me) return;
        try {
            await Store.removeVenue(this.state.quarterId, id);
            this.toast('Spot removed.');
        } catch (err) { this.writeFailed(err); }
    },

    writeFailed(err) {
        console.error(err);
        this.toast(err.code === 'permission-denied'
            ? 'That write was rejected. Check the Firestore rules.'
            : 'Could not save that. It will retry when you are back online.');
    },

    // ---- share ----------------------------------------------------------

    async share() {
        const text = `${CONFIG.APP_NAME}\n${CONFIG.APP_URL}\nPasscode: orphans2026`;
        if (navigator.share) {
            try {
                await navigator.share({ title: CONFIG.APP_NAME, text, url: CONFIG.APP_URL });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;   // they just backed out
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            this.toast('Link and passcode copied.');
        } catch (_) {
            this.toast(CONFIG.APP_URL);
        }
    },

    // =====================================================================
    // Small helpers
    // =====================================================================

    /** Every user-authored string goes through here before it touches innerHTML. */
    esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    },

    /**
     * Venue links are user-supplied and land in an href, so anything that is
     * not plainly http(s) is dropped. javascript: here would be a real vector,
     * not a theoretical one.
     */
    safeUrl(raw) {
        if (!raw) return null;
        try {
            const u = new URL(String(raw).trim());
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
        } catch (_) { return null; }
    },

    initials(name) {
        return String(name).trim().slice(0, 2);
    },

    /** ["Luz","Bernice"] -> "Luz and Bernice" */
    list(names) {
        if (names.length === 0) return '';
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} and ${names[1]}`;
        return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    },

    empty(icon, msg) {
        return `<div class="rounded-2xl p-5 border border-dashed border-white/10 text-center">
                    <i data-lucide="${icon}" class="w-5 h-5 mx-auto mb-2 text-slate-600"></i>
                    <p class="text-sm text-slate-500">${this.esc(msg)}</p>
                </div>`;
    },

    banner(kind, html) {
        const el = document.getElementById('banner');
        const tone = kind === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            : 'bg-white/5 border-white/10 text-slate-300';
        el.className = `mb-4 rounded-xl border px-4 py-3 text-sm ${tone}`;
        el.innerHTML = html;
        el.classList.remove('hidden');
    },

    showError(id, msg) {
        const el = document.getElementById(id);
        el.textContent = msg;
        el.classList.remove('hidden');
    },

    hideError(id) {
        document.getElementById(id).classList.add('hidden');
    },

    toast(msg) {
        const host = document.getElementById('toast');
        host.innerHTML = `<div class="toast-msg">${this.esc(msg)}</div>`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3000);
    },

    renderSync(status) {
        const el = document.getElementById('sync-chip');
        if (!el) return;
        const map = {
            idle:    ['loader', 'text-slate-600', 'Starting'],
            syncing: ['loader', 'text-slate-500', 'Syncing'],
            synced:  ['cloud',  'text-emerald-500/70', 'Live'],
            offline: ['cloud-off', 'text-amber-500/80', 'Offline'],
            error:   ['cloud-alert', 'text-rose-500/80', 'Sync error']
        };
        const [icon, color, label] = map[status] || map.idle;
        el.innerHTML = `<i data-lucide="${icon}" class="w-3 h-3 ${color}"></i><span>${label}</span>`;
        this.icons();
    },

    /** Lucide replaces <i data-lucide> with SVG, so it must run after every swap. */
    icons() {
        if (window.lucide) lucide.createIcons();
    }
};

document.addEventListener('DOMContentLoaded', () => App.start());
