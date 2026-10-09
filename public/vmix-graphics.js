/**
 * vMix broadcast graphics — title, lower third, draw, results, leader, tracker.
 * Keys: d/l/r/t = play in · w = leader · x = CV leader (KRI/Karāpiro) · h = CV draw boats · u = course underlay · s = schedule · v = speed chart · k = live tracking · m = weather · g = tracker (Milford) · e = lane cards (Milford) · 1–8 = leader lane (lane cards: open card, 0 close, b bolt) · n/p = next/prev race · o = out · c = clear.
 * URL: ?g=d  &race=1  &regatta=nzmm2026  (&autoplay=1 to run in on load)
 */
const VG_GRAPHIC_ALIASES = {
    t: 'title',
    title: 'title',
    d: 'draw',
    draw: 'draw',
    l: 'lower',
    lower: 'lower',
    r: 'results',
    results: 'results',
    w: 'leader',
    leader: 'leader',
    x: 'cvleader',
    cvleader: 'cvleader',
    h: 'cvdraw',
    cvdraw: 'cvdraw',
    u: 'coursescroll',
    coursescroll: 'coursescroll',
    course: 'coursescroll',
    s: 'schedule',
    g: 'speed',
    map: 'speed',
    gps: 'speed',
    v: 'speedchart',
    speedchart: 'speedchart',
    chart: 'speedchart',
    m: 'weather',
    weather: 'weather',
    meteo: 'weather',
    k: 'livetracking',
    livetracking: 'livetracking',
    livetrack: 'livetracking',
    track: 'livetracking',
    tracking: 'livetracking',
    schedule: 'schedule',
    upcoming: 'schedule',
    drill: 'drill',
    drilldown: 'drill',
    crew: 'drill',
    suits: 'suits',
    rowsuits: 'suits',
    suitstrip: 'suitstrip',
    rowsuitstrip: 'suitstrip',
    lowersuits: 'lowersuits',
    l3suits: 'lowersuits',
    brand: 'brand',
    watermark: 'brand',
    nextrace: 'next',
    next: 'next',
    previous: 'prev',
    previousrace: 'prev',
    prev: 'prev',
    tracker: 'tracker',
    e: 'lanes',
    lanes: 'lanes',
    lanecards: 'lanes',
    lanecard: 'lanes',
};

/** Theme-aware shortcut → graphic (KRI / Karāpiro schedule on s). */
function vgGraphicFromShortcut(key) {
    const k = String(key || '').toLowerCase();
    if (k === 's' && vgIsCssOverlayTheme()) return 'schedule';
    if (k === 'x' && vgIsCssOverlayTheme()) return 'cvleader';
    if (k === 'h' && vgIsCssOverlayTheme()) return 'cvdraw';
    if (k === 'u' && vgIsCssOverlayTheme()) return 'coursescroll';
    if (k === 'm' && vgIsCssOverlayTheme()) return 'weather';
    if (vgIsKarapiroTheme()) {
        if (k === 'a') return 'suitstrip';
        if (k === 'f') return 'lowersuits';
        if (k === 'b') return 'brand';
        if (k === 'q') return 'speedchart';
        if (k === 'y') return 'drill';
    }
    return VG_GRAPHIC_ALIASES[k] || null;
}

function vgResolveGraphicAlias(raw) {
    const key = String(raw || '').toLowerCase();
    return vgGraphicFromShortcut(key) || VG_GRAPHIC_ALIASES[key] || raw;
}

const VG_HOLD_MS = 3000;
const VG_OUTRO_MS = 3000;
const VG_KRI_FADE_MS = 1500;
const VG_MILFORD_FADE_MS = 500;
const VG_KARAPIRO_FADE_MS = 700;

const vgPlayback = {
    state: 'idle',
    graphic: null,
    introTimer: null,
    outroTimer: null,
    profileTimers: [],
    onVideoEnded: null,
    videoHoldTime: null,
};

/** True while CSV refresh rebuilds a graphic already on hold (skip intro motion). */
let vgHoldRefreshing = false;

const VG_THEMES = {
    kri: {
        label: 'KRI',
        backgrounds: {},
    },
    karapiro: {
        label: 'Karāpiro (Ged)',
        backgrounds: {},
    },
    'rnz-milford': {
        label: 'RNZ Milford',
        videoGraphics: true,
        backgrounds: {
            speed: 'assets/vmix/milford/tracker.webm',
            lower: 'assets/vmix/milford/lower.webm',
            draw: 'assets/vmix/milford/draw.webm',
            results: 'assets/vmix/milford/results.webm',
            leader: 'assets/vmix/milford/leader.webm',
        },
    },
    'beachsprints-milford': {
        label: 'Beach Sprints Milford',
        videoGraphics: true,
        backgrounds: {
            draw: 'assets/vmix/beachsprints/draw.webm',
            lower: 'assets/vmix/beachsprints/lower.webm',
        },
    },
};

const VG_MONTHS = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
    november: 10, nov: 10, december: 11, dec: 11,
};

const vgState = {
    lookup: null,
    races: [],
    competitors: new Map(),
    results: new Map(),
    regattaCode: 'nzmm2026',
    regattaTitle: '',
    csvFingerprint: '',
};

function vgParseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (c === '"') inQ = false;
            else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') {
            out.push(cur);
            cur = '';
        } else cur += c;
    }
    out.push(cur);
    return out;
}

function vgParseDayHeader(line) {
    const m = line.match(
        /DAY\s+\d+:\s+\w+\s+(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
    );
    if (!m) return { date: null, label: line.trim() };
    const month = VG_MONTHS[m[2].toLowerCase()];
    if (month === undefined) return { date: null, label: line.trim() };
    return {
        date: new Date(parseInt(m[3], 10), month, parseInt(m[1], 10)),
        label: line.trim(),
    };
}

function vgParseRaceLabel(raw) {
    const s = String(raw || '').trim();
    const withParen = s.match(/^(\d+)\s*\(([^)]*)\)\s*$/);
    if (withParen) {
        const inner = withParen[2].trim();
        const letter = inner.match(/^[A-Za-z]$/);
        return {
            raceNum: parseInt(withParen[1], 10),
            label: letter
                ? `${withParen[1]} (${letter[0].toUpperCase()})`
                : withParen[1],
        };
    }
    const plain = s.match(/^(\d+)$/);
    if (plain) return { raceNum: parseInt(plain[1], 10), label: plain[1] };
    return { raceNum: null, label: s };
}

function vgIsCrewCell(raw) {
    const t = String(raw || '').trim();
    if (!t || t === '-' || /^-+\s*$/.test(t)) return false;
    if (/cancelled/i.test(t)) return false;
    return true;
}

function vgParseTimeOnDay(timeStr, dayDate) {
    const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || !dayDate) return null;
    return new Date(
        dayDate.getFullYear(),
        dayDate.getMonth(),
        dayDate.getDate(),
        parseInt(m[1], 10),
        parseInt(m[2], 10),
        0,
        0,
    );
}

function vgDaysheetColIndex(headerCols, name) {
    if (!headerCols?.length) return -1;
    const key = name.trim().toLowerCase();
    return headerCols.findIndex((h) => (h || '').trim().toLowerCase() === key);
}

function vgParseLanes(cols, headerCols) {
    if (headerCols?.length) {
        const lanes = [];
        for (let i = 0; i < headerCols.length; i++) {
            const h = (headerCols[i] || '').trim().toLowerCase();
            const m = h.match(/^lane[_\s-]?(\d+)$/);
            if (!m) continue;
            const code = (cols[i] || '').trim();
            if (!vgIsCrewCell(code)) continue;
            lanes.push({ lane: parseInt(m[1], 10), code });
        }
        lanes.sort((a, b) => a.lane - b.lane);
        if (lanes.length) return lanes;
        const hasLaneCols = headerCols.some((h) =>
            /^lane[_\s-]?\d+$/i.test((h || '').trim()),
        );
        if (!hasLaneCols) return [];
    }
    const lanes = [];
    for (let lane = 1; lane <= 9; lane++) {
        const idx = 5 + lane;
        if (idx >= cols.length - 1) break;
        const code = (cols[idx] || '').trim();
        lanes.push({ lane, code: vgIsCrewCell(code) ? code : null });
    }
    let lastUsed = 0;
    for (const l of lanes) if (l.code) lastUsed = l.lane;
    return lastUsed ? lanes.filter((l) => l.lane <= lastUsed) : lanes;
}

function vgParseDaysheet(text) {
    const races = [];
    let dayDate = null;
    let dayLabel = '';
    let headerCols = null;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            const day = vgParseDayHeader(trimmed);
            dayDate = day.date;
            dayLabel = day.label;
            headerCols = null;
            continue;
        }
        if (!dayDate) continue;
        if (/^Race,/i.test(trimmed)) {
            headerCols = vgParseCsvLine(trimmed);
            continue;
        }
        const cols = vgParseCsvLine(trimmed);
        const info = vgParseRaceLabel(cols[0]);
        if (!info.raceNum) continue;
        const startAt = vgParseTimeOnDay(cols[1], dayDate);
        if (!startAt) continue;
        races.push({
            raceNum: info.raceNum,
            race: info.label,
            startAt,
            eventNum: cols[2].trim(),
            eventType: cols[3].trim(),
            round: cols[4].trim(),
            division: cols[5] ? cols[5].trim() : '',
            lanes: vgParseLanes(cols, headerCols),
            progression: (() => {
                if (headerCols) {
                    const idx = vgDaysheetColIndex(headerCols, 'progression');
                    return idx >= 0 ? (cols[idx] || '').trim() : '';
                }
                return cols[cols.length - 1] ? cols[cols.length - 1].trim() : '';
            })(),
            dayLabel,
        });
    }
    races.sort((a, b) => a.startAt - b.startAt);
    return races;
}

function vgParseCompetitors(text) {
    const map = new Map();
    let dayDate = null;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^DAY\s+\d+:/i.test(trimmed)) {
            dayDate = vgParseDayHeader(trimmed).date;
            continue;
        }
        if (!dayDate || /^Race,/i.test(trimmed)) continue;
        const cols = vgParseCsvLine(trimmed);
        const info = vgParseRaceLabel(cols[0]);
        if (!info.raceNum) continue;
        const division = cols[5] ? cols[5].trim() : '';
        const eventNum = cols[2] ? cols[2].trim() : '';
        const key = `${info.label}|${division}|${eventNum}`;
        map.set(key, {
            race: info.label,
            raceNum: info.raceNum,
            division,
            eventNum,
            names: cols[6] ? cols[6].trim() : '',
        });
    }
    return map;
}

function vgParseResults(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !/^\d/.test(trimmed)) continue;
        const cols = vgParseCsvLine(trimmed);
        const raceNum = parseInt(cols[0], 10);
        if (!Number.isFinite(raceNum)) continue;
        const placings = [];
        for (let i = 6; i + 2 < cols.length; i += 3) {
            const place = parseInt(cols[i], 10);
            if (!Number.isFinite(place)) continue;
            placings.push({
                place,
                competitor: cols[i + 1].trim(),
                time: cols[i + 2].trim(),
            });
        }
        placings.sort((a, b) => a.place - b.place);
        map.set(raceNum, { status: cols[5].trim(), placings });
    }
    return map;
}

function vgRegattaTitle() {
    const named = String(vgState.regattaTitle || '').trim();
    if (named) return named;
    const code = String(vgState.regattaCode || vgGetRegattaCode() || '').trim();
    return code ? code.toUpperCase() : '';
}

async function vgLoadRegattaTitle(code) {
    const archive = window.RegattaCsvArchive;
    if (archive?.getRegattaDisplayName) {
        const name = await archive.getRegattaDisplayName(code);
        if (name) return name;
    }
    return String(code || '').toUpperCase();
}

function vgGetRegattaCode() {
    const p = new URLSearchParams(location.search);
    if (p.get('regatta')) return p.get('regatta').trim().toLowerCase();
    if (window.AltitudeHdHub?.getRegattaCode) {
        return window.AltitudeHdHub.getRegattaCode();
    }
    try {
        return localStorage.getItem('altitudeHdRegattaCode_v1') || 'nzmm2026';
    } catch {
        return 'nzmm2026';
    }
}

function vgGetCsvUrl(fileId) {
    if (window.AltitudeHdHub?.buildCsvUrl) {
        return window.AltitudeHdHub.buildCsvUrl(vgGetRegattaCode(), fileId);
    }
    const code = vgGetRegattaCode();
    return `https://l.rowit.nz/altitude/${code}/${fileId}.csv`;
}

function vgIsCsvLike(text) {
    const t = String(text || '')
        .replace(/^\uFEFF/, '')
        .trim();
    if (window.AltitudeHdHub?.isCsvLike) return window.AltitudeHdHub.isCsvLike(t);
    if (t.length < 20 || !t.includes(',')) return false;
    if (/^<!doctype html/i.test(t) || /<html[\s>]/i.test(t)) return false;
    if (/nothing published/i.test(t)) return false;
    return /event|race|day |competitor|lane_/i.test(t);
}

function vgHasLaneColumns(text) {
    return /(?:^|,)lane[_\s-]?\d+/im.test(String(text || ''));
}

async function vgFetchCsvRaw(url) {
    try {
        const res = await fetch(
            `/api/fetch-csv?url=${encodeURIComponent(url)}`,
        );
        if (res.ok) {
            const text = await res.text();
            if (vgIsCsvLike(text)) return text;
        }
    } catch {
        /* direct */
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!vgIsCsvLike(text)) throw new Error('Not a CSV');
    return text;
}

function vgAcceptRegattaFile(fileId, text) {
    if (!vgIsCsvLike(text)) return false;
    if (fileId === 'daysheet' && !vgHasLaneColumns(text)) return false;
    return true;
}

async function vgFetchRegattaFile(fileId) {
    const code = vgGetRegattaCode();
    let namesOnly = '';
    if (window.RegattaCsvArchive?.fetchRegattaCsv) {
        try {
            const text = await window.RegattaCsvArchive.fetchRegattaCsv(
                code,
                fileId,
            );
            if (vgAcceptRegattaFile(fileId, text)) return text;
            if (fileId === 'daysheet' && vgIsCsvLike(text)) namesOnly = text;
        } catch {
            /* local paths */
        }
    }
    const urls = window.AltitudeHdHub?.buildCsvUrlCandidates
        ? window.AltitudeHdHub.buildCsvUrlCandidates(code, fileId)
        : [vgGetCsvUrl(fileId)];
    for (const url of urls) {
        try {
            const text = await vgFetchCsvRaw(url);
            if (vgAcceptRegattaFile(fileId, text)) return text;
            if (fileId === 'daysheet' && vgIsCsvLike(text) && !namesOnly) namesOnly = text;
        } catch {
            /* next */
        }
    }
    const locals = [
        `data/rowit-live/${code}/${fileId}.csv`,
        window.AltitudeHdHub?.localCsvPath?.(code, fileId),
        `data/archives/${code}/latest/${fileId}.csv`,
        `data/${code}-${fileId}.csv`,
    ].filter(Boolean);
    if (fileId === 'daysheet') {
        locals.push(
            `data/rowit-live/${code}/competitors.csv`,
            window.AltitudeHdHub?.localCsvPath?.(code, 'competitors'),
            `data/archives/${code}/latest/competitors.csv`,
            `data/${code}-competitors.csv`,
        );
    }
    for (const path of [...new Set(locals)]) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const text = await res.text();
            if (vgAcceptRegattaFile(fileId, text)) return text;
            if (fileId === 'daysheet' && vgIsCsvLike(text) && !namesOnly) namesOnly = text;
        } catch {
            /* next */
        }
    }
    return namesOnly;
}

async function vgFetchCsv(url) {
    if (window.RegattaCsvArchive?.fetchCsvUrl) {
        try {
            const text = await window.RegattaCsvArchive.fetchCsvUrl(url);
            if (vgIsCsvLike(text)) return text;
        } catch {
            /* fallback */
        }
    }
    return vgFetchCsvRaw(url);
}

async function vgLoadLookup() {
    const res = await fetch('data/ahd-lookup.json');
    if (!res.ok) throw new Error('Lookup file missing');
    return res.json();
}

function vgLookupToken(map, token) {
    if (!map || !token) return token;
    if (map[token]) return map[token];
    const lower = token.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
    }
    return token;
}

function vgExpandEventName(eventType, lookup) {
    if (!lookup || !eventType) return eventType;
    const parts = eventType.trim().split(/\s+/);
    if (parts.length < 3) return eventType;
    const g = vgLookupToken(lookup.gender, parts[0]);
    const c = vgLookupToken(lookup.class, parts[1]);
    const b = vgLookupToken(lookup.boat, parts[2]);
    return `${g} ${c} ${b}`;
}

function vgParseClubCode(raw) {
    const s = String(raw || '').trim();
    if (!s) return { id: '', crewNum: '', age: '', composite: false };
    const ageM = s.match(/^(.*?)\s*\(([A-Za-z])\*?\)\s*$/);
    const core = (ageM ? ageM[1] : s).trim();
    const age = ageM ? ageM[2].toUpperCase() : '';
    const m = core.match(/^([A-Za-z]{2,6})(\*?)(?:\s+(\d+))?$/);
    if (!m) return { id: '', crewNum: '', age, composite: /\*/.test(s) };
    return {
        id: m[1].toLowerCase(),
        crewNum: m[3] || '',
        age,
        composite: m[2] === '*',
    };
}

function vgClubInfo(clubId, lookup) {
    const raw = String(clubId || '')
        .toLowerCase()
        .replace(/\*+$/, '');
    if (!raw) return { name: '', logoUrl: null };
    const clubs = lookup?.clubs;
    if (!clubs) return { name: raw.toUpperCase(), logoUrl: null };
    let c = clubs[raw];
    if (!c && raw.length <= 3) {
        const hits = Object.keys(clubs).filter((k) => k !== 'comp' && k.startsWith(raw));
        if (hits.length) c = clubs[hits[0]];
    }
    if (!c) return { name: raw.toUpperCase(), logoUrl: null };
    const logoUrl = c.logo
        ? `assets/school-logos/${encodeURIComponent(c.logo)}`
        : null;
    return { name: c.name, logoUrl };
}

/** Live-race labels for KRI speed chart / live tracking (demo traces unchanged). */
function vgBuildSpeedChartRaceContext() {
    const race = vgFindRace(vgGetRaceParam());
    if (!race) return null;
    const lanes = (race.lanes || [])
        .filter((entry) => entry.code)
        .sort((a, b) => a.lane - b.lane)
        .map((entry) => {
            const club = vgParseClubCode(entry.code);
            const info = vgClubInfo(club.id, vgState.lookup);
            return {
                lane: entry.lane,
                label: info.name,
                shortLabel: club.id ? club.id.toUpperCase() : String(entry.code || '').trim(),
                logoUrl: info.logoUrl,
            };
        });
    return {
        event: vgExpandEventName(race.eventType, vgState.lookup),
        round: race.round || '',
        race: race.race,
        lanes,
    };
}

const VG_LS_LIVE_RACE = 'altitudeHdLiveRace_v1';
const VG_LS_LEADER_LANE = 'altitudeHdLeaderLane_v1';
const VG_LS_TRIGGER = 'altitudeHdVmixTrigger_v1';
const VG_LS_SPEED = 'altitudeHdSpeedVmix_v1';
const VG_DEFAULT_LEADER_LANE = 4;

/** In-page live race (wins over URL ?race= after n/p or hub sync). */
let vgLiveRaceOverride = null;
/** Milford leader overlay: selected lane 1–8 from current draw. */
let vgLeaderLane = null;

function vgInitLiveRaceOverride() {
    const urlRace = new URLSearchParams(location.search).get('race');
    if (urlRace != null && String(urlRace).trim() !== '') {
        vgLiveRaceOverride = String(urlRace).trim();
        return;
    }
    if (window.AltitudeHdLiveRace?.getLiveRace) {
        const hub = window.AltitudeHdLiveRace.getLiveRace();
        if (hub) {
            vgLiveRaceOverride = hub;
            return;
        }
    }
    try {
        const stored = localStorage.getItem(VG_LS_LIVE_RACE);
        if (stored != null && String(stored).trim()) {
            vgLiveRaceOverride = String(stored).trim();
        }
    } catch {
        /* ignore */
    }
}

function vgGetRaceParam() {
    if (vgLiveRaceOverride != null && String(vgLiveRaceOverride).trim() !== '') {
        return String(vgLiveRaceOverride).trim();
    }
    const urlRace = new URLSearchParams(location.search).get('race');
    if (urlRace != null && String(urlRace).trim() !== '') {
        return String(urlRace).trim();
    }
    if (window.AltitudeHdLiveRace?.getLiveRace) {
        return window.AltitudeHdLiveRace.getLiveRace();
    }
    try {
        const stored = localStorage.getItem(VG_LS_LIVE_RACE);
        if (stored != null && String(stored).trim()) return String(stored).trim();
    } catch {
        /* ignore */
    }
    return null;
}

function vgFindRace(raceParam) {
    if (!vgState.races.length) return null;
    const p = String(raceParam || '').trim();
    if (!p) return vgState.races[0];
    const exact = vgState.races.find((r) => r.race === p);
    if (exact) return exact;
    const num = parseInt(p, 10);
    const letter = p.match(/\(([A-Za-z])\)/i)?.[1]?.toUpperCase();
    const found = vgState.races.find((r) => {
        if (r.raceNum !== num) return false;
        if (letter && !r.race.includes(`(${letter})`)) return false;
        return true;
    });
    return found || vgState.races.find((r) => r.raceNum === num) || vgState.races[0];
}

/** Upcoming races from live/dashboard race (includes current), daysheet order. */
function vgGetUpcomingRaces(raceParam, count = 10) {
    const races = vgState.races;
    if (!races.length) return { current: null, upcoming: [] };
    const current = vgFindRace(raceParam);
    if (!current) return { current: null, upcoming: races.slice(0, count) };
    let startIdx = races.findIndex((r) => r.race === current.race);
    if (startIdx < 0) {
        startIdx = races.findIndex((r) => r.raceNum === current.raceNum);
    }
    if (startIdx < 0) startIdx = 0;
    return {
        current,
        upcoming: races.slice(startIdx, startIdx + count),
    };
}

function vgCurrentRaceNumber(raceParam) {
    const current = vgFindRace(raceParam);
    if (current && Number.isFinite(current.raceNum)) return current.raceNum;
    const num = parseInt(String(raceParam || ''), 10);
    return Number.isFinite(num) ? num : null;
}

/** Next/previous race by daysheet race number (+1 / −1), not array index. */
function vgFindRaceByNumberStep(delta) {
    const races = vgState.races;
    if (!races.length) return null;
    const param = vgGetRaceParam();
    const num = vgCurrentRaceNumber(param);
    if (!Number.isFinite(num)) return races[0];

    const targetNum = num + delta;
    const exact = races.find((r) => r.raceNum === targetNum);
    if (exact) return exact;

    if (delta > 0) {
        return races.find((r) => r.raceNum > num) || races[races.length - 1];
    }
    for (let i = races.length - 1; i >= 0; i--) {
        if (races[i].raceNum < num) return races[i];
    }
    return races[0];
}

function vgSetLiveRace(raceLabel) {
    const race = String(raceLabel || '').trim();
    if (!race) return;
    vgLiveRaceOverride = race;
    try {
        localStorage.setItem(VG_LS_LIVE_RACE, race);
    } catch {
        /* ignore */
    }
    if (window.AltitudeHdLiveRace?.setLiveRace) {
        window.AltitudeHdLiveRace.setLiveRace(race);
    }
    try {
        document.dispatchEvent(
            new CustomEvent('altitudehd:liverace', { detail: { race } }),
        );
    } catch {
        /* ignore */
    }
}

function vgStepLiveRace(delta) {
    const races = vgState.races;
    if (!races.length) {
        const num = vgCurrentRaceNumber(vgGetRaceParam());
        const base = Number.isFinite(num) ? num : 1;
        vgSetLiveRace(String(Math.max(1, base + delta)));
    } else {
        const next = vgFindRaceByNumberStep(delta);
        if (next) vgSetLiveRace(next.race);
    }
    vgRefreshLiveRaceContent();
}

function vgFindDrawLane(race, laneNum) {
    if (!race?.lanes?.length) return null;
    return race.lanes.find((l) => l.lane === laneNum && l.code) || null;
}

function vgClampLeaderLane(value) {
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return VG_DEFAULT_LEADER_LANE;
    return Math.min(8, Math.max(1, n));
}

function vgGetLeaderLane() {
    if (window.AltitudeHdLeaderLane?.getLeaderLane) {
        return vgClampLeaderLane(window.AltitudeHdLeaderLane.getLeaderLane());
    }
    try {
        const v = localStorage.getItem(VG_LS_LEADER_LANE);
        if (v != null && String(v).trim() !== '') {
            return vgClampLeaderLane(v);
        }
    } catch {
        /* ignore */
    }
    return VG_DEFAULT_LEADER_LANE;
}

function vgSetLeaderLane(laneNum) {
    const lane = vgClampLeaderLane(laneNum);
    vgLeaderLane = lane;
    try {
        localStorage.setItem(VG_LS_LEADER_LANE, String(lane));
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('altitudehd:leaderlane', { detail: { lane } }),
    );
    if (window.AltitudeHdLeaderLane?.syncLeaderLaneUi) {
        window.AltitudeHdLeaderLane.syncLeaderLaneUi();
    }
}

function vgApplyLeaderLane(laneNum, opts = {}) {
    if (!vgIsMilfordBroadcastTheme() && !vgIsKriTheme()) return;
    const race = vgFindRace(vgGetRaceParam());
    if (!race) return;
    if (!vgFindDrawLane(race, laneNum)) return;

    vgSetLeaderLane(laneNum);
    const layer = vgGetLayerEl();
    if (!layer) return;
    vgRenderLeader(layer, race, laneNum, opts);
    layer.classList.add('vg-layer--visible');
    if (vgPlayback.state !== 'idle') {
        layer.classList.remove('vg-layer--fade-out');
    }
    vgSyncLayerVisibility(layer);
}

function vgSelectLeaderLane(laneNum) {
    if (vgPlayback.graphic !== 'leader') return;
    if (!vgIsMilfordBroadcastTheme() && !vgIsKriTheme()) return;
    if (vgPlayback.state === 'idle') return;
    vgApplyLeaderLane(laneNum);
}

function vgShowLeaderForConfiguredLane(fadeIn = false) {
    if (!vgIsMilfordBroadcastTheme() && !vgIsKriTheme()) return;
    vgApplyLeaderLane(vgGetLeaderLane(), { fadeIn });
}

function vgRefreshLiveRaceContent() {
    const graphic = vgPlayback.graphic;
    if (!graphic || vgPlayback.state === 'idle') return;
    /* Dev layout tuning uses inline styles; CSV refresh would wipe unsaved drags. */
    if (vgIsLayoutDevMode()) return;

    if (vgIsCourseScrollGraphic(graphic)) {
        window.KriVmixCourseScroll?.updateRaceContext?.(vgBuildSpeedChartRaceContext());
        return;
    }
    if (vgIsLanesGraphic(graphic)) {
        window.MilfordLaneCards?.updateRace?.(vgBuildLaneCardsContext());
        return;
    }

    const profile = vgGetVideoProfile(graphic);
    const layer = vgGetLayerEl();

    const prevRefresh = vgHoldRefreshing;
    vgHoldRefreshing = true;
    try {
        vgPrepareContent(graphic, vgGetRaceParam());
    } finally {
        vgHoldRefreshing = prevRefresh;
    }
    if (graphic === 'leader' && vgLeaderLane != null) {
        vgShowLeaderForConfiguredLane();
    }

    if (!profile.noText && layer) {
        layer.classList.add('vg-layer--visible');
        layer.classList.remove('vg-layer--fade-out');
        /* Keep hold stable on CSV refresh — fade-in is only for intro (see vgEnterHold). */
    }
}

function vgCompetitorNames(race, lane) {
    if (!vgState.competitors?.size) return '';
    const club = vgParseClubCode(lane?.code);
    const wantedDivs = [];
    if (club.crewNum) wantedDivs.push(String(club.crewNum));
    if (lane?.lane) wantedDivs.push(String(lane.lane));
    if (race?.division) wantedDivs.push(String(race.division));

    let byEvent = '';
    let byLaneDiv = '';
    let byRace = '';
    for (const v of vgState.competitors.values()) {
        if (!v?.names) continue;
        const sameRace =
            v.raceNum === race.raceNum ||
            (v.race && race.race && v.race === race.race);
        if (!sameRace) continue;
        if (race.eventNum && v.eventNum && String(v.eventNum) === String(race.eventNum)) {
            byEvent = v.names;
        }
        if (lane && wantedDivs.includes(String(v.division))) {
            byLaneDiv = v.names;
        }
        if (v.race === race.race || !byRace) byRace = v.names;
    }
    return byEvent || byLaneDiv || byRace || '';
}

function vgFormatTime(d) {
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function vgFormatScheduleTime(d) {
    return d
        .toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        })
        .toLowerCase();
}

/** e.g. 12:15pm (no space before am/pm) */
function vgFormatCompactScheduleTime(d) {
    return vgFormatScheduleTime(d).replace(/\s+(am|pm)$/, '$1');
}

function vgScheduleMetaText() {
    return `Current time - ${vgFormatScheduleTime(new Date())}`;
}

let vgScheduleClockTimer = null;

function vgStopScheduleClock() {
    if (vgScheduleClockTimer) {
        clearInterval(vgScheduleClockTimer);
        vgScheduleClockTimer = null;
    }
}

function vgUpdateScheduleMetaClock() {
    const el = document.querySelector('[data-vg-layout="schedule-meta"]');
    if (el) el.textContent = vgScheduleMetaText();
}

function vgStartScheduleClock() {
    vgStopScheduleClock();
    vgUpdateScheduleMetaClock();
    vgScheduleClockTimer = setInterval(vgUpdateScheduleMetaClock, 30000);
}

function vgFormatDayLabel(dayLabel) {
    return dayLabel.replace(/^DAY\s+\d+:\s*/i, '').trim();
}

function vgResolveTheme() {
    return document.body.dataset.vmixTheme || 'kri';
}

/** Layout dev editor (?dev=1) — skip live CSV refresh that rebuilds the DOM. */
function vgIsLayoutDevMode() {
    const p = new URLSearchParams(location.search);
    return (
        p.get('dev') === '1' ||
        p.get('layout') === 'edit' ||
        document.body.classList.contains('vg-layout-dev')
    );
}

/** Dark, fit-to-window preview when not in a 1920×1080 vMix Browser. */
function vgIsBrowserPreview() {
    const p = new URLSearchParams(location.search);
    if (p.get('preview') === '0') return false;
    if (p.get('preview') === '1') return true;
    return window.innerWidth < 1920 || window.innerHeight < 1080;
}

function vgFitPreviewStage() {
    if (!document.documentElement.classList.contains('vg-preview')) return;
    const stage = document.querySelector('.vg-stage');
    if (!stage) return;
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const x = (window.innerWidth - 1920 * scale) / 2;
    const y = (window.innerHeight - 1080 * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function vgEnableBrowserPreview() {
    if (!vgIsBrowserPreview()) return;
    document.documentElement.classList.add('vg-preview');
    document.body.classList.add('vg-preview');
    if (!document.querySelector('.vg-preview-hint')) {
        const hint = document.createElement('p');
        hint.className = 'vg-preview-hint';
        hint.textContent =
            'Click anywhere to play the graphic · L play · O out · C clear';
        document.body.appendChild(hint);
    }
    vgFitPreviewStage();
    window.addEventListener('resize', vgFitPreviewStage);
    document.addEventListener('click', (e) => {
        if (e.target.closest('.vg-layout-panel, .kp-ops, input, textarea, select, a, button, [data-kp-festive]')) {
            return;
        }
        const raw =
            new URLSearchParams(location.search).get('g') ||
            document.body?.dataset?.vmixDefaultGraphic ||
            'l';
        const graphic = vgResolveGraphicAlias(raw);
        if (!graphic) return;
        if (vgPlayback.state !== 'idle') vgTriggerClear();
        vgTriggerIn(graphic);
        const video = vgGetBgVideo();
        if (video) {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
            }
        }
    });
}

function vgThemeConfig() {
    return VG_THEMES[vgResolveTheme()] || VG_THEMES.kri;
}

function vgIsSpeedGraphic(graphic) {
    return graphic === 'speed';
}

function vgIsSpeedChartGraphic(graphic) {
    return graphic === 'speedchart';
}

function vgIsCvLeaderGraphic(graphic) {
    return graphic === 'cvleader';
}

function vgIsCvDrawGraphic(graphic) {
    return graphic === 'cvdraw';
}

function vgIsLiveTrackingGraphic(graphic) {
    return graphic === 'livetracking';
}

function vgIsCourseScrollGraphic(graphic) {
    return graphic === 'coursescroll';
}

function vgIsScheduleGraphic(graphic) {
    return graphic === 'schedule';
}

function vgIsWeatherGraphic(graphic) {
    return graphic === 'weather';
}

/** Milford lane cards + docked lower third (vmix-rnz-milford-lanes.js). */
function vgIsLanesGraphic(graphic) {
    return graphic === 'lanes';
}

function vgLanesEnabled() {
    return vgIsMilfordTheme() && !!window.MilfordLaneCards;
}

/** Daysheet draw → lane-card crews (names, club ids, logos) + lower-third text. */
function vgBuildLaneCardsContext(raceParam) {
    const race = vgFindRace(raceParam ?? vgGetRaceParam());
    if (!race) return null;
    const lanes = (race.lanes || [])
        .filter((entry) => entry.code)
        .sort((a, b) => a.lane - b.lane)
        .map((entry) => {
            const club = vgParseClubCode(entry.code);
            const info = vgClubInfo(club.id, vgState.lookup);
            return {
                lane: entry.lane,
                code: String(entry.code || '').trim(),
                clubId: club.id || '',
                crewNum: club.crewNum || '',
                name: info.name || club.id.toUpperCase(),
                logoUrl: info.logoUrl,
            };
        });
    return {
        race: race.race,
        raceNum: race.raceNum,
        event: vgExpandEventName(race.eventType, vgState.lookup),
        round: race.round || '',
        division: race.division || '',
        progression: race.progression || '',
        lanes,
    };
}

/** KRI / Karāpiro graphics use CSS panels (no PNG/WebM backgrounds). */
function vgKriUsesCssBackground(graphic) {
    if (!vgIsCssOverlayTheme()) return false;
    const g = graphic ?? vgPlayback.graphic;
    if (vgKarapiroOwns(g)) return true;
    return (
        !!g &&
        !vgIsSpeedChartGraphic(g) &&
        !vgIsLiveTrackingGraphic(g) &&
        !vgIsWeatherGraphic(g) &&
        !vgIsCvLeaderGraphic(g) &&
        !vgIsCvDrawGraphic(g) &&
        !vgIsCourseScrollGraphic(g)
    );
}

function vgMilfordCssGraphic(graphic) {
    const g = graphic ?? vgPlayback.graphic;
    return (
        vgIsMilfordTheme() &&
        (g === 'lower' ||
            g === 'draw' ||
            g === 'results' ||
            g === 'leader' ||
            g === 'title' ||
            g === 'speed')
    );
}

function vgMilfordCssLower(graphic) {
    return vgMilfordCssGraphic(graphic) && (graphic ?? vgPlayback.graphic) === 'lower';
}

function vgMilfordChromeAssetId(graphic) {
    return graphic === 'speed' ? 'tracker' : graphic;
}

function vgUsesCssBackground(graphic) {
    return vgKriUsesCssBackground(graphic) || vgMilfordCssGraphic(graphic);
}

/** @deprecated alias */
function vgKriScheduleCssLayout(graphic) {
    return vgKriUsesCssBackground(graphic);
}

function vgSpeedChartEnabled() {
    return vgIsCssOverlayTheme() && !!window.KriVmixSpeedChart;
}

function vgCvLeaderEnabled() {
    return vgIsCssOverlayTheme() && !!window.KriVmixCvLeader && !!window.AltitudeHdCvOverlay;
}

function vgCvDrawEnabled() {
    return (
        vgIsCssOverlayTheme() &&
        !!window.KriVmixCvDraw &&
        !!window.AltitudeHdCvBoatMap &&
        !!window.AltitudeHdCvOverlay
    );
}

function vgLiveTrackingEnabled() {
    return vgIsCssOverlayTheme() && !!window.KriVmixLiveTracking && !!window.KriVmixSpeedChart;
}

function vgCourseScrollEnabled() {
    return vgIsCssOverlayTheme() && !!window.KriVmixCourseScroll;
}

function vgWeatherEnabled() {
    return vgIsCssOverlayTheme() && !!window.KriVmixWeather;
}

function vgMaybeLoopSpeedChart() {
    const params = new URLSearchParams(location.search);
    if (params.get('loop') !== '1') return;
    const g = params.get('g') || 'v';
    const graphic = VG_GRAPHIC_ALIASES[g.toLowerCase()];
    if (graphic !== 'speedchart') return;
    setTimeout(() => {
        if (vgPlayback.state === 'idle') vgTriggerIn('speedchart');
    }, 1200);
}

function vgMaybeLoopLiveTracking() {
    const params = new URLSearchParams(location.search);
    if (params.get('loop') !== '1') return;
    const g = params.get('g') || 'k';
    const graphic = VG_GRAPHIC_ALIASES[g.toLowerCase()];
    if (graphic !== 'livetracking') return;
    setTimeout(() => {
        if (vgPlayback.state === 'idle') vgTriggerIn('livetracking');
    }, 1200);
}

async function vgStartSpeedChartIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixSpeedChart) {
            throw new Error('Speed chart module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsSpeedChartGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixSpeedChart.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        await window.KriVmixSpeedChart.show({
            raceContext: vgBuildSpeedChartRaceContext(),
        });
        if (!vgIsSpeedChartGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
        vgStartSpeedChartOutro();
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'Speed chart failed';
        }
        vgResetToIdle();
    }
}

async function vgStartSpeedChartOutro() {
    if (!vgIsSpeedChartGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro' && vgPlayback.state !== 'outro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixSpeedChart) await window.KriVmixSpeedChart.hide();
    } finally {
        vgResetToIdle();
        vgMaybeLoopSpeedChart();
    }
}

async function vgStartCvLeaderIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixCvLeader) {
            throw new Error('CV leader module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsCvLeaderGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixCvLeader.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        const race = vgFindRace(vgGetRaceParam());
        await window.KriVmixCvLeader.show({
            race,
            lane: vgGetLeaderLane(),
        });
        if (!vgIsCvLeaderGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'CV leader failed';
        }
        vgResetToIdle();
    }
}

async function vgStartCvLeaderOutro() {
    if (!vgIsCvLeaderGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro' && vgPlayback.state !== 'outro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixCvLeader) await window.KriVmixCvLeader.hide();
    } finally {
        vgResetToIdle();
    }
}

async function vgStartLanesIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.MilfordLaneCards) {
            throw new Error('Lane cards module not loaded');
        }
        const err = document.getElementById('vgError');
        if (err) err.hidden = true;
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsLanesGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.MilfordLaneCards.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        await window.MilfordLaneCards.show({
            race: vgBuildLaneCardsContext(),
        });
        if (!vgIsLanesGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'Lane cards failed';
        }
        vgResetToIdle();
    }
}

async function vgStartLanesOutro() {
    if (!vgIsLanesGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.MilfordLaneCards) await window.MilfordLaneCards.hide();
    } finally {
        if (vgIsLanesGraphic(vgPlayback.graphic)) vgResetToIdle();
    }
}

async function vgStartCvDrawIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixCvDraw) {
            throw new Error('CV draw module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsCvDrawGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixCvDraw.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        const race = vgFindRace(vgGetRaceParam());
        await window.KriVmixCvDraw.show({ race });
        if (!vgIsCvDrawGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'CV draw failed';
        }
        vgResetToIdle();
    }
}

async function vgStartCvDrawOutro() {
    if (!vgIsCvDrawGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro' && vgPlayback.state !== 'outro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixCvDraw) await window.KriVmixCvDraw.hide();
    } finally {
        vgResetToIdle();
    }
}

async function vgStartCourseScrollIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixCourseScroll) {
            throw new Error('Course underlay module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsCourseScrollGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixCourseScroll.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        await window.KriVmixCourseScroll.show({
            raceContext: vgBuildSpeedChartRaceContext(),
            leaderLane: vgGetLeaderLane(),
        });
        if (!vgIsCourseScrollGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'Course underlay failed';
        }
        vgResetToIdle();
    }
}

async function vgStartCourseScrollOutro() {
    if (!vgIsCourseScrollGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro' && vgPlayback.state !== 'outro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixCourseScroll) await window.KriVmixCourseScroll.hide();
    } finally {
        vgResetToIdle();
    }
}

async function vgStartLiveTrackingIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixLiveTracking) {
            throw new Error('Live tracking module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsLiveTrackingGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixLiveTracking.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        await window.KriVmixLiveTracking.show({
            raceContext: vgBuildSpeedChartRaceContext(),
        });
        if (!vgIsLiveTrackingGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
        vgStartLiveTrackingOutro();
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'Live tracking failed';
        }
        vgResetToIdle();
    }
}

async function vgStartLiveTrackingOutro() {
    if (!vgIsLiveTrackingGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro' && vgPlayback.state !== 'outro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixLiveTracking) await window.KriVmixLiveTracking.hide();
    } finally {
        vgResetToIdle();
        vgMaybeLoopLiveTracking();
    }
}

async function vgStartWeatherIntro() {
    vgShowBackground(false);
    vgShowTextLayer(false);
    vgHideMap();
    const layer = vgGetLayerEl();
    if (layer) {
        layer.replaceChildren();
        layer.className = 'vg-layer';
    }
    try {
        if (!window.KriVmixWeather) {
            throw new Error('Weather module not loaded');
        }
        const holdTimer = setTimeout(() => {
            if (vgPlayback.state === 'intro' && vgIsWeatherGraphic(vgPlayback.graphic)) {
                vgSetStageState('hold');
            }
        }, window.KriVmixWeather.INTRO_MS);
        vgPlayback.profileTimers.push(holdTimer);

        await window.KriVmixWeather.show();
        if (!vgIsWeatherGraphic(vgPlayback.graphic)) return;
        vgSetStageState('hold');
        window.VmixKarapiro?.paintOps?.();
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent = e instanceof Error ? e.message : 'Weather overlay failed';
        }
        vgResetToIdle();
    }
}

async function vgStartWeatherOutro() {
    if (!vgIsWeatherGraphic(vgPlayback.graphic)) return;
    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgSetStageState('outro');
    try {
        if (window.KriVmixWeather) await window.KriVmixWeather.hide();
    } finally {
        vgResetToIdle();
        window.VmixKarapiro?.paintOps?.();
    }
}

function vgSpeedEnabled() {
    const theme = vgThemeConfig();
    if (theme.videoGraphics && vgGetBackgroundSrc('speed')) return true;
    return !!theme.speedEmbed;
}

function vgIsVideoTheme() {
    const theme = document.body?.dataset?.vmixTheme;
    return theme === 'rnz-milford' || theme === 'beachsprints-milford';
}

function vgIsBeachSprintsTheme() {
    return document.body?.dataset?.vmixTheme === 'beachsprints-milford';
}

function vgBuildSpeedEmbedUrl() {
    const u = new URL('speed.html', location.href);
    u.searchParams.set('vmix', '1');
    u.searchParams.set('transparent', '1');
    if (vgIsVideoTheme()) {
        u.searchParams.set('overlayOnly', '1');
    }
    try {
        const s = JSON.parse(localStorage.getItem(VG_LS_SPEED) || '{}');
        if (s.deviceId) u.searchParams.set('deviceId', String(s.deviceId));
        if (s.rsLat != null) u.searchParams.set('rsLat', String(s.rsLat));
        if (s.rsLng != null) u.searchParams.set('rsLng', String(s.rsLng));
        if (s.reLat != null) u.searchParams.set('reLat', String(s.reLat));
        if (s.reLng != null) u.searchParams.set('reLng', String(s.reLng));
    } catch {
        /* ignore */
    }
    return `speed.html?${u.searchParams.toString()}`;
}

function vgSendSpeedOverlayPhase(phase) {
    const frame = vgGetSpeedFrame();
    if (!frame) return;
    const send = () => vgPostToSpeedFrame(phase);
    if (frame.dataset.loaded === '1') {
        send();
        return;
    }
    frame.addEventListener(
        'load',
        () => {
            frame.dataset.loaded = '1';
            send();
        },
        { once: true },
    );
}

function vgGetSpeedFrame() {
    return document.getElementById('vgMapFrame');
}

function vgPostToSpeedFrame(phase) {
    const frame = vgGetSpeedFrame();
    frame?.contentWindow?.postMessage({ type: 'altitudehd:vg', phase }, '*');
}

function vgIsVideoAsset(src) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(src || '');
}

function vgGetBackgroundSrc(graphic) {
    const theme = VG_THEMES[vgResolveTheme()] || VG_THEMES.kri;
    return theme.backgrounds[graphic] || null;
}

function vgGetBgEl() {
    return document.getElementById('vgBg');
}

function vgGetLayerEl() {
    return document.getElementById('vgLayer');
}

function vgGetBgVideo() {
    const bg = vgGetBgEl();
    if (!bg) return null;
    return bg.querySelector('video.vg-bg-video');
}

function vgEnsureBgVideo() {
    const bg = vgGetBgEl();
    if (!bg) return null;
    let video = bg.querySelector('video.vg-bg-video');
    if (!video) {
        video = document.createElement('video');
        video.className = 'vg-bg-video';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        bg.appendChild(video);
    }
    video.loop = false;
    return video;
}

function vgClearPlaybackTimers() {
    if (vgPlayback.introTimer) {
        clearTimeout(vgPlayback.introTimer);
        vgPlayback.introTimer = null;
    }
    if (vgPlayback.outroTimer) {
        clearTimeout(vgPlayback.outroTimer);
        vgPlayback.outroTimer = null;
    }
    for (const id of vgPlayback.profileTimers) {
        clearTimeout(id);
    }
    vgPlayback.profileTimers = [];
    const video = vgGetBgVideo();
    if (video && vgPlayback.onVideoEnded) {
        video.removeEventListener('ended', vgPlayback.onVideoEnded);
        vgPlayback.onVideoEnded = null;
    }
}

function vgScheduleProfile(ms, fn) {
    const id = setTimeout(fn, ms);
    vgPlayback.profileTimers.push(id);
    return id;
}

function vgGetLayoutPlayback(graphic) {
    const theme = vgThemeId();
    if (!theme || !window.VmixLayout?.getPlayback) return null;
    return window.VmixLayout.getPlayback(theme, graphic);
}

function vgMergePlaybackProfile(graphic, base) {
    const custom = vgGetLayoutPlayback(graphic);
    if (!custom) return base;
    const out = { ...base };
    for (const key of ['textInMs', 'pauseAtMs', 'textOutMs']) {
        if (custom[key] != null && Number.isFinite(custom[key])) {
            out[key] = custom[key];
        }
    }
    return out;
}

function vgGetOutroFadeMs(graphic) {
    const custom = vgGetLayoutPlayback(graphic);
    const n = custom?.outroMs;
    if (Number.isFinite(n) && n > 0) return n;
    if (vgIsKarapiroTheme()) return VG_KARAPIRO_FADE_MS;
    return VG_MILFORD_FADE_MS;
}

function vgGetVideoProfile(graphic) {
    if (vgKarapiroOwns(graphic) || (vgIsKarapiroTheme() && vgKriUsesCssBackground(graphic))) {
        return vgMergePlaybackProfile(graphic, { textInMs: 0 });
    }
    if (vgMilfordCssGraphic(graphic)) {
        const merged = vgMergePlaybackProfile(graphic, { textInMs: 0 });
        merged.textInMs = 0;
        delete merged.textOutMs;
        delete merged.pauseAtMs;
        return merged;
    }
    let base;
    if (graphic === 'leader') {
        base = vgIsKriTheme()
            ? { textInMs: 0 }
            : { pauseAtMs: 6000 };
    } else if (graphic === 'speed') {
        base = { textInMs: 1000, pauseAtMs: 3000 };
    } else if (graphic === 'lower') {
        base = { textInMs: 1500, pauseAtMs: 1500 };
    } else if (graphic === 'draw') {
        base = { textInMs: 4500, textOutMs: 27000, playThrough: true };
    } else if (graphic === 'results') {
        base = { textInMs: 6000, textOutMs: 16000, playThrough: true };
    } else {
        base = { textInMs: 3000, pauseAtMs: 3000 };
    }
    return vgMergePlaybackProfile(graphic, base);
}

function vgSetStageState(state) {
    vgPlayback.state = state;
    const stage = document.querySelector('.vg-stage');
    if (stage) {
        stage.dataset.vgState = state;
    }
}

function vgShowBackground(visible) {
    const bg = vgGetBgEl();
    if (!bg) return;
    bg.classList.toggle('vg-bg--visible', visible);
    bg.classList.toggle('vg-bg--outro', vgPlayback.state === 'outro');
}

function vgVideoGraphicTextDuringIntro() {
    const graphic = vgPlayback.graphic;
    if (!graphic || vgPlayback.state !== 'intro') return false;
    const profile = vgGetVideoProfile(graphic);
    return vgIsVideoTheme() && !profile.noText && profile.textInMs != null;
}

function vgShowTextLayer(visible, opts = {}) {
    const layer = vgGetLayerEl();
    if (!layer) return;
    if (!visible) {
        layer.classList.remove(
            'vg-layer--visible',
            'vg-layer--fade-in',
            'vg-layer--fade-out',
        );
        return;
    }
    if (opts.fadeIn) {
        /* Add fade-in with visible in one step — removing fade-in first caused a
           full-opacity flash before the Milford draw lane cascade. */
        const restartFadeIn = layer.classList.contains('vg-layer--fade-in');
        layer.classList.add('vg-layer--visible');
        if (restartFadeIn) {
            layer.classList.remove('vg-layer--fade-in');
            void layer.offsetWidth;
        }
        layer.classList.add('vg-layer--fade-in');
        vgRestartMilfordIntros(layer);
        return;
    }
    layer.classList.add('vg-layer--visible');
    layer.classList.remove('vg-layer--fade-in', 'vg-layer--fade-out');
}

function vgStartKriOutroFade() {
    const bg = vgGetBgEl();
    const layer = vgGetLayerEl();
    if (bg) {
        bg.classList.remove('vg-bg--fade-in');
        bg.classList.add('vg-bg--fade-out');
    }
    if (layer) {
        layer.classList.remove('vg-layer--fade-in');
        layer.classList.add('vg-layer--fade-out');
    }
}

function vgStartMilfordOutroFade() {
    const layer = vgGetLayerEl();
    if (layer) {
        layer.classList.remove('vg-layer--fade-in');
        layer.classList.add('vg-layer--fade-out');
    }
}

function vgIsMilfordTheme() {
    return document.body?.dataset?.vmixTheme === 'rnz-milford';
}

function vgIsMilfordBroadcastTheme() {
    const t = vgThemeId();
    return t === 'rnz-milford' || t === 'beachsprints-milford';
}

function vgArmVideoEndedReset(video) {
    if (!video) return;
    if (vgPlayback.onVideoEnded) {
        video.removeEventListener('ended', vgPlayback.onVideoEnded);
    }
    vgPlayback.onVideoEnded = () => {
        if (vgPlayback.state === 'idle') return;
        vgResetToIdle();
    };
    video.addEventListener('ended', vgPlayback.onVideoEnded);
}

function vgSyncLayerVisibility(layer) {
    if (!layer) return;
    if (layer.classList.contains('vg-layer--leader')) {
        const hasLeaderContent = !!layer.querySelector('.vg-leader-crew');
        if (
            vgLeaderLane != null &&
            hasLeaderContent &&
            vgPlayback.state !== 'idle'
        ) {
            layer.classList.add('vg-layer--visible');
        } else {
            layer.classList.remove(
                'vg-layer--visible',
                'vg-layer--fade-in',
                'vg-layer--fade-out',
            );
        }
        return;
    }
    if (vgPlayback.state === 'hold' || vgPlayback.state === 'outro') {
        layer.classList.add('vg-layer--visible');
    } else if (
        vgPlayback.state === 'intro' &&
        layer.classList.contains('vg-layer--visible') &&
        vgVideoGraphicTextDuringIntro()
    ) {
        /* Milford draw/results: text is shown mid-intro — don't hide on refresh. */
        return;
    } else {
        layer.classList.remove('vg-layer--visible', 'vg-layer--fade-in');
    }
}

function vgUpdateBgGraphicClass() {
    const bg = vgGetBgEl();
    if (!bg) return;
    bg.classList.toggle(
        'vg-bg--leader-shot',
        vgPlayback.graphic === 'leader' && vgIsMilfordBroadcastTheme(),
    );
}

function vgSetLayerGraphicClass(layer, modifier) {
    const keepVisible = layer.classList.contains('vg-layer--visible');
    const keepFadeOut = layer.classList.contains('vg-layer--fade-out');
    const keepRefresh = layer.classList.contains('kp-refresh');
    layer.className = `vg-layer ${modifier}`;
    if (keepVisible) layer.classList.add('vg-layer--visible');
    if (keepFadeOut) layer.classList.add('vg-layer--fade-out');
    if (keepRefresh) layer.classList.add('kp-refresh');
    /* Drop fade-in on re-render so live CSV refresh doesn't replay the cascade. */
    vgSyncLayerVisibility(layer);
}

function vgLoadBackgroundAsset(graphic) {
    const bg = vgGetBgEl();
    if (!bg) return { isVideo: false };
    const src = vgGetBackgroundSrc(graphic);

    if (src && vgIsVideoAsset(src)) {
        const video = vgEnsureBgVideo();
        bg.style.backgroundImage = '';
        bg.classList.remove('vg-bg--plain');
        if (video.dataset.src !== src) {
            video.dataset.src = src;
            video.src = src;
            video.load();
        }
        return { isVideo: true, video };
    }

    const video = vgGetBgVideo();
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.remove();
    }

    if (src) {
        bg.style.backgroundImage = `url('${src}')`;
        bg.classList.remove('vg-bg--plain');
    } else {
        bg.style.backgroundImage = '';
        bg.classList.add('vg-bg--plain');
    }
    return { isVideo: false };
}

function vgResetBackground() {
    const bg = vgGetBgEl();
    const video = vgGetBgVideo();
    if (video) {
        video.pause();
        video.playbackRate = 1;
        video.currentTime = 0;
    }
    if (bg) {
        bg.style.backgroundImage = '';
        bg.classList.remove(
            'vg-bg--visible',
            'vg-bg--outro',
            'vg-bg--plain',
            'vg-bg--fade-in',
            'vg-bg--fade-out',
        );
    }
    vgHideMap();
}

function vgGetMapWrap() {
    return document.getElementById('vgMapWrap');
}

function vgEnsureMapFrame() {
    let wrap = vgGetMapWrap();
    if (!wrap) {
        const stage = document.querySelector('.vg-stage');
        if (!stage) return null;
        wrap = document.createElement('div');
        wrap.id = 'vgMapWrap';
        wrap.className = 'vg-map-wrap';
        wrap.innerHTML =
            '<iframe class="vg-map-frame" id="vgMapFrame" title="Altitude HD speed overlay"></iframe>';
        stage.insertBefore(wrap, vgGetBgEl()?.nextSibling || null);
    }
    return wrap;
}

function vgLoadSpeedFrame() {
    const wrap = vgEnsureMapFrame();
    const frame = vgGetSpeedFrame();
    const embedUrl = vgBuildSpeedEmbedUrl();
    if (!wrap || !frame) return;
    if (frame.dataset.srcUrl !== embedUrl) {
        frame.dataset.srcUrl = embedUrl;
        frame.dataset.loaded = '0';
        frame.src = embedUrl;
    }
}

function vgStartSpeedIntro() {
    vgShowTextLayer(false);
    vgShowBackground(false);
    vgLoadSpeedFrame();
    vgShowMap(true, false);

    const frame = vgGetSpeedFrame();
    const sendIntro = () => vgPostToSpeedFrame('intro');
    if (frame) {
        if (frame.dataset.loaded === '1') {
            sendIntro();
        } else {
            frame.addEventListener('load', () => {
                frame.dataset.loaded = '1';
                sendIntro();
            }, { once: true });
        }
    }
    vgPlayback.introTimer = setTimeout(() => vgEnterHold(), 4500);
}

function vgShowMap(visible, outro) {
    const wrap = vgEnsureMapFrame();
    if (!wrap) return;
    wrap.classList.toggle('vg-map-wrap--visible', visible);
    wrap.classList.toggle('vg-map-wrap--outro', !!outro && visible);
}

function vgHideMap() {
    const wrap = vgGetMapWrap();
    if (wrap) {
        wrap.classList.remove('vg-map-wrap--visible', 'vg-map-wrap--outro');
    }
}

function vgPauseVideoAtHoldPoint(video) {
    if (!video) return;
    video.pause();
    video.playbackRate = 1;
    vgPlayback.videoHoldTime = video.currentTime;
}

/** Pause or seek to the configured hold frame (avoids early pause when WebM is still buffering). */
function vgHoldVideoAtProfilePoint(video, graphic) {
    if (!video) return;
    const profile = vgGetVideoProfile(graphic);
    const pauseAt = Number(profile.pauseAtMs);
    if (!Number.isFinite(pauseAt) || pauseAt <= 0) {
        vgPauseVideoAtHoldPoint(video);
        return;
    }
    const targetSec = pauseAt / 1000;
    /* Some VP9 WebMs cannot seek and would snap back to a blank frame 0. */
    if (video.currentTime >= targetSec - 0.08) {
        vgPauseVideoAtHoldPoint(video);
        return;
    }
    vgSeekVideoAndPause(video, pauseAt);
}

/** Dev / layout editor: ms into the WebM to show as the hold frame. */
function vgDevHoldVideoTimeMs(graphic) {
    const profile = vgGetVideoProfile(graphic);
    if (Number.isFinite(profile.pauseAtMs) && profile.pauseAtMs > 0) {
        return profile.pauseAtMs;
    }
    if (Number.isFinite(profile.textInMs) && profile.textInMs > 0) {
        return profile.textInMs;
    }
    return 0;
}

function vgSeekVideoAndPause(video, pauseMs) {
    if (!video) return;
    const ms = Math.max(0, Number(pauseMs) || 0);
    const applySeek = () => {
        const durationMs = Number.isFinite(video.duration)
            ? video.duration * 1000
            : null;
        const clamped =
            durationMs != null ? Math.min(ms, Math.max(0, durationMs - 50)) : ms;
        video.currentTime = clamped / 1000;
        video.pause();
        video.playbackRate = 1;
        vgPlayback.videoHoldTime = video.currentTime;
    };
    if (video.readyState >= 1) {
        applySeek();
    } else {
        video.addEventListener('loadedmetadata', applySeek, { once: true });
    }
}

/** Layout dev (?dev=1): seek background WebM to the saved pause point. */
function vgDevSeekVideoHold(pauseMsOverride) {
    if (!vgIsLayoutDevMode()) return null;
    const graphic = vgPlayback.graphic;
    if (!graphic || !vgIsVideoTheme()) return null;
    const video = vgGetBgVideo();
    if (!video) return null;
    const ms = Number.isFinite(pauseMsOverride)
        ? pauseMsOverride
        : vgDevHoldVideoTimeMs(graphic);
    vgSeekVideoAndPause(video, ms);
    return {
        pauseMs: ms,
        currentTime: video.currentTime,
        duration: video.duration,
    };
}

function vgIsKriTheme() {
    return document.body?.dataset?.vmixTheme === 'kri';
}

function vgIsKarapiroTheme() {
    return document.body?.dataset?.vmixTheme === 'karapiro';
}

function vgKarapiroOwns(graphic) {
    return vgIsKarapiroTheme() && !!window.VmixKarapiro?.owns(graphic);
}

function vgIsCssOverlayTheme() {
    return vgIsKriTheme() || vgIsKarapiroTheme();
}

/** KRI PNG graphics: background and text fade in together on hold. */
function vgKriDefersBackgroundFade() {
    return vgIsKriTheme();
}

function vgMilfordFadeTextOut() {
    const layer = vgGetLayerEl();
    if (!layer) return;
    layer.classList.remove('vg-layer--fade-in');
    layer.classList.add('vg-layer--fade-out');
    vgScheduleProfile(VG_MILFORD_FADE_MS, () => {
        vgShowTextLayer(false);
        layer.classList.remove('vg-layer--fade-out');
    });
}

function vgVideoGraphicEnterHold(video, graphic) {
    if (vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgHoldVideoAtProfilePoint(video, graphic);
    vgSetStageState('hold');
    if (graphic === 'leader' && vgIsMilfordBroadcastTheme()) {
        vgShowLeaderForConfiguredLane();
    } else {
        vgShowTextLayer(true);
        vgApplySavedLayout(graphic);
    }
}

/** Milford tracker: paused WebM + fleet-map speed/route overlay (speed.html iframe). */
function vgEnterSpeedTrackerHold(video) {
    if (vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgHoldVideoAtProfilePoint(video, 'speed');
    vgSetStageState('hold');
    vgShowTextLayer(false);
    vgLoadSpeedFrame();
    vgShowMap(true, false);
    vgSendSpeedOverlayPhase('hold');
}

function vgStartVideoGraphicIntro(graphic, video) {
    const profile = vgGetVideoProfile(graphic);
    vgShowBackground(true);
    const isLeaderOverlay =
        graphic === 'leader' && vgIsMilfordBroadcastTheme();
    if (isLeaderOverlay) {
        vgShowLeaderForConfiguredLane(true);
    } else {
        vgShowTextLayer(false);
    }

    video.loop = false;
    video.muted = true;
    video.playbackRate = 1;
    video.currentTime = 0;
    vgPlayback.videoHoldTime = null;

    vgArmVideoEndedReset(video);

    const beginPlayback = () => {
        if (vgPlayback.state !== 'intro' || vgPlayback.graphic !== graphic) return;

        if (!profile.noText && profile.textInMs != null) {
            vgScheduleProfile(profile.textInMs, () => {
                if (vgPlayback.state !== 'intro') return;
                if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
                    vgLoadSpeedFrame();
                    vgShowMap(true, false);
                    vgSendSpeedOverlayPhase('intro');
                    return;
                }
                vgShowTextLayer(true, { fadeIn: true });
                vgApplySavedLayout(graphic);
            });
        }

        if (profile.textOutMs != null) {
            vgScheduleProfile(profile.textOutMs, () => {
                if (vgPlayback.state === 'idle') return;
                vgMilfordFadeTextOut();
            });
        }

        if (profile.pauseAtMs != null) {
            vgScheduleProfile(profile.pauseAtMs, () => {
                if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
                    vgEnterSpeedTrackerHold(video);
                } else {
                    vgVideoGraphicEnterHold(video, graphic);
                }
            });
        }

        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                /* Autoplay blocked (normal browser) — still show the hold frame. */
                if (vgPlayback.state !== 'intro' || vgPlayback.graphic !== graphic) {
                    return;
                }
                vgHoldVideoAtProfilePoint(video, graphic);
            });
        }

        const safetyMs =
            (Number.isFinite(video.duration) ? video.duration * 1000 : 45000) + 8000;
        vgPlayback.introTimer = setTimeout(() => {
            if (vgPlayback.state !== 'idle') vgResetToIdle();
        }, safetyMs);
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        beginPlayback();
    } else {
        video.addEventListener('canplay', beginPlayback, { once: true });
    }
}

function vgStartIntroPlayback(isVideo, video) {
    if (isVideo && video && vgIsVideoTheme()) {
        vgStartVideoGraphicIntro(vgPlayback.graphic, video);
        return;
    }

    const graphic = vgPlayback.graphic;
    vgShowBackground(!vgKriDefersBackgroundFade() && !vgUsesCssBackground(graphic));
    vgShowTextLayer(false);

    /* CSS-built graphics: optional intro delay, then fade in on hold. */
    if (vgUsesCssBackground(graphic)) {
        const introMs = vgGetVideoProfile(graphic).textInMs || 0;
        const startHold = () => requestAnimationFrame(() => vgEnterHold());
        if (introMs > 0) {
            vgPlayback.introTimer = setTimeout(startHold, introMs);
        } else {
            startHold();
        }
        return;
    }

    vgPlayback.introTimer = setTimeout(() => vgEnterHold(), VG_HOLD_MS);
}

function vgEnterHold() {
    if (vgPlayback.state !== 'intro') return;
    vgClearPlaybackTimers();
    vgPauseVideoAtHoldPoint(vgGetBgVideo());
    vgSetStageState('hold');
    if (vgUsesCssBackground(vgPlayback.graphic)) {
        vgShowBackground(false);
    } else if (vgKriDefersBackgroundFade()) {
        vgShowBackground(true);
        const bg = vgGetBgEl();
        if (bg) bg.classList.add('vg-bg--fade-in');
    }
    vgShowTextLayer(true, { fadeIn: true });
    vgApplySavedLayout(vgPlayback.graphic);
    if (vgIsSpeedGraphic(vgPlayback.graphic) && vgMilfordCssGraphic('speed')) {
        vgLoadSpeedFrame();
        vgScheduleProfile(1000, () => {
            if (!vgIsSpeedGraphic(vgPlayback.graphic)) return;
            vgShowMap(true, false);
            vgSendSpeedOverlayPhase('intro');
        });
        vgScheduleProfile(3000, () => {
            if (!vgIsSpeedGraphic(vgPlayback.graphic)) return;
            vgSendSpeedOverlayPhase('hold');
        });
    }
}

function vgResumeVideoToEnd(video, onDone) {
    vgShowBackground(true);
    const bg = vgGetBgEl();
    if (bg) bg.classList.add('vg-bg--outro');

    const finish = () => {
        vgClearPlaybackTimers();
        vgShowTextLayer(false);
        onDone();
    };

    const startPlay = () => {
        video.playbackRate = 1;
        const onEnd = () => {
            video.removeEventListener('ended', onEnd);
            finish();
        };
        video.addEventListener('ended', onEnd, { once: true });
        const remain = Number.isFinite(video.duration)
            ? Math.max(500, (video.duration - video.currentTime) * 1000)
            : 15000;
        vgPlayback.outroTimer = setTimeout(finish, remain + 400);
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(finish);
        }
    };

    vgMilfordFadeTextOut();
    vgScheduleProfile(VG_MILFORD_FADE_MS, startPlay);
}

function vgStartOutroPlayback(isVideo, video) {
    const graphic = vgPlayback.graphic;
    const done = () => vgResetToIdle();

    if (vgIsSpeedGraphic(graphic) && !vgIsVideoTheme()) {
        vgShowBackground(false);
        vgShowMap(true, false);
        vgPostToSpeedFrame('outro');
        vgPlayback.outroTimer = setTimeout(done, 6000);
        return;
    }

    if (isVideo && video && vgIsVideoTheme()) {
        if (vgIsSpeedGraphic(graphic)) {
            vgPostToSpeedFrame('clear');
            vgHideMap();
        }
        vgSetStageState('outro');
        vgResumeVideoToEnd(video, done);
        return;
    }

    if (vgMilfordCssGraphic(graphic)) {
        vgSetStageState('outro');
        if (vgIsSpeedGraphic(graphic)) {
            vgPostToSpeedFrame('clear');
            vgHideMap();
        }
        vgStartMilfordOutroFade();
        vgPlayback.outroTimer = setTimeout(done, vgGetOutroFadeMs(graphic) + 100);
        return;
    }

    vgShowBackground(true);
    const bg = vgGetBgEl();
    if (bg) bg.classList.add('vg-bg--outro');

    if (vgIsKriTheme() || vgIsKarapiroTheme()) {
        vgStartKriOutroFade();
        const outroMs = vgGetOutroFadeMs(graphic);
        vgPlayback.outroTimer = setTimeout(done, outroMs + 100);
        return;
    }

    vgPlayback.outroTimer = setTimeout(done, VG_OUTRO_MS);
}

function vgResetToIdle() {
    vgPostToSpeedFrame('clear');
    vgClearPlaybackTimers();
    vgStopScheduleClock();
    vgPlayback.videoHoldTime = null;
    vgPlayback.graphic = null;
    vgLeaderLane = null;
    if (window.KriVmixSpeedChart) window.KriVmixSpeedChart.remove();
    if (window.KriVmixCvLeader) window.KriVmixCvLeader.remove();
    if (window.KriVmixCvDraw) window.KriVmixCvDraw.remove();
    if (window.KriVmixLiveTracking) window.KriVmixLiveTracking.remove();
    if (window.KriVmixWeather) window.KriVmixWeather.remove();
    if (window.KriVmixCourseScroll) window.KriVmixCourseScroll.remove();
    if (window.MilfordLaneCards) window.MilfordLaneCards.remove();
    vgSetStageState('idle');
    vgShowTextLayer(false);
    vgShowBackground(false);
    vgResetBackground();
    vgUpdateBgGraphicClass();
    const layer = vgGetLayerEl();
    if (layer) layer.replaceChildren();
}

function vgPostRaceCue(graphic) {
    if (graphic !== 'draw' && graphic !== 'results') return;
    fetch('/api/race-cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: graphic,
            race: vgGetRaceParam(),
            regatta: vgGetRegattaCode(),
        }),
        keepalive: true,
    }).catch(() => {});
}

function vgTriggerIn(graphic) {
    vgPostRaceCue(graphic);
    if (vgPlayback.state !== 'idle') return;
    const kpOwns = vgKarapiroOwns(graphic);
    if (!kpOwns) {
        if (vgIsSpeedGraphic(graphic) && !vgSpeedEnabled()) return;
        if (vgIsSpeedChartGraphic(graphic) && !vgSpeedChartEnabled()) return;
        if (vgIsLiveTrackingGraphic(graphic) && !vgLiveTrackingEnabled()) return;
        if (vgIsCvLeaderGraphic(graphic) && !vgCvLeaderEnabled()) return;
        if (vgIsCvDrawGraphic(graphic) && !vgCvDrawEnabled()) return;
        if (vgIsCourseScrollGraphic(graphic) && !vgCourseScrollEnabled()) return;
        if (vgIsWeatherGraphic(graphic) && !vgWeatherEnabled()) return;
        if (vgIsLanesGraphic(graphic) && !vgLanesEnabled()) return;
    }
    if (vgIsScheduleGraphic(graphic) && !vgIsCssOverlayTheme()) return;

    vgPlayback.graphic = graphic;
    vgSetStageState('intro');
    vgHideMap();
    vgUpdateBgGraphicClass();

    if (!kpOwns && vgIsSpeedChartGraphic(graphic)) {
        vgStartSpeedChartIntro();
        return;
    }

    if (!kpOwns && vgIsLiveTrackingGraphic(graphic)) {
        vgStartLiveTrackingIntro();
        return;
    }

    if (!kpOwns && vgIsCvLeaderGraphic(graphic)) {
        vgStartCvLeaderIntro();
        return;
    }

    if (!kpOwns && vgIsCvDrawGraphic(graphic)) {
        vgStartCvDrawIntro();
        return;
    }

    if (!kpOwns && vgIsCourseScrollGraphic(graphic)) {
        vgStartCourseScrollIntro();
        return;
    }

    if (!kpOwns && vgIsWeatherGraphic(graphic)) {
        vgStartWeatherIntro();
        return;
    }

    if (!kpOwns && vgIsLanesGraphic(graphic)) {
        vgStartLanesIntro();
        return;
    }

    if (vgIsSpeedGraphic(graphic) && vgMilfordCssGraphic(graphic)) {
        vgPrepareTrackerContent();
        vgStartIntroPlayback(false, null);
        return;
    }

    if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
        vgPrepareTrackerContent();
        vgLoadSpeedFrame();
        const { isVideo, video } = vgLoadBackgroundAsset('speed');
        vgStartIntroPlayback(isVideo, video);
        return;
    }

    if (vgIsSpeedGraphic(graphic)) {
        vgStartSpeedIntro();
        return;
    }

    vgPrepareContent(graphic, vgGetRaceParam());
    if (vgUsesCssBackground(graphic)) {
        vgStartIntroPlayback(false, null);
        return;
    }
    const { isVideo, video } = vgLoadBackgroundAsset(graphic);
    vgStartIntroPlayback(isVideo, video);
}

function vgTriggerOut() {
    const graphic = vgPlayback.graphic;
    if (!vgKarapiroOwns(graphic)) {
        if (vgIsSpeedChartGraphic(graphic)) {
            vgStartSpeedChartOutro();
            return;
        }
        if (vgIsLiveTrackingGraphic(graphic)) {
            vgStartLiveTrackingOutro();
            return;
        }
        if (vgIsCvLeaderGraphic(graphic)) {
            vgStartCvLeaderOutro();
            return;
        }
        if (vgIsCvDrawGraphic(graphic)) {
            vgStartCvDrawOutro();
            return;
        }
        if (vgIsCourseScrollGraphic(graphic)) {
            vgStartCourseScrollOutro();
            return;
        }
        if (vgIsWeatherGraphic(graphic)) {
            vgStartWeatherOutro();
            return;
        }
        if (vgIsLanesGraphic(graphic)) {
            vgStartLanesOutro();
            return;
        }
    }
    const video = vgGetBgVideo();
    const isThemeVideo =
        !vgUsesCssBackground(graphic) &&
        !!video &&
        vgIsVideoTheme() &&
        vgIsVideoAsset(vgGetBackgroundSrc(graphic));

    if (
        vgPlayback.state === 'intro' &&
        isThemeVideo &&
        vgGetVideoProfile(graphic).pauseAtMs != null
    ) {
        vgClearPlaybackTimers();
        if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
            vgEnterSpeedTrackerHold(video);
        } else {
            vgVideoGraphicEnterHold(video, graphic);
        }
        return;
    }

    if (vgPlayback.state !== 'hold' && vgPlayback.state !== 'intro') return;

    if (isThemeVideo && vgGetVideoProfile(graphic).playThrough) {
        vgMilfordFadeTextOut();
        return;
    }

    if (vgPlayback.state !== 'hold') return;
    vgSetStageState('outro');
    if (vgIsSpeedGraphic(graphic) && !isThemeVideo) {
        vgStartOutroPlayback(false, null);
        return;
    }
    vgStartOutroPlayback(isThemeVideo, video);
}

function vgTriggerClear() {
    vgClearPlaybackTimers();
    vgResetToIdle();
}

function vgPrepareTrackerContent() {
    const layer = vgGetLayerEl();
    if (!layer) return;
    layer.replaceChildren();
    vgSetLayerGraphicClass(layer, 'vg-layer--tracker');
    if (vgMilfordCssGraphic('speed')) {
        vgAppendMilfordBoardChrome(layer, 'speed');
        return;
    }
    if (vgIsVideoTheme()) {
        return;
    }
    let label = 'Live tracking';
    try {
        const s = JSON.parse(localStorage.getItem(VG_LS_SPEED) || '{}');
        if (s.deviceId) label = `Tracker · device ${s.deviceId}`;
    } catch {
        /* ignore */
    }
    layer.appendChild(vgEl('p', 'vg-tracker-label', label));
}

function vgPrepareContent(graphic, raceParam) {
    const layer = vgGetLayerEl();
    const err = document.getElementById('vgError');
    if (!layer) return;
    if (graphic !== 'schedule') vgStopScheduleClock();
    if (vgKarapiroOwns(graphic)) {
        const race = vgFindRace(raceParam);
        const g = window.VmixKarapiro.canon(graphic);
        if (
            !race &&
            g !== 'title' &&
            g !== 'schedule' &&
            g !== 'weather' &&
            g !== 'brand' &&
            g !== 'coursescroll'
        ) {
            if (err) {
                err.hidden = false;
                err.textContent = 'No race data — check regatta code and daysheet.';
            }
            layer.replaceChildren();
            return;
        }
        if (err) err.hidden = true;
        layer.classList.toggle('kp-refresh', vgHoldRefreshing);
        layer.replaceChildren();
        window.VmixKarapiro.render(layer, graphic, race);
        layer.classList.toggle('kp-refresh', vgHoldRefreshing);
        vgSyncLayerVisibility(layer);
        vgApplySavedLayout(graphic);
        window.VmixKarapiro.paintOps?.();
        return;
    }
    if (vgIsSpeedGraphic(graphic) || vgIsSpeedChartGraphic(graphic) || vgIsLiveTrackingGraphic(graphic) || vgIsCvLeaderGraphic(graphic) || vgIsWeatherGraphic(graphic) || vgIsLanesGraphic(graphic)) return;

    const race = vgFindRace(raceParam);

    if (!race && graphic !== 'title' && graphic !== 'schedule') {
        if (err) {
            err.hidden = false;
            err.textContent = 'No race data — check regatta code and daysheet.';
        }
        layer.replaceChildren();
        return;
    }
    if (err) err.hidden = true;

    layer.replaceChildren();
    layer.classList.toggle('kp-refresh', vgHoldRefreshing);
    if (graphic === 'title') vgRenderTitle(layer, race);
    else if (graphic === 'lower') vgRenderLower(layer, race);
    else if (graphic === 'draw') vgRenderDraw(layer, race);
    else if (graphic === 'results') vgRenderResults(layer, race);
    else if (graphic === 'schedule') vgRenderSchedule(layer, raceParam);
    else if (graphic === 'leader') {
        const lane = vgLeaderLane ?? vgGetLeaderLane();
        vgRenderLeader(layer, race, lane);
    }

    vgSyncLayerVisibility(layer);
    vgApplySavedLayout(graphic);
}

function vgApplySavedLayout(graphic) {
    const theme = document.body?.dataset?.vmixTheme;
    if (!theme || !graphic || !window.VmixLayout) return;
    window.VmixLayout.apply(theme, graphic);
}

function vgEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

/** Pixel intros extracted from the Milford MOVs (see public/assets/vmix/milford/css-graphics.json). */
const VG_MF_BOARD_INTRO = {
    draw: { kind: 'anim' },
    results: { kind: 'anim' },
    title: { kind: 'anim' },
    leader: { kind: 'sprite' },
    tracker: { kind: 'sprite' },
};

function vgAppendMilfordBoardChrome(layer, graphic) {
    if (!vgIsMilfordTheme()) return;
    const id = vgMilfordChromeAssetId(graphic);
    const spec = VG_MF_BOARD_INTRO[id];
    if (!spec) return;
    const wrap = vgEl('div', `mf-board mf-board--${id}`);
    wrap.setAttribute('aria-hidden', 'true');
    wrap.dataset.vgLayout = `mf-board-${id}`;
    if (spec.kind === 'sprite') {
        const intro = vgEl('div', `mf-board-intro mf-board-intro--${id} mf-board-intro--sprite`);
        intro.setAttribute('aria-hidden', 'true');
        wrap.appendChild(intro);
    } else {
        const intro = document.createElement('img');
        intro.className = `mf-board-intro mf-board-intro--${id} mf-board-intro--anim`;
        intro.src = `assets/vmix/milford/${id}-intro.webp?v=1`;
        intro.alt = '';
        intro.setAttribute('aria-hidden', 'true');
        wrap.appendChild(intro);
    }
    const plate = document.createElement('img');
    plate.className = `mf-board-plate mf-board-plate--${id}`;
    plate.src = `assets/vmix/milford/${id}-plate.png?v=1`;
    plate.alt = '';
    plate.setAttribute('aria-hidden', 'true');
    wrap.appendChild(plate);
    layer.appendChild(wrap);
}

function vgRestartMilfordIntros(layer) {
    if (!layer || layer.classList.contains('kp-refresh')) return;
    layer.querySelectorAll('.mf-board-intro--anim').forEach((el) => {
        if (el.tagName === 'IMG') {
            const src = el.getAttribute('src');
            el.removeAttribute('src');
            el.setAttribute('src', src);
        }
    });
}

function vgMilfordLowerImg(className, src, layoutId) {
    const img = document.createElement('img');
    img.className = className;
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.dataset.vgLayout = layoutId;
    return img;
}

const KRI_LOGO_SRC = 'assets/kri/kri-logo-full.png';
const KRI_LOGO_MARK_SRC = 'assets/kri/kri-logo.png';
const KRI_SPONSOR_IMAGES_URL = 'data/kri-sponsor-images.json';
const KRI_SPONSOR_ASSETS = 'assets/kri/sponsors/';

/** @type {string[]} */
let vgKriSponsorImages = [];

function vgKriCreateShell(opts = {}) {
    const shell = vgEl('div', 'vg-kri-shell');
    shell.dataset.vgLayout = 'kri-shell';
    const logo = document.createElement('img');
    logo.className = 'vg-kri-logo';
    if (opts.useMarkLogo) {
        logo.classList.add('vg-kri-logo--mark');
        logo.src = KRI_LOGO_MARK_SRC;
    } else {
        logo.src = KRI_LOGO_SRC;
    }
    logo.alt = '';
    logo.dataset.vgLayout = 'kri-logo';
    shell.appendChild(logo);
    return shell;
}

function vgKriCreatePanel(modifier) {
    const panel = vgEl('div', `vg-kri-panel${modifier ? ` vg-kri-panel--${modifier}` : ''}`);
    panel.dataset.vgLayout = modifier ? `kri-panel-${modifier}` : 'kri-panel';
    return panel;
}

function vgKriCreateLowerLogoBox() {
    const box = vgEl('div', 'vg-kri-lower-logo-box');
    box.dataset.vgLayout = 'kri-lower-logo-box';
    const img = document.createElement('img');
    img.className = 'vg-kri-lower-logo-mark';
    img.src = KRI_LOGO_MARK_SRC;
    img.alt = '';
    img.width = 73;
    img.height = 73;
    img.dataset.vgLayout = 'kri-lower-logo-mark';
    box.appendChild(img);
    return box;
}

async function vgLoadKriSponsorImages() {
    if (vgKriSponsorImages.length) return vgKriSponsorImages;
    try {
        const res = await fetch(KRI_SPONSOR_IMAGES_URL);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                vgKriSponsorImages = data.filter((name) => typeof name === 'string' && name.trim());
            }
        }
    } catch {
        /* ignore — sponsor box hidden if list empty */
    }
    return vgKriSponsorImages;
}

function vgKriRandomSponsorUrl() {
    if (!vgKriSponsorImages.length) return '';
    const file = vgKriSponsorImages[Math.floor(Math.random() * vgKriSponsorImages.length)];
    return `${KRI_SPONSOR_ASSETS}${encodeURIComponent(file)}`;
}

function vgKriCreateLowerSponsorBox() {
    const box = vgEl('div', 'vg-kri-lower-sponsor-box');
    box.dataset.vgLayout = 'kri-lower-sponsor';
    box.appendChild(vgEl('span', 'vg-kri-lower-sponsor-label', 'Race Sponsor'));
    const src = vgKriRandomSponsorUrl();
    if (src) {
        const img = document.createElement('img');
        img.className = 'vg-kri-lower-sponsor-img';
        img.src = src;
        img.alt = '';
        img.dataset.vgLayout = 'kri-lower-sponsor-img';
        box.appendChild(img);
    }
    return box;
}

const VG_KP_FESTIVE_LS = 'altitudeHdKpFestive_v1';
const VG_KP_CHRISTMAS = { start: '2026-12-11', end: '2026-12-13' };

function vgKpTodayYmdNz() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Auckland',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function vgKpChristmasWindow() {
    const today = vgKpTodayYmdNz();
    return today >= VG_KP_CHRISTMAS.start && today <= VG_KP_CHRISTMAS.end;
}

/** Snow, candy bars, Santa hat: off for general use; on for Christmas weekend or ?festive=1. */
function vgKpFestive() {
    const p = new URLSearchParams(location.search);
    const q = String(p.get('festive') || '')
        .trim()
        .toLowerCase();
    if (q === '0' || q === 'false' || q === 'off' || q === 'no') return false;
    if (q === '1' || q === 'true' || q === 'on' || q === 'yes') return true;
    try {
        const ls = localStorage.getItem(VG_KP_FESTIVE_LS);
        if (ls === '0') return false;
        if (ls === '1') return true;
    } catch {
        /* ignore */
    }
    return vgKpChristmasWindow();
}

function vgKpRaceChip(race) {
    const n = race?.raceNum ?? race?.race ?? '';
    return n === '' ? 'R—' : `R${n}`;
}

function vgKpAbbr(code) {
    const club = vgParseClubCode(code);
    const id = (club.id || '').toUpperCase();
    return id ? id.slice(0, 4) : '—';
}

function vgKpLogo(size) {
    const wrap = vgEl('div', 'kp-logo');
    wrap.innerHTML =
        `<svg viewBox="0 0 100 126" width="${size}" height="${Math.round(size * 1.26)}" aria-hidden="true">` +
        ['#4a97ee', '#2e7de0', '#1b5cb4', '#12325e']
            .map((c, r) => {
                const y = r * 26;
                return (
                    `<path d="M2 ${4 + y} L38 ${40 + y} L74 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>` +
                    `<path d="M26 ${4 + y} L62 ${40 + y} L98 ${4 + y}" stroke="${c}" stroke-width="9" fill="none"/>`
                );
            })
            .join('') +
        '</svg>';
    return wrap;
}

function vgKpSponsorBox() {
    const box = vgEl('div', 'kp-lower-sponsor');
    box.appendChild(vgEl('span', 'kp-lower-sponsor-label', 'Race sponsor'));
    const src = vgKriRandomSponsorUrl();
    if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        box.appendChild(img);
    }
    return box;
}

function vgKpRowLogo(info) {
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'kp-row-logo';
        img.src = info.logoUrl;
        img.alt = '';
        return img;
    }
    return vgEl('span', 'kp-row-logo kp-row-logo--empty');
}

function vgRenderKarapiroTitle(layer, race) {
    const day = race
        ? vgFormatDayLabel(race.dayLabel)
        : vgState.races[0]
          ? vgFormatDayLabel(vgState.races[0].dayLabel)
          : '';
    const root = vgEl('div', 'kp-title');
    root.appendChild(vgKpLogo(130));
    root.appendChild(vgEl('h1', 'kp-title-word', 'Karāpiro Rowing'));
    root.appendChild(
        vgEl('p', 'kp-title-kicker', vgKpFestive() ? 'Christmas Regatta' : (vgRegattaTitle() || 'Lake Karāpiro')),
    );
    const metaBits = ['Lake Karāpiro', day, '2000m'].filter(Boolean);
    root.appendChild(vgEl('p', 'kp-title-meta', metaBits.join(' · ')));
    const live = vgEl('p', 'kp-title-live');
    live.appendChild(vgEl('span', 'kp-live-dot'));
    live.appendChild(document.createTextNode('Live from Lake Karāpiro'));
    root.appendChild(live);
    layer.appendChild(root);
}

function vgRenderKarapiroLower(layer, race) {
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const roundLabel = vgFormatRoundLabel(race.round, race.division);
    const subParts = [
        roundLabel,
        vgFormatScheduleTime(race.startAt),
        race.progression,
    ].filter(Boolean);
    const wrap = vgEl('div', 'kp-lower');
    wrap.dataset.vgLayout = 'lower';
    const chip = vgEl('div', 'kp-chip', vgKpRaceChip(race));
    chip.dataset.vgLayout = 'lower-meta';
    wrap.appendChild(chip);
    const main = vgEl('div', 'kp-lower-main');
    const eventEl = vgEl('h2', 'kp-lower-event', fullName);
    eventEl.dataset.vgLayout = 'lower-event';
    main.appendChild(eventEl);
    if (subParts.length) {
        const sub = vgEl('p', 'kp-lower-sub', subParts.join(' · '));
        sub.dataset.vgLayout = 'lower-race';
        main.appendChild(sub);
    }
    wrap.appendChild(main);
    wrap.appendChild(vgKpSponsorBox());
    layer.appendChild(wrap);
}

function vgRenderKarapiroBoard(layer, race, mode) {
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const isResults = mode === 'results';
    const isSchedule = mode === 'schedule';
    const board = vgEl('div', 'kp-board');
    const head = vgEl('div', 'kp-board-head');
    head.dataset.vgLayout = isResults ? 'results-head' : isSchedule ? 'schedule-head' : 'draw-head';
    head.appendChild(vgEl('div', 'kp-chip', vgKpRaceChip(race)));
    const copy = vgEl('div', 'kp-board-copy');
    copy.appendChild(
        vgEl(
            'p',
            'kp-board-kicker',
            isResults ? 'Results' : isSchedule ? 'Upcoming' : 'Start list',
        ),
    );
    copy.appendChild(vgEl('h2', 'kp-board-title', isSchedule ? 'Schedule' : fullName));
    const meta = isSchedule
        ? vgScheduleMetaText()
        : `Race ${race.race} · ${vgFormatRoundLabel(race.round, race.division) || race.round || ''}`.trim();
    copy.appendChild(vgEl('p', 'kp-board-meta', meta));
    head.appendChild(copy);
    board.appendChild(head);

    const list = vgEl('ul', 'kp-rows');
    list.dataset.vgLayout = isResults ? 'results-lanes' : isSchedule ? 'schedule-rows' : 'draw-lanes';

    if (isSchedule) {
        const { current, upcoming } = vgGetUpcomingRaces(vgGetRaceParam(), 10);
        if (!upcoming.length) {
            list.appendChild(vgEl('li', 'kp-row kp-empty', 'No races on daysheet'));
        } else {
            for (const row of upcoming) {
                const li = vgEl('li', 'kp-row kp-row--schedule');
                if (current && row.race === current.race && row.raceNum === current.raceNum) {
                    li.classList.add('kp-row--current');
                }
                li.appendChild(vgEl('span', 'kp-sched-time', vgFormatScheduleTime(row.startAt)));
                li.appendChild(vgEl('span', 'kp-sched-race', `Race ${row.race}`));
                li.appendChild(
                    vgEl('span', 'kp-row-club', vgExpandEventName(row.eventType, vgState.lookup)),
                );
                const chip = vgEl(
                    'span',
                    'kp-sched-chip',
                    current && row.race === current.race ? 'On water' : vgFormatRoundLabel(row.round, row.division) || '—',
                );
                li.appendChild(chip);
                list.appendChild(li);
            }
        }
    } else if (isResults) {
        const result = vgState.results.get(race.raceNum);
        if (result?.placings?.length) {
            result.placings.forEach((p, i) => {
                const club = vgParseClubCode(p.competitor);
                const info = vgClubInfo(club.id, vgState.lookup);
                const li = vgEl('li', `kp-row kp-row--results${i === 0 ? ' kp-row--first' : ''}`);
                li.appendChild(vgEl('span', 'kp-lane', String(p.place)));
                li.appendChild(vgKpRowLogo(info));
                const name = vgEl('span', 'kp-row-club', info.name);
                name.dataset.vgLayoutTarget = 'results-crew';
                li.appendChild(name);
                li.appendChild(vgEl('span', 'kp-row-time', p.time || ''));
                list.appendChild(li);
            });
        } else {
            list.appendChild(vgEl('li', 'kp-row kp-empty', 'Results not available'));
        }
    } else {
        for (const lane of race.lanes) {
            if (!lane.code) continue;
            const club = vgParseClubCode(lane.code);
            const info = vgClubInfo(club.id, vgState.lookup);
            const li = vgEl('li', 'kp-row');
            li.appendChild(vgEl('span', 'kp-lane', String(lane.lane)));
            li.appendChild(vgKpRowLogo(info));
            const name = vgEl('span', 'kp-row-club', info.name);
            name.dataset.vgLayoutTarget = 'draw-crew';
            li.appendChild(name);
            li.appendChild(vgEl('span', 'kp-row-abbr', vgKpAbbr(lane.code)));
            list.appendChild(li);
        }
    }
    board.appendChild(list);
    const foot = vgEl('div', 'kp-board-foot');
    const laneCount = (race.lanes || []).filter((l) => l.code).length;
    foot.appendChild(
        vgEl('span', '', `Lake Karāpiro · 2000m${laneCount ? ` · ${laneCount} lanes` : ''}`),
    );
    board.appendChild(foot);
    layer.appendChild(board);
}

function vgRenderKarapiroLeader(layer, race, laneNum) {
    const entry = vgFindDrawLane(race, laneNum);
    if (!entry) return;
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, vgState.lookup);
    const wrap = vgEl('div', 'vg-leader-wrap');
    wrap.dataset.vgLayout = 'leader-wrap';
    const card = vgEl('div', 'kp-leader');
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'kp-leader-logo';
        img.src = info.logoUrl;
        img.alt = '';
        img.dataset.vgLayout = 'leader-logo';
        card.appendChild(img);
    }
    const copy = vgEl('div', 'kp-leader-copy');
    const kicker = vgEl('p', 'kp-leader-kicker', 'Leader');
    kicker.dataset.vgLayout = 'leader-badge';
    copy.appendChild(kicker);
    const name = vgEl('p', 'kp-leader-name vg-leader-crew', info.name);
    name.dataset.vgLayout = 'leader-crew';
    copy.appendChild(name);
    const lane = vgEl('p', 'kp-leader-lane', `Lane ${laneNum}`);
    lane.dataset.vgLayout = 'leader-badge-lane';
    copy.appendChild(lane);
    card.appendChild(copy);
    wrap.appendChild(card);
    layer.appendChild(wrap);
}

function vgKriAppendHead(panel, { kicker, title, meta, layoutId = 'kri-head', parts = null }) {
    const head = vgEl('div', 'vg-kri-head');
    head.dataset.vgLayout = layoutId;
    if (kicker) {
        const p = vgEl('p', 'vg-kri-kicker', kicker);
        if (parts?.kicker) p.dataset.vgLayout = parts.kicker;
        head.appendChild(p);
    }
    if (title) {
        const h = vgEl('h2', 'vg-kri-heading', title);
        if (parts?.title) h.dataset.vgLayout = parts.title;
        head.appendChild(h);
    }
    if (meta) {
        const p = vgEl('p', 'vg-kri-meta', meta);
        if (parts?.meta) p.dataset.vgLayout = parts.meta;
        head.appendChild(p);
    }
    panel.appendChild(head);
    return head;
}

function vgKriAppendCols(panel, labels, { layoutId = 'kri-cols' } = {}) {
    const cols = vgEl('div', 'vg-kri-cols');
    cols.dataset.vgLayout = layoutId;
    for (const { text, className } of labels) {
        cols.appendChild(vgEl('span', className ? `vg-kri-col ${className}` : 'vg-kri-col', text));
    }
    panel.appendChild(cols);
    return cols;
}

function vgKriBuildLaneLogo(info, layoutTarget) {
    const wrap = vgEl('span', 'vg-lane-logo-wrap');
    if (layoutTarget) wrap.dataset.vgLayoutTarget = layoutTarget;
    wrap.appendChild(vgEl('span', 'vg-lane-logo-halo'));
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-lane-logo';
        img.src = info.logoUrl;
        img.alt = '';
        if (layoutTarget) img.dataset.vgLayoutTarget = layoutTarget;
        wrap.appendChild(img);
    } else {
        const ph = vgEl('span', 'vg-lane-logo vg-lane-logo--empty');
        if (layoutTarget) ph.dataset.vgLayoutTarget = layoutTarget;
        wrap.appendChild(ph);
    }
    return wrap;
}

function vgBuildKriDrawLaneRow(entry, lookup) {
    const li = vgEl('li', 'vg-lane vg-lane--draw');
    const laneN = vgEl('span', 'vg-lane-n', String(entry.lane));
    laneN.dataset.vgLayoutTarget = 'draw-lane-n';
    li.appendChild(laneN);
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, lookup);
    li.appendChild(vgKriBuildLaneLogo(info, 'draw-logo'));
    const crew = vgEl('div', 'vg-lane-crew');
    crew.dataset.vgLayoutTarget = 'draw-crew';
    crew.appendChild(vgEl('span', 'vg-lane-club', info.name));
    li.appendChild(crew);
    return li;
}

function vgBuildKriResultsLaneRow(entry, lookup) {
    const li = vgEl('li', 'vg-lane');
    const laneN = vgEl('span', 'vg-lane-n', String(entry.lane));
    laneN.dataset.vgLayoutTarget = 'results-lane-n';
    li.appendChild(laneN);
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, lookup);
    li.appendChild(vgKriBuildLaneLogo(info, 'results-logo'));
    const crew = vgEl('div', 'vg-lane-crew');
    crew.dataset.vgLayoutTarget = 'results-crew';
    crew.appendChild(vgEl('span', 'vg-lane-club', info.name));
    li.appendChild(crew);
    if (entry.time) {
        li.appendChild(vgEl('span', 'vg-lane-time', entry.time));
    }
    return li;
}

function vgRenderTitle(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--title');
    layer.dataset.vgLayout = 'title';
    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroTitle(layer, race);
        return;
    }
    const headline = vgRegattaTitle();
    const day = race
        ? vgFormatDayLabel(race.dayLabel)
        : vgState.races[0]
          ? vgFormatDayLabel(vgState.races[0].dayLabel)
          : '';
    if (vgIsKriTheme()) {
        const shell = vgKriCreateShell();
        const panel = vgKriCreatePanel('title');
        panel.appendChild(vgEl('h1', 'vg-title-code', headline));
        if (day) panel.appendChild(vgEl('p', 'vg-title-date', day));
        shell.appendChild(panel);
        layer.appendChild(shell);
        return;
    }
    if (vgIsMilfordTheme()) {
        vgAppendMilfordBoardChrome(layer, 'title');
    }
    const codeEl = vgEl('h1', 'vg-title-code', headline);
    codeEl.dataset.vgLayout = 'title-code';
    layer.appendChild(codeEl);
    if (day) {
        const dayEl = vgEl('p', 'vg-title-date', day);
        dayEl.dataset.vgLayout = 'title-date';
        layer.appendChild(dayEl);
    }
}

function vgKriCapitalizeFirst(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Daysheet Round + Division columns → e.g. heat/1 → "Heat 1", final/A → "Final A". */
function vgFormatRoundLabel(round, division) {
    const r = String(round || '').trim();
    if (!r) return String(division || '').trim();
    const word = vgKriCapitalizeFirst(r);
    const div = String(division || '').trim();
    return div ? `${word} ${div}` : word;
}

function vgRenderLower(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--lower');
    layer.dataset.vgLayout = 'lower';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroLower(layer, race);
        return;
    }
    if (vgIsKriTheme()) {
        const shell = vgKriCreateShell({ useMarkLogo: true });
        shell.classList.add('vg-kri-shell--lower');
        const wrap = vgEl('div', 'vg-kri-lower-wrap');
        wrap.dataset.vgLayout = 'kri-lower-wrap';
        wrap.appendChild(vgKriCreateLowerLogoBox());
        const main = vgEl('div', 'vg-kri-lower-main');
        main.dataset.vgLayout = 'kri-lower-main';
        const panel = vgKriCreatePanel('lower');
        if (race.progression) {
            const progBox = vgEl('div', 'vg-kri-lower-progression-box');
            progBox.dataset.vgLayout = 'kri-lower-progression';
            progBox.appendChild(
                vgEl('span', 'vg-kri-lower-progression-text', race.progression),
            );
            panel.appendChild(progBox);
        }
        const body = vgEl('div', 'vg-kri-lower-body');
        body.dataset.vgLayout = 'kri-lower-body';
        body.appendChild(vgEl('p', 'vg-lower-meta', `Race ${race.race}`));
        const raceEl = vgEl('p', 'vg-lower-race');
        raceEl.appendChild(vgEl('span', 'vg-lower-race-time', vgFormatTime(race.startAt)));
        if (race.round) {
            raceEl.appendChild(vgEl('span', 'vg-lower-race-round', race.round));
        }
        body.appendChild(raceEl);
        body.appendChild(vgEl('h2', 'vg-lower-event', fullName));
        panel.appendChild(body);
        main.appendChild(panel);
        main.appendChild(vgKriCreateLowerSponsorBox());
        wrap.appendChild(main);
        shell.appendChild(wrap);
        layer.appendChild(shell);
        return;
    }
    const raceNumber = `Race ${race.race}`;
    const roundLabel = vgFormatRoundLabel(race.round, race.division);
    const progressionLabel = race.progression || '';

    if (vgIsMilfordBroadcastTheme()) {
        if (vgIsMilfordTheme()) {
            const chrome = vgEl('div', 'mf-lower-chrome');
            chrome.dataset.vgLayout = 'mf-lower-chrome';
            const intro = vgEl('div', 'mf-lower-intro');
            intro.setAttribute('aria-hidden', 'true');
            intro.dataset.vgLayout = 'mf-lower-intro';
            chrome.appendChild(intro);
            chrome.appendChild(
                vgMilfordLowerImg(
                    'mf-lower-mountains',
                    'assets/vmix/milford/lower-mountains.png?v=2',
                    'mf-lower-mountains',
                ),
            );
            chrome.appendChild(
                vgMilfordLowerImg(
                    'mf-lower-logo-dock',
                    'assets/vmix/milford/lower-logo-dock.png?v=3',
                    'mf-lower-logo-dock',
                ),
            );
            chrome.appendChild(
                vgMilfordLowerImg(
                    'mf-lower-logo-art',
                    'assets/vmix/milford/lower-logo-art.png?v=2',
                    'mf-lower-logo-art',
                ),
            );
            chrome.appendChild(
                vgMilfordLowerImg(
                    'mf-lower-bars',
                    'assets/vmix/milford/lower-bars.png?v=2',
                    'mf-lower-bars',
                ),
            );
            layer.appendChild(chrome);
        }
        const metaEl = vgEl('p', 'vg-lower-meta', roundLabel);
        metaEl.dataset.vgLayout = 'lower-meta';
        layer.appendChild(metaEl);

        if (vgIsMilfordTheme()) {
            const timeEl = vgEl(
                'p',
                'vg-lower-race-time',
                vgFormatScheduleTime(race.startAt).replace(/\s+(am|pm)$/, '$1'),
            );
            timeEl.dataset.vgLayout = 'lower-race-time';
            layer.appendChild(timeEl);

            const numEl = vgEl('p', 'vg-lower-race-number', raceNumber);
            numEl.dataset.vgLayout = 'lower-race-number';
            layer.appendChild(numEl);
        } else {
            const raceEl = vgEl('p', 'vg-lower-race');
            raceEl.appendChild(
                vgEl(
                    'span',
                    'vg-lower-race-time',
                    vgFormatScheduleTime(race.startAt).replace(/\s+(am|pm)$/, '$1'),
                ),
            );
            raceEl.appendChild(vgEl('span', 'vg-lower-race-number', raceNumber));
            raceEl.dataset.vgLayout = 'lower-race';
            layer.appendChild(raceEl);
        }

        if (progressionLabel) {
            const progEl = vgEl('p', 'vg-lower-progression', progressionLabel);
            progEl.dataset.vgLayout = 'lower-progression';
            layer.appendChild(progEl);
        }

        const eventEl = vgEl('h2', 'vg-lower-event', fullName);
        eventEl.dataset.vgLayout = 'lower-event';
        layer.appendChild(eventEl);
        return;
    }

    const metaEl = vgEl('p', 'vg-lower-meta', raceNumber);
    metaEl.dataset.vgLayout = 'lower-meta';
    layer.appendChild(metaEl);

    const raceEl = vgEl('p', 'vg-lower-race');
    const timeLabel = vgFormatTime(race.startAt);
    raceEl.appendChild(vgEl('span', 'vg-lower-race-time', timeLabel));
    if (race.round) {
        raceEl.appendChild(document.createTextNode(' · '));
        raceEl.appendChild(vgEl('span', 'vg-lower-race-round', race.round));
    }
    if (progressionLabel) {
        raceEl.appendChild(vgEl('span', 'vg-lower-race-progression', progressionLabel));
    }
    raceEl.dataset.vgLayout = 'lower-race';
    layer.appendChild(raceEl);
    const eventEl = vgEl('h2', 'vg-lower-event', fullName);
    eventEl.dataset.vgLayout = 'lower-event';
    layer.appendChild(eventEl);
}

function vgThemeId() {
    return document.body?.dataset?.vmixTheme || '';
}

/** Lane numbers are baked into Milford draw; results (blank plate) uses HTML placing. */
function vgShowLaneNumber(mode) {
    const theme = vgThemeId();
    if (theme === 'rnz-milford') return mode === 'results';
    return theme !== 'kri' && theme !== 'beachsprints-milford';
}

function vgShowAthleteNames(mode) {
    if (mode === 'draw') return false;
    const theme = vgThemeId();
    return (
        theme !== 'kri' &&
        theme !== 'rnz-milford' &&
        theme !== 'beachsprints-milford'
    );
}

function vgBuildLaneRow(entry, lookup, mode) {
    const li = vgEl('li', `vg-lane${mode === 'draw' ? ' vg-lane--draw' : ''}`);
    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, lookup);
    if (vgShowLaneNumber(mode)) {
        const n = vgEl('span', 'vg-lane-n', String(entry.lane));
        n.dataset.vgLayoutTarget = mode === 'results' ? 'results-lane-n' : 'draw-lane-n';
        li.appendChild(n);
    }
    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-lane-logo';
        img.src = info.logoUrl;
        img.alt = '';
        if (mode === 'draw') {
            img.dataset.vgLayoutTarget = 'draw-logo';
        } else {
            img.dataset.vgLayoutTarget = 'results-logo';
        }
        li.appendChild(img);
    } else {
        li.appendChild(vgEl('span', 'vg-lane-logo vg-lane-logo--empty', '—'));
    }
    const crew = vgEl('div', 'vg-lane-crew');
    crew.dataset.vgLayoutTarget = mode === 'draw' ? 'draw-crew' : 'results-crew';
    crew.appendChild(vgEl('span', 'vg-lane-club', info.name));
    if (entry.names && vgShowAthleteNames(mode)) {
        crew.appendChild(vgEl('span', 'vg-lane-names', entry.names));
    }
    li.appendChild(crew);
    if (entry.time) {
        li.appendChild(vgEl('span', 'vg-lane-time', entry.time));
    }
    return li;
}

function vgBuildKriLeaderCard(race, laneNum) {
    const entry = vgFindDrawLane(race, laneNum);
    if (!entry) return null;

    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, vgState.lookup);

    const card = vgEl('div', 'vg-kri-leader-card');
    card.dataset.vgLayout = 'leader-card';

    const badges = vgEl('div', 'vg-kri-leader-badges');
    badges.dataset.vgLayout = 'leader-badges';
    const badge = vgEl('p', 'vg-leader-badge', 'Leader');
    badge.dataset.vgLayout = 'leader-badge';
    badges.appendChild(badge);
    const laneBadge = vgEl('p', 'vg-leader-badge-lane', `Lane ${laneNum}`);
    laneBadge.dataset.vgLayout = 'leader-badge-lane';
    badges.appendChild(laneBadge);
    card.appendChild(badges);

    const panel = vgEl('div', 'vg-kri-leader-panel');
    panel.dataset.vgLayout = 'leader-panel';

    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-leader-logo';
        img.src = info.logoUrl;
        img.alt = '';
        img.dataset.vgLayout = 'leader-logo';
        panel.appendChild(img);
    } else {
        panel.appendChild(vgEl('span', 'vg-leader-logo vg-leader-logo--empty', '—'));
    }

    const crew = vgEl('p', 'vg-leader-crew', info.name);
    crew.dataset.vgLayout = 'leader-crew';
    panel.appendChild(crew);
    card.appendChild(panel);
    return card;
}

/** KRI CV draw overlay (h) — lane crew card; optional gold leader glow. */
function vgBuildKriCvDrawCard(race, laneNum, opts = {}) {
    const entry = vgFindDrawLane(race, laneNum);
    if (!entry) return null;

    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, vgState.lookup);
    const isLeader = Boolean(opts.isLeader);

    const card = vgEl('div', 'vg-kri-leader-card vg-kri-cv-draw-card');
    card.dataset.vgLayout = 'cv-draw-card';
    card.dataset.drawLane = String(laneNum);
    if (opts.slot != null) card.dataset.cvSlot = String(opts.slot);

    const badges = vgEl('div', 'vg-kri-leader-badges');
    badges.dataset.vgLayout = 'cv-draw-badges';
    if (isLeader) {
        const badge = vgEl('p', 'vg-leader-badge', 'Leader');
        badge.dataset.vgLayout = 'cv-draw-leader-badge';
        badges.appendChild(badge);
    }
    const laneBadge = vgEl('p', 'vg-leader-badge-lane', `Lane ${laneNum}`);
    laneBadge.dataset.vgLayout = 'cv-draw-lane-badge';
    badges.appendChild(laneBadge);
    card.appendChild(badges);

    const panel = vgEl('div', 'vg-kri-leader-panel');
    panel.dataset.vgLayout = 'cv-draw-panel';
    if (isLeader) panel.classList.add('vg-kri-cv-draw-panel--leader-glow');

    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-leader-logo';
        img.src = info.logoUrl;
        img.alt = '';
        img.dataset.vgLayout = 'cv-draw-logo';
        panel.appendChild(img);
    } else {
        panel.appendChild(vgEl('span', 'vg-leader-logo vg-leader-logo--empty', '—'));
    }

    const crew = vgEl('p', 'vg-leader-crew', info.name);
    crew.dataset.vgLayout = 'cv-draw-crew';
    panel.appendChild(crew);
    card.appendChild(panel);
    return card;
}

function vgRenderLeader(layer, race, laneNum, opts = {}) {
    vgSetLayerGraphicClass(layer, 'vg-layer--leader');
    layer.dataset.vgLayout = 'leader';
    layer.replaceChildren();

    const entry = vgFindDrawLane(race, laneNum);
    if (!entry) return;

    const club = vgParseClubCode(entry.code);
    const info = vgClubInfo(club.id, vgState.lookup);

    const wrap = vgEl('div', 'vg-leader-wrap');
    wrap.dataset.vgLayout = 'leader-wrap';
    if (opts.fadeIn) {
        wrap.classList.add('vg-leader-wrap--fade-in');
    }

    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroLeader(layer, race, laneNum);
        return;
    }

    if (vgIsKriTheme()) {
        const card = vgBuildKriLeaderCard(race, laneNum);
        if (!card) return;
        wrap.appendChild(card);
        layer.appendChild(wrap);
        return;
    }

    if (vgIsMilfordTheme()) {
        vgAppendMilfordBoardChrome(layer, 'leader');
    }

    if (info.logoUrl) {
        const img = document.createElement('img');
        img.className = 'vg-leader-logo';
        img.src = info.logoUrl;
        img.alt = '';
        img.dataset.vgLayout = 'leader-logo';
        wrap.appendChild(img);
    } else {
        wrap.appendChild(vgEl('span', 'vg-leader-logo vg-leader-logo--empty', '—'));
    }

    const badge = vgEl('p', 'vg-leader-badge', 'Leader');
    badge.dataset.vgLayout = 'leader-badge';
    wrap.appendChild(badge);
    const laneBadge = vgEl('p', 'vg-leader-badge-lane', `Lane ${laneNum}`);
    laneBadge.dataset.vgLayout = 'leader-badge-lane';
    wrap.appendChild(laneBadge);
    const crew = vgEl('p', 'vg-leader-crew', info.name);
    crew.dataset.vgLayout = 'leader-crew';
    wrap.appendChild(crew);
    layer.appendChild(wrap);
}

function vgRenderMilfordRaceHead(head, race, layoutId) {
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
    const meta = vgEl('p', 'vg-draw-meta');
    meta.appendChild(vgEl('span', 'vg-draw-meta-race', `Race ${race.race}`));
    const roundLabel = vgFormatRoundLabel(race.round, race.division);
    if (roundLabel) {
        const roundEl = vgEl('span', 'vg-draw-meta-round');
        roundEl.appendChild(
            vgEl(
                'span',
                'vg-draw-meta-time',
                vgFormatCompactScheduleTime(race.startAt),
            ),
        );
        roundEl.appendChild(document.createTextNode(' '));
        roundEl.appendChild(
            vgEl('span', 'vg-draw-meta-round-label', roundLabel),
        );
        meta.appendChild(roundEl);
    }
    head.appendChild(meta);
    head.dataset.vgLayout = layoutId;
}

function vgRenderDraw(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--draw');
    layer.dataset.vgLayout = 'draw';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const metaText = `Race ${race.race} · ${race.round}${race.division ? ` · Div ${race.division}` : ''}`;

    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroBoard(layer, race, 'draw');
        return;
    }

    if (vgIsKriTheme()) {
        const shell = vgKriCreateShell({ useMarkLogo: true });
        const panel = vgKriCreatePanel('draw');
        vgKriAppendHead(panel, {
            kicker: 'Start list',
            title: fullName,
            meta: metaText,
            layoutId: 'draw-head',
            parts: {
                kicker: 'draw-kicker',
                title: 'draw-title',
                meta: 'draw-meta',
            },
        });
        const body = vgEl('div', 'vg-kri-draw-body');
        body.dataset.vgLayout = 'draw-body';
        vgKriAppendCols(
            body,
            [
                { text: 'Lane', className: 'vg-kri-col--lane' },
                { text: '', className: 'vg-kri-col--logo' },
                { text: 'Crew', className: 'vg-kri-col--crew' },
            ],
            { layoutId: 'draw-cols' },
        );
        const list = vgEl('ul', 'vg-kri-lanes vg-draw-lanes');
        list.dataset.vgLayout = 'draw-lanes';
        for (const lane of race.lanes) {
            if (!lane.code) continue;
            list.appendChild(
                vgBuildKriDrawLaneRow({ lane: lane.lane, code: lane.code }, vgState.lookup),
            );
        }
        body.appendChild(list);
        panel.appendChild(body);
        shell.appendChild(panel);
        layer.appendChild(shell);
        return;
    }

    if (vgIsMilfordTheme()) {
        vgAppendMilfordBoardChrome(layer, 'draw');
    }

    const head = vgEl('div', 'vg-draw-head');
    if (vgIsMilfordBroadcastTheme()) {
        vgRenderMilfordRaceHead(head, race, 'draw-head');
    } else {
        head.appendChild(vgEl('p', 'vg-draw-meta', metaText));
        head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
        head.dataset.vgLayout = 'draw-head';
    }
    layer.appendChild(head);

    const list = vgEl('ul', 'vg-draw-lanes');
    list.dataset.vgLayout = 'draw-lanes';
    for (const lane of race.lanes) {
        if (!lane.code) continue;
        list.appendChild(
            vgBuildLaneRow(
                {
                    lane: lane.lane,
                    code: lane.code,
                },
                vgState.lookup,
                'draw',
            ),
        );
    }
    layer.appendChild(list);
}

function vgRenderSchedule(layer, raceParam) {
    vgSetLayerGraphicClass(layer, 'vg-layer--schedule');
    layer.dataset.vgLayout = 'schedule';

    const { current, upcoming } = vgGetUpcomingRaces(raceParam, 10);

    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroBoard(layer, current || { race: '', raceNum: '', lanes: [], eventType: '', round: '', division: '' }, 'schedule');
        vgStartScheduleClock();
        return;
    }

    const shell = vgKriCreateShell({ useMarkLogo: true });
    const panel = vgKriCreatePanel('schedule');

    const metaText = vgScheduleMetaText();
    vgKriAppendHead(panel, {
        kicker: 'Upcoming',
        title: 'Schedule',
        meta: metaText,
        layoutId: 'schedule-head',
        parts: {
            kicker: 'schedule-kicker',
            title: 'schedule-title',
            meta: 'schedule-meta',
        },
    });

    const body = vgEl('div', 'vg-kri-draw-body');
    body.dataset.vgLayout = 'schedule-body';
    vgKriAppendCols(
        body,
        [
            { text: 'Time', className: 'vg-schedule-col--time' },
            { text: 'Race', className: 'vg-schedule-col--race' },
            { text: 'Event', className: 'vg-schedule-col--event' },
            { text: 'Round', className: 'vg-schedule-col--round' },
        ],
        { layoutId: 'schedule-cols' },
    );

    const list = vgEl('ul', 'vg-schedule-rows');
    list.dataset.vgLayout = 'schedule-rows';

    if (!upcoming.length) {
        list.appendChild(
            vgEl('li', 'vg-schedule-row vg-schedule-row--empty', 'No races on daysheet'),
        );
    } else {
        for (const race of upcoming) {
            const li = vgEl('li', 'vg-schedule-row');
            if (
                current &&
                race.race === current.race &&
                race.raceNum === current.raceNum
            ) {
                li.classList.add('vg-schedule-row--current');
            }
            const fullName = vgExpandEventName(race.eventType, vgState.lookup);
            li.appendChild(vgEl('span', 'vg-schedule-time', vgFormatScheduleTime(race.startAt)));
            li.appendChild(vgEl('span', 'vg-schedule-race', `Race ${race.race}`));
            li.appendChild(vgEl('span', 'vg-schedule-event', fullName));
            const round = [race.round, race.division ? `Div ${race.division}` : '']
                .filter(Boolean)
                .join(' · ');
            li.appendChild(vgEl('span', 'vg-schedule-round', round || '—'));
            list.appendChild(li);
        }
    }
    body.appendChild(list);
    panel.appendChild(body);
    shell.appendChild(panel);
    layer.appendChild(shell);
    vgStartScheduleClock();
}

function vgRenderResults(layer, race) {
    vgSetLayerGraphicClass(layer, 'vg-layer--results');
    layer.dataset.vgLayout = 'results';
    const fullName = vgExpandEventName(race.eventType, vgState.lookup);
    const metaText = `Race ${race.race} · ${race.round} · Results`;

    if (vgIsKarapiroTheme()) {
        vgRenderKarapiroBoard(layer, race, 'results');
        return;
    }

    if (vgIsKriTheme()) {
        const shell = vgKriCreateShell({ useMarkLogo: true });
        const panel = vgKriCreatePanel('results');
        vgKriAppendHead(panel, {
            kicker: 'Results',
            title: fullName,
            meta: metaText,
            layoutId: 'results-head',
            parts: {
                kicker: 'results-kicker',
                title: 'results-title',
                meta: 'results-meta',
            },
        });
        const body = vgEl('div', 'vg-kri-draw-body');
        body.dataset.vgLayout = 'results-body';
        vgKriAppendCols(
            body,
            [
                { text: 'Placing', className: 'vg-kri-col--lane' },
                { text: 'Crew', className: 'vg-kri-col--crew' },
                { text: 'Time', className: 'vg-kri-col--time' },
            ],
            { layoutId: 'results-cols' },
        );
        const list = vgEl('ul', 'vg-kri-lanes vg-draw-lanes vg-draw-lanes--results');
        list.dataset.vgLayout = 'results-lanes';
        const result = vgState.results.get(race.raceNum);
        if (result?.placings?.length) {
            for (const p of result.placings) {
                list.appendChild(
                    vgBuildKriResultsLaneRow(
                        {
                            lane: p.place,
                            code: p.competitor,
                            time: p.time,
                        },
                        vgState.lookup,
                    ),
                );
            }
        } else {
            list.appendChild(vgEl('li', 'vg-lane vg-lane--empty', 'Results not available'));
        }
        body.appendChild(list);
        panel.appendChild(body);
        shell.appendChild(panel);
        layer.appendChild(shell);
        return;
    }

    if (vgIsMilfordTheme()) {
        vgAppendMilfordBoardChrome(layer, 'results');
    }

    const head = vgEl('div', 'vg-draw-head');
    if (vgIsMilfordBroadcastTheme()) {
        vgRenderMilfordRaceHead(head, race, 'results-head');
    } else {
        head.appendChild(vgEl('p', 'vg-draw-meta', metaText));
        head.appendChild(vgEl('h2', 'vg-draw-event', fullName));
        head.dataset.vgLayout = 'results-head';
    }
    layer.appendChild(head);

    const result = vgState.results.get(race.raceNum);
    const list = vgEl('ul', 'vg-draw-lanes vg-draw-lanes--results');
    list.dataset.vgLayout = 'results-lanes';
    if (result?.placings?.length) {
        for (const p of result.placings) {
            const laneRef = { lane: p.place, code: p.competitor };
            list.appendChild(
                vgBuildLaneRow(
                    {
                        lane: p.place,
                        code: p.competitor,
                        names: vgCompetitorNames(race, laneRef),
                        time: p.time,
                    },
                    vgState.lookup,
                    'results',
                ),
            );
        }
    } else {
        list.appendChild(vgEl('li', 'vg-lane vg-lane--empty', 'Results not available'));
    }
    layer.appendChild(list);
}

function vgRefreshHoldContent() {
    vgRefreshLiveRaceContent();
}

function vgHandleRemoteTrigger(raw) {
    if (!raw) return;
    try {
        const msg = JSON.parse(raw);
        if (msg.action === 'out') {
            vgTriggerOut();
            return;
        }
        if (msg.action === 'clear' || msg.action === 'c') {
            vgTriggerClear();
            return;
        }
        if (msg.action === 'in' && msg.graphic) {
            const g = vgResolveGraphicAlias(msg.graphic);
            vgTriggerIn(g);
        }
    } catch {
        /* ignore */
    }
}

function vgBindKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.target.closest('input, textarea, select')) return;
        if (vgIsKarapiroTheme() && window.VmixKarapiro?.onKey(e)) return;
        const key = e.key.toLowerCase();
        if (key === 'o') {
            e.preventDefault();
            vgTriggerOut();
            return;
        }
        if (key === 'c') {
            e.preventDefault();
            vgTriggerClear();
            return;
        }
        if (key === 'n') {
            e.preventDefault();
            vgStepLiveRace(1);
            return;
        }
        if (key === 'p') {
            e.preventDefault();
            vgStepLiveRace(-1);
            return;
        }
        if (vgIsLanesGraphic(vgPlayback.graphic) && vgPlayback.state !== 'idle') {
            if (window.MilfordLaneCards?.onKey?.(e.key)) {
                e.preventDefault();
                return;
            }
        }
        if (
            (vgPlayback.graphic === 'leader' || vgPlayback.graphic === 'cvleader') &&
            (vgIsMilfordBroadcastTheme() || vgIsKriTheme()) &&
            vgPlayback.state !== 'idle'
        ) {
            const lane = parseInt(e.key, 10);
            if (lane >= 1 && lane <= 8) {
                e.preventDefault();
                if (vgPlayback.graphic === 'cvleader') {
                    vgSetLeaderLane(lane);
                    window.KriVmixCvLeader?.setLane?.(lane);
                } else {
                    vgSelectLeaderLane(lane);
                }
                return;
            }
        }
        if (vgIsCourseScrollGraphic(vgPlayback.graphic) && vgPlayback.state !== 'idle') {
            const lane = key === '0' ? 10 : parseInt(key, 10);
            const maxLane = window.KriVmixCourseScroll?.LANE_COUNT || 10;
            if (Number.isFinite(lane) && lane >= 1 && lane <= maxLane) {
                e.preventDefault();
                if (lane <= 8) vgSetLeaderLane(lane);
                window.KriVmixCourseScroll?.setLeaderLane?.(lane);
                return;
            }
        }
        const graphic = vgGraphicFromShortcut(key) || VG_GRAPHIC_ALIASES[key];
        if (graphic) {
            e.preventDefault();
            vgTriggerIn(graphic);
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === VG_LS_LEADER_LANE) {
            const lane = vgGetLeaderLane();
            if (vgPlayback.graphic === 'leader' && vgPlayback.state !== 'idle') {
                vgApplyLeaderLane(lane);
            } else if (vgPlayback.graphic === 'cvleader' && vgPlayback.state !== 'idle') {
                window.KriVmixCvLeader?.setLane?.(lane);
            } else if (vgIsCourseScrollGraphic(vgPlayback.graphic) && vgPlayback.state !== 'idle') {
                window.KriVmixCourseScroll?.setLeaderLane?.(lane);
            } else {
                vgLeaderLane = lane;
            }
        }
        if (e.key === VG_LS_LIVE_RACE) {
            try {
                const v = localStorage.getItem(VG_LS_LIVE_RACE);
                if (v != null && String(v).trim()) vgLiveRaceOverride = String(v).trim();
            } catch {
                /* ignore */
            }
            vgRefreshLiveRaceContent();
        }
        if (e.key === VG_LS_TRIGGER) vgHandleRemoteTrigger(e.newValue);
    });

    document.addEventListener('altitudehd:liverace', (e) => {
        const race = e.detail?.race;
        if (race != null && String(race).trim()) {
            vgLiveRaceOverride = String(race).trim();
        }
        vgRefreshLiveRaceContent();
    });
}

function vgBindRemoteTriggers() {
    const params = new URLSearchParams(location.search);
    const action = (params.get('action') || params.get('a') || '').toLowerCase();
    if (action === 'out' || action === 'o') {
        vgTriggerOut();
        return;
    }
    if (action === 'clear' || action === 'c') {
        vgTriggerClear();
        return;
    }
    const g =
        params.get('g') ||
        params.get('graphic') ||
        document.body?.dataset?.vmixDefaultGraphic;
    if (!g) return;
    const graphic = vgResolveGraphicAlias(g);
    if (!graphic) return;
    if (params.get('autoplay') === '1' || params.get('play') === '1') {
        vgTriggerIn(graphic);
    }
}

function vgCsvFingerprint(daysheetText, competitorsText, resultsText) {
    return `${daysheetText}\n\x1e${competitorsText}\n\x1e${resultsText}`;
}

async function vgReload() {
    vgState.regattaCode = vgGetRegattaCode();
    const [lookup, daysheetText, competitorsText, resultsText, , regattaTitle] =
        await Promise.all([
            vgLoadLookup(),
            vgFetchRegattaFile('daysheet'),
            vgFetchRegattaFile('competitors'),
            vgFetchRegattaFile('results'),
            vgLoadKriSponsorImages(),
            vgLoadRegattaTitle(vgState.regattaCode),
        ]);
    const fingerprint = vgCsvFingerprint(daysheetText, competitorsText, resultsText);
    const changed =
        fingerprint !== vgState.csvFingerprint ||
        regattaTitle !== vgState.regattaTitle;
    vgState.csvFingerprint = fingerprint;
    vgState.regattaTitle = regattaTitle;
    vgState.lookup = lookup;
    vgState.races = vgParseDaysheet(daysheetText);
    vgState.competitors = vgParseCompetitors(competitorsText);
    vgState.results = vgParseResults(resultsText);
    return changed;
}

async function vgInit() {
    vgEnableBrowserPreview();
    window.VmixKarapiro?.init?.();
    vgInitLiveRaceOverride();
    vgLeaderLane = vgGetLeaderLane();
    vgResetToIdle();
    vgBindKeyboard();

    try {
        await vgReload();
        window.VmixKarapiro?.paintOps?.();
    } catch (e) {
        const err = document.getElementById('vgError');
        if (err) {
            err.hidden = false;
            err.textContent =
                e instanceof Error ? e.message : 'Failed to load graphics data';
        }
    }

    vgBindRemoteTriggers();

    try {
        const ch = new BroadcastChannel('altitudehd-rowit');
        ch.addEventListener('message', async (e) => {
            if (e.data?.action !== 'reload') return;
            try {
                const changed = await vgReload();
                if (changed && !vgIsLayoutDevMode()) vgRefreshHoldContent();
            } catch {
                /* ignore */
            }
        });
    } catch {
        /* BroadcastChannel unavailable */
    }

    document.addEventListener('altitudehd:rowit', async () => {
        try {
            const changed = await vgReload();
            if (changed && !vgIsLayoutDevMode()) vgRefreshHoldContent();
        } catch {
            /* ignore */
        }
    });

    document.addEventListener('altitudehd:liverace', () => vgRefreshHoldContent());
    document.addEventListener('altitudehd:leaderlane', (e) => {
        const lane = vgClampLeaderLane(e.detail?.lane);
        if (vgPlayback.graphic === 'leader' && vgPlayback.state !== 'idle') {
            vgApplyLeaderLane(lane);
        } else if (vgPlayback.graphic === 'cvleader' && vgPlayback.state !== 'idle') {
            window.KriVmixCvLeader?.setLane?.(lane);
        } else if (vgIsCourseScrollGraphic(vgPlayback.graphic) && vgPlayback.state !== 'idle') {
            window.KriVmixCourseScroll?.setLeaderLane?.(lane);
        } else {
            vgLeaderLane = lane;
        }
    });
    document.addEventListener('altitudehd:vmixtrigger', (e) => {
        vgHandleRemoteTrigger(JSON.stringify(e.detail || {}));
    });

    window.addEventListener('message', (e) => {
        if (e.data?.type !== 'altitudehd:vg') return;
        if (!vgIsSpeedGraphic(vgPlayback.graphic)) return;
        if (vgIsVideoTheme()) return;
        if (e.data.phase === 'hold' && vgPlayback.state === 'intro') {
            vgClearPlaybackTimers();
            vgEnterHold();
        }
        if (e.data.phase === 'idle' && vgPlayback.state === 'outro') {
            vgClearPlaybackTimers();
            vgResetToIdle();
        }
    });

    setInterval(async () => {
        try {
            const archive = window.RegattaCsvArchive;
            if (archive?.isLiveCsvPollDay) {
                const live = await archive.isLiveCsvPollDay(vgGetRegattaCode());
                if (!live) return;
            }
            const changed = await vgReload();
            if (changed && !vgIsLayoutDevMode()) {
                vgRefreshHoldContent();
            }
        } catch {
            /* ignore refresh errors */
        }
    }, 60000);
}

/** Dev layout editor (?dev=1) — show graphic on hold with background + text visible. */
function vgDevPreviewHold(graphic) {
    vgClearPlaybackTimers();
    vgPlayback.graphic = graphic;
    if (vgIsSpeedChartGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        window.KriVmixSpeedChart?.show({
            raceContext: vgBuildSpeedChartRaceContext(),
        }).catch(() => {});
        return;
    }
    if (vgIsLiveTrackingGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        window.KriVmixLiveTracking?.show({
            raceContext: vgBuildSpeedChartRaceContext(),
        }).catch(() => {});
        return;
    }
    if (vgIsCvLeaderGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        const race = vgFindRace(vgGetRaceParam());
        window.KriVmixCvLeader?.show({
            race,
            lane: vgGetLeaderLane(),
        }).catch(() => {});
        return;
    }
    if (vgIsCvDrawGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        const race = vgFindRace(vgGetRaceParam());
        window.KriVmixCvDraw?.show({ race }).catch(() => {});
        return;
    }
    if (vgIsCourseScrollGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        window.KriVmixCourseScroll?.show({
            raceContext: vgBuildSpeedChartRaceContext(),
            leaderLane: vgGetLeaderLane(),
        }).catch(() => {});
        return;
    }
    if (vgIsLanesGraphic(graphic)) {
        vgSetStageState('hold');
        vgShowBackground(false);
        vgShowTextLayer(false);
        window.MilfordLaneCards?.show({
            race: vgBuildLaneCardsContext(),
            demo: false,
        }).catch(() => {});
        return;
    }
    if (vgIsSpeedGraphic(graphic) && vgMilfordCssGraphic(graphic)) {
        vgPrepareTrackerContent();
    } else if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
        vgPrepareTrackerContent();
    } else if (graphic === 'leader') {
        vgPrepareContent(graphic, vgGetRaceParam());
        vgShowLeaderForConfiguredLane();
        vgUpdateBgGraphicClass();
    } else {
        vgPrepareContent(graphic, vgGetRaceParam());
    }
    const assetKey = vgIsSpeedGraphic(graphic) ? 'speed' : graphic;
    let isVideo = false;
    let video = null;
    if (!vgUsesCssBackground(graphic)) {
        const loaded = vgLoadBackgroundAsset(assetKey);
        isVideo = loaded.isVideo;
        video = loaded.video;
    }
    vgSetStageState('hold');
    vgShowBackground(!vgUsesCssBackground(graphic));
    if (vgIsSpeedGraphic(graphic) && vgMilfordCssGraphic(graphic)) {
        vgShowTextLayer(true);
        vgLoadSpeedFrame();
        vgShowMap(true, false);
        vgSendSpeedOverlayPhase('hold');
        vgApplySavedLayout(graphic);
    } else if (vgIsSpeedGraphic(graphic) && vgIsVideoTheme()) {
        vgShowTextLayer(false);
        vgLoadSpeedFrame();
        vgShowMap(true, false);
        vgSendSpeedOverlayPhase('hold');
    } else {
        vgShowTextLayer(true);
        vgApplySavedLayout(graphic);
    }
    if (isVideo && video) {
        vgDevSeekVideoHold();
    }
}

window.VmixGraphics = {
    triggerIn: vgTriggerIn,
    triggerOut: vgTriggerOut,
    triggerClear: vgTriggerClear,
    getState: () => vgPlayback.state,
    devPreviewHold: vgDevPreviewHold,
    devSeekVideoHold: vgDevSeekVideoHold,
    devHoldVideoTimeMs: vgDevHoldVideoTimeMs,
    buildKriLeaderCard: vgBuildKriLeaderCard,
    buildKriCvDrawCard: vgBuildKriCvDrawCard,
    findRace: vgFindRace,
    getRaceParam: vgGetRaceParam,
    getLookup: () => vgState.lookup,
    buildLaneCardsContext: vgBuildLaneCardsContext,
    parseClubCode: vgParseClubCode,
    clubInfo: (clubId) => vgClubInfo(clubId, vgState.lookup),
};
window.AltitudeHdVmix = window.VmixGraphics;

document.addEventListener('DOMContentLoaded', vgInit);
