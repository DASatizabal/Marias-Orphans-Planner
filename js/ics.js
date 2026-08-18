// Calendar export for Maria's Orphans Planner.
//
// Two paths, because phones and laptops want different things: an .ics file
// download (Apple Calendar, Outlook, and the desktop case) and a Google
// Calendar template URL (what most of this group will actually tap).
//
// Times here are LOCAL and deliberately floating -- an .ics with no timezone
// means "6:30pm wherever you are", which is exactly right for six friends in
// one city and avoids shipping a VTIMEZONE block.

const Ics = {

    /** "20260912T183000" from ("2026-09-12", "18:30") */
    _stamp(dateStr, timeStr) {
        const [h, m] = String(timeStr || '18:00').split(':').map(Number);
        const d = Quarter.parseDate(dateStr);
        d.setHours(h || 0, m || 0, 0, 0);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
               `T${p(d.getHours())}${p(d.getMinutes())}00`;
    },

    _end(dateStr, timeStr) {
        const [h, m] = String(timeStr || '18:00').split(':').map(Number);
        const d = Quarter.parseDate(dateStr);
        d.setHours((h || 0) + CONFIG.EVENT_DURATION_HOURS, m || 0, 0, 0);
        return this._stamp(Quarter.fmtDate(d),
            `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    },

    /** RFC 5545 wants CRLF, and commas/semicolons/backslashes escaped in TEXT values. */
    _esc(s) {
        return String(s || '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\r?\n/g, '\\n');
    },

    build(ev) {
        const uid = `mop-${ev.date}-${Date.now().toString(36)}@marias-orphans`;
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Marias Orphans Planner//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${this._stamp(Quarter.today(), '12:00')}Z`,
            `DTSTART:${this._stamp(ev.date, ev.time)}`,
            `DTEND:${this._end(ev.date, ev.time)}`,
            `SUMMARY:${this._esc(CONFIG.EVENT_TITLE)}`,
            ev.venue ? `LOCATION:${this._esc(ev.venue)}` : '',
            `DESCRIPTION:${this._esc(ev.description || CONFIG.APP_URL)}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].filter(Boolean).join('\r\n');
    },

    download(ev) {
        const blob = new Blob([this.build(ev)], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `happy-hour-${ev.date}.ics`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    googleUrl(ev) {
        const params = new URLSearchParams({
            action: 'TEMPLATE',
            text: CONFIG.EVENT_TITLE,
            dates: `${this._stamp(ev.date, ev.time)}/${this._end(ev.date, ev.time)}`,
            details: ev.description || CONFIG.APP_URL
        });
        if (ev.venue) params.set('location', ev.venue);
        return `https://calendar.google.com/calendar/render?${params.toString()}`;
    }
};
