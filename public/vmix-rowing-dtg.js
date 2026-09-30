/**
 * Distance to go — a translucent strip lying on the water along the buoy line, with white
 * text on the same plane counting down the metres left in the race. 1920×1080, transparent.
 *
 * Placement (screen px, set once for the camera; ?guides=1 draws the strip corners):
 *   ?x1=560&y1=860   near end of the buoy line        ?w1=170  strip width there
 *   ?x2=1700&y2=640  far end of the buoy line         ?w2=70   strip width there
 *   ?len=0.62        use only this fraction of the line, from the near end (0–1)
 *   The strip is mapped onto those corners with a real projective transform, so the text
 *   foreshortens like the water does.
 *
 * Distance (any mix):
 *   ?dist=2000                 course length (default 2000)
 *   ?data=<json url>&poll=1000 the lane feed: leader distance = max lanes[]/telemetry[].distance
 *   JS   window.RowingDtg.set(metresToGo) · .leader(metresCovered) · .show() · .hide() · .demo(on)
 *   msg  postMessage({ type: 'rowing-dtg', payload: { dtg | distance | distances: { lane: m } } })
 *   Between updates the count runs on at the leader's measured speed, so it ticks metre by metre.
 *   ?demo=1 runs a 2000 m race at ~5.4 m/s. ?opacity=0.35 strip opacity. ?text=0.9 text opacity.
 *
 * Keys: L in · O out · D demo · G guides · B preview backdrop.
 */
(function () {
    const q = new URLSearchParams(location.search);
    const num = (k, d) => (Number.isFinite(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);
    const body = document.body;
    const strip = document.getElementById('dtgStrip');
    const valueEl = document.getElementById('dtgValue');
    const guides = document.getElementById('dtgGuides');

    const cfg = {
        course: num('dist', 2000),
        near: { x: num('x1', 560), y: num('y1', 860), w: num('w1', 170) },
        far: { x: num('x2', 1700), y: num('y2', 640), w: num('w2', 70) },
        len: Math.max(0.15, Math.min(1, num('len', 0.62))),
        W: 900, // strip's own size before projection
        H: 160,
    };

    const st = {
        target: null,   // latest distance to go from the feed
        shown: null,    // what is displayed (runs on between updates)
        speed: 0,       // m/s, from successive feed values
        lastT: 0,
        on: false,
        demo: 0,
        raf: 0,
    };

    // ---------- projective mapping: strip rectangle → four screen corners ----------

    function corners() {
        const { near, far, len } = cfg;
        const fx = near.x + (far.x - near.x) * len;
        const fy = near.y + (far.y - near.y) * len;
        const fw = near.w + (far.w - near.w) * len;
        const dx = fx - near.x;
        const dy = fy - near.y;
        const L = Math.hypot(dx, dy) || 1;
        // Perpendicular in screen space, pointing up-screen (away from the camera), so the
        // strip's top edge is its far side and the text reads like paint on a road.
        let nx = -dy / L;
        let ny = dx / L;
        if (ny > 0) { nx = -nx; ny = -ny; }
        return [
            { x: near.x + nx * (near.w / 2), y: near.y + ny * (near.w / 2) }, // near end, far side  (strip top-left)
            { x: fx + nx * (fw / 2), y: fy + ny * (fw / 2) },                 // far end, far side   (top-right)
            { x: fx - nx * (fw / 2), y: fy - ny * (fw / 2) },                 // far end, near side  (bottom-right)
            { x: near.x - nx * (near.w / 2), y: near.y - ny * (near.w / 2) }, // near end, near side (bottom-left)
        ];
    }

    /** Solve the 3×3 homography taking (0,0),(W,0),(W,H),(0,H) to the four corners. */
    function homography(W, H, c) {
        const src = [[0, 0], [W, 0], [W, H], [0, H]];
        const A = [];
        const b = [];
        for (let i = 0; i < 4; i++) {
            const [x, y] = src[i];
            const { x: X, y: Y } = c[i];
            A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
            A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
        }
        // Gaussian elimination
        for (let col = 0; col < 8; col++) {
            let piv = col;
            for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
            [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
            for (let r = 0; r < 8; r++) {
                if (r === col) continue;
                const f = A[r][col] / A[col][col];
                for (let k = col; k < 8; k++) A[r][k] -= f * A[col][k];
                b[r] -= f * b[col];
            }
        }
        const h = b.map((v, i) => v / A[i][i]);
        // CSS matrix3d is column-major 4×4; embed the 3×3 (with z untouched).
        return `matrix3d(${h[0]},${h[3]},0,${h[6]}, ${h[1]},${h[4]},0,${h[7]}, 0,0,1,0, ${h[2]},${h[5]},0,1)`;
    }

    function place() {
        const c = corners();
        strip.style.width = `${cfg.W}px`;
        strip.style.height = `${cfg.H}px`;
        strip.style.transform = homography(cfg.W, cfg.H, c);
        guides.innerHTML =
            `<polygon points="${c.map((p) => `${p.x},${p.y}`).join(' ')}"/>` +
            `<line x1="${cfg.near.x}" y1="${cfg.near.y}" x2="${cfg.far.x}" y2="${cfg.far.y}"/>` +
            c.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="6"/><text x="${p.x + 10}" y="${p.y - 8}">${['near · far side', 'far · far side', 'far · near side', 'near · near side'][i]}</text>`).join('');
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

    /** Run the displayed value on at the leader's speed; snap gently to the feed. */
    let prevFrame = 0;
    function frame(now) {
        st.raf = 0;
        const dt = prevFrame ? (now - prevFrame) / 1000 : 0;
        prevFrame = now;
        if (st.target == null) return;
        let v = st.shown - st.speed * dt;
        const err = st.target - v;
        // Ease toward the feed value (a fresh sample) without jumping backwards visibly.
        if (Math.abs(err) > 25) v = st.target;
        else v += err * Math.min(1, dt * 1.5);
        st.shown = Math.max(0, v);
        const m = Math.ceil(st.shown);
        const text = m.toLocaleString('en-NZ');
        if (valueEl.textContent !== text) valueEl.textContent = text;
        strip.classList.toggle('dtg-strip--finish', m <= 100);
        if (st.shown > 0 || st.target > 0) st.raf = requestAnimationFrame(frame);
    }

    function leader(metresCovered) {
        setTarget(cfg.course - Number(metresCovered));
    }

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
        let covered = 0;
        const t0 = performance.now();
        st.demo = setInterval(() => {
            const t = (performance.now() - t0) / 1000;
            covered = Math.min(cfg.course, t * (5.4 + 0.3 * Math.sin(t / 7)));
            leader(covered);
            if (covered >= cfg.course) { clearInterval(st.demo); st.demo = 0; }
        }, 1000); // feed cadence: the count runs on between samples
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

    window.RowingDtg = { set: setTarget, leader, apply, show, hide, demo, place, cfg };

    // ---------- boot ----------
    document.documentElement.style.setProperty('--dtg-strip-opacity', String(num('opacity', 0.35)));
    document.documentElement.style.setProperty('--dtg-text-opacity', String(num('text', 0.9)));
    place();
    setTarget(cfg.course);
    if (q.get('guides') === '1') body.classList.add('dtg--guides');
    if (q.get('bg') === '1') body.classList.add('rl3--preview-bg');
    if (q.get('demo') === '1') demo(true);
    if (q.get('data')) poll(q.get('data'), Math.max(200, num('poll', 1000)));
    if (q.get('auto') !== '0') requestAnimationFrame(show);
})();
