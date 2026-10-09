# Milford lane cards + docked lower third

vMix browser-source graphic for the RNZ Milford package: eight fixed-lane cards
down the right edge plus a lower third that docks to the Milford logo
bottom-right. Built from the design handoff "Lower third with vertical"
(1920×1080, Montserrat, Milford grey `#303C42` / orange `#E47126`).

## Pages and triggers

| What | Where |
| --- | --- |
| Dedicated page | `public/vmix-rnz-milford-lanes.html` (defaults to `g=e`) |
| Also available on | `public/vmix-rnz-milford.html` with `?g=e` or key **E** |
| Styles | `public/vmix-graphics.css`, `.mf-lanes*` block under `[data-vmix-theme='rnz-milford']` |
| Controller | `public/vmix-rnz-milford-lanes.js` → `window.MilfordLaneCards` |
| Playback wiring | `public/vmix-graphics.js` (graphic `lanes`, aliases `e`, `lanecards`) |
| Logo | `public/assets/vmix/milford/milford-colour.png` |

Keys while the graphic is on air: **1–8** open that lane's card for 8 s (press
again to close), **0** close, **B** toggle the bolt window, **N / P** step the
live race, **O** fall out, **C** clear. The hub trigger buttons and
`?g=e&autoplay=1` work the same as the other Milford graphics.

`?demo=1` runs the reference sequence: in → move on lane 4 at 2.6 s (8 s
hold) → bolt at 3.2 s (5 s) → close → 5 s → out. `&openLane=` and
`&moveLevel=` change the demo lane / chevron count.

## What is shown

- **Closed card** — rowsuit silhouette (flat placeholder colours until club
  artwork arrives), short crew name from the daysheet draw, lane number chip.
- **Medal dot** — gold / silver / bronze only, from `place` (feed) or standings
  by distance.
- **Open card ("move")** — split /500m, rating, and 1–3 orange chevrons on the
  water side. Opens for 8 s, one card at a time.
- **Bolt** — at each 500 m mark, crews whose last 500 m split beats the Gold
  Standard get a lightning bolt in place of the rowsuit for 5 s.
- **Lower third** — `RACE n · event` from the daysheet, `GOLD STANDARD m:ss.s
  /500m` (hidden until a value is set), and a round chip (`A-FINAL`, `HEAT 2`…).

## Feeding live timing

Nothing in the repo produces split / rating data yet, so the controller takes
it from whichever timing source is wired up. All of these reach it:

```js
// Progress samples (preferred — the controller derives speed, places, moves, bolts)
MilfordLaneCards.feed({
    t: Date.now(),            // optional, ms
    lanes: [
        { lane: 4, dist: 612, rate: 38 },            // split derived from last 100 m
        { lane: 6, dist: 640, split: '1:26.1', place: 1 }, // explicit values win
    ],
});

// Explicit state (operator panel / external engine)
MilfordLaneCards.setState({
    goldStandard: 85,         // seconds /500m, or "1:25.0"
    openLane: 4, moveLevel: 3,  // open a card now (8 s)
    boltOn: true,             // bolt window now (5 s)
    lanes: [{ lane: 4, split: '1:26.4', rate: 38, place: 3 }],
});
```

Cross-tab / cross-window equivalents carry the same payload shape wrapped as
`{ feed }`, `{ state }`, `{ open, level }`, `{ bolt }` or `{ goldStandard }`:

- `document.dispatchEvent(new CustomEvent('altitudehd:lanecards', { detail }))`
- `localStorage.setItem('altitudeHdLaneCards_v1', JSON.stringify(detail))`
- `window.postMessage({ type: 'altitudehd:lanecards', ...detail }, '*')`

### Rules (tunable via `MilfordLaneCards.config`)

| Rule | Default |
| --- | --- |
| Move = faster than both *place* neighbours over the last 100 m | `moveWindowM: 100` |
| Chevron count from % faster than the quicker neighbour | `moveLevels: [1, 2.5, 4]` |
| No move before this distance | `moveMinDistM: 150` |
| Same lane can't re-open within | `moveCooldownMs: 30000` |
| Bolt check interval | `boltIntervalM: 500` |
| Gold Standard fallback (s /500m) | `goldStandard: null` |

## Not yet wired

- Real rowsuit artwork — swap `buildSuit()` in the controller for club PNG/SVG.
- Gold Standard per event — set it from the timing feed or `config.goldStandard`;
  the daysheet does not carry it.
