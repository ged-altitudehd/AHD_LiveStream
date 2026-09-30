/**
 * Distance to go — the row of course buoys (10 m apart) as a countdown to the finish.
 * A translucent strip lies on the water along the buoy row and each buoy carries the metres
 * to go at that buoy, in white, lying on the water; the lead crew's live count rides along
 * the row as they pass the buoys. 1920×1080, transparent.
 *
 * Placement (screen px, set once for the camera; ?guides=1 draws the fit):
 *   Two or three buoys whose distance to go is known, given as x,y,metres:
 *     ?b1=1860,680,50   ?b2=1300,540,0   [?b3=1565,610,20]
 *   Two buoys give a linear fit; a third lets the spacing shrink with distance the way the
 *   camera sees it (perspective). ?range=0,80 draws buoys from 0 to 80 m to go along the
 *   fitted line, every ?step=10 m (the buoy interval). ?w=90 strip width at the nearest buoy.
 *   ?every=1 labels every buoy (2 = every second buoy, useful for a long stretch).
 *
 * Distance (any mix):
 *   ?dist=2000                 course length (default 2000)
 *   ?data=<json url>&poll=1000 the lane feed: leader distance = max lanes[]/telemetry[].distance
 *   JS   window.RowingDtg.set(metresToGo) · .leader(metresCovered) · .show() · .hide() · .demo(on)
 *   msg  postMessage({ type: 'rowing-dtg', payload: { dtg | distance | distances: { lane: m } } })
 *   Between updates the count runs on at the leader's measured speed, so it ticks metre by metre.
 *   ?demo=1 runs a 2000 m race. ?opacity=0.35 strip opacity · ?text=0.92 text opacity.
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

    const refs = [list('b1', [1862, 681, 40]), list('b2', [1305, 540, 0]), q.get('b3') ? list('b3', null) : [1565, 610, 20]]
        .filter((r) => r && r.length === 3 && r.every(Number.isFinite))
        .map(([x, y, d]) => ({ x, y, d }));
    const cfg = {
        course: num('dist', 2000),
        range: list('range', [0, 60]),
        step: Math.max(1, num('step', 10)),
        every: Math.max(1, Math.round(num('every', 1))),
        w: num('w', 90),
    };

    const st = { target: null, shown: null, speed: 0, lastT: 0, on: false, demo: 0, raf: 0 };

    // ---------- buoy row: metres to go → screen point ----------
    // Along the row, screen position is a projective (1-D homography) function of distance:
    // t(d) = (a·d + b) / (c·d + 1). Three references fix a, b, c; two give the linear case.

    const near = refs.reduce((m, r) => (m.d > r.d ? m : r)); // the buoy with most metres to go = start of the ruler
    const far = refs.reduce((m, r) => (m.d < r.d ? m : r));
    const axis = { x: far.x - near.x, y: far.y - near.y };
    const axisLen = Math.hypot(axis.x, axis.y) || 1;
    const tOf = (p) => ((p.x - near.x) * axis.x + (p.y - near.y) * axis.y) / (axisLen * axisLen); // 0 at near, 1 at far

    let tFn;
    {
        const pts = refs.map((r) => ({ d: r.d, t: tOf(r) }));
        if (pts.length >= 3) {
            // Solve t(c·d + 1) = a·d + b for the three points.
            const [p0, p1, p2] = pts;
            const M = [
                [p0.d, 1, -p0.t * p0.d],
                [p1.d, 1, -p1.t * p1.d],
                [p2.d, 1, -p2.t * p2.d],
            ];
            const v = [p0.t, p1.t, p2.t];
            const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
            const D = det(M);
            const col = (i) => M.map((row, r) => row.map((val, c) => (c === i ? v[r] : val)));
            if (Math.abs(D) > 1e-9) {
                const a = det(col(0)) / D;
                const b = det(col(1)) / D;
                const c = det(col(2)) / D;
                tFn = (d) => (a * d + b) / (c * d + 1);
            }
        }
        if (!tFn) {
            const dd = far.d - near.d || 1;
            tFn = (d) => (d - near.d) / dd;
        }
    }

    const pointAt = (d) => {
        const t = tFn(d);
        return { x: near.x + axis.x * t, y: near.y + axis.y * t, t };
    };
    /** Local screen scale at a buoy: how far apart neighbouring buoys are there (px per step). */
    const spacingAt = (d) => {
        const a = pointAt(d);
        const b = pointAt(d - cfg.step);
        return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const nearSpacing = spacingAt(near.d);
    // Perpendicular to the row, pointing down-screen (toward the camera) so labels sit this side.
    let px = -axis.y / axisLen;
    let py = axis.x / axisLen;
    if (py < 0) { px = -px; py = -py; }
    // Text runs along the row but always reads left → right (never upside down).
    let angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const clampS = (s) => Math.max(0.45, Math.min(1.6, s));

    // ---------- drawing ----------

    function el(tag, attrs, text) {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (text != null) n.textContent = text;
        return n;
    }

    /** Text lying on the water: rotated along the row, squashed toward the camera, sized by local spacing. */
    function flatText(p, d, s, cls, text) {
        const squash = 0.55; // the water plane seen at a low angle
        return el('text', {
            class: cls,
            transform: `translate(${p.x} ${p.y}) rotate(${angle}) scale(${s} ${s * squash})`,
        }, text);
    }

    let liveLabel = null;
    let liveDot = null;

    function draw() {
        svg.replaceChildren();
        const [d0, d1] = cfg.range;
        const lo = Math.min(d0, d1);
        const hi = Math.max(d0, d1);

        // Strip along the row, width shrinking with distance.
        const left = [];
        const right = [];
        for (let d = lo; d <= hi + 1e-6; d += cfg.step / 2) {
            const p = pointAt(d);
            const w = cfg.w * clampS(spacingAt(d) / nearSpacing);
            left.push(`${p.x - px * w * 0.35},${p.y - py * w * 0.35}`);
            right.unshift(`${p.x + px * w * 0.65},${p.y + py * w * 0.65}`);
        }
        svg.appendChild(el('polygon', { class: 'dtg-band', points: [...left, ...right].join(' ') }));

        // Buoy marks and metres-to-go labels.
        let i = 0;
        for (let d = lo; d <= hi + 1e-6; d += cfg.step, i++) {
            const p = pointAt(d);
            const s = clampS(spacingAt(d) / nearSpacing);
            svg.appendChild(el('circle', { class: 'dtg-tick', cx: p.x, cy: p.y, r: Math.max(2, 4 * s) }));
            if (i % cfg.every) continue;
            const lp = { x: p.x + px * 14 * s, y: p.y + py * 14 * s };
            svg.appendChild(flatText(lp, d, s, 'dtg-mark', d === 0 ? 'FINISH' : String(d)));
        }

        // The lead crew's live count: rides the row while in range, else parks at the row's start.
        liveDot = svg.appendChild(el('circle', { class: 'dtg-live-dot', r: 7 }));
        liveLabel = svg.appendChild(flatText({ x: 0, y: 0 }, 0, 1, 'dtg-live', ''));

        // Guides: the reference buoys and their distances.
        const g = el('g', { class: 'dtg-guides' });
        for (const r of refs) {
            g.appendChild(el('circle', { cx: r.x, cy: r.y, r: 9 }));
            g.appendChild(el('text', { x: r.x + 12, y: r.y - 12 }, `${r.d} m to go (${r.x},${r.y})`));
        }
        g.appendChild(el('line', { x1: pointAt(lo).x, y1: pointAt(lo).y, x2: pointAt(hi).x, y2: pointAt(hi).y }));
        svg.appendChild(g);
    }

    function placeLive(dtg) {
        const [d0, d1] = cfg.range;
        const lo = Math.min(d0, d1);
        const hi = Math.max(d0, d1);
        const inRange = dtg >= lo && dtg <= hi;
        const d = inRange ? dtg : hi;
        const p = pointAt(d);
        const s = clampS(spacingAt(d) / nearSpacing);
        liveDot.setAttribute('cx', p.x);
        liveDot.setAttribute('cy', p.y);
        liveDot.setAttribute('r', Math.max(4, 7 * s));
        liveDot.classList.toggle('dtg-live-dot--on', inRange);
        const lp = { x: p.x - px * 30 * s, y: p.y - py * 30 * s }; // the far side of the row, clear of the buoy labels
        liveLabel.setAttribute('transform', `translate(${lp.x} ${lp.y}) rotate(${angle}) scale(${s} ${s * 0.55})`);
        liveLabel.textContent = `${Math.ceil(dtg).toLocaleString('en-NZ')} m to go`;
        liveLabel.classList.toggle('dtg-live--finish', dtg <= 100);
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
        // Start with 140 m to go so the count reaches the buoys in view within seconds.
        const t0 = performance.now();
        const startCovered = Math.max(0, cfg.course - 140);
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
