/**
 * Rowing lane lower third — 1920×1080, transparent, vMix browser input.
 *
 * Live fields (all marked data-field; shown as dashed/italic placeholders until
 * a live value arrives):
 *   race.title · race.number · race.type · lane[n].code · lane[n].colors   (n = 1–9)
 *
 * Lane cards show the school/club code (e.g. AGSB), not the full name, and the
 * crew's row-suit colours as a horizontal colour bar (not the suit picture).
 * Styled to the Milford Asset Management brand guidelines (see vmix-rowing-l3.css).
 *
 * Programmable lane cards — a sub-card pops above a lane when, within a rolling
 * window, that crew's
 *   pace:  split (sec/500 m) drops by more than rules.pace.drop seconds, or
 *   rate:  stroke rating rises by more than rules.rate.rise spm.
 * Rules are global with optional per-lane overrides (lanes[i].rules).
 *
 * Feeding data (any mix):
 *   URL      ?title=&num=&type=&lanes=9&paceDrop=2&rateRise=3&window=10&hold=5&cooldown=12
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
 *     lanes: [ { lane, name, code, suit, colors: ['#hex'], rules, split, rate } ],
 *     telemetry: [ { lane, split, rate } ],
 *     show: true | false
 *   }
 *   code   = RowIT club code, shown on the card; also finds the row-suit PNG in data/ahd-lookup.json
 *   colors = row-suit colours for the colour bar, main colour first (wins over everything)
 *   suit   = row-suit image URL to read colours from when colors is not given
 *            (default: the club's RowIT suit PNG). Colours are sampled from the suit
 *            itself — background and the code caption under the suit are ignored.
 *   name   = full school/club name (optional; not shown)
 *   split = seconds per 500 m (102.4) or "1:42.4"; rate = strokes per minute
 *
 * Keys: L in · O out · G guides · C control panel · B preview backdrop · D demo
 *       1–9 test pace pop on lane · Shift+1–9 test rate pop.
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
        laneCount: clampLanes(numParam('lanes', MAX_LANES)),
        lookup: null,
        lookupPromise: null,
        shown: false,
        demoTimer: 0,
        pollTimer: 0,
    };

    /** lane number → { lane data, card elements, telemetry history, pop-up state } */
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

    function laneList() {
        if (state.lanes.length) return state.lanes;
        return Array.from({ length: state.laneCount }, (_, i) => ({ lane: i + 1 }));
    }

    // ---------- row-suit colours ----------

    /** suit image URL → Promise<[{ hex, share }] | null> */
    const colourCache = new Map();

    function suitColours(url) {
        if (!colourCache.has(url)) {
            colourCache.set(
                url,
                new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        try {
                            resolve(extractColours(img));
                        } catch {
                            resolve(null); // e.g. cross-origin image taints the canvas
                        }
                    };
                    img.onerror = () => resolve(null);
                    img.src = url;
                }),
            );
        }
        return colourCache.get(url);
    }

    /**
     * Main colours of a RowIT suit PNG: suit on a white/transparent square with the
     * club code printed underneath. Flood-fills the background in from the top and
     * sides (so white parts of the suit itself still count), skips the caption rows,
     * then clusters what's left and keeps colours covering at least 6% of the suit.
     */
    function extractColours(img) {
        const W = 120;
        const H = Math.round((W * img.naturalHeight) / img.naturalWidth) || W;
        const rows = Math.round(H * 0.8);
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, rows).data;
        const isBg = (i) => px[i * 4 + 3] < 40 || Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 232;

        const bg = new Uint8Array(W * rows);
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
        while (stack.length) {
            const i = stack.pop();
            const x = i % W;
            if (x > 0) seed(i - 1);
            if (x < W - 1) seed(i + 1);
            if (i >= W) seed(i - W);
            if (i + W < W * rows) seed(i + W);
        }

        const buckets = new Map();
        let total = 0;
        for (let i = 0; i < W * rows; i++) {
            if (bg[i] || px[i * 4 + 3] < 200) continue;
            const r = px[i * 4];
            const g = px[i * 4 + 1];
            const b = px[i * 4 + 2];
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            const k = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
            k.n++;
            k.r += r;
            k.g += g;
            k.b += b;
            buckets.set(key, k);
            total++;
        }
        if (!total) return null;

        const clusters = [];
        for (const k of [...buckets.values()].sort((a, b) => b.n - a.n)) {
            const c = [k.r / k.n, k.g / k.n, k.b / k.n];
            const hit = clusters.find((cl) => Math.hypot(cl.r / cl.n - c[0], cl.g / cl.n - c[1], cl.b / cl.n - c[2]) < 56);
            if (hit) {
                hit.n += k.n;
                hit.r += k.r;
                hit.g += k.g;
                hit.b += k.b;
            } else {
                clusters.push({ ...k });
            }
        }
        const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
        const out = clusters
            .map((cl) => ({ hex: `#${hex(cl.r / cl.n)}${hex(cl.g / cl.n)}${hex(cl.b / cl.n)}`, share: cl.n / total }))
            .filter((c) => c.share >= 0.06)
            .sort((a, b) => b.share - a.share)
            .slice(0, 3);
        return out.length ? out : null;
    }

    function makeCard(lane) {
        const root = el('div', 'rl3-card');
        const subs = el('div', 'rl3-subs');
        const swatch = el('div', 'rl3-card-colours');
        swatch.dataset.field = `lane${lane}.colors`;
        const row = el('div', 'rl3-card-row');
        const laneEl = el('div', 'rl3-card-lane', String(lane));
        const code = el('div', 'rl3-card-code');
        code.dataset.field = `lane${lane}.code`;
        row.append(laneEl, code);
        root.append(subs, swatch, row);
        return { root, subs, swatch, laneEl, code, colourKey: null };
    }

    /** Horizontal colour bar; main colour widest, secondary colours narrower.
     *  One element with hard gradient stops, so there are no sub-pixel seams. */
    function drawColours(card, colours) {
        const weights = colours.map((c) => Math.max(c.share ?? 1, 0.22));
        const sum = weights.reduce((a, b) => a + b, 0);
        let at = 0;
        const stops = colours.map((c, i) => {
            const from = at;
            at += (weights[i] / sum) * 100;
            return `${c.hex} ${from.toFixed(2)}% ${i === colours.length - 1 ? 100 : at.toFixed(2)}%`;
        });
        const bar = el('span', 'rl3-colour');
        bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
        card.swatch.replaceChildren(bar);
        card.swatch.classList.remove('rl3-ph');
    }

    function colourPlaceholder(card) {
        card.swatch.replaceChildren(el('span', 'rl3-colour-tag', 'COLOURS'));
        card.swatch.classList.add('rl3-ph');
    }

    function paintColours(card, data, info) {
        const given = (Array.isArray(data.colors) ? data.colors : [data.colors]).filter((c) => !blank(c));
        const url = !blank(data.suit) ? data.suit : info?.logo ? SUIT_DIR + encodeURIComponent(info.logo) : null;
        const key = given.length ? `c:${given.join(',')}` : url ? `u:${url}` : 'ph';
        if (card.colourKey === key) return;
        card.colourKey = key;
        if (given.length) {
            // Explicit colours: first is the main colour.
            return drawColours(card, given.slice(0, 3).map((hex, i) => ({ hex, share: i ? 0.25 : 0.5 })));
        }
        if (!url) return colourPlaceholder(card);
        card.swatch.replaceChildren();
        card.swatch.classList.remove('rl3-ph');
        suitColours(url).then((colours) => {
            if (card.colourKey !== key) return;
            if (colours) drawColours(card, colours);
            else colourPlaceholder(card);
        });
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
                r = { data, card: makeCard(data.lane), hist: [], base: { pace: -Infinity, rate: -Infinity }, cool: { pace: -Infinity, rate: -Infinity }, pops: {} };
                rt.set(data.lane, r);
            }
            r.data = data;
            const c = r.card;
            c.root.style.setProperty('--rl3-i', i);
            const info = club(data.code);
            c.laneEl.textContent = String(data.lane);
            setField(c.code, blank(data.code) ? null : String(data.code).trim().toUpperCase(), PH.code);
            paintColours(c, data, info);
            lanesEl.appendChild(c.root); // keeps DOM order = list order
        });
        if (!state.lookup && list.some((l) => !blank(l.code))) loadLookup();
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
                pop(r, 'pace', { value: cur.split, delta: -drop }, rules);
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
                pop(r, 'rate', { value: cur.rate, delta: rise }, rules);
            }
        }
    }

    function pop(r, kind, info, rules) {
        if (!state.shown) return;
        const hold = (rules || rulesFor(r.data.lane)).hold * 1000;
        let p = r.pops[kind];
        if (p) {
            clearTimeout(p.timer);
            p.el.classList.remove('rl3-sub--out');
        } else {
            const node = el('div', `rl3-sub rl3-sub--${kind}`);
            p = r.pops[kind] = { el: node, timer: 0 };
            node.append(el('span', 'rl3-sub-label'), el('span', 'rl3-sub-value'), el('span', 'rl3-sub-delta'));
            r.card.subs.appendChild(node);
        }
        const [label, value, delta] = p.el.children;
        if (kind === 'pace') {
            label.textContent = 'Pace';
            value.textContent = fmtSplit(info.value);
            value.appendChild(el('span', 'rl3-sub-unit', '/500'));
            delta.textContent = Number.isFinite(info.delta) ? `${fmtSigned(info.delta, 1)}s` : '';
        } else {
            label.textContent = 'Rating';
            value.textContent = Number.isFinite(info.value) ? String(Math.round(info.value)) : '––';
            value.appendChild(el('span', 'rl3-sub-unit', 'spm'));
            delta.textContent = Number.isFinite(info.delta) ? fmtSigned(Math.round(info.delta), 0) : '';
        }
        p.timer = setTimeout(() => {
            p.el.classList.add('rl3-sub--out');
            p.timer = setTimeout(() => {
                p.el.remove();
                if (r.pops[kind] === p) delete r.pops[kind];
            }, 380);
        }, hold);
    }

    function clearPops() {
        for (const r of rt.values()) {
            for (const p of Object.values(r.pops)) {
                clearTimeout(p.timer);
                p.el.remove();
            }
            r.pops = {};
        }
    }

    /** Manual / test pop-up using the lane's latest sample (or a plausible value). */
    function fire(lane, kind) {
        const r = rt.get(Number(lane));
        if (!r) return;
        const last = [...r.hist].reverse().find((s) => Number.isFinite(kind === 'pace' ? s.split : s.rate));
        const rules = rulesFor(r.data.lane);
        if (kind === 'pace') {
            pop(r, 'pace', { value: last ? last.split : 98.6, delta: -(rules.pace.drop + 0.4) }, rules);
        } else {
            pop(r, 'rate', { value: last ? last.rate : 38, delta: rules.rate.rise + 1 }, rules);
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
        clearPops();
        setTimeout(() => {
            if (!state.shown) body.classList.remove('rl3--on', 'rl3--out');
        }, 480);
    }

    // ---------- apply external state ----------

    function apply(input) {
        if (!input || typeof input !== 'object') return;
        if (input.race) deepMerge(state.race, input.race);
        if (input.rules) deepMerge(state.rules, input.rules);
        if (Number.isFinite(input.laneCount)) state.laneCount = clampLanes(input.laneCount);
        if (Array.isArray(input.lanes)) {
            state.lanes = input.lanes
                .filter((l) => l && Number.isFinite(Number(l.lane)))
                .slice(0, MAX_LANES)
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
            apply({ race: DEMO.race, lanes: demoLanes(state.laneCount) });
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
            ctrlField('Lanes when no draw', 'laneCount', 'number', { min: 1, max: 9, step: 1 }),
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
        timing.appendChild(el('legend', null, 'Sub-card'));
        timing.append(
            ctrlField('Hold on screen (s)', 'rules.hold', 'number', { step: 0.5, min: 1 }),
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
            btn('Test pace', () => fire(laneSel.value, 'pace'), true),
            btn('Test rate', () => fire(laneSel.value, 'rate'), true),
            btn('Demo', () => (state.demoTimer ? stopDemo() : startDemo()), true),
            btn('Guides', () => body.classList.toggle('rl3--guides'), true),
        );
        ctrlEl.appendChild(row);
        ctrlEl.appendChild(
            el(
                'p',
                'rl3-ctrl-hint',
                'Hide this panel (C) before going to air. Keys: L in · O out · G guides · B backdrop · D demo · 1–9 test pace · Shift+1–9 test rate.',
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
        if (input.type === 'number') {
            v = parseFloat(v);
            if (!Number.isFinite(v)) return;
        }
        if (key === 'laneCount') return apply({ laneCount: v });
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
