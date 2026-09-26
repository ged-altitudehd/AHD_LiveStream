/**
 * Rowing lane lower third — 1920×1080, transparent, vMix browser input.
 *
 * Live fields (all marked data-field; shown as dashed/italic placeholders until
 * a live value arrives):
 *   race.title · race.number · race.type · lane[n].code · lane[n].suit   (n = 1–9)
 *
 * Lane cards show the crew's row suit (white background cut out) and the
 * school/club code (e.g. AGSB), not the full name.
 * Styled to the Milford Asset Management brand guidelines (see vmix-rowing-l3.css).
 *
 * Programmable lane cards — within a rolling window, when that crew's
 *   pace:  split (sec/500 m) drops by more than rules.pace.drop seconds, the card
 *          flips over to show the split in place of the suit;
 *   rate:  stroke rating rises by more than rules.rate.rise spm, a small "38 SPM"
 *          pop-up appears above the card's top-left corner (the card does not flip).
 * Both hold for rules.hold seconds. Rules are global with optional per-lane
 * overrides (lanes[i].rules).
 *
 * Feeding data (any mix):
 *   URL      ?title=&num=&type=&lanes=8&paceDrop=2&rateRise=3&window=10&hold=5&cooldown=12
 *            &data=<json url>&poll=1000   poll a JSON feed (shape below)
 *            &demo=1   sample crews + simulated telemetry
 *            &auto=0   don't animate in on load (use L / RowingL3.show())
 *            &guides=1 &ctrl=1 &bg=1   design aids — never on the program output
 *   JS       window.RowingL3.apply(state) · .telemetry(lane, split, rate) · .fire(lane, 'pace'|'rate')
 *            .show() · .hide()
 *   message  window.postMessage({ type: 'rowing-l3', payload: state }, '*')
 *
 * State shape (every key optional):
 *   {
 *     race:  { title, number, type },          type: heat | rep | qf | sf | fa | fb | final | tt | free text
 *     rules: { pace: { enabled, drop, window }, rate: { enabled, rise, window }, hold, cooldown },
 *     laneCount: 1–9 | null,                  lanes in the race; null = the highest lane in the draw
 *     lanes: [ { lane, name, code, suit, colors: ['#hex'], scratched, rules, split, rate } ],
 *     telemetry: [ { lane, split, rate } ],
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
 *       1–9 test pace flip on lane · Shift+1–9 test rating pop-up.
 */
(function () {
    const MAX_LANES = 9;
    const LOOKUP_URL = 'data/ahd-lookup.json';
    const SUIT_DIR = 'assets/school-logos/';

    const PH = {
        'race.title': 'Race title',
        'race.number': '00',
        'race.type': 'RACE TYPE',
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
        race: { title: "Schoolboy U18 Eight", number: '42', type: 'fa' },
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
        laneCount: q.get('lanes') ? clampLanes(numParam('lanes', MAX_LANES)) : null, // null = from the draw
        lookup: null,
        lookupPromise: null,
        shown: false,
        demoTimer: 0,
        pollTimer: 0,
    };

    /** lane number → { lane data, card elements, telemetry history, flip state } */
    const rt = new Map();

    // ---------- utils ----------

    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function numParam(key, fallback) {
        const v = parseFloat(q.get(key));
        return Number.isFinite(v) ? v : fallback;
    }

    function clampLanes(n) {
        return Math.max(1, Math.min(MAX_LANES, Math.round(n) || MAX_LANES));
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
        const m = Math.floor(sec / 60);
        const s = sec - m * 60;
        return `${m}:${s.toFixed(1).padStart(4, '0')}`;
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
    }

    // ---------- lane cards ----------

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

    /**
     * RowIT suit PNGs: suit on a white (or transparent) square with the club code
     * printed underneath. Drops the caption (the last band of rows in the lower half),
     * flood-fills the background in from the edges so white parts of the suit itself
     * survive, then trims to the suit.
     */
    function cutout(img) {
        const H = Math.min(240, img.naturalHeight || 240);
        const W = Math.max(1, Math.round((H * img.naturalWidth) / img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        const im = ctx.getImageData(0, 0, W, H);
        const px = im.data;
        const isBg = (i) => px[i * 4 + 3] < 40 || Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 232;

        // Caption: last run of occupied rows, if it starts in the lower half after a gap.
        const occ = new Array(H).fill(0);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isBg(y * W + x)) occ[y]++;
        const runs = [];
        for (let y = 0; y < H; ) {
            while (y < H && !occ[y]) y++;
            const start = y;
            while (y < H && occ[y]) y++;
            if (y > start) runs.push(start);
        }
        const rows = runs.length >= 2 && runs[runs.length - 1] > H * 0.5 ? runs[runs.length - 1] : H;

        const bg = new Uint8Array(W * H);
        for (let i = rows * W; i < W * H; i++) bg[i] = 1;
        const stack = [];
        const seed = (i) => {
            if (!bg[i] && isBg(i)) {
                bg[i] = 1;
                stack.push(i);
            }
        };
        for (let x = 0; x < W; x++) seed(x);
        for (let y = 0; y < rows; y++) {
            seed(y * W);
            seed(y * W + W - 1);
        }
        if (rows > 0) for (let x = 0; x < W; x++) seed((rows - 1) * W + x);
        while (stack.length) {
            const i = stack.pop();
            const x = i % W;
            if (x > 0) seed(i - 1);
            if (x < W - 1) seed(i + 1);
            if (i >= W) seed(i - W);
            if (i + W < W * H) seed(i + W);
        }

        let minX = W;
        let minY = H;
        let maxX = -1;
        let maxY = -1;
        for (let i = 0; i < W * H; i++) {
            if (bg[i]) {
                px[i * 4 + 3] = 0;
                continue;
            }
            const x = i % W;
            const y = (i / W) | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (maxX < 0) throw new Error('empty suit');
        ctx.putImageData(im, 0, 0);
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1;
        out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
    }

    /** Two-sided card: front = suit + lane + code; back = the triggered data. */
    function makeCard(lane) {
        const root = el('div', 'rl3-card');
        const flip = el('div', 'rl3-card-flip');

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

        // Rating pop-up: outside the flipping element, so it shows whichever face is up.
        const rate = el('div', 'rl3-rate');
        rate.setAttribute('aria-hidden', 'true');
        const rateValue = el('span', 'rl3-rate-value');
        rate.append(rateValue, el('span', 'rl3-rate-unit', 'SPM'));

        flip.append(front, back);
        root.append(flip, rate);
        return {
            root, back, suit, laneEl, code, backLane, backCode, splitValue, splitDelta,
            rate, rateValue, suitKey: null, timer: 0, rateTimer: 0,
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
                r = { data, card: makeCard(data.lane), hist: [], base: { pace: -Infinity, rate: -Infinity }, cool: { pace: -Infinity, rate: -Infinity } };
                rt.set(data.lane, r);
            }
            r.data = data;
            const c = r.card;
            c.root.style.setProperty('--rl3-i', i);
            c.laneEl.textContent = String(data.lane);
            c.backLane.textContent = String(data.lane);
            c.root.classList.toggle('rl3-card--empty', !!data.empty);
            if (data.empty) {
                // Lane is in the race but has no crew: show the lane number only.
                unflip(r);
                c.code.textContent = '';
                c.code.classList.remove('rl3-ph');
                c.backCode.textContent = '';
                c.suit.replaceChildren();
                c.suit.classList.remove('rl3-ph');
                c.suitKey = 'empty';
            } else {
                const info = club(data.code);
                setField(c.code, blank(data.code) ? null : String(data.code).trim().toUpperCase(), PH.code);
                c.backCode.textContent = blank(data.code) ? '' : String(data.code).trim().toUpperCase();
                paintSuit(c, data, info);
            }
            lanesEl.appendChild(c.root); // keeps DOM order = list order
        });
        if (!state.lookup && list.some((l) => !l.empty && !blank(l.code))) loadLookup();
    }

    // ---------- telemetry + triggers ----------

    function telemetry(lane, split, rate, t) {
        const r = rt.get(Number(lane));
        if (!r) return;
        const ts = Number.isFinite(t) ? t : now();
        const sample = { t: ts, split: parseSplit(split), rate: Number(rate) };
        r.hist.push(sample);
        const rules = rulesFor(r.data.lane);
        const keep = Math.max(rules.pace.window, rules.rate.window) + 2;
        while (r.hist.length && r.hist[0].t < ts - keep) r.hist.shift();
        evaluate(r, sample, rules);
    }

    function evaluate(r, cur, rules) {
        const t = cur.t;
        if (rules.pace.enabled && Number.isFinite(cur.split)) {
            const from = Math.max(t - rules.pace.window, r.base.pace);
            let ref = -Infinity;
            for (const s of r.hist) if (s !== cur && s.t >= from && Number.isFinite(s.split)) ref = Math.max(ref, s.split);
            const drop = ref - cur.split;
            if (drop > rules.pace.drop && t >= r.cool.pace) {
                r.cool.pace = t + rules.cooldown;
                r.base.pace = t;
                flipCard(r, { value: cur.split, delta: -drop }, rules);
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

    const FLIP_MS = 600; // matches .rl3-card-flip transition
    const SPLIT_FONT = { max: 60, min: 30 }; // px: as large as the card width allows

    /** Pace: flip the card to show the split in place of the suit; holds, then flips back. */
    function flipCard(r, info, rules) {
        if (!state.shown || r.data.empty) return;
        const c = r.card;
        const hold = (rules || rulesFor(r.data.lane)).hold * 1000;
        renderSplit(c, info);
        c.root.classList.add('rl3-card--flipped');
        clearTimeout(c.timer);
        c.timer = setTimeout(() => c.root.classList.remove('rl3-card--flipped'), hold);
    }

    /** Rating: small "38 SPM" pop-up above the card's top-left corner; the card doesn't flip. */
    function popRating(r, info, rules) {
        if (!state.shown || r.data.empty) return;
        const c = r.card;
        const hold = (rules || rulesFor(r.data.lane)).hold * 1000;
        c.rateValue.textContent = Number.isFinite(info.value) ? String(Math.round(info.value)) : '––';
        c.rate.classList.add('rl3-rate--on');
        clearTimeout(c.rateTimer);
        c.rateTimer = setTimeout(() => c.rate.classList.remove('rl3-rate--on'), hold);
    }

    function unflip(r) {
        const c = r.card;
        clearTimeout(c.timer);
        clearTimeout(c.rateTimer);
        c.root.classList.remove('rl3-card--flipped');
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
        fitText(c.splitValue, SPLIT_FONT);
    }

    function resetFlips() {
        for (const r of rt.values()) unflip(r);
    }

    /** Manual / test trigger using the lane's latest sample (or a plausible value). */
    function fire(lane, kind) {
        const r = rt.get(Number(lane));
        if (!r || r.data.empty) return;
        const last = [...r.hist].reverse().find((s) => Number.isFinite(kind === 'pace' ? s.split : s.rate));
        const rules = rulesFor(r.data.lane);
        if (kind === 'pace') {
            flipCard(r, { value: last ? last.split : 98.6, delta: -(rules.pace.drop + 0.4) }, rules);
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
        resetFlips();
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
            state.laneCount = input.laneCount == null || input.laneCount === '' || !Number.isFinite(n) ? null : clampLanes(n);
        }
        if (Array.isArray(input.lanes)) {
            state.lanes = input.lanes
                .filter((l) => l && Number.isInteger(Number(l.lane)) && Number(l.lane) >= 1 && Number(l.lane) <= MAX_LANES)
                .map((l) => ({ ...l, lane: Number(l.lane) }));
        }
        renderRace();
        renderLanes();
        syncCtrl();
        if (Array.isArray(input.lanes)) {
            for (const l of input.lanes) {
                if (l && (l.split != null || l.rate != null)) telemetry(l.lane, l.split, l.rate);
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
                split: 100 + Math.random() * 6,
                rate: 33 + Math.random() * 3,
                pushAt: now() + 4 + Math.random() * 20,
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
                telemetry(lane, split, rate, t);
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
            ctrlField('Lanes in race (blank = from draw)', 'laneCount', 'number', { min: 1, max: 9, step: 1 }),
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
        timing.appendChild(el('legend', null, 'Pace flip / rating pop-up'));
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
            btn('Flip: pace', () => fire(laneSel.value, 'pace'), true),
            btn('Rating pop-up', () => fire(laneSel.value, 'rate'), true),
            btn('Demo', () => (state.demoTimer ? stopDemo() : startDemo()), true),
            btn('Guides', () => body.classList.toggle('rl3--guides'), true),
        );
        ctrlEl.appendChild(row);
        ctrlEl.appendChild(
            el(
                'p',
                'rl3-ctrl-hint',
                'Hide this panel (C) before going to air. Keys: L in · O out · G guides · B backdrop · D demo · 1–9 flip pace · Shift+1–9 rating pop-up.',
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

    window.RowingL3 = {
        apply,
        telemetry,
        fire,
        show,
        hide,
        demo: (on) => (on === false ? stopDemo() : startDemo()),
        get state() {
            return clone({ race: state.race, rules: state.rules, lanes: state.lanes });
        },
    };

    // ---------- boot ----------

    const boot = {
        race: { title: q.get('title'), number: q.get('num') ?? q.get('number'), type: q.get('type') },
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

    if (q.get('guides') === '1') body.classList.add('rl3--guides');
    if (q.get('bg') === '1') body.classList.add('rl3--preview-bg');
    if (q.get('ctrl') === '1') toggleCtrl(true);
    if (q.get('demo') === '1') startDemo();
    if (q.get('data')) startPoll(q.get('data'), Math.max(200, numParam('poll', 1000)));
    if (q.get('auto') !== '0') requestAnimationFrame(show);

})();
