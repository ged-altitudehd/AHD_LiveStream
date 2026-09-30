/**
 * Rowing lane lower third — 1920×1080, transparent, vMix browser input.
 *
 * Live fields (all marked data-field; shown as dashed/italic placeholders until
 * a live value arrives):
 *   race.title · race.number · race.type · race.goldSplit · lane[n].code · lane[n].suit   (n = 1–9)
 *
 * Lane cards show the crew's row suit and the school/club code (e.g. AGSB), not the
 * full name. Suits come from assets/school-logos: 189 clubs have the detailed 1890px
 * renders (from the AHD lookup); the rest only have RowIT's small 55×90 pictures. Either
 * way the white page and code caption are cut away in the browser and every suit is
 * shown at the same height.
 * Styled to the Milford Asset Management brand guidelines (see vmix-rowing-l3.css).
 *
 * Programmable lane cards — within a rolling window, when that crew's
 *   pace:  split (sec/500 m) drops by more than rules.pace.drop seconds, the card
 *          swipes up to show the split in place of the suit (and back down after);
 *   rate:  stroke rating rises by more than rules.rate.rise spm, a small "38 SPM"
 *          pop-up appears above the card's top-left corner (the card doesn't swipe).
 * Both hold for rules.hold seconds. Rules are global with optional per-lane
 * overrides (lanes[i].rules).
 *
 * Race positions: the crews placed 1st, 2nd and 3rd get a gold, silver or bronze medal
 * pop-up ("1st" with the medal) above the card's top-right corner, for as long as they
 * hold that place. Positions come from lanes[].position / telemetry[].position
 * / positions (explicit), otherwise they are ranked from distance covered
 * (lanes[].distance / telemetry[].distance, metres). positions: null clears them.
 *
 * Feeding data (any mix):
 *   URL      ?title=&num=&type=&gold=5:18.68&dist=2000&lanes=8&paceDrop=2&rateRise=3&window=10&hold=5&cooldown=12
 *            &data=<json url>&poll=1000   poll a JSON feed (shape below)
 *            &demo=1   sample crews + simulated telemetry
 *            &auto=0   don't animate in on load (use L / RowingL3.show())
 *            &layout=side   vertical column at the far right, lane 1 at the top (vmix-rowing-side.html)
 *            &layout=bow    "bow data": a card mounted on each crew's bow number holder, sized by
 *                           camera perspective (vmix-rowing-bow.html). Bow points come from the
 *                           CV feed (&cv=1&streamId=…; same API as vmix-cv-leader.html) or from
 *                           state.bows. Only crews in view get a card. Tuning: &horizon=380
 *                           (y where cards are smallest) &near=980 (y where they are full size)
 *                           &minScale=0.4 &bowW=300
 *            &guides=1 &ctrl=1 &bg=1   design aids — never on the program output
 *   JS       window.RowingL3.apply(state) · .telemetry(lane, split, rate) · .fire(lane, 'pace'|'rate')
 *            .show() · .hide() · .layout('bottom' | 'side' | 'bow') · .bows({ lane: { x, y } })
 *   message  window.postMessage({ type: 'rowing-l3', payload: state }, '*')
 *
 * State shape (every key optional):
 *   {
 *     race:  { title, number, type, gold, goldSplit, distance },
 *            type: heat | rep | qf | sf | fa | fb | final | tt | free text
 *            gold = gold-standard time for the event ("5:18.68" or seconds). Only its
 *            average split /500m is shown, on the title bar next to the race type:
 *            gold ÷ (distance / 500), or goldSplit if given. distance defaults to 2000.
 *            No gold → the block is hidden (it shows as a placeholder only while the
 *            whole race is still placeholders).
 *     rules: { pace: { enabled, drop, window }, rate: { enabled, rise, window }, hold, cooldown },
 *     laneCount: 1–9 | null,                  lanes in the race; null = the highest lane in the draw
 *     lanes: [ { lane, name, code, suit, colors: ['#hex'], scratched, rules, split, rate } ],
 *     telemetry: [ { lane, split, rate, distance, position } ],
 *     positions: { "4": 1, "2": 2, "6": 3 } | [4, 2, 6] (lanes in race order) | null,
 *     medals: true | false,                   medal pop-ups on/off (?medals=0)
 *     bows: { "4": { x, y }, … } | [ { lane, x, y } ] | null   bow points in 1920×1080 px (bow layout);
 *            a lane not listed has no card. From the CV feed, boats[] are matched to the crews in
 *            lane order from the far lane (smallest y = lane 1) unless a boat carries its own lane.
 *     show: true | false
 *   }
 *   code   = RowIT club code, shown on the card; also finds the row-suit PNG in data/ahd-lookup.json
 *   suit   = row-suit image URL (default: the club's RowIT suit PNG). The white
 *            background and the code caption under the suit are removed in the browser
 *            (needs the page served over http; from file:// the PNG shows as supplied).
 *   colors = placeholder suit colours, main colour first, when there is no suit image
 *   name   = full school/club name (optional; not shown)
 *   scratched = true: the lane stays visible but shows no crew. A lane missing from the
 *            draw (or with no code/name/suit) is shown the same way.
 *
 * Lane count: the graphic shows lanes 1…N and is as wide as N lane cards (left-anchored),
 * so a 7-lane race is shorter than a 9-lane one. N = laneCount (or ?lanes=), else the highest
 * lane in the draw; with no draw at all, 9 placeholder lanes. Set laneCount when the last
 * lane is scratched, or it would drop off the end.
 *   split = seconds per 500 m (102.4) or "1:42.4"; rate = strokes per minute
 *
 * Keys: L in · O out · G guides · C control panel · B preview backdrop · D demo
 *       1–9 test split swipe on lane · Shift+1–9 test rating pop-up.
 */
(function () {
    const MAX_LANES = 9;
    const LOOKUP_URL = 'data/ahd-lookup.json';
    const SUIT_DIR = 'assets/school-logos/';

    const PH = {
        'race.title': 'Race title',
        'race.number': '00',
        'race.type': 'RACE TYPE',
        'race.goldSplit': '0:00.0',
        code: 'CODE',
    };

    const RACE_TYPES = {
        heat: 'Heat', h: 'Heat',
        rep: 'Repechage', r: 'Repechage', repechage: 'Repechage',
        qf: 'Quarter-final', quarter: 'Quarter-final', 'quarter-final': 'Quarter-final', quarterfinal: 'Quarter-final',
        sf: 'Semi-final', semi: 'Semi-final', 'semi-final': 'Semi-final', semifinal: 'Semi-final',
        fa: 'A-Final', 'a-final': 'A-Final', afinal: 'A-Final', 'final a': 'A-Final',
        fb: 'B-Final', 'b-final': 'B-Final', bfinal: 'B-Final', 'final b': 'B-Final',
        fc: 'C-Final', 'c-final': 'C-Final', cfinal: 'C-Final', 'final c': 'C-Final',
        fd: 'D-Final', 'd-final': 'D-Final', dfinal: 'D-Final', 'final d': 'D-Final',
        f: 'Final', final: 'Final',
        tt: 'Time trial', 'time trial': 'Time trial', 'time-trial': 'Time trial',
        prelim: 'Preliminary', pr: 'Preliminary',
    };

    const DEFAULT_RULES = {
        pace: { enabled: true, drop: 2.0, window: 10 },
        rate: { enabled: true, rise: 3, window: 10 },
        hold: 5,
        cooldown: 12,
    };

    const DEMO = {
        race: { title: "Schoolboy U18 Eight", number: '42', type: 'fa', gold: '5:40.00' }, // sample gold standard
        lanes: ['agsb', 'kgca', 'stpc', 'hamb', 'cbhs', 'rotb', 'nelb', 'rgtt', 'chco'],
    };

    const q = new URLSearchParams(location.search);
    const $ = (id) => document.getElementById(id);
    const body = document.body;
    const lanesEl = $('rl3Lanes');
    const ctrlEl = $('rl3Ctrl');

    const state = {
        race: { title: null, number: null, type: null },
        rules: clone(DEFAULT_RULES),
        lanes: [],
        laneCount: q.get('lanes') ? clampLanes(parseFloat(q.get('lanes'))) : null, // null = from the draw
        positions: new Map(), // lane → explicit race position
        distances: new Map(), // lane → metres covered (ranked when no explicit positions)
        medals: q.get('medals') !== '0',
        bows: new Map(), // lane → { x, y } (bow layout)
        cvTimer: 0,
        lookup: null,
        lookupPromise: null,
        shown: false,
        demoTimer: 0,
        pollTimer: 0,
    };

    /** lane number → { lane data, card elements, telemetry history, split / pop-up state } */
    const rt = new Map();

    // ---------- utils ----------

    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function numParam(key, fallback) {
        const v = parseFloat(q.get(key));
        return Number.isFinite(v) ? v : fallback;
    }

    /** 1–MAX_LANES, or null (= from the draw) for anything that isn't a number. */
    function clampLanes(n) {
        const r = Math.round(Number(n));
        return Number.isFinite(r) ? Math.max(1, Math.min(MAX_LANES, r)) : null;
    }

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text != null) e.textContent = text;
        return e;
    }

    function deepMerge(target, src) {
        if (!src || typeof src !== 'object') return target;
        for (const [k, v] of Object.entries(src)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
            } else if (v !== undefined) {
                target[k] = v;
            }
        }
        return target;
    }

    function blank(v) {
        return v == null || String(v).trim() === '';
    }

    function now() {
        return performance.now() / 1000;
    }

    /** "1:42.4" | "102.4" | 102.4 → seconds, or NaN */
    function parseSplit(v) {
        if (typeof v === 'number') return v;
        if (blank(v)) return NaN;
        const s = String(v).trim();
        const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
        if (m) return Number(m[1]) * 60 + Number(m[2]);
        return parseFloat(s);
    }

    function fmtSplit(sec) {
        if (!Number.isFinite(sec)) return '–:––.–';
        const r = Math.round(sec * 10) / 10; // round first, so 1:59.97 → 2:00.0, not 1:60.0
        const m = Math.floor(r / 60);
        return `${m}:${(r - m * 60).toFixed(1).padStart(4, '0')}`;
    }

    function fmtSigned(v, digits) {
        const s = Math.abs(v).toFixed(digits);
        return `${v < 0 ? '−' : '+'}${s}`;
    }

    function raceType(v) {
        if (blank(v)) return { label: null, tier: '' };
        const key = String(v).trim().toLowerCase();
        const label = RACE_TYPES[key] || String(v).trim();
        const l = label.toLowerCase();
        const tier = /^(a-)?final$/.test(l) ? 'final' : /semi/.test(l) ? 'semi' : '';
        return { label, tier };
    }

    /** Set a live field; falls back to its placeholder token and marks it. */
    function setField(node, value, placeholder) {
        const ph = blank(value);
        node.textContent = ph ? placeholder : String(value);
        node.classList.toggle('rl3-ph', ph);
    }

    // ---------- club lookup (RowIT code → name + suit) ----------

    function loadLookup() {
        if (state.lookup) return Promise.resolve(state.lookup);
        if (!state.lookupPromise) {
            state.lookupPromise = fetch(LOOKUP_URL, { cache: 'force-cache' })
                .then((r) => (r.ok ? r.json() : { clubs: {} }))
                .catch(() => ({ clubs: {} }))
                .then((j) => {
                    state.lookup = j.clubs || {};
                    renderLanes();
                    return state.lookup;
                });
        }
        return state.lookupPromise;
    }

    function club(code) {
        if (blank(code) || !state.lookup) return null;
        return state.lookup[String(code).trim().toLowerCase()] || null;
    }

    // ---------- rules ----------

    function rulesFor(lane) {
        const r = rt.get(lane)?.data?.rules;
        return r ? deepMerge(clone(state.rules), r) : state.rules;
    }

    // ---------- race rail ----------

    function renderRace() {
        setField(document.querySelector('[data-field="race.title"]'), state.race.title, PH['race.title']);
        setField(document.querySelector('[data-field="race.number"]'), state.race.number, PH['race.number']);
        const typeEl = document.querySelector('[data-field="race.type"]');
        const t = raceType(state.race.type);
        setField(typeEl, t.label, PH['race.type']);
        typeEl.dataset.tier = t.tier;
        renderGold();
    }

    /** Gold standard: its average split /500m only, next to the race type. */
    function renderGold() {
        const race = state.race;
        const box = document.getElementById('rl3Gold');
        const splitEl = box.querySelector('[data-field="race.goldSplit"]');
        const sec = parseSplit(race.gold);
        const dist = Number(race.distance) > 0 ? Number(race.distance) : 2000;
        let split = null;
        if (!blank(race.goldSplit)) {
            const g = parseSplit(race.goldSplit);
            split = Number.isFinite(g) ? fmtSplit(g) : String(race.goldSplit).trim();
        } else if (Number.isFinite(sec) && sec > 0) {
            split = fmtSplit(sec / (dist / 500));
        }
        // Placeholder only while the whole race is placeholders; a live race without a
        // gold standard simply doesn't show the block.
        const placeholderRace = blank(race.title) && blank(race.number) && blank(race.type);
        box.hidden = !split && !placeholderRace;
        setField(splitEl, split, PH['race.goldSplit']);
    }

    // ---------- lane cards ----------

    /** Which crew a lane shows (code / name / suit), compared by value across feed updates. */
    function crewId(d) {
        if (d.empty) return 'empty';
        return [d.code, d.name, d.suit].map((v) => (blank(v) ? '' : String(v).trim().toLowerCase())).join('|');
    }

    /** Long codes shrink to fit the card instead of being cut mid-letter. */
    function fitCode(c) {
        if (c.code.classList.contains('rl3-ph') || !c.code.textContent) {
            c.code.style.fontSize = '';
            return;
        }
        fitText(c.code, codeFont());
    }

    /** A lane in the draw with no crew in it (scratched, or nothing to show). */
    function isEmptyLane(l) {
        return !l || l.scratched === true || (blank(l.code) && blank(l.name) && blank(l.suit));
    }

    /** Lanes 1…N, one card each. Lanes without a crew come back as { lane, empty: true }. */
    function laneList() {
        const hasDraw = state.lanes.length > 0;
        const byLane = new Map(state.lanes.map((l) => [l.lane, l]));
        const count =
            state.laneCount ?? (hasDraw ? clampLanes(Math.max(...state.lanes.map((l) => l.lane))) : MAX_LANES);
        return Array.from({ length: count }, (_, i) => {
            const lane = i + 1;
            const d = byLane.get(lane);
            if (hasDraw && isEmptyLane(d)) return { lane, empty: true };
            return d || { lane };
        });
    }

    // ---------- row suits ----------

    function suitSvg(colors) {
        const a = colors?.[0] || 'rgba(247, 247, 247, 0.55)';
        const b = colors?.[1] || 'rgba(247, 247, 247, 0.3)';
        return (
            '<svg class="rl3-suit-svg" viewBox="0 0 60 84" aria-hidden="true">' +
            `<path d="M14 0h8v9c0 6 3.5 11 8 11s8-5 8-11V0h8v10c0 5 3.5 8 9 9v58c0 4-2 7-6 7H11c-4 0-6-3-6-7V19c5.5-1 9-4 9-9z" fill="${a}"/>` +
            `<path d="M14 0h8v9c0 6 3.5 11 8 11s8-5 8-11V0h8v10c0 5 3.5 8 9 9v4c-6-1-11-5-11-11v-8h-2v5c0 8-5 15-12 15s-12-7-12-15V4h-2v8c0 6-5 10-11 11v-4c5.5-1 9-4 9-9z" fill="${b}"/>` +
            '</svg>'
        );
    }

    /** suit image URL → Promise<data URL of the cut-out suit, or the original URL> */
    const suitCache = new Map();

    function cutoutSuit(url) {
        if (!suitCache.has(url)) {
            suitCache.set(
                url,
                new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        try {
                            resolve(cutout(img));
                        } catch {
                            resolve(url); // e.g. file:// or cross-origin taints the canvas: show as supplied
                        }
                    };
                    img.onerror = () => reject(new Error('missing suit'));
                    img.src = url;
                }),
            );
        }
        return suitCache.get(url);
    }

    // Same approach as the on-air Karāpiro suit cutouts (vmix-karapiro.js cropSinglet /
    // punchPaper): drop the code caption, flood-fill the white page in from the edges
    // with 1px outline gaps sealed, so white panels in the design survive. Run at a
    // reduced working height (the renders are 1890px) and output at display size.
    const SUIT_WORK_H = 720;
    const SUIT_OUT_H = 240;

    const isPaper = (d, p) => d[p + 3] < 40 || (d[p] > 250 && d[p + 1] > 250 && d[p + 2] > 250);

    function suitCanvas(img, h) {
        const H = Math.min(h, img.naturalHeight || h);
        const W = Math.max(1, Math.round((H * img.naturalWidth) / img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, W, H);
        return cv;
    }

    /** Garment only: rows above the club-code caption band, cropped to the ink. */
    function cropSinglet(cv) {
        const { width: w, height: h } = cv;
        const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        const occ = new Array(h).fill(0);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isPaper(d, (y * w + x) * 4)) occ[y]++;
        const minRow = Math.max(1, Math.round(w * 0.002));
        const runs = [];
        for (let y = 0; y < h; ) {
            while (y < h && occ[y] < minRow) y++;
            const start = y;
            while (y < h && occ[y] >= minRow) y++;
            if (y > start) runs.push(start);
        }
        const yLimit = runs.length >= 2 && runs[runs.length - 1] > h * 0.5 ? runs[runs.length - 1] : h;
        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < yLimit; y++) {
            for (let x = 0; x < w; x++) {
                if (isPaper(d, (y * w + x) * 4)) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) throw new Error('empty suit');
        minX = Math.max(0, minX - 2);
        minY = Math.max(0, minY - 2);
        maxX = Math.min(w - 1, maxX + 2);
        maxY = Math.min(h - 1, maxY + 2);
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1;
        out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    /** 3×3 dilate then erode: closes 1px gaps in the outline without sealing the neck or armholes. */
    function closeMask(src, w, h) {
        const grow = new Uint8Array(src);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!src[y * w + x]) continue;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h) grow[ny * w + nx] = 1;
                    }
                }
            }
        }
        const out = new Uint8Array(grow);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!grow[y * w + x]) continue;
                let keep = 1;
                for (let dy = -1; dy <= 1 && keep; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !grow[ny * w + nx]) {
                            keep = 0;
                            break;
                        }
                    }
                }
                if (!keep) out[y * w + x] = 0;
            }
        }
        return out;
    }

    /** Make the page transparent (flood fill from the edges), then trim to the suit. */
    function punchPaper(cv) {
        const { width: w, height: h } = cv;
        const n = w * h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const im = ctx.getImageData(0, 0, w, h);
        const d = im.data;
        const wall = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (!isPaper(d, i * 4)) wall[i] = 1;
        const sealed = closeMask(wall, w, h);
        const outside = new Uint8Array(n);
        const stack = [];
        const push = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const i = y * w + x;
            if (outside[i] || sealed[i] || !isPaper(d, i * 4)) return;
            outside[i] = 1;
            stack.push(i);
        };
        for (let x = 0; x < w; x++) {
            push(x, 0);
            push(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
            push(0, y);
            push(w - 1, y);
        }
        while (stack.length) {
            const i = stack.pop();
            const x = i % w;
            const y = (i / w) | 0;
            push(x - 1, y);
            push(x + 1, y);
            push(x, y - 1);
            push(x, y + 1);
        }
        for (let i = 0; i < n; i++) if (outside[i]) d[i * 4 + 3] = 0;
        // White pixels left touching the cut edge are page, not design.
        const clear = (x, y) => x < 0 || y < 0 || x >= w || y >= h || d[(y * w + x) * 4 + 3] < 16;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = (y * w + x) * 4;
                if (d[p + 3] < 16 || !isPaper(d, p)) continue;
                if (clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1)) d[p + 3] = 0;
            }
        }
        ctx.putImageData(im, 0, 0);

        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (d[(y * w + x) * 4 + 3] < 16) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) throw new Error('empty suit');
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1;
        out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    function cutout(img) {
        const suit = punchPaper(cropSinglet(suitCanvas(img, SUIT_WORK_H)));
        const H = Math.min(SUIT_OUT_H, suit.height);
        const W = Math.max(1, Math.round((H * suit.width) / suit.height));
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(suit, 0, 0, W, H);
        return out.toDataURL('image/png');
    }

    /** Two-sided card: front = suit + lane + code; back = the triggered data. */
    function makeCard(lane) {
        const root = el('div', 'rl3-card');
        const win = el('div', 'rl3-card-window');

        const front = el('div', 'rl3-face rl3-face--front');
        const suit = el('div', 'rl3-card-suit');
        suit.dataset.field = `lane${lane}.suit`;
        const row = el('div', 'rl3-card-row');
        const laneEl = el('div', 'rl3-card-lane', String(lane));
        const code = el('div', 'rl3-card-code');
        code.dataset.field = `lane${lane}.code`;
        row.append(laneEl, code);
        front.append(suit, row);

        const back = el('div', 'rl3-face rl3-face--back');
        back.setAttribute('aria-hidden', 'true');
        const head = el('div', 'rl3-back-head');
        const backLane = el('div', 'rl3-card-lane rl3-card-lane--sm', String(lane));
        const backCode = el('div', 'rl3-back-code');
        head.append(backLane, backCode, el('span', 'rl3-metric-label', 'Pace'));
        const split = el('div', 'rl3-metric');
        const splitValue = el('span', 'rl3-metric-value');
        const foot = el('div', 'rl3-metric-foot');
        const splitDelta = el('span', 'rl3-metric-delta');
        foot.append(el('span', 'rl3-metric-unit', '/500m'), splitDelta);
        split.append(splitValue, foot);
        back.append(head, split);

        // Rating pop-up: outside the card window, so it shows whichever side is up.
        const rate = el('div', 'rl3-rate');
        rate.setAttribute('aria-hidden', 'true');
        const rateValue = el('span', 'rl3-rate-value');
        rate.append(rateValue, el('span', 'rl3-rate-unit', 'SPM'));

        win.append(front, back);
        // Medal pop-up (gold / silver / bronze by race position), above the top-right corner.
        const medal = el('div', 'rl3-medal');
        medal.setAttribute('aria-hidden', 'true');
        const medalImg = el('img', 'rl3-medal-img');
        medalImg.alt = '';
        const medalText = el('span', 'rl3-medal-text');
        medal.append(medalImg, medalText);

        root.append(win, medal, rate);
        return {
            root, back, suit, laneEl, code, backLane, backCode, splitValue, splitDelta,
            rate, rateValue, medal, medalImg, medalText, suitKey: null, timer: 0, rateTimer: 0,
        };
    }

    function paintSuit(card, data, info) {
        const url = !blank(data.suit) ? data.suit : info?.logo ? SUIT_DIR + encodeURIComponent(info.logo) : null;
        const key = url || `ph:${[].concat(data.colors || []).join(',')}`;
        if (card.suitKey === key) return;
        card.suitKey = key;
        const placeholder = () => {
            if (card.suitKey !== key) return;
            card.suit.classList.add('rl3-ph');
            card.suit.innerHTML = suitSvg([].concat(data.colors || []));
            card.suit.appendChild(el('span', 'rl3-suit-tag', 'ROW SUIT'));
        };
        card.suit.replaceChildren();
        if (!url) return placeholder();
        card.suit.classList.remove('rl3-ph');
        cutoutSuit(url).then((src) => {
            if (card.suitKey !== key) return;
            const img = el('img', 'rl3-suit-img');
            img.alt = data.name || info?.name || '';
            img.onerror = placeholder;
            img.src = src;
            card.suit.replaceChildren(img);
        }, placeholder);
    }

    function renderLanes() {
        const list = laneList();
        const wanted = new Set(list.map((l) => l.lane));
        for (const [lane, r] of rt) {
            if (!wanted.has(lane)) {
                r.card?.root.remove();
                rt.delete(lane);
            }
        }
        list.forEach((data, i) => {
            let r = rt.get(data.lane);
            if (!r) {
                r = { data, id: null, card: makeCard(data.lane), hist: [], base: { pace: -Infinity, rate: -Infinity }, cool: { pace: -Infinity, rate: -Infinity } };
                rt.set(data.lane, r);
            }
            // A different crew in this lane starts clean: no inherited history, cooldown or split.
            const id = crewId(data);
            if (r.id !== null && r.id !== id) {
                resetCard(r);
                r.hist = [];
                r.base = { pace: -Infinity, rate: -Infinity };
                r.cool = { pace: -Infinity, rate: -Infinity };
            }
            r.id = id;
            r.data = data;
            const c = r.card;
            // Move a card only when it is out of place: re-inserting restarts its entrance
            // animation and cuts a swipe short, which a 1 s poll feed would do every second.
            if (lanesEl.children[i] !== c.root) lanesEl.insertBefore(c.root, lanesEl.children[i] || null);
            c.root.style.setProperty('--rl3-i', i);
            c.laneEl.textContent = String(data.lane);
            c.backLane.textContent = String(data.lane);
            c.root.classList.toggle('rl3-card--empty', !!data.empty);
            if (data.empty) {
                // Lane is in the race but has no crew: show the lane number only.
                resetCard(r);
                c.code.textContent = '';
                c.code.classList.remove('rl3-ph');
                c.code.style.fontSize = '';
                c.backCode.textContent = '';
                c.suit.replaceChildren();
                c.suit.classList.remove('rl3-ph');
                c.suitKey = 'empty';
            } else {
                const info = club(data.code);
                setField(c.code, blank(data.code) ? null : String(data.code).trim().toUpperCase(), PH.code);
                fitCode(c);
                c.backCode.textContent = blank(data.code) ? '' : String(data.code).trim().toUpperCase();
                paintSuit(c, data, info);
            }
        });
        lanesEl.parentElement.style.setProperty('--rl3-n', list.length); // rail waits for the last card
        if (!state.lookup && list.some((l) => !l.empty && !blank(l.code))) loadLookup();
    }

    // ---------- race positions → medal pop-ups ----------

    const MEDALS = ['gold', 'silver', 'bronze'];
    const PLACES = ['1st', '2nd', '3rd'];
    const MEDAL_DIR = 'assets/rowing/';

    /** lane → position: explicit positions win; otherwise rank by distance covered. */
    function currentPositions() {
        if (state.positions.size) return state.positions;
        const ranked = [...state.distances].filter(([, d]) => Number.isFinite(d)).sort((a, b) => b[1] - a[1]);
        return new Map(ranked.map(([lane], i) => [lane, i + 1]));
    }

    function renderMedals() {
        const pos = state.medals ? currentPositions() : new Map();
        for (const [lane, r] of rt) {
            const p = r.data.empty ? 0 : pos.get(lane) || 0;
            const medal = MEDALS[p - 1] || '';
            const c = r.card;
            if ((c.medal.dataset.medal || '') === medal) continue;
            if (medal) {
                c.medal.dataset.medal = medal;
                c.medalImg.src = `${MEDAL_DIR}medal-${medal}.svg`;
                c.medalText.textContent = PLACES[p - 1];
                // Replay the pop when a crew gains or changes medal.
                c.medal.classList.remove('rl3-medal--on');
                void c.medal.offsetWidth;
                c.medal.classList.add('rl3-medal--on');
            } else {
                delete c.medal.dataset.medal;
                c.medal.classList.remove('rl3-medal--on');
            }
        }
    }

    // ---------- bow data: cards mounted on the bow, sized by perspective ----------

    const BOW = {
        horizon: numParam('horizon', 380), // y where a bow is furthest away → smallest card
        near: numParam('near', 980),       // y where a bow is nearest → full-size card
        minScale: Math.max(0.15, Math.min(1, numParam('minScale', 0.4))),
        stem: 22,                          // post from the card down to the bow point (px, unscaled)
    };

    function perspectiveScale(y) {
        const t = (y - BOW.horizon) / Math.max(1, BOW.near - BOW.horizon);
        return BOW.minScale + (1 - BOW.minScale) * Math.max(0, Math.min(1, t));
    }

    /** bows input: { lane: { x, y } } | [ { lane, x, y } ] | null. */
    function setBows(b) {
        state.bows = new Map();
        const list = Array.isArray(b) ? b : b && typeof b === 'object' ? Object.entries(b).map(([lane, v]) => ({ lane, ...v })) : [];
        for (const e of list) {
            const lane = Number(e?.lane);
            const x = Number(e?.x);
            const y = Number(e?.y);
            if (Number.isInteger(lane) && Number.isFinite(x) && Number.isFinite(y)) state.bows.set(lane, { x, y });
        }
    }

    function renderBows() {
        if (!body.classList.contains('rl3--bow')) return;
        for (const [lane, r] of rt) {
            const c = r.card;
            const b = r.data.empty ? null : state.bows.get(lane);
            const inView = !!b && b.x > -200 && b.x < 2120 && b.y > -100 && b.y < 1180;
            c.root.classList.toggle('rl3-card--bow-on', inView);
            if (!b) continue;
            const s = perspectiveScale(b.y);
            c.root.style.setProperty('--s', s.toFixed(3));
            c.root.style.left = `${b.x.toFixed(1)}px`;
            c.root.style.top = `${(b.y - BOW.stem * s).toFixed(1)}px`;
        }
    }

    /** CV feed (api/cv-position): boats[] {slot, x, y, laneCoord, lane?} in refW×refH → bows per lane. */
    function bowsFromCv(data) {
        if (!data || data.stale || !Array.isArray(data.boats)) return {};
        const refW = Number(data.refW) || 1280;
        const refH = Number(data.refH) || 720;
        const off = data.offset || (String(data.venue).toLowerCase() === 'twizel' ? { x: -140, y: -50 } : { x: 140, y: -50 });
        const toPx = (x, y) => ({ x: ((Number(x) + off.x) * 1920) / refW, y: ((Number(y) + off.y) * 1080) / refH });
        const crews = laneList().filter((l) => !l.empty).map((l) => l.lane); // lane order = far → near
        const boats = data.boats.filter((bt) => Number.isFinite(Number(bt.x)) && Number.isFinite(Number(bt.y)));
        const out = {};
        const unassigned = [];
        for (const bt of boats) {
            if (Number.isInteger(Number(bt.lane))) out[Number(bt.lane)] = toPx(bt.x, bt.y);
            else unassigned.push(bt);
        }
        // No lane from the CV: far lane (smallest y) first, matched to the crews in lane order.
        unassigned.sort((a, b2) => (a.laneCoord ?? a.y) - (b2.laneCoord ?? b2.y));
        const free = crews.filter((l) => !(l in out));
        unassigned.forEach((bt, i) => {
            if (free[i] != null) out[free[i]] = toPx(bt.x, bt.y);
        });
        return out;
    }

    function startCvPoll(streamId, ms) {
        const api = (q.get('api') || '').replace(/\/$/, '');
        const tick = async () => {
            try {
                const res = await fetch(`${api}/api/cv-position?streamId=${encodeURIComponent(streamId)}`, { cache: 'no-store' });
                const data = res.ok ? await res.json() : null;
                apply({ bows: bowsFromCv(data) });
            } catch {
                apply({ bows: {} });
            }
            state.cvTimer = setTimeout(tick, ms);
        };
        tick();
    }

    /** positions input: { lane: pos } | [lane, lane, …] in race order | null. */
    function setPositions(p) {
        state.positions = new Map();
        if (Array.isArray(p)) {
            p.forEach((lane, i) => Number.isFinite(Number(lane)) && state.positions.set(Number(lane), i + 1));
        } else if (p && typeof p === 'object') {
            for (const [lane, pos] of Object.entries(p)) {
                if (Number.isFinite(Number(lane)) && Number(pos) > 0) state.positions.set(Number(lane), Number(pos));
            }
        }
    }

    /** Per-lane position / distance fields from lanes[] or telemetry[] entries. */
    function takeRaceData(entries) {
        for (const e of entries) {
            if (!e || !Number.isFinite(Number(e.lane))) continue;
            const lane = Number(e.lane);
            if (e.position != null && Number(e.position) > 0) state.positions.set(lane, Number(e.position));
            if (e.distance != null && Number.isFinite(Number(e.distance))) state.distances.set(lane, Number(e.distance));
        }
    }

    // ---------- telemetry + triggers ----------

    function telemetry(lane, split, rate, t) {
        const r = rt.get(Number(lane));
        if (!r) return;
        const ts = Number.isFinite(t) ? t : now();
        const sp = parseSplit(split);
        const rt_ = blank(rate) ? NaN : Number(rate);
        // Blank or zero readings (e.g. before the start) are missing data, not 0.
        const sample = { t: ts, split: sp > 0 ? sp : NaN, rate: rt_ > 0 ? rt_ : NaN };
        r.hist.push(sample);
        const rules = rulesFor(r.data.lane);
        const keep = Math.max(rules.pace.window, rules.rate.window) + 2;
        while (r.hist.length && r.hist[0].t < ts - keep) r.hist.shift();
        evaluate(r, sample, rules);
    }

    function evaluate(r, cur, rules) {
        // While hidden, or for a lane with no crew, keep the history but don't fire (so the
        // cooldown isn't used up by a split nobody sees).
        if (!state.shown || r.data.empty) return;
        const t = cur.t;
        if (rules.pace.enabled && Number.isFinite(cur.split)) {
            const from = Math.max(t - rules.pace.window, r.base.pace);
            let ref = -Infinity;
            for (const s of r.hist) if (s !== cur && s.t >= from && Number.isFinite(s.split)) ref = Math.max(ref, s.split);
            const drop = ref - cur.split;
            if (drop > rules.pace.drop && t >= r.cool.pace) {
                r.cool.pace = t + rules.cooldown;
                r.base.pace = t;
                showSplit(r, { value: cur.split, delta: -drop }, rules);
            }
        }
        if (rules.rate.enabled && Number.isFinite(cur.rate)) {
            const from = Math.max(t - rules.rate.window, r.base.rate);
            let ref = Infinity;
            for (const s of r.hist) if (s !== cur && s.t >= from && Number.isFinite(s.rate)) ref = Math.min(ref, s.rate);
            const rise = cur.rate - ref;
            if (rise > rules.rate.rise && t >= r.cool.rate) {
                r.cool.rate = t + rules.cooldown;
                r.base.rate = t;
                popRating(r, { value: cur.rate, delta: rise }, rules);
            }
        }
    }

    // px: as large as the card allows, per layout (side cards are short rows).
    const isSide = () => body.classList.contains('rl3--side');
    const splitFont = () => (isSide() ? { max: 44, min: 22 } : { max: 60, min: 30 });
    const codeFont = () => (isSide() ? { max: 24, min: 14 } : { max: 25, min: 15 });

    /** Pace: swipe the card up to show the split in place of the suit; holds, then swipes back down. */
    function showSplit(r, info, rules) {
        if (!state.shown || r.data.empty) return;
        const c = r.card;
        const hold = (rules || rulesFor(r.data.lane)).hold * 1000;
        renderSplit(c, info);
        c.root.classList.add('rl3-card--split');
        clearTimeout(c.timer);
        c.timer = setTimeout(() => c.root.classList.remove('rl3-card--split'), hold);
    }

    /** Rating: small "38 SPM" pop-up above the card's top-left corner; the card doesn't swipe. */
    function popRating(r, info, rules) {
        if (!state.shown || r.data.empty) return;
        const c = r.card;
        const hold = (rules || rulesFor(r.data.lane)).hold * 1000;
        c.rateValue.textContent = Number.isFinite(info.value) ? String(Math.round(info.value)) : '––';
        c.rate.classList.add('rl3-rate--on');
        clearTimeout(c.rateTimer);
        c.rateTimer = setTimeout(() => c.rate.classList.remove('rl3-rate--on'), hold);
    }

    /** Back to the suit side, rating pop-up hidden (medal pop-ups follow positions). */
    function resetCard(r) {
        const c = r.card;
        clearTimeout(c.timer);
        clearTimeout(c.rateTimer);
        c.root.classList.remove('rl3-card--split');
        c.rate.classList.remove('rl3-rate--on');
    }

    function fitText(node, { max, min }) {
        let size = max;
        node.style.fontSize = `${size}px`;
        while (size > min && node.scrollWidth > node.clientWidth + 1) {
            size -= 1;
            node.style.fontSize = `${size}px`;
        }
    }

    /** Card back: header (lane · code · Pace), big split, then /500m and the change. */
    function renderSplit(c, info) {
        c.splitValue.textContent = fmtSplit(info.value);
        c.splitDelta.textContent = Number.isFinite(info.delta) ? `${fmtSigned(info.delta, 1)}s` : '';
        fitText(c.splitValue, splitFont());
    }

    function resetCards() {
        for (const r of rt.values()) resetCard(r);
    }

    /** Manual / test trigger using the lane's latest sample (or a plausible value). */
    function fire(lane, kind) {
        const r = rt.get(Number(lane));
        if (!r || r.data.empty) return;
        const last = [...r.hist].reverse().find((s) => Number.isFinite(kind === 'pace' ? s.split : s.rate));
        const rules = rulesFor(r.data.lane);
        if (kind === 'pace') {
            showSplit(r, { value: last ? last.split : 98.6, delta: -(rules.pace.drop + 0.4) }, rules);
        } else {
            popRating(r, { value: last ? last.rate : 38, delta: rules.rate.rise + 1 }, rules);
        }
    }

    // ---------- show / hide ----------

    function show() {
        if (state.shown) return;
        state.shown = true;
        body.classList.remove('rl3--out');
        body.classList.add('rl3--on', 'rl3--in');
    }

    function hide() {
        if (!state.shown) return;
        state.shown = false;
        body.classList.remove('rl3--in');
        body.classList.add('rl3--out');
        resetCards();
        setTimeout(() => {
            if (!state.shown) body.classList.remove('rl3--on', 'rl3--out');
        }, 480);
    }

    // ---------- apply external state ----------

    function apply(input) {
        if (!input || typeof input !== 'object') return;
        if (input.race) deepMerge(state.race, input.race);
        if (input.rules) deepMerge(state.rules, input.rules);
        if ('laneCount' in input) {
            const n = Number(input.laneCount);
            state.laneCount = input.laneCount == null || input.laneCount === '' ? null : clampLanes(n);
        }
        if (Array.isArray(input.lanes)) {
            state.lanes = input.lanes
                .filter((l) => l && Number.isInteger(Number(l.lane)) && Number(l.lane) >= 1 && Number(l.lane) <= MAX_LANES)
                .map((l) => ({ ...l, lane: Number(l.lane) }));
            // A new draw starts from its own positions / distances (if it carries any).
            state.positions = new Map();
            state.distances = new Map();
            takeRaceData(state.lanes);
        }
        if ('positions' in input) setPositions(input.positions);
        if (Array.isArray(input.telemetry)) takeRaceData(input.telemetry);
        if (typeof input.medals === 'boolean') state.medals = input.medals;
        if ('bows' in input) setBows(input.bows);
        renderRace();
        renderLanes();
        renderMedals();
        renderBows();
        syncCtrl();
        if (Array.isArray(input.lanes)) {
            const byLane = new Map(state.lanes.map((l) => [l.lane, l])); // last row per lane, as shown
            for (const l of byLane.values()) {
                if (l.split != null || l.rate != null) telemetry(l.lane, l.split, l.rate);
            }
        }
        if (Array.isArray(input.telemetry)) {
            for (const s of input.telemetry) if (s) telemetry(s.lane, s.split, s.rate);
        }
        if (input.show === true) show();
        if (input.show === false) hide();
    }

    // ---------- JSON feed ----------

    function startPoll(url, ms) {
        const tick = async () => {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) apply(await r.json());
            } catch {
                /* keep last good state on air */
            }
            state.pollTimer = setTimeout(tick, ms);
        };
        tick();
    }

    // ---------- demo simulation ----------

    function demoLanes(n) {
        return DEMO.lanes.slice(0, n).map((code, i) => ({ lane: i + 1, code }));
    }

    function startDemo() {
        if (state.demoTimer) return;
        if (!state.lanes.length) {
            apply({ race: DEMO.race, lanes: demoLanes(state.laneCount ?? MAX_LANES) });
        }
        const sim = new Map();
        for (const l of laneList()) {
            sim.set(l.lane, {
                split: 100 + Math.random() * 1.6,
                rate: 33 + Math.random() * 3,
                pushAt: now() + 4 + Math.random() * 20,
                dist: 0,
                bowX: 1750 + Math.random() * 300, // demo bow sweep, right → left
            });
        }
        // Push envelope: ramp 3 s, hold 5 s, ease back over 10 s.
        const kick = (dt) => (dt < 0 ? 0 : dt < 3 ? dt / 3 : dt < 8 ? 1 : dt < 18 ? 1 - (dt - 8) / 10 : 0);
        const step = () => {
            const t = now();
            for (const [lane, s] of sim) {
                const dt = t - s.pushAt;
                if (dt > 18) s.pushAt = t + 12 + Math.random() * 25;
                const k = kick(dt);
                const split = s.split - 3.4 * k + (Math.random() - 0.5) * 0.6;
                const rate = s.rate + 4.6 * k + (Math.random() - 0.5) * 0.8;
                s.dist += (0.5 * 500) / split; // metres in this 0.5 s step
                state.distances.set(lane, s.dist);
                telemetry(lane, split, rate, t);
            }
            renderMedals();
            if (body.classList.contains('rl3--bow')) {
                // Lanes as rows down the frame (lane 1 far), bows sweeping right → left.
                const crews = laneList().filter((l) => !l.empty).map((l) => l.lane);
                const bows = {};
                for (const [lane, s] of sim) {
                    const i = crews.indexOf(lane);
                    if (i < 0) continue;
                    const y = BOW.horizon + 40 + ((BOW.near - BOW.horizon - 40) * i) / Math.max(1, crews.length - 1);
                    s.bowX -= 0.5 * (80 + 55 * (y - BOW.horizon) / (BOW.near - BOW.horizon)) / 4;
                    if (s.bowX < -150) s.bowX = 2050;
                    bows[lane] = { x: s.bowX, y };
                }
                apply({ bows });
            }
        };
        state.demoTimer = setInterval(step, 500);
    }

    function stopDemo() {
        clearInterval(state.demoTimer);
        state.demoTimer = 0;
    }

    // ---------- operator panel ----------

    function ctrlField(label, key, type, extra) {
        const wrap = el('label', type === 'checkbox' ? 'rl3-ctrl-check' : '');
        const input = el('input');
        input.type = type;
        input.dataset.key = key;
        Object.assign(input, extra || {});
        if (type === 'checkbox') wrap.append(input, document.createTextNode(label));
        else wrap.append(document.createTextNode(label), input);
        return wrap;
    }

    function buildCtrl() {
        ctrlEl.replaceChildren();
        ctrlEl.appendChild(el('h2', null, 'Lower third — operator'));

        const race = el('fieldset');
        race.appendChild(el('legend', null, 'Race (placeholders)'));
        race.append(
            ctrlField('Title', 'race.title', 'text'),
            ctrlField('Number', 'race.number', 'text'),
            ctrlField('Type (heat, qf, sf, fa…)', 'race.type', 'text'),
            ctrlField('Gold standard (m:ss.00)', 'race.gold', 'text'),
            ctrlField('Distance (m)', 'race.distance', 'number', { min: 100, step: 50 }),
            ctrlField('Lanes in race (blank = from draw)', 'laneCount', 'number', { min: 1, max: 9, step: 1 }),
            ctrlField('Medal pop-ups (1st–3rd)', 'medals', 'checkbox'),
        );

        const pace = el('fieldset');
        pace.appendChild(el('legend', null, 'Pace trigger'));
        pace.append(
            ctrlField('Split drops by more than (s/500)', 'rules.pace.drop', 'number', { step: 0.1, min: 0 }),
            ctrlField('Within window (s)', 'rules.pace.window', 'number', { step: 1, min: 1 }),
            ctrlField('Enabled', 'rules.pace.enabled', 'checkbox'),
        );

        const rate = el('fieldset');
        rate.appendChild(el('legend', null, 'Rating trigger'));
        rate.append(
            ctrlField('Rating rises by more than (spm)', 'rules.rate.rise', 'number', { step: 0.5, min: 0 }),
            ctrlField('Within window (s)', 'rules.rate.window', 'number', { step: 1, min: 1 }),
            ctrlField('Enabled', 'rules.rate.enabled', 'checkbox'),
        );

        const timing = el('fieldset');
        timing.appendChild(el('legend', null, 'Split swipe / rating pop-up'));
        timing.append(
            ctrlField('Show data for (s)', 'rules.hold', 'number', { step: 0.5, min: 1 }),
            ctrlField('Cooldown per lane (s)', 'rules.cooldown', 'number', { step: 1, min: 0 }),
        );

        ctrlEl.append(race, pace, rate, timing);

        const row = el('div', 'rl3-ctrl-row');
        const laneSel = el('select');
        for (let i = 1; i <= MAX_LANES; i++) laneSel.appendChild(new Option(`Lane ${i}`, String(i)));
        const btn = (label, fn, alt) => {
            const b = el('button', alt ? 'rl3-ctrl-alt' : '', label);
            b.type = 'button';
            b.addEventListener('click', fn);
            return b;
        };
        row.append(
            btn('In', show),
            btn('Out', hide),
            laneSel,
            btn('Show split', () => fire(laneSel.value, 'pace'), true),
            btn('Rating pop-up', () => fire(laneSel.value, 'rate'), true),
            btn('Demo', () => (state.demoTimer ? stopDemo() : startDemo()), true),
            btn('Guides', () => body.classList.toggle('rl3--guides'), true),
        );
        ctrlEl.appendChild(row);
        ctrlEl.appendChild(
            el(
                'p',
                'rl3-ctrl-hint',
                'Hide this panel (C) before going to air. Keys: L in · O out · G guides · B backdrop · D demo · 1–9 split swipe · Shift+1–9 rating pop-up.',
            ),
        );

        ctrlEl.addEventListener('input', onCtrlInput);
        syncCtrl();
    }

    function getPath(key) {
        if (key === 'laneCount') return state.laneCount;
        return key.split('.').reduce((o, k) => (o ? o[k] : undefined), state);
    }

    function syncCtrl() {
        if (ctrlEl.hidden || !ctrlEl.firstChild) return;
        for (const input of ctrlEl.querySelectorAll('input[data-key]')) {
            if (document.activeElement === input) continue;
            const v = getPath(input.dataset.key);
            if (input.type === 'checkbox') input.checked = !!v;
            else input.value = v == null ? '' : v;
        }
    }

    function onCtrlInput(e) {
        const input = e.target;
        const key = input.dataset?.key;
        if (!key) return;
        let v = input.type === 'checkbox' ? input.checked : input.value;
        if (key === 'laneCount') return apply({ laneCount: v === '' ? null : Number(v) });
        if (input.type === 'number') {
            v = parseFloat(v);
            if (!Number.isFinite(v)) return;
        }
        const path = key.split('.');
        const patch = {};
        path.reduce((o, k, i) => (o[k] = i === path.length - 1 ? v : {}), patch);
        apply(patch);
    }

    function toggleCtrl(force) {
        ctrlEl.hidden = force != null ? !force : !ctrlEl.hidden;
        if (!ctrlEl.hidden && !ctrlEl.firstChild) buildCtrl();
        syncCtrl();
    }

    // ---------- inputs ----------

    document.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        const k = e.key.toLowerCase();
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (digit) return fire(Number(digit[1]), e.shiftKey ? 'rate' : 'pace');
        if (k === 'l') show();
        else if (k === 'o') hide();
        else if (k === 'g') body.classList.toggle('rl3--guides');
        else if (k === 'b') body.classList.toggle('rl3--preview-bg');
        else if (k === 'c') toggleCtrl();
        else if (k === 'd') (state.demoTimer ? stopDemo() : startDemo());
    });

    window.addEventListener('message', (e) => {
        const m = e.data;
        if (m && m.type === 'rowing-l3') apply(m.payload);
    });

    /** 'bottom' (lower third), 'side' (vertical column at the far right, lane 1 on top)
     *  or 'bow' (side-style cards mounted on each bow, sized by perspective). */
    function setLayout(mode) {
        body.classList.toggle('rl3--side', mode === 'side' || mode === 'bow');
        body.classList.toggle('rl3--bow', mode === 'bow');
        for (const r of rt.values()) if (!r.data.empty) fitCode(r.card);
        renderBows();
    }

    window.RowingL3 = {
        apply,
        layout: setLayout,
        bows: (b) => apply({ bows: b }),
        telemetry,
        positions: (p) => apply({ positions: p }),
        fire,
        show,
        hide,
        demo: (on) => (on === false ? stopDemo() : startDemo()),
        get state() {
            return clone({ race: state.race, rules: state.rules, laneCount: state.laneCount, lanes: state.lanes });
        },
    };

    // ---------- boot ----------

    const boot = {
        race: {
            title: q.get('title'),
            number: q.get('num') ?? q.get('number'),
            type: q.get('type'),
            gold: q.get('gold'),
            distance: q.get('dist') ? numParam('dist', 2000) : null,
        },
        rules: {
            pace: { drop: numParam('paceDrop', DEFAULT_RULES.pace.drop), window: numParam('paceWindow', numParam('window', DEFAULT_RULES.pace.window)) },
            rate: { rise: numParam('rateRise', DEFAULT_RULES.rate.rise), window: numParam('rateWindow', numParam('window', DEFAULT_RULES.rate.window)) },
            hold: numParam('hold', DEFAULT_RULES.hold),
            cooldown: numParam('cooldown', DEFAULT_RULES.cooldown),
        },
    };
    if (q.get('paceOff') === '1') boot.rules.pace.enabled = false;
    if (q.get('rateOff') === '1') boot.rules.rate.enabled = false;
    apply(boot);

    if (q.get('layout') === 'side' || q.get('layout') === 'bow') setLayout(q.get('layout'));
    if (q.get('cv') === '1' || q.get('streamId')) {
        const id = q.get('streamId') || 'kri-live';
        startCvPoll(id, Math.max(100, numParam('cvPoll', 200)));
    }
    if (q.get('guides') === '1') body.classList.add('rl3--guides');
    if (q.get('bg') === '1') body.classList.add('rl3--preview-bg');
    if (q.get('ctrl') === '1') toggleCtrl(true);
    if (q.get('demo') === '1') startDemo();
    if (q.get('data')) startPoll(q.get('data'), Math.max(200, numParam('poll', 1000)));
    if (q.get('auto') !== '0') requestAnimationFrame(show);
    // Code widths depend on the web font: refit once it has loaded.
    document.fonts?.ready.then(() => {
        for (const r of rt.values()) if (!r.data.empty) fitCode(r.card);
    });

})();
