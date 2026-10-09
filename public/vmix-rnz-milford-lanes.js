/**
 * RNZ Milford — lane cards + docked lower third (vMix browser source).
 *
 * Eight fixed-lane cards down the right edge (rowsuit + short crew name + lane
 * number). A card opens for 8 s when that crew makes a "move" — faster than its
 * place neighbours over the last 100 m — showing split /500m, rating and 1–3
 * orange chevrons. Gold / silver / bronze positions get a small dot. At each
 * 500 m mark a lightning bolt replaces the rowsuit for 5 s on crews whose last
 * 500 m split beats the Gold Standard. The lower third docks to the Milford logo
 * bottom-right and slides out from behind it.
 *
 * Driven by vmix-graphics.js (graphic `lanes`, key E) for intro/hold/outro and
 * daysheet crew names. Live timing reaches it through any of:
 *   MilfordLaneCards.feed({ t, lanes: [{ lane, dist, split, rate, place }] })
 *   MilfordLaneCards.setState({ openLane, moveLevel, boltOn, goldStandard, lanes })
 *   document.dispatchEvent(new CustomEvent('altitudehd:lanecards', { detail }))
 *   localStorage 'altitudeHdLaneCards_v1' (cross-tab, JSON of the same detail)
 *   window.postMessage({ type: 'altitudehd:lanecards', ...detail })
 * detail = { feed: {...} } | { state: {...} } | { open: lane, level } | { bolt: bool }
 * Operator keys while on air: 1–8 open a card for 8 s, 0 closes, B toggles bolt.
 * `?demo=1` runs the reference sequence (in → move → 8 s hold → close → 5 s → out).
 */
(function (global) {
    const INTRO_MS = 2000;
    const OUTRO_MS = 2100;
    const MOVE_HOLD_MS = 8000;
    const BOLT_MS = 5000;
    const LANE_COUNT = 8;
    const LS_KEY = 'altitudeHdLaneCards_v1';
    const EVENT_NAME = 'altitudehd:lanecards';
    const MSG_TYPE = 'altitudehd:lanecards';

    /** Tunables — operators can override via MilfordLaneCards.config.x = y. */
    const config = {
        /** % faster than the quicker place neighbour (last 100 m) → chevron count. */
        moveLevels: [1, 2.5, 4],
        /** Window for the "move" speed comparison (m). */
        moveWindowM: 100,
        /** Don't re-open the same lane within this many ms of its last move. */
        moveCooldownMs: 30000,
        /** Ignore moves before the crews have covered this distance (m). */
        moveMinDistM: 150,
        /** Distance mark interval for the bolt check (m). */
        boltIntervalM: 500,
        /** Default Gold Standard split (s /500m) when no race value is set. */
        goldStandard: null,
    };

    const MEDAL_COLOR = { gold: '#EFC728', silver: '#B8C0C4', bronze: '#EDA062' };
    const MEDAL_BY_PLACE = { 1: 'gold', 2: 'silver', 3: 'bronze' };

    /** Flat rowsuit palettes used until club artwork arrives (deterministic by club id). */
    const SUIT_PALETTE = [
        ['#1B2A5B', '#FFFFFF'],
        ['#6B1E3A', '#8EC5E8'],
        ['#0B6B3A', '#FFFFFF'],
        ['#B51C2B', '#111111'],
        ['#0E2A5A', '#7FB3E0'],
        ['#111111', '#FFFFFF'],
        ['#C8102E', '#FFFFFF'],
        ['#0A3A6B', '#F4C542'],
        ['#2F6F3E', '#F4C542'],
        ['#5B2C83', '#FFFFFF'],
        ['#003B5C', '#E47126'],
        ['#7A1F1F', '#F2D16B'],
    ];

    const SUIT_PATH =
        'M9 1H16V9A4 4 0 0 0 24 9V1H31V17L34 25V55H22.5L20 40L17.5 55H6V25L9 17Z';
    const BOLT_PATH = 'M14 0 L0 23 H9 L6 40 L22 15 H12 Z';

    let root = null;
    let rows = [];
    let lt = null;
    let activeRace = null;
    let visible = false;
    let demoTimers = [];
    let moveTimer = null;
    let boltTimer = null;
    let outroTimer = null;

    /** Per-lane presentation state (what is on screen). */
    const laneState = new Map();
    /** Per-lane timing history for feed-driven moves/bolts. */
    const laneHist = new Map();

    const state = {
        openLane: 0,
        moveLevel: 3,
        boltOn: false,
        goldStandard: null,
        boltLanes: new Set(),
    };

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text != null) e.textContent = text;
        return e;
    }

    function svgEl(tag, attrs) {
        const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
        return e;
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function params() {
        return new URLSearchParams(location.search);
    }

    function hashStr(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h;
    }

    function suitColours(lane) {
        if (lane.c1) return [lane.c1, lane.c2 || '#FFFFFF'];
        const key = String(lane.clubId || lane.code || lane.lane || '');
        return SUIT_PALETTE[hashStr(key) % SUIT_PALETTE.length];
    }

    const SHORT_NAME_RULES = [
        [/\bBoys'?\s+High\s+School\b/i, 'BHS'],
        [/\bGirls'?\s+High\s+School\b/i, 'GHS'],
        [/\bHigh\s+School\b/i, 'HS'],
        [/\bGrammar\s+School\b/i, 'GS'],
        [/\bRowing\s+Club\b/i, ''],
        [/\bRowing\b/i, ''],
        [/\bCollege\b/i, ''],
        [/\bSchool\b/i, ''],
    ];

    /** "Hamilton Boys' High School" → "Hamilton BHS"; "Christ's College" → "Christ's". */
    function shortName(name) {
        let s = String(name || '').trim();
        if (!s) return '';
        for (const [re, rep] of SHORT_NAME_RULES) s = s.replace(re, rep);
        s = s.replace(/\s{2,}/g, ' ').replace(/\s+$/, '').trim();
        return s || String(name).trim();
    }

    function toSec(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const s = String(v).trim();
        const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
        if (m) return Number(m[1]) * 60 + Number(m[2]);
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }

    function fmtSplit(sec) {
        if (!Number.isFinite(sec) || sec <= 0) return '—';
        const m = Math.floor(sec / 60);
        const r = sec - m * 60;
        return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
    }

    function clampLane(n) {
        const v = parseInt(String(n), 10);
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(LANE_COUNT, v));
    }

    function clampLevel(n) {
        const v = parseInt(String(n), 10);
        if (!Number.isFinite(v)) return 3;
        return Math.max(1, Math.min(3, v));
    }

    /* ── DOM ─────────────────────────────────────────────────────────────── */

    function buildSuit(c1, c2, lane) {
        const svg = svgEl('svg', {
            class: 'mf-lane-suit',
            width: '38',
            height: '54',
            viewBox: '0 0 40 56',
            'aria-hidden': 'true',
        });
        const clipId = `mfSuitClip${lane}`;
        const clip = svgEl('clipPath', { id: clipId });
        clip.appendChild(svgEl('path', { d: SUIT_PATH }));
        svg.appendChild(clip);
        svg.appendChild(svgEl('path', { d: SUIT_PATH, fill: c1, class: 'mf-lane-suit-body' }));
        svg.appendChild(
            svgEl('rect', {
                x: '0',
                y: '26',
                width: '40',
                height: '8',
                fill: c2,
                'clip-path': `url(#${clipId})`,
                class: 'mf-lane-suit-band',
            }),
        );
        return svg;
    }

    function buildBolt() {
        const wrap = el('div', 'mf-lane-bolt');
        const svg = svgEl('svg', {
            width: '28',
            height: '50',
            viewBox: '0 0 22 40',
            'aria-hidden': 'true',
        });
        svg.appendChild(svgEl('path', { d: BOLT_PATH, fill: '#E47126' }));
        wrap.appendChild(svg);
        return wrap;
    }

    function buildRow(laneNum) {
        const row = el('div', 'mf-lane-row');
        row.dataset.lane = String(laneNum);
        row.style.setProperty('--mf-lc-dy', `${892 - 88 * laneNum}px`);
        row.style.setProperty('--mf-lc-rise-delay', `${300 + (LANE_COUNT - laneNum) * 90}ms`);
        row.style.setProperty('--mf-lc-fall-delay', `${(laneNum - 1) * 90}ms`);

        const chev = el('div', 'mf-lane-chev', '›››');
        chev.setAttribute('aria-hidden', 'true');
        row.appendChild(chev);

        const card = el('div', 'mf-lane-card');
        card.appendChild(el('div', 'mf-lane-hair mf-lane-hair--top'));
        card.appendChild(el('div', 'mf-lane-hair mf-lane-hair--bottom'));
        card.appendChild(el('div', 'mf-lane-medal'));
        card.appendChild(el('div', 'mf-lane-name'));

        const data = el('div', 'mf-lane-data');
        const splitWrap = el('div', 'mf-lane-split');
        splitWrap.appendChild(el('span', 'mf-lane-split-value', '—'));
        splitWrap.appendChild(el('span', 'mf-lane-split-unit', '/500m'));
        data.appendChild(splitWrap);
        data.appendChild(el('div', 'mf-lane-rate', '—'));
        card.appendChild(data);

        const tab = el('div', 'mf-lane-tab');
        const suitHost = el('div', 'mf-lane-suit-host');
        tab.appendChild(suitHost);
        tab.appendChild(buildBolt());
        tab.appendChild(el('div', 'mf-lane-num', String(laneNum)));
        card.appendChild(tab);
        row.appendChild(card);

        return {
            lane: laneNum,
            row,
            card,
            chev,
            medal: card.querySelector('.mf-lane-medal'),
            name: card.querySelector('.mf-lane-name'),
            splitValue: card.querySelector('.mf-lane-split-value'),
            rate: card.querySelector('.mf-lane-rate'),
            suitHost,
        };
    }

    function buildLowerThird() {
        const wrap = el('div', 'mf-lanes-lt');
        const mask = el('div', 'mf-lanes-lt-mask');
        const plate = el('div', 'mf-lanes-lt-plate');

        const left = el('div', 'mf-lanes-lt-left');
        const raceWrap = el('div', 'mf-lanes-lt-race');
        raceWrap.appendChild(el('span', 'mf-lanes-lt-race-label', 'RACE'));
        raceWrap.appendChild(el('span', 'mf-lanes-lt-race-num', ''));
        left.appendChild(raceWrap);
        left.appendChild(el('div', 'mf-lanes-lt-event', ''));
        plate.appendChild(left);

        plate.appendChild(el('div', 'mf-lanes-lt-divider'));

        const right = el('div', 'mf-lanes-lt-right');
        const gold = el('div', 'mf-lanes-lt-gold');
        gold.appendChild(el('span', 'mf-lanes-lt-gold-label', 'GOLD STANDARD'));
        const goldVal = el('span', 'mf-lanes-lt-gold-value');
        goldVal.appendChild(el('span', 'mf-lanes-lt-gold-split', '—'));
        goldVal.appendChild(el('span', 'mf-lanes-lt-gold-unit', '/500m'));
        gold.appendChild(goldVal);
        right.appendChild(gold);
        right.appendChild(el('div', 'mf-lanes-lt-chip', ''));
        plate.appendChild(right);

        mask.appendChild(plate);
        wrap.appendChild(mask);

        const logo = el('div', 'mf-lanes-lt-logo');
        const img = document.createElement('img');
        img.src = 'assets/vmix/milford/milford-colour.png';
        img.alt = 'Milford';
        img.className = 'mf-lanes-lt-logo-img';
        logo.appendChild(img);
        wrap.appendChild(logo);

        return {
            wrap,
            plate,
            raceNum: raceWrap.querySelector('.mf-lanes-lt-race-num'),
            event: left.querySelector('.mf-lanes-lt-event'),
            divider: plate.querySelector('.mf-lanes-lt-divider'),
            gold,
            goldSplit: goldVal.querySelector('.mf-lanes-lt-gold-split'),
            chip: right.querySelector('.mf-lanes-lt-chip'),
        };
    }

    function ensureRoot() {
        if (root) return root;
        const host = document.querySelector('.vg-stage') || document.body;
        root = el('div', 'mf-lanes');
        root.id = 'mfLanesRoot';
        root.setAttribute('role', 'img');
        root.setAttribute('aria-label', 'Lane cards');
        root.appendChild(el('div', 'mf-lanes-fade'));

        const stack = el('div', 'mf-lanes-stack');
        rows = [];
        for (let n = 1; n <= LANE_COUNT; n++) {
            const r = buildRow(n);
            rows.push(r);
            stack.appendChild(r.row);
        }
        root.appendChild(stack);

        lt = buildLowerThird();
        root.appendChild(lt.wrap);
        host.appendChild(root);
        return root;
    }

    /* ── Race context → cards ────────────────────────────────────────────── */

    function chipLabel(race) {
        if (!race) return '';
        if (race.chip) return String(race.chip).toUpperCase();
        const round = String(race.round || '').trim().toLowerCase();
        const div = String(race.division || '').trim().toUpperCase();
        if (/final/.test(round)) return div ? `${div}-FINAL` : 'FINAL';
        if (/heat/.test(round)) return div ? `HEAT ${div}` : 'HEAT';
        if (/rep/.test(round)) return div ? `REP ${div}` : 'REPECHAGE';
        if (/semi/.test(round)) return div ? `SEMI ${div}` : 'SEMI-FINAL';
        const label = [round, div].filter(Boolean).join(' ');
        return label.toUpperCase();
    }

    function applyRace(race) {
        activeRace = race || null;
        if (!root) return;
        const byLane = new Map();
        for (const l of race?.lanes || []) {
            const n = clampLane(l.lane);
            if (n) byLane.set(n, l);
        }
        /* Two crews from one club in a race → "North Shore 1" / "North Shore 2". */
        const clubCount = new Map();
        for (const l of byLane.values()) {
            const id = l.clubId || l.code;
            if (id) clubCount.set(id, (clubCount.get(id) || 0) + 1);
        }
        for (const r of rows) {
            const entry = byLane.get(r.lane);
            const has = !!entry && !!(entry.name || entry.code);
            r.row.classList.toggle('is-empty', !has);
            let name = has ? entry.shortName || shortName(entry.name) || entry.code : '';
            if (has && !entry.shortName && entry.crewNum && clubCount.get(entry.clubId || entry.code) > 1) {
                name = `${name} ${entry.crewNum}`;
            }
            r.name.textContent = name;
            const [c1, c2] = suitColours(entry || { lane: r.lane });
            r.suitHost.replaceChildren(buildSuit(c1, c2, r.lane));
            const ls = laneState.get(r.lane) || {};
            if (!ls.split) r.splitValue.textContent = '—';
            if (ls.rate == null) r.rate.textContent = '—';
        }
        if (race?.goldStandard != null) state.goldStandard = toSec(race.goldStandard);
        else if (state.goldStandard == null && config.goldStandard != null) {
            state.goldStandard = toSec(config.goldStandard);
        }
        lt.raceNum.textContent = race?.raceNum != null ? String(race.raceNum) : race?.race || '';
        lt.event.textContent = race?.event || '';
        const chip = chipLabel(race);
        lt.chip.textContent = chip;
        lt.chip.hidden = !chip;
        renderGold();
    }

    function renderGold() {
        const gs = state.goldStandard;
        const has = Number.isFinite(gs) && gs > 0;
        lt.gold.hidden = !has;
        lt.goldSplit.textContent = has ? fmtSplit(gs) : '—';
        const chipShown = !lt.chip.hidden;
        lt.divider.hidden = !has && !chipShown;
    }

    /* ── Presentation state ──────────────────────────────────────────────── */

    function renderLane(r) {
        const ls = laneState.get(r.lane) || {};
        const open = state.openLane === r.lane && !r.row.classList.contains('is-empty');
        const wasOpen = r.card.classList.contains('is-open');
        r.card.classList.toggle('is-open', open);
        r.row.classList.toggle('is-open', open);
        r.chev.textContent = '›'.repeat(clampLevel(ls.level ?? state.moveLevel));
        if (open && !wasOpen && visible) {
            r.card.classList.remove('is-nudge');
            void r.card.offsetWidth;
            r.card.classList.add('is-nudge');
        }
        if (!open) r.card.classList.remove('is-nudge');

        const medal = ls.medal || (ls.place ? MEDAL_BY_PLACE[ls.place] : null);
        r.medal.hidden = !medal;
        r.medal.style.background = medal ? MEDAL_COLOR[medal] : 'transparent';
        r.medal.dataset.medal = medal || '';

        r.splitValue.textContent = fmtSplit(ls.split);
        r.rate.textContent = ls.rate != null && Number.isFinite(ls.rate) ? String(Math.round(ls.rate)) : '—';

        const bolt = state.boltOn && state.boltLanes.has(r.lane);
        r.row.classList.toggle('is-bolt', bolt);
    }

    function renderAll() {
        if (!root) return;
        for (const r of rows) renderLane(r);
    }

    function recomputeBoltLanes() {
        const gs = state.goldStandard;
        state.boltLanes.clear();
        if (!Number.isFinite(gs) || gs <= 0) return;
        for (const [lane, ls] of laneState) {
            const split = Number.isFinite(ls.split500) ? ls.split500 : ls.split;
            if (Number.isFinite(split) && split > 0 && split < gs) state.boltLanes.add(lane);
        }
    }

    function clearMoveTimer() {
        if (moveTimer) {
            clearTimeout(moveTimer);
            moveTimer = null;
        }
    }

    /** Operator / feed: open a lane card for the move hold (8 s), then close. */
    function openLane(lane, level, holdMs) {
        const n = clampLane(lane);
        clearMoveTimer();
        if (!n) {
            state.openLane = 0;
            renderAll();
            return;
        }
        const ls = laneState.get(n) || {};
        ls.level = clampLevel(level ?? state.moveLevel);
        laneState.set(n, ls);
        state.openLane = n;
        renderAll();
        const ms = Number.isFinite(holdMs) ? holdMs : MOVE_HOLD_MS;
        if (ms > 0) {
            moveTimer = setTimeout(() => {
                moveTimer = null;
                if (state.openLane === n) {
                    state.openLane = 0;
                    renderAll();
                }
            }, ms);
        }
    }

    function closeLane() {
        openLane(0);
    }

    /** Bolt window: on for BOLT_MS (or until setBolt(false)). */
    function setBolt(on, ms) {
        if (boltTimer) {
            clearTimeout(boltTimer);
            boltTimer = null;
        }
        state.boltOn = !!on;
        if (state.boltOn) {
            recomputeBoltLanes();
            const dur = Number.isFinite(ms) ? ms : BOLT_MS;
            if (dur > 0) {
                boltTimer = setTimeout(() => {
                    boltTimer = null;
                    state.boltOn = false;
                    renderAll();
                }, dur);
            }
        }
        renderAll();
    }

    /**
     * Explicit state from the timing system / operator panel.
     * { openLane, moveLevel, boltOn, goldStandard, lanes: [{ lane, split, rate, place, medal, c1, c2, name }] }
     */
    function setState(next) {
        if (!next || typeof next !== 'object') return;
        ensureRoot();
        if (next.goldStandard !== undefined) {
            state.goldStandard = toSec(next.goldStandard);
            renderGold();
        }
        if (next.moveLevel != null) state.moveLevel = clampLevel(next.moveLevel);
        if (Array.isArray(next.lanes)) {
            for (const l of next.lanes) {
                const n = clampLane(l.lane);
                if (!n) continue;
                const ls = laneState.get(n) || {};
                if (l.split !== undefined) ls.split = toSec(l.split);
                if (l.split500 !== undefined) ls.split500 = toSec(l.split500);
                if (l.rate !== undefined) ls.rate = l.rate == null ? null : Number(l.rate);
                if (l.place !== undefined) ls.place = l.place == null ? null : Number(l.place);
                if (l.medal !== undefined) ls.medal = l.medal || null;
                laneState.set(n, ls);
                const r = rows[n - 1];
                if (r && (l.name || l.c1)) {
                    if (l.name) r.name.textContent = l.shortName || shortName(l.name);
                    if (l.c1) r.suitHost.replaceChildren(buildSuit(l.c1, l.c2 || '#FFFFFF', n));
                    r.row.classList.remove('is-empty');
                }
            }
        }
        if (next.openLane !== undefined) {
            if (next.openLane) openLane(next.openLane, next.moveLevel, next.holdMs);
            else closeLane();
        }
        if (next.boltOn !== undefined) setBolt(!!next.boltOn, next.boltMs);
        else if (state.boltOn) recomputeBoltLanes();
        renderAll();
    }

    /* ── Timing feed → moves, medals, bolts ──────────────────────────────── */

    function histFor(lane) {
        let h = laneHist.get(lane);
        if (!h) {
            h = { samples: [], nextMark: config.boltIntervalM, markTimes: [] };
            laneHist.set(lane, h);
        }
        return h;
    }

    /** Time (ms) at which the crew passed `dist`, interpolated from samples. */
    function timeAtDist(samples, dist) {
        for (let i = samples.length - 1; i > 0; i--) {
            const a = samples[i - 1];
            const b = samples[i];
            if (a.d <= dist && b.d >= dist) {
                if (b.d === a.d) return b.t;
                return a.t + ((dist - a.d) / (b.d - a.d)) * (b.t - a.t);
            }
        }
        return null;
    }

    /** Average speed (m/s) over the last `window` metres, or null. */
    function speedOverLast(samples, window) {
        if (samples.length < 2) return null;
        const last = samples[samples.length - 1];
        const t0 = timeAtDist(samples, last.d - window);
        if (t0 == null || last.t <= t0) return null;
        return window / ((last.t - t0) / 1000);
    }

    /**
     * Live progress sample: { t?: ms, lanes: [{ lane, dist (m), split?, rate?, place? }] }
     * Computes last-100 m speeds, standings, moves vs place neighbours and
     * 500 m bolt windows. Explicit split/rate/place in the sample win over
     * derived values.
     */
    function feed(sample) {
        if (!sample || !Array.isArray(sample.lanes)) return;
        ensureRoot();
        const now = Number.isFinite(sample.t) ? sample.t : Date.now();
        const gs = Number.isFinite(sample.goldStandard) ? sample.goldStandard : state.goldStandard;
        const live = [];
        for (const l of sample.lanes) {
            const n = clampLane(l.lane);
            if (!n) continue;
            const ls = laneState.get(n) || {};
            const dist = Number(l.dist);
            const h = histFor(n);
            if (Number.isFinite(dist)) {
                const prev = h.samples[h.samples.length - 1];
                if (!prev || dist >= prev.d) {
                    h.samples.push({ t: now, d: dist });
                    if (h.samples.length > 600) h.samples.splice(0, h.samples.length - 600);
                }
                /* Bolt: crossed the next 500 m mark → split for that 500. */
                while (dist >= h.nextMark) {
                    const tMark = timeAtDist(h.samples, h.nextMark) ?? now;
                    const tPrev = h.markTimes.length
                        ? h.markTimes[h.markTimes.length - 1]
                        : timeAtDist(h.samples, 0) ?? h.samples[0].t;
                    const split500 = ((tMark - tPrev) / 1000) * (500 / config.boltIntervalM);
                    ls.split500 = split500;
                    h.markTimes.push(tMark);
                    h.nextMark += config.boltIntervalM;
                    if (Number.isFinite(gs) && gs > 0 && split500 > 0 && split500 < gs) {
                        ls.boltUntil = now + BOLT_MS;
                    }
                }
            }
            const speed = speedOverLast(h.samples, config.moveWindowM);
            ls.speed = speed;
            ls.split = l.split != null ? toSec(l.split) : speed ? 500 / speed : ls.split;
            if (l.rate !== undefined) ls.rate = l.rate == null ? null : Number(l.rate);
            if (l.place !== undefined) ls.place = l.place == null ? null : Number(l.place);
            else if (Number.isFinite(dist)) ls.placeFromDist = dist;
            laneState.set(n, ls);
            live.push({ lane: n, ls, dist });
        }

        /* Standings by distance when the feed doesn't give places. */
        const needPlaces = live.some((x) => x.ls.place == null);
        if (needPlaces) {
            const ranked = live
                .filter((x) => Number.isFinite(x.dist))
                .sort((a, b) => b.dist - a.dist);
            ranked.forEach((x, i) => {
                if (x.ls.place == null) x.ls.derivedPlace = i + 1;
            });
        }
        const placeOf = (x) => (x.ls.place != null ? x.ls.place : x.ls.derivedPlace);
        for (const x of live) {
            if (x.ls.place == null && x.ls.derivedPlace != null) {
                x.ls.medal = MEDAL_BY_PLACE[x.ls.derivedPlace] || null;
            } else if (x.ls.place != null) {
                x.ls.medal = MEDAL_BY_PLACE[x.ls.place] || null;
            }
        }

        /* Bolt window from the 500 m marks. */
        const boltNow = live.some((x) => Number.isFinite(x.ls.boltUntil) && x.ls.boltUntil > now);
        state.boltLanes.clear();
        for (const x of live) {
            if (Number.isFinite(x.ls.boltUntil) && x.ls.boltUntil > now) state.boltLanes.add(x.lane);
        }
        state.boltOn = boltNow;

        /* Move: faster than both place neighbours over the last 100 m. */
        if (!state.openLane) {
            const byPlace = new Map();
            for (const x of live) {
                const p = placeOf(x);
                if (p != null) byPlace.set(p, x);
            }
            let best = null;
            for (const x of live) {
                const p = placeOf(x);
                if (p == null || !Number.isFinite(x.ls.speed)) continue;
                if (Number.isFinite(x.dist) && x.dist < config.moveMinDistM) continue;
                if (x.ls.lastMoveAt && now - x.ls.lastMoveAt < config.moveCooldownMs) continue;
                const ahead = byPlace.get(p - 1);
                const behind = byPlace.get(p + 1);
                const rivals = [ahead, behind].filter((r) => r && Number.isFinite(r.ls.speed));
                if (!rivals.length) continue;
                const fastestRival = Math.max(...rivals.map((r) => r.ls.speed));
                const gainPct = ((x.ls.speed - fastestRival) / fastestRival) * 100;
                if (gainPct < config.moveLevels[0]) continue;
                let level = 1;
                if (gainPct >= config.moveLevels[2]) level = 3;
                else if (gainPct >= config.moveLevels[1]) level = 2;
                if (!best || gainPct > best.gainPct) best = { lane: x.lane, level, gainPct };
            }
            if (best) {
                state.moveLevel = best.level;
                openLane(best.lane, best.level);
                /* Cooldown runs on feed time (may be replay / simulated clock). */
                const ls = laneState.get(best.lane);
                if (ls) ls.lastMoveAt = now;
                return;
            }
        }
        renderAll();
    }

    /* ── Show / hide ─────────────────────────────────────────────────────── */

    function clearDemo() {
        demoTimers.forEach(clearTimeout);
        demoTimers = [];
    }

    function resetTimers() {
        clearDemo();
        clearMoveTimer();
        if (boltTimer) {
            clearTimeout(boltTimer);
            boltTimer = null;
        }
        if (outroTimer) {
            clearTimeout(outroTimer);
            outroTimer = null;
        }
    }

    /**
     * Reference sequence: in → bolt at 500 m (t≈3.2 s, 5 s) → move at t≈2.6 s
     * (8 s hold) → close → 5 s → out. Resolves when the sequence has finished.
     */
    function demo(opts = {}) {
        clearDemo();
        const t = (fn, ms) => demoTimers.push(setTimeout(fn, ms));
        const lane = clampLane(opts.lane ?? params().get('openLane') ?? 4) || 4;
        const level = clampLevel(opts.level ?? params().get('moveLevel') ?? 3);
        t(() => openLane(lane, level, MOVE_HOLD_MS), 2600);
        t(() => setBolt(true, BOLT_MS), 3200);
        const outAt = 2600 + MOVE_HOLD_MS + 900 + 5000;
        if (opts.out !== false) {
            t(() => {
                if (global.VmixGraphics?.triggerOut) global.VmixGraphics.triggerOut();
                else hide();
            }, outAt);
        }
        return outAt;
    }

    async function show(opts = {}) {
        ensureRoot();
        resetTimers();
        visible = false;
        root.classList.remove('is-out', 'is-in', 'is-hold');
        if (opts.race) applyRace(opts.race);
        else if (activeRace) applyRace(activeRace);
        if (opts.state) setState(opts.state);
        renderAll();
        void root.offsetWidth;
        root.classList.add('is-visible', 'is-in');
        visible = true;
        const demoOn = opts.demo ?? params().get('demo') === '1';
        if (demoOn) demo(opts.demoOpts);
        await wait(INTRO_MS);
        if (root) root.classList.add('is-hold');
    }

    async function hide() {
        resetTimers();
        if (!root) return;
        state.openLane = 0;
        state.boltOn = false;
        renderAll();
        root.classList.remove('is-in', 'is-hold');
        root.classList.add('is-out');
        await wait(OUTRO_MS);
        if (root) root.classList.remove('is-visible', 'is-out');
        visible = false;
    }

    function remove() {
        resetTimers();
        visible = false;
        state.openLane = 0;
        state.boltOn = false;
        state.boltLanes.clear();
        laneState.clear();
        laneHist.clear();
        if (root) {
            root.remove();
            root = null;
            rows = [];
            lt = null;
        }
    }

    /** Race changed on air (n / p or hub live race) — swap names, keep state. */
    function updateRace(race) {
        if (!race) return;
        if (!root) {
            activeRace = race;
            return;
        }
        applyRace(race);
        renderAll();
    }

    function isActive() {
        return !!root && visible;
    }

    /* ── External control channels ───────────────────────────────────────── */

    function handleDetail(detail) {
        if (!detail || typeof detail !== 'object') return;
        if (detail.feed) feed(detail.feed);
        if (detail.state) setState(detail.state);
        if (detail.open !== undefined) {
            if (detail.open) openLane(detail.open, detail.level, detail.holdMs);
            else closeLane();
        }
        if (detail.bolt !== undefined) setBolt(!!detail.bolt, detail.boltMs);
        if (detail.goldStandard !== undefined) setState({ goldStandard: detail.goldStandard });
    }

    document.addEventListener(EVENT_NAME, (e) => {
        if (isActive()) handleDetail(e.detail);
    });
    window.addEventListener('storage', (e) => {
        if (e.key !== LS_KEY || !e.newValue || !isActive()) return;
        try {
            handleDetail(JSON.parse(e.newValue));
        } catch {
            /* ignore */
        }
    });
    window.addEventListener('message', (e) => {
        if (e.data?.type !== MSG_TYPE || !isActive()) return;
        handleDetail(e.data);
    });

    /** Operator keys (vmix-graphics.js calls this while the graphic is on air). */
    function onKey(key) {
        const k = String(key || '').toLowerCase();
        if (k >= '1' && k <= '8') {
            const n = parseInt(k, 10);
            if (state.openLane === n) closeLane();
            else openLane(n, state.moveLevel);
            return true;
        }
        if (k === '0') {
            closeLane();
            return true;
        }
        if (k === 'b') {
            setBolt(!state.boltOn);
            return true;
        }
        return false;
    }

    global.MilfordLaneCards = {
        INTRO_MS,
        OUTRO_MS,
        MOVE_HOLD_MS,
        BOLT_MS,
        LANE_COUNT,
        LS_KEY,
        EVENT_NAME,
        config,
        show,
        hide,
        remove,
        updateRace,
        setState,
        feed,
        openLane,
        closeLane,
        setBolt,
        demo,
        onKey,
        isActive,
        shortName,
        getState: () => ({
            openLane: state.openLane,
            moveLevel: state.moveLevel,
            boltOn: state.boltOn,
            goldStandard: state.goldStandard,
            boltLanes: [...state.boltLanes],
            lanes: [...laneState.entries()].map(([lane, ls]) => ({ lane, ...ls })),
        }),
    };
})(window);
