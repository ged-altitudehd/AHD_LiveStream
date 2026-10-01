/**
 * Distance to go — the rows of course buoys as a countdown to the finish.
 * Each row of buoys runs across the course at a distance mark, and the rows are 10 m apart
 * down the course. The graphic lays a translucent band on the water along each row in view
 * with that row's metres to go in white at its near end ("80m", the next row "70m"), and the
 * lead crew's live count moves between the rows as they race. 1920×1080, transparent.
 *
 * Placement (screen px, set once for the camera; ?guides=1 draws the fit):
 *   Each known row as near-x,near-y,far-x,far-y,metres — the near end is the buoy closest to
 *   the camera, the far end the last buoy of that row you can see:
 *     ?r1=560,860,605,620,80   ?r2=1862,681,1305,540,90   [?r3=…]
 *   Two rows fix the course direction; a third lets the row spacing shrink with distance the
 *   way the camera sees it. ?rows=60,70,80,90 draws these rows (default: every ?step=10 m
 *   from the nearest to the furthest known row). ?w=60 band width at the nearest row.
 *
 * Distance (any mix):
 *   ?dist=2000                 course length (default 2000)
 *   ?data=<json url>&poll=1000 the lane feed: leader distance = max lanes[]/telemetry[].distance
 *   JS   window.RowingDtg.set(metresToGo) · .leader(metresCovered) · .show() · .hide() · .demo(on)
 *   msg  postMessage({ type: 'rowing-dtg', payload: { dtg | distance | distances: { lane: m } } })
 *   Between updates the count runs on at the leader's measured speed, so it ticks metre by metre.
 *   ?demo=1 runs the last 160 m of a race. ?opacity=0.35 band opacity · ?text=0.92 text opacity.
 *
 * Keys: L in · O out · D demo · G guides · B preview backdrop.
 */
(function () {
    const q = new URLSearchParams(location.search);
    const num = (k, d) => (Number.isFinite(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);
    const list = (k, d) => (q.get(k) ? q.get(k).split(',').map(Number) : d);
    const body = document.body;
    const svg = document.getElementById('dtgSvg');
    const NS = 'http://www.w3.org/2000/svg';

    const refs = [list('r1', [560, 860, 605, 620, 80]), list('r2', [1862, 681, 1305, 540, 90]), list('r3', null), list('r4', null)]
        .filter((r) => r && r.length === 5 && r.every(Number.isFinite))
        .map(([nx, ny, fx, fy, d]) => ({ near: { x: nx, y: ny }, far: { x: fx, y: fy }, d }));
    const cfg = {
        course: num('dist', 2000),
        step: Math.max(1, num('step', 10)),
        rows: list('rows', null),
        w: num('w', 60),
    };

    const st = { target: null, shown: null, speed: 0, lastT: 0, on: false, demo: 0, raf: 0 };

    // ---------- rows: metres to go → the row's line on screen ----------
    // The near ends of the rows lie on one line down the course, the far ends on another. Along
    // each, position is a projective function of distance: t(d) = (a·d + b) / (c·d + 1). Three
    // rows fix a, b, c; two give the linear case.

    function fit1d(points) {
        // points: [{ d, t }]
        if (points.length >= 3) {
            const [p0, p1, p2] = points;
            const M = [[p0.d, 1, -p0.t * p0.d], [p1.d, 1, -p1.t * p1.d], [p2.d, 1, -p2.t * p2.d]];
            const v = [p0.t, p1.t, p2.t];
            const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
            const D = det(M);
            const col = (i) => M.map((row, r) => row.map((val, c) => (c === i ? v[r] : val)));
            if (Math.abs(D) > 1e-9) {
                const a = det(col(0)) / D, b = det(col(1)) / D, c = det(col(2)) / D;
                return (d) => (a * d + b) / (c * d + 1);
            }
        }
        const [p0, p1] = points;
        const dd = p1.d - p0.d || 1;
        return (d) => p0.t + ((d - p0.d) * (p1.t - p0.t)) / dd;
    }

    /** A line through the matching ends of the known rows, parameterised by metres to go. */
    function endLine(key) {
        const first = refs.reduce((m, r) => (m.d < r.d ? m : r)); // nearest to the finish
        const last = refs.reduce((m, r) => (m.d > r.d ? m : r));
        const A = first[key];
        const B = last[key];
        const ax = B.x - A.x, ay = B.y - A.y;
        const len2 = ax * ax + ay * ay || 1;
        const tOf = (p) => ((p.x - A.x) * ax + (p.y - A.y) * ay) / len2;
        const tFn = fit1d(refs.map((r) => ({ d: r.d, t: tOf(r[key]) })));
        return (d) => {
            const t = tFn(d);
            return { x: A.x + ax * t, y: A.y + ay * t };
        };
    }

    const nearAt = endLine('near');
    const farAt = endLine('far');
    const rowAt = (d) => ({ near: nearAt(d), far: farAt(d) });
    // Size by how close a row's near end is to the camera (lower on screen = nearer).
    const nearestY = Math.max(...refs.map((r) => r.near.y));
    const scaleAt = (d) => Math.max(0.35, Math.min(1.6, Math.pow(Math.max(1, nearAt(d).y) / nearestY, 1.5)));

    function rowsToDraw() {
        if (cfg.rows) return cfg.rows.filter(Number.isFinite);
        const ds = refs.map((r) => r.d);
        const out = [];
        for (let d = Math.min(...ds); d <= Math.max(...ds) + 1e-6; d += cfg.step) out.push(d);
        return out;
    }

    // ---------- drawing ----------

    function el(tag, attrs, text) {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (text != null) n.textContent = text;
        return n;
    }

    /** Text lying on the water below a point: squashed toward the camera, sized by local scale. */
    function flatText(p, s, cls, text) {
        return el('text', { class: cls, transform: `translate(${p.x} ${p.y}) scale(${s} ${s * 0.6})` }, text);
    }

    let liveLabel = null;
    let liveDot = null;

    function draw() {
        svg.replaceChildren();
        for (const d of rowsToDraw()) {
            const r = rowAt(d);
            const s = scaleAt(d);
            // Band along the row, wider at the near end.
            const dx = r.far.x - r.near.x, dy = r.far.y - r.near.y;
            const L = Math.hypot(dx, dy) || 1;
            const px = -dy / L, py = dx / L;
            const wn = cfg.w * s, wf = wn * 0.45;
            svg.appendChild(el('polygon', {
                class: 'dtg-band',
                points: [
                    `${r.near.x - px * wn / 2},${r.near.y - py * wn / 2}`, `${r.far.x - px * wf / 2},${r.far.y - py * wf / 2}`,
                    `${r.far.x + px * wf / 2},${r.far.y + py * wf / 2}`, `${r.near.x + px * wn / 2},${r.near.y + py * wn / 2}`,
                ].join(' '),
            }));
            // The row's distance, on the water just below its near end.
            svg.appendChild(flatText({ x: r.near.x, y: r.near.y + 16 * s }, s, 'dtg-mark', d === 0 ? 'FINISH' : `${d}m`));
        }
        liveDot = svg.appendChild(el('circle', { class: 'dtg-live-dot', r: 7 }));
        liveLabel = svg.appendChild(flatText({ x: 0, y: 0 }, 1, 'dtg-live', ''));

        const g = el('g', { class: 'dtg-guides' });
        for (const r of refs) {
            g.appendChild(el('line', { x1: r.near.x, y1: r.near.y, x2: r.far.x, y2: r.far.y }));
            g.appendChild(el('circle', { cx: r.near.x, cy: r.near.y, r: 9 }));
            g.appendChild(el('circle', { cx: r.far.x, cy: r.far.y, r: 6 }));
            g.appendChild(el('text', { x: r.near.x + 14, y: r.near.y + 6 }, `${r.d} m row · near (${r.near.x},${r.near.y}) far (${r.far.x},${r.far.y})`));
        }
        svg.appendChild(g);
    }

    /** The lead crew's live count: moves along the near-end line between the rows. */
    function placeLive(dtg) {
        const ds = rowsToDraw();
        const lo = Math.min(...ds), hi = Math.max(...ds);
        const inRange = dtg >= lo - cfg.step && dtg <= hi + cfg.step;
        const d = Math.max(lo - cfg.step, Math.min(hi + cfg.step, dtg));
        const p = nearAt(d);
        const s = scaleAt(d);
        liveDot.setAttribute('cx', p.x);
        liveDot.setAttribute('cy', p.y);
        liveDot.setAttribute('r', Math.max(4, 7 * s));
        liveDot.classList.toggle('dtg-live-dot--on', inRange);
        liveLabel.setAttribute('transform', `translate(${p.x} ${p.y - 26 * s}) scale(${s} ${s * 0.6})`);
        liveLabel.textContent = `${Math.ceil(dtg).toLocaleString('en-NZ')} m to go`;
        liveLabel.classList.toggle('dtg-live--finish', dtg <= 100);
        liveLabel.classList.toggle('dtg-live--parked', !inRange);
    }

    // ---------- distance ----------

    function setTarget(dtg) {
        const v = Number(dtg);
        if (!Number.isFinite(v)) return;
        const t = performance.now() / 1000;
        const clamped = Math.max(0, Math.min(cfg.course, v));
        if (st.target != null && t > st.lastT) {
            const sp = (st.target - clamped) / (t - st.lastT);
            if (sp > 0 && sp < 12) st.speed = st.speed ? st.speed * 0.5 + sp * 0.5 : sp;
        }
        st.target = clamped;
        st.lastT = t;
        if (st.shown == null) st.shown = clamped;
        if (!st.raf) st.raf = requestAnimationFrame(frame);
    }

    let prevFrame = 0;
    function frame(now) {
        st.raf = 0;
        const dt = prevFrame ? (now - prevFrame) / 1000 : 0;
        prevFrame = now;
        if (st.target == null) return;
        let v = st.shown - st.speed * dt; // run on at the leader's speed between samples
        const err = st.target - v;
        if (Math.abs(err) > 25) v = st.target;
        else v += err * Math.min(1, dt * 1.5);
        st.shown = Math.max(0, v);
        placeLive(st.shown);
        if (st.shown > 0 || st.target > 0) st.raf = requestAnimationFrame(frame);
    }

    const leader = (metresCovered) => setTarget(cfg.course - Number(metresCovered));

    function apply(p) {
        if (!p || typeof p !== 'object') return;
        if (p.dtg != null) setTarget(p.dtg);
        else if (p.distance != null) leader(p.distance);
        else {
            const ds = [];
            if (p.distances && typeof p.distances === 'object') ds.push(...Object.values(p.distances).map(Number));
            for (const k of ['lanes', 'telemetry']) if (Array.isArray(p[k])) ds.push(...p[k].map((e) => Number(e?.distance)));
            const max = Math.max(...ds.filter(Number.isFinite));
            if (Number.isFinite(max)) leader(max);
        }
        if (p.show === true) show();
        if (p.show === false) hide();
    }

    // ---------- show / hide / demo ----------

    function show() {
        st.on = true;
        body.classList.remove('dtg--out');
        body.classList.add('dtg--on');
    }

    function hide() {
        st.on = false;
        body.classList.add('dtg--out');
        setTimeout(() => !st.on && body.classList.remove('dtg--on', 'dtg--out'), 500);
    }

    function demo(on) {
        clearInterval(st.demo);
        st.demo = 0;
        if (on === false) return;
        // Start with 160 m to go so the count reaches the rows in view within seconds.
        const t0 = performance.now();
        const startCovered = Math.max(0, cfg.course - 160);
        st.demo = setInterval(() => {
            const t = (performance.now() - t0) / 1000;
            const covered = Math.min(cfg.course, startCovered + t * (5.4 + 0.3 * Math.sin(t / 7)));
            leader(covered);
            if (covered >= cfg.course) { clearInterval(st.demo); st.demo = 0; }
        }, 1000);
    }

    function poll(url, ms) {
        const tick = async () => {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) apply(await r.json());
            } catch { /* keep counting on the last speed */ }
            setTimeout(tick, ms);
        };
        tick();
    }

    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'l') show();
        else if (k === 'o') hide();
        else if (k === 'g') body.classList.toggle('dtg--guides');
        else if (k === 'b') body.classList.toggle('rl3--preview-bg');
        else if (k === 'd') demo(!st.demo);
    });
    window.addEventListener('message', (e) => e.data?.type === 'rowing-dtg' && apply(e.data.payload));

    window.RowingDtg = { set: setTarget, leader, apply, show, hide, demo, draw, cfg, refs };

    // ---------- boot ----------
    document.documentElement.style.setProperty('--dtg-strip-opacity', String(num('opacity', 0.35)));
    document.documentElement.style.setProperty('--dtg-text-opacity', String(num('text', 0.92)));
    draw();
    setTarget(cfg.course);
    if (q.get('guides') === '1') body.classList.add('dtg--guides');
    if (q.get('bg') === '1') body.classList.add('rl3--preview-bg');
    if (q.get('demo') === '1') demo(true);
    if (q.get('data')) poll(q.get('data'), Math.max(200, num('poll', 1000)));
    if (q.get('auto') !== '0') requestAnimationFrame(show);
})();
