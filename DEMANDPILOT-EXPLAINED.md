# DemandPilot — End-to-End Explanation

A complete walkthrough of this codebase: every layer, every screen, every tile, every table column, every formula, and where each number on screen actually comes from.

All figures quoted here were produced by running the real engine and test suite on 23 October 2026, not copied from the README. Where the README disagrees with the code, this document says so.

---

## Table of contents

1. [What this application is](#1-what-this-application-is)
2. [How to run it](#2-how-to-run-it)
3. [The end-to-end pipeline](#3-the-end-to-end-pipeline)
4. [Project layout](#4-project-layout)
5. [The data layer](#5-the-data-layer)
6. [The engine](#6-the-engine)
7. [The worker and the store](#7-the-worker-and-the-store)
8. [The shell, routing and navigation](#8-the-shell-routing-and-navigation)
9. [Every screen, section by section](#9-every-screen-section-by-section)
10. [The UI kit](#10-the-ui-kit)
11. [Charts and colour](#11-charts-and-colour)
12. [Planner settings and what each one moves](#12-planner-settings-and-what-each-one-moves)
13. [The story the demo tells](#13-the-story-the-demo-tells)
14. [Tests](#14-tests)
15. [Live numbers from a real run](#15-live-numbers-from-a-real-run)
16. [Findings: discrepancies and dead code](#16-findings-discrepancies-and-dead-code)

---

## 1. What this application is

DemandPilot is a **single-page React application with no backend**. It is a working proof of concept for demand-driven material planning in a stainless steel business.

The important architectural fact, which shapes everything else: **every number displayed is computed in the browser at runtime.** There is no API, no database, no fixtures file of pre-baked results. The app generates a synthetic but internally consistent dataset from a fixed random seed, then runs a genuine planning engine over it — fitting and back-testing forecasting models, detecting anomalies, computing safety stock, exploding a bill of materials, netting against inventory, and producing purchase recommendations.

This matters because it makes the central claim honest. When the app says "change a setting and every screen moves together," that is literally true: there is exactly one calculation, `runPlanning()`, and all thirteen screens read its output.

**Scale of one run:** 240 products × 4 regions = 960 demand series. Each series has 3 models fitted and back-tested, then the winner refitted on full history. That is 2,880 model fits plus 960 refits per run, completing in roughly **578 ms** in Node.

---

## 2. How to run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # tsc -b && vite build  -> dist/
npm run preview    # serve the production build
npm test           # vitest run — 90 tests, ~7s
```

Node v24.21.0, npm 11.19.0, Vite 5.4.21, React 18.3.

### A note on the dev server address

`vite.config.ts:13` pins the dev server to IPv4 loopback:

```ts
server: { host: '127.0.0.1', port: 5173 },
```

This is deliberate and load-bearing on Windows. Vite's default host is `localhost`, and on this machine `localhost` resolves to `::1` (IPv6) *before* `127.0.0.1`. Node binds to the first address it gets, so the default configuration leaves port 5173 **closed on IPv4** while listening only on `[::1]`. VS Code's Simple Browser dials `127.0.0.1`, finds nothing, and reports `ERR_CONNECTION_REFUSED (-102)` even though the server is running perfectly. Pinning the host fixes it without exposing the server to the LAN.

---

## 3. The end-to-end pipeline

This is the spine of the whole application. Follow it once and the rest of the codebase falls into place.

```
┌─ BUILD TIME (once per worker, cached) ───────────────────────────────┐
│                                                                       │
│  catalog.ts          hand-written master data                        │
│  (40 materials, 15 suppliers, BOM recipes, plants, lines, regions)   │
│                              │                                       │
│                              ▼                                       │
│  generate.ts  buildDataset(seed = 20260413)                          │
│    buildSkus      → 240 products (4 grades × 3 forms × 4 th × 5 fin) │
│    buildDemand    → 960 series × 117 weeks (104 visible + 13 hidden) │
│    buildBom       → 7,964 recipe lines                               │
│    buildMaterials → on-hand stock derived from real recent usage     │
│    buildSuppliers → 15, with OTIF / quality / price variance         │
│    buildCustomers → 60 across 8 industries                           │
│    buildOrders    → 2,500 customer orders drawn from real demand     │
│    buildPurchaseOrders → 230 POs with realistic slip                 │
│    buildSignals   → 32 market signals (12 scripted + 20 filler)      │
│    buildCommodity → 130 weeks of nickel / moly / ferrochrome index   │
│    buildPlanHistory → 21 audit entries                               │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               ▼
┌─ EVERY RUN (on any settings change) ─────────────────────────────────┐
│                                                                       │
│  engine/index.ts  runPlanning({ ds, settings, weeksAdvanced, … })    │
│                                                                       │
│   0. Build the signal lookup   which signals touch which SKU×region  │
│   1. forecast.ts  × 960        3 models fitted, back-tested, winner  │
│   2. anomaly.ts   × 960        rolling z-score + materiality gates   │
│   3. inventory.ts × 40         safety stock, ROP, cover, health      │
│   4. mrp.ts       × 1          5-stage MRP over 40 materials × 26 wk │
│   5. procurement.ts × 1        buy / expedite / reduce recommendations│
│   6. replay.ts    × 1          16 weeks simulated twice (old vs new) │
│   7. KPIs                      22 headline numbers                   │
│   8. Workbench                 one unified decision queue            │
│   9. Insights                  auto-written prose per screen         │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               ▼
                    PlanningResult  (one object)
                               │
                    Zustand store  (useStore)
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   13 screens            Command palette          Tour / WeekMenu
```

The entire run happens inside a **Web Worker** (`src/worker/engine.worker.ts`) so the UI never blocks. The worker posts progress messages back, which is what the loading screen reads.

---

## 4. Project layout

```
src/
  main.tsx              React root, StrictMode
  App.tsx               BrowserRouter + 14 routes + the Gate component
  vite-env.d.ts

  data/
    types.ts            237 lines — every interface in the app
    catalog.ts          339 lines — hand-written master data
    generate.ts         692 lines — the seeded dataset generator

  engine/
    index.ts            688 lines — runPlanning(), the orchestrator
    forecast.ts         397 lines — 3 models + back-testing
    anomaly.ts          187 lines — rolling z-score detection
    inventory.ts        166 lines — safety stock / ROP / health
    mrp.ts              256 lines — 5-stage material requirements planning
    procurement.ts      267 lines — recommendations
    scenario.ts         232 lines — what-if levers + costed plan options
    replay.ts           324 lines — before/after simulation
    engine.test.ts      322 lines
    smoke.test.ts       216 lines

  worker/engine.worker.ts   43 lines

  store/useStore.ts     291 lines — Zustand state + all actions

  ui/
    Shell.tsx           176 lines — sidebar, top bar, toasts
    kit.tsx             374 lines — Tile, Chip, Panel, Drawer, Modal, …
    Table.tsx           124 lines — sortable, searchable, paged, CSV
    charts.tsx          235 lines — Recharts wrappers
    colors.ts            43 lines — literal palettes (not CSS vars)
    WeekMenu.tsx        116 lines — the planning-week calendar
    Tour.tsx             69 lines — 8-step guided walkthrough
    Palette.tsx          76 lines — Ctrl+K command palette

  screens/              13 screens, 2,619 lines total
  content/glossary.ts   123 lines — 39 plain-language definitions
  lib/                  format, csv, rng, view helpers
  index.css             147 lines — design tokens + component classes
```

---

## 5. The data layer

### 5.1 `data/types.ts` — the contracts

Every shape in the app. The top-level `Dataset` interface is what `buildDataset()` returns and what the engine consumes:

| Field | Type | Count | What it is |
|---|---|---|---|
| `todayWeek` | `number` | `104` | Index of "this week" in the week array |
| `startDate` | `Date` | — | 104 weeks before the demo Monday |
| `weekDates` | `Date[]` | 145 | A real Monday for every week index |
| `regions` | `Region[]` | 4 | North, South, East, West |
| `warehouses` | `Warehouse[]` | 6 | 2 plant, 4 distribution |
| `plants` | `Plant[]` | 2 | PL-1 (West), PL-2 (South) |
| `lines` | `ProductionLine[]` | 5 | Melting → hot roll → cold roll → anneal → finish |
| `skus` | `Sku[]` | 240 | Finished products |
| `materials` | `Material[]` | 40 | RM-101 … RM-140 |
| `suppliers` | `Supplier[]` | 15 | S-01 … S-15 |
| `customers` | `Customer[]` | 60 | Across 8 industries |
| `orders` | `CustomerOrder[]` | 2,500 | Sales order book |
| `purchaseOrders` | `PurchaseOrder[]` | 230 | Inbound POs |
| `signals` | `MarketSignal[]` | 32 | Outside events |
| `commodity` | `CommodityPoint[]` | 130 | Weekly nickel/moly/ferrochrome index |
| `bom` | `Record<string, BomLine[]>` | 7,964 lines | Recipes, keyed by SKU id |
| `demand` | `DemandSeries[]` | 960 | 117 weeks each |
| `planHistory` | `PlanHistoryEntry[]` | 21 | Audit trail |

**Key domain enums:**

- `Grade` — `304 | 316L | 430 | 201`
- `Form` — `Cold-rolled coil | Hot-rolled coil | Sheet`
- `Finish` — `2B | BA | No.1 | No.4 | HL`
- `Lifecycle` — `New | Growing | Mature | Declining`
- `ABC` / `XYZ` — value class / variability class
- `OrderStatus` — `Open → Confirmed → In production → Dispatched → Delivered`
- `POStatus` — `Recommended → Approved → Sent → Confirmed → In transit → Received` (+ `Cancelled`)
- `StockStatus` — `Healthy | Reorder now | Stockout risk | Excess`
- `AnomalyStatus` — `Open | Accepted as new trend | Ignored as one-off | Investigating`

### 5.2 `data/catalog.ts` — the hand-written master data

This file is deliberately not generated. The metallurgy has to be correct for the story's cause and effect to be real rather than asserted.

#### The 4 regions

| Region | Share | Hub | Warehouses | Industries |
|---|---|---|---|---|
| North | 26% | Northern hub | WH-N1 | Automotive, Appliances, Construction |
| South | 30% | Southern hub | WH-S1, WH-S2 | Pharmaceuticals, Food processing, Automotive |
| East | 18% | Eastern hub | WH-E1 | Railways, Construction, Heavy engineering |
| West | 26% | Western hub | WH-W1, WH-W2 | Chemicals, Pharmaceuticals, Appliances |

#### The 6 warehouses

| ID | Name | Region | Type | Capacity |
|---|---|---|---|---|
| WH-N1 | North Distribution Warehouse | North | Distribution | 4,200 t |
| WH-S1 | South Plant Warehouse | South | Plant | 3,000 t |
| WH-S2 | South Distribution Warehouse | South | Distribution | 3,300 t |
| WH-E1 | East Distribution Warehouse | East | Distribution | 6,500 t |
| WH-W1 | West Plant Warehouse | West | Plant | 7,500 t |
| WH-W2 | West Distribution Warehouse | West | Distribution | 3,800 t |

#### The 5 production lines

| ID | Process | Plant | Weekly capacity | Shifts | Maintenance weeks | Forms |
|---|---|---|---|---|---|---|
| LN-1 | Melting & casting | PL-1 | 1,700 t | 3 | 110, 122 | All three |
| LN-2 | Hot rolling | PL-1 | 1,500 t | 3 | 108, 120 | HR, CR |
| LN-3 | Cold rolling | PL-1 | 1,000 t | 3 | 113 | CR, Sheet |
| LN-4 | Annealing & pickling | PL-2 | 900 t | 2 | 107, 118 | CR, Sheet, HR |
| LN-5 | Finishing & slitting | PL-2 | 700 t | 2 | 115 | Sheet, CR |

LN-1 is the real bottleneck — everything passes through melting. The MRP uses this explicitly.

#### The 40 materials

Each `MatSpec` row carries: code, name, category, unit, cost, critical flag, shelf life, storage location, MOQ, lot rule, lot size, lead time ± SD, primary supplier, backups, substitutes, price trend, target cover days, and a note.

**By category:**

| Category | Codes | Examples |
|---|---|---|
| Base metal / Alloy | RM-101 … RM-110 | Scrap, ferrochrome (HC & LC), nickel cathode, ferromolybdenum, ferromanganese, ferrosilicon, ferrotitanium, ferroniobium, aluminium shot |
| Flux | RM-111 … RM-113 | Burnt lime, dolomitic lime, fluorspar |
| Industrial gas | RM-114 … RM-117 | Argon, nitrogen, oxygen, LPG |
| Process chemical | RM-118 … RM-124 | Nitric / hydrofluoric / sulphuric acid, inhibitor, rolling oil, fuel additive, neutraliser |
| Consumable | RM-125 … RM-128, RM-131 … RM-133 | Graphite electrode, refractory brick, tundish board, casting powder, grinding wheel, abrasive belt, polishing compound |
| Spare part | RM-129, RM-130, RM-139, RM-140 | Work roll, backup roll, mill bearing, hydraulic seal kit |
| Packaging | RM-134 … RM-138 | Strapping, skid, interleaving paper, coil sleeve, VCI wrap |

**The three materials that carry the story** (via the `STORY_COVER` override in `generate.ts`):

| Code | Material | Lead time | Target cover forced to | Why |
|---|---|---|---|---|
| **RM-105** | Ferromolybdenum | 42 ± 6 d | **24 days** | ~4 weeks of cover against a 6-week lead time. The crisis. |
| **RM-102** | Ferrochrome (high carbon) | 21 ± 4 d | **95 days** | Far more than falling 430 demand needs. The excess. |
| RM-135 | Wooden skid | 8 ± 2 d | **11 days** | Chronically short; unreliable monsoon supplier. |

Extremes worth knowing: RM-130 (backup roll) has the longest lead time at **84 days**; RM-104 (nickel cathode) is the highest-value at **₹16.8 lakh/t**; RM-130 costs **₹39 lakh each**.

#### The 15 suppliers

| ID | Name | Region | Lead ± SD | OTIF | Quality | Price var | Risk |
|---|---|---|---|---|---|---|---|
| S-01 | Bulk Alloys | West | 21 ± 4 | 91% | 98.6% | −1.2% | Low |
| S-02 | Imported Alloys | Import | 42 ± 7 | 78% | 99.1% | +4.6% | **High** |
| **S-03** | **Specialty Alloys** | South | **12 ± 2.5** | 94% | 98.9% | **+8.4%** | Low |
| S-04 | Scrap Processing | West | 9 ± 2.5 | 88% | 96.2% | +2.1% | Medium |
| S-05 | Scrap & Recycling | North | 12 ± 3 | 84% | 95.4% | −0.8% | Medium |
| S-06 | Industrial Gases | West | 4 ± 1 | **97%** | 99.7% | +0.6% | Low |
| S-07 | Flux & Lime | East | 7 ± 1.5 | 93% | 97.8% | −0.4% | Low |
| S-08 | Process Chemicals | West | 14 ± 3 | 89% | 98.2% | +2.8% | Medium |
| S-09 | Acids | South | 11 ± 2.5 | 86% | 98.8% | +3.9% | **High** |
| S-10 | Refractories | East | 22 ± 5 | 90% | 97.4% | +1.4% | Medium |
| S-11 | Electrodes | Import | 30 ± 6 | 82% | 98.0% | +5.1% | **High** |
| S-12 | Rolls & Grinding | West | 56 ± 10 | 87% | 99.3% | +2.2% | Medium |
| S-13 | Packaging | West | 11 ± 2 | 95% | 98.4% | −1.6% | Low |
| S-14 | Packaging & Timber | East | 8 ± 2.5 | **79%** | 95.9% | +1.1% | **High** |
| S-15 | Spares & Bearings | North | 45 ± 9 | 92% | 99.0% | +1.9% | Medium |

**S-03 is the rescue supplier.** It is the domestic specialty alloy source: 12-day lead time against S-02's 42 days, at roughly 8.4% more on price. This is the trade the entire demo turns on.

#### The bill of materials

Composed from four layers that are merged additively per SKU:

**1. `BOM_BY_GRADE` — per tonne, by grade:**

| Material | 304 | 316L | 430 | 201 |
|---|---|---|---|---|
| RM-101 Scrap | 0.820 | 0.790 | 0.870 | 0.855 |
| RM-102 Ferrochrome HC | 0.185 | — | 0.172 | 0.158 |
| RM-103 Ferrochrome LC | — | **0.180** | — | — |
| RM-104 Nickel | 0.084 | **0.112** | — | 0.042 |
| **RM-105 Ferromolybdenum** | — | **0.028** | — | — |
| RM-106 Ferromanganese | 0.012 | 0.012 | 0.009 | **0.078** |
| RM-107 Ferrosilicon | 0.006 | 0.006 | 0.006 | 0.006 |
| RM-108 Ferrotitanium | — | — | 0.004 | — |
| RM-111/112/113 Flux | 0.055 / 0.025 / 0.008 | same | same | same |

The metallurgy is enforced by a unit test: **316L is the only grade containing molybdenum**, 430 contains no nickel, and 201 substitutes manganese for part of the nickel. That single fact — moly appears in exactly one grade — is what makes "316L demand rose, therefore molybdenum is now at risk" a real causal chain rather than a scripted coincidence.

**2. `BOM_COMMON` — needed for every tonne regardless of grade:** aluminium shot 1.5 kg, argon 12 m³, nitrogen 8 m³, oxygen 48 m³, LPG 6 kg, graphite electrode 0.004 nos, refractory brick 0.8 nos, tundish board 0.03, casting powder 1.2 kg, neutraliser 6 kg, strapping 2.2 kg, skid 0.12 nos, interleaving 1.4 kg, sleeve 0.10, VCI wrap 0.5 kg.

**3. `BOM_BY_FORM`** — cold-rolled and sheet need the full acid/oil/roll set; hot-rolled needs roughly half.

**4. `BOM_BY_FINISH`** — `2B` and `No.1` add nothing; `BA` adds 4 m³ nitrogen; `No.4` adds abrasive belt; `HL` adds polishing compound + belt.

Plus two gauge adjustments in `buildBom`: at ≤ 0.5 mm, rolling oil × 1.35 and work roll × 1.4 (thinner gauge means more rolling passes).

Each resulting line also carries `scrapPct` — **4%** for the acids and rolling oil (RM-118, RM-119, RM-122), **2%** for everything else.

### 5.3 `data/generate.ts` — where every row comes from

Everything is driven by `Rng`, a seeded mulberry32 generator (`lib/rng.ts`), default seed **20260413**. Same seed → identical dataset every run, which a unit test asserts.

#### The calendar is anchored to the real today

```ts
function mondayOfThisWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
```

This is the reason the demo never ages. Week index 104 is always the Monday of the real current week; 104 weeks of history sit behind it and 13 weeks of unread future sit in front. `WOY_OFFSET = 44` shifts the seasonal index so the festive peak lands in Oct–Nov and the monsoon dip in Jun–Aug.

#### SKU construction

Nested loops over 4 grades × 3 forms × 4 thicknesses × 5 finishes = **240**. Per SKU:

- **Weight** = `GRADE_W × FORM_W × THICK_W × FINISH_W` — drives volume share.
- **Lifecycle** is skewed by grade: 430 is 62% likely Declining; 316L is 46% likely Growing.
- **Price** = `GRADE_PRICE × FORM_ADJ × FINISH_ADJ × thickness adj × ±2% noise`, rounded to ₹100. Base prices: 304 ₹252k/t, 316L ₹368k/t, 430 ₹168k/t, 201 ₹186k/t.
- **ABC** from weight: > 0.0062 = A, > 0.0032 = B, else C.
- **XYZ**: lumpy → Z, Mature → X, else coin-flip X/Y.
- **`mainRegions`** is forced for the story: 316L → South + West; 430 → North + West; others random.
- **`lumpy`** — low-weight SKUs have a 45% chance of selling in bursts.

#### Demand history — the heart of the generator

Each of the 960 series is built by `shape(spec, t)`, which composes, in order:

1. **Base level** — `skuWeeklyTotal × regionShare × tilt`, where tilt is 1.25–1.65 if the region is a main region, else 0.55–0.92. Total plant volume is `TOTAL_WEEKLY_TONNES = 3800`.
2. **Trend** — compounding `(1 + trendPerWeek)^t`. Growing +0.22…0.55%/wk, New +0.6…1.3%, Declining −0.25…0.62%, Mature ≈ flat.
3. **Yearly season** — `1 + seasAmp × sin(2π(t + phase)/52)`. 430 and 201 get a bigger amplitude (0.14–0.24) than 304/316L (0.06–0.15).
4. **Calendar effects** — festive build-up (weeks of year 40–45) × 1.14; monsoon (24–33) × 0.87 for construction-linked grades; year-end (week 0 and 51) × 0.78.
5. **The 430 structural decline** — over the last 26 weeks, `max(0.55, 1 − 0.011 × weeks_elapsed)`. Floored at 55%, because a declining grade loses share rather than stopping.
6. **24 random historical anomaly episodes** — 2–4 weeks each, +28…72% or −24…50%, each with a plain-language cause.
7. **THE STORY** — if grade is 316L **and** region is South **and** `t ≥ 101`, multiply by `1 + 0.35 × [0.72, 1.0, 1.12][step]`. A step change that persists, not a blip.

Then noise: `v × exp(normal(0, noiseSd) − noiseSd²/2)` — lognormal, mean-corrected. `noiseSd` is 0.075 (X), 0.15 (Y) or 0.42 (Z). Lumpy SKUs zero out 55% of weeks.

**A subtle but important detail.** The 13 future weeks are drawn from a *separate* RNG stream (`new Rng(910_357)`):

> Taking them from `rng` inside the loop above would shift every number generated after it — stock, suppliers, orders, the whole tuned story.

That isolation is why advancing the planning week reveals genuinely new data without disturbing the 55-stockout figure the demo depends on.

#### Materials — stock derived from real usage

`buildMaterials` does not invent stock levels. It computes actual average weekly consumption over the last 8 weeks of history by exploding demand through the BOM, then sets on-hand as `dailyUsage × coverDays`, where:

```
naturalCover = leadTimeDays + 2 × leadTimeSdDays + 14
coverDays    = STORY_COVER[code] ?? max(targetCoverDays, naturalCover)
```

So most materials start in a sensible position (if everything looked broken, the demo would teach nothing), and only the three story materials sit deliberately outside it.

Stock is split across warehouses — packaging across four, everything else across WH-W1 (56%) and WH-S1.

Also set here: `onOrder` (42% chance of 6–20 days' worth), and **`staticMinLevel`** = `daily × (critical ? 14 : 10)` — the deliberately crude fixed rule the "old way" runs on in the replay.

#### Orders, POs and signals

- **`buildOrders`** walks every series from week 92 to 110, takes a 16% chance per week, and sizes the order at 30–90% of that week's real demand. Status derives from the promised week relative to today. Result: **2,500 orders**. There is a careful comment explaining that past-today weeks deliberately use the trailing average rather than the real figure, because whether a week clears the 0.4 t floor changes how many RNG draws the loop makes — and every number generated afterwards rides on that stream.
- **`buildPurchaseOrders`** creates 6–9 POs per critical material, 3–6 otherwise = **230**. Slip is drawn against the supplier's OTIF, so unreliable suppliers genuinely arrive late.
- **`buildSignals`** = **12 scripted + 20 filler = 32**. The scripted ones carry the story: SIG-001 (new South pharma plants, +32%, confidence 0.82), SIG-002 (customers raised 316L forecasts, +18%, 0.91), SIG-003 (moly index +9.4%), SIG-004 (port congestion, −14%), SIG-005 (appliance makers leaving 430, −16%).
- **`buildCommodity`** random-walks three indices from 100, with moly given an extra × 1.014 per week over the last six weeks so the index chart matches SIG-003.

---

## 6. The engine

All of `src/engine/` is pure functions over plain data. No React, no DOM, no I/O. That is what makes it unit-testable and what lets it run in a worker.

### 6.1 `forecast.ts` — three competing models

#### Model 1: Seasonal naive

"The same week last year." `y[length − 52 + (i mod 52)]`, falling back to the trailing 8-week mean. This is the baseline every other model must beat.

#### Model 2: Holt-Winters

Triple exponential smoothing — level + trend + multiplicative yearly season, with a damped trend (φ = 0.97).

```
forecast  f = (level + φ·trend) × season[t mod m]
level'      = α(y/season) + (1−α)(level + φ·trend)
trend'      = β(level' − level) + (1−β)·φ·trend
season'     = γ(y/level') + (1−γ)·season
```

Fitted by grid search over α ∈ {0.1, 0.3, 0.55}, β ∈ {0.02, 0.1}, γ ∈ {0.1, 0.3, 0.55} — 18 fits per series, keeping lowest SSE. Seasonal factors are clamped to [0.2, 3.2] to stop runaway multipliers.

#### Model 3: Ridge regression

A genuine ML model, solved in closed form. **Nine features:**

| # | Feature | Meaning |
|---|---|---|
| 1 | `y[t−1]` | Sales last week |
| 2 | `y[t−2]` | Sales 2 weeks ago |
| 3 | `mean(y[t−1..t−4])` | Average last 4 weeks |
| 4 | `y[t−52]` | Same week last year |
| 5 | `sin(2π(t mod 52)/52)` | Season, yearly cycle |
| 6 | `cos(2π(t mod 52)/52)` | Season, half-yearly |
| 7 | `t/100` | Trend over time |
| 8 | `priceIndex[t]` | Alloy price index |
| 9 | `signalFlag[t]` | Market signal active |

Training standardises every column, centres the target, then solves the ridge normal equations:

```
(ZᵀZ + λI) w = Zᵀy        with λ = 1.2 × n/100
```

via Gaussian elimination with partial pivoting (`solve()`). Multi-step forecasting feeds each prediction back in as the next step's lag.

`ridgeDrivers()` returns `|w_i| / Σ|w|` per feature — this is what the "Drivers" panel and the Models screen's "What the ML model uses" chart display.

#### The honest part: back-testing

```
HOLDOUT = 12
cut   = max(8, length − 12)
train = y[0 .. cut]       test = y[cut ..]
```

Each model is fitted on `train` only and scored on `test`, which it never saw. Metrics: `safeMape` (which falls back to error-relative-to-mean when a series is mostly zeros, so the comparison stays fair), `biasPct`, `rmse`. Lowest MAPE wins, then the winner is **refitted on the full history** before forecasting forward.

`spreadsheetMethod()` — a flat 13-week average — is scored the same way, giving the honest side-by-side comparison. On some series the simple method wins, and the app says so rather than hiding it.

**`accuracyTrend`** re-runs the whole back-test 24 weeks earlier and compares: better by > 2.5 points = Improving, worse by > 2.5 = Getting worse, else Stable.

**`shortHistory`** — fewer than 26 non-zero weeks switches the label to `Look-alike` and forecasts a flat recent mean, with an honest reason string.

#### Post-processing

```
forecast = raw × (1 + signalUplift/100) × (1 + override/100)
errPct   = clamp(mape/100, 0.06, 0.9)
lower[i] = forecast[i] × (1 − errPct × (1 + i×0.035))
upper[i] = forecast[i] × (1 + errPct × (1 + i×0.035))
```

The band widens with horizon — further out means less certain.

**Decomposition** splits the forecast into `base` (trailing 8-week mean), `trend` (HW trend × i × 0.97), `season` (base × (seasonFactor − 1)) and `signal` (whatever is left over). This is what the Forecast screen's "Parts" tab draws.

### 6.2 `anomaly.ts` — catching demand shifts in days

The idea in one line: work out what each week *should* have looked like from the weeks around it, then flag weeks further away than normal.

**Expected value** for week `t` is a robust mean of the preceding 10 non-zero weeks, lifted by the same-week-last-year seasonal ratio (clamped 0.6–1.6). **SD** is `max(stdev(window), base × 0.06)` — the floor stops a very steady series generating absurd z-scores.

**Three gates before anything is examined**, each removing a class of false alarm:

| Gate | Constant | Removes |
|---|---|---|
| `mean(recent) < 6.0` | `MIN_LEVEL` | Series too small for tonnes to matter |
| `zeros/total > 0.3` | `MAX_ZERO_SHARE` | Lumpy series — bursty, not anomalous |
| only last 16 weeks | `LOOKBACK` | Old episodes — history, not a work queue |

Then `z = (y[t] − expected) / sd`, flagged when `|z| ≥ threshold` (default **2.5σ**, planner-adjustable 1.5–4.0).

**Grouping** joins consecutive same-direction flagged weeks into one episode, and will bridge a single gap week if it still reaches 65% of threshold.

**Materiality filter** — an episode is only reported if *all three* hold:

```
expected ≥ 3.0 t                  (baseline big enough for % to mean anything)
14% ≤ |deltaPct| ≤ 300%           (commercially material, not absurd)
|deltaT| × weeks ≥ 2.5 t          (enough total tonnage)
```

The comment explains the first one precisely: without it, a week going from 0.2 t to 2 t reads as "+900%".

**Severity:** High needs `peakZ ≥ 1.6×threshold` **and** ≥ 2 weeks; Medium needs `peakZ ≥ 1.15×threshold` **or** ≥ 3 weeks; else Low.

**`detectedWeek`** is `t+1` for multi-week episodes, `t` for single weeks — a single week needs a stronger signal to be believed. `detectedAfterDays = (detectedWeek − startWeek) × 7 + 3`, which is why the demo reports "caught after 3 days".

**Cause attribution** searches for a demand signal in the 8 weeks before the episode whose effect has the *same sign* as the gap. If found, the signal's title becomes `likelyCause` and `linkedSignalId` is set — this is what wires the Signals screen to the Anomalies screen.

### 6.3 `inventory.ts` — live reorder parameters

This is capability K3, and the contrast with the old way is the point: a fixed minimum typed into a spreadsheet once a year, versus two numbers recalculated from current usage, current variability and current lead time on every run.

```
Z             = from service level (90% → 1.2816 … 99.5% → 2.5758)
LT            = leadTimeDays + leadTimeBufferDays
variance      = LT × σ_demand² + demand² × σ_LT²
safetyStock   = Z × √variance
reorderPoint  = demand × LT + safetyStock
daysOfCover   = onHand / dailyUsage
daysToBreach  = (onHand − safetyStock) / dailyUsage
orderByDays   = daysToBreach − LT
```

The variance formula covers **both** kinds of uncertainty at once: how much we use varies, *and* how long the supplier takes varies. That second term is what a fixed minimum level cannot express.

**Status classification** (order matters — first match wins):

| Status | Condition |
|---|---|
| `Stockout risk` | `daysOfCover ≤ LT × 0.75` |
| `Reorder now` | `onHand + onOrder ≤ reorderPoint` |
| `Excess` | `daysOfCover ≥ excessCoverDays` |
| `Healthy` | otherwise |

**Action tier:** < 7 days = Order now, 7–14 = Review, > 14 = Monitor.

**Health score** grades two different failures separately and then combines them:

```
availabilityScore = clamp((coverWithOnOrder / (LT + SS/d)) × 70, 0, 100)
excessRatio       = onHand / (d × excessCoverDays)
excessScore       = clamp(100 − max(0, excessRatio − 1) × 85, 0, 100)
healthScore       = round(availability × 0.58 + excess × 0.42)
```

This is what lets one screen say "raise this buffer" and "cut that order" at the same time — the case study's twin problem.

Every result also carries an `explain` object with the formula **filled in with the real values**, which is what the clickable `Calc` component shows:

> "Safety stock = Z × √(lead time × usage variability² + usage² × lead-time variability²). With a 97% service level Z is 1.88; we use about 3.31 per day (varying by ±0.42), and the lead time is 47 days (varying by ±6 days). That gives 26.84 units of buffer."

### 6.4 `mrp.ts` — five stages

**Stage 1 — capacity-constrained production plan.** Sums forecast across all 240 SKUs per week. Computes available capacity, halving to 35% on maintenance weeks. Then:

```ts
const meltCap = sum of melting-line capacity this week
const bottleneck = Math.min(capacityT, meltCap * 2.3)
const plannedT = Math.min(requiredT, bottleneck)
const ratio = plannedT / requiredT     // the feasibility factor
```

Everything passes through melting, so the melt line gates the plant. `ratio` is carried into stage 2 so material requirements reflect what can actually be made, not what was wished for.

**Stage 2 — BOM explosion.** For every SKU, every week, every recipe line:

```
gross[material][week] += forecast × ratio × qtyPerTonne × (1 + scrapPct/100)
```

**Stage 3 — netting.**

```
before = onHand + scheduledReceipts
net    = max(0, gross + safetyStock − before)
```

Safety stock is added to the requirement, which is what keeps the buffer intact rather than being consumed.

**Stage 4 — lot sizing.** Only when `respectLotSizes` is on:

| Rule | Quantity |
|---|---|
| `Fixed lot` | `ceil(net / lotSize) × lotSize` |
| `Min order qty` | `max(moq, ceil(net / lotSize) × lotSize)` |
| `Lot-for-lot` | exactly `net` |

**Stage 5 — lead-time offset.** `releaseWeek = needWeek − round(leadTimeDays / 7)`. If `releaseWeek < startWeek`, the order is flagged **late** with an explicit reason:

> "Needed in week 112, but with a 42-day lead time the order should already have gone out in week 106."

Output per material is an `MrpRow` with one `MrpCell` per week carrying all seven standard MRP rows, plus `firstBreachWeek` and `firstStockoutWeek`.

### 6.5 `procurement.ts` — turning plans into decisions

Two branches per material.

**Branch A — short, or will be** (status is `Stockout risk` / `Reorder now`, or any planned order is late):

`chooseSupplier()` is the interesting part. It takes the days available and filters approved sources to those that can actually make the date:

- If any can, pick the **cheapest** that still makes it.
- If none can, pick the **fastest** and flag it as needing an expedite.

The note is written in plain language either way:

> "Supplier B — Imported Alloys needs 42 days, which is longer than the 11 days available. Supplier C — Specialty Alloys delivers in 12 days at about +8.4% on price."

Quantity covers planned orders inside `leadTime + 21 days`, then respects the lot rule. **Confidence** is a bounded additive score:

```
52 + (critical ? 12 : 4) + (cover < 14d ? 18 : 6) + (anomaly linked ? 10 : 0)
   + (OTIF − 85) × 0.35 − (cover > 30d ? 16 : 0) − (switched ? 4 : 0)
clamped to [38, 96]
```

**Revenue at risk** carries a careful design note. Exposure is measured as the *rupee value of downstream production* × weeks stopped, not in units of the material:

> "456 wooden skids a day and 3.3 tonnes of molybdenum a day are not comparable numbers, and treating them as if they were makes packaging look like the biggest risk on site."

Five weighted `signals` and three costed `alternatives` are attached to every recommendation.

**Branch B — carrying too much** (status `Excess` and excess value > ₹1.2 lakh): a `Reduce / delay` recommendation with a **negative** `valueINR`, which is how the UI distinguishes cash released from cash spent.

**Ranking** — and this is the sharpest bit of judgement in the file — is by **slack**, not by time-to-stockout:

```ts
const slack = (r) => r.stockoutInDays - r.leadTimeDays
sort by urgency, then slack, then revenue at risk
```

> "A packaging item with eleven days of cover and an eight-day lead time has three days of headroom and is recoverable; an imported alloy with twenty-four days of cover and a forty-two-day lead time does not, even though it lasts longer."

### 6.6 `replay.ts` — the proof

Simulates **16 weeks** of identical demand through two planning methods.

| | Spreadsheet planning | DemandPilot |
|---|---|---|
| Forecast | 13-week rolling average, seeded with pre-replay weeks | Forward mean over `leadWeeks + 2`, **carrying an 8% error** |
| Reorder level | `staticMinLevel` — fixed, never revisited | `computeInventory().reorderPoint`, recalculated weekly |
| Supplier | Always the usual one | Switches to a faster approved source when the usual one cannot make the date |
| Upper bound | None — a fixed minimum has no view on holding too much | Will not order past the planner's excess target |

**The fairness controls matter more than the result.** Both arms:

- Inherit the **same opening stock**.
- Inherit the **same inbound pipeline** — without this, every material whose cover is shorter than its lead time would stock out under either method, proving nothing.
- Buy from the **same supplier panel**, and deliveries **slip against each supplier's real OTIF record** (78–97%). The slip is keyed on `(materialId, arrivalWeek)` rather than drawn from a running stream, so an order landing in a given week slips identically whichever method placed it.
- Use the **same order-up-to rule**: `orderUpTo = reorderLevel + forecast × ORDER_CYCLE_WEEKS` (2).

Two deliberate anti-flattery measures sit on the DemandPilot side:

- **No foresight.** `FORECAST_ERROR_SD = 0.08` perturbs the forward mean. Taking true future demand as the forecast would make the engine clairvoyant and hand it a perfect score. Material-level demand aggregates hundreds of SKUs, so 8% is right against roughly 11% at SKU level.
- **An excess ceiling.** DemandPilot will not order past `excessCoverDays` of cover, because topping up beyond the planner's excess target manufactures exactly the overstock the system exists to release. This is the one place the two policies differ in *how much* they may order; a fixed minimum level simply has no upper bound to respect.

Two further details:

- The trigger tests the position *after* this week's consumption (`start − demand + inPipeline`), because checking the opening balance fires a week late.
- The supplier switch only happens if the backup is **genuinely quicker** — several materials list a backup that is slower, and switching to one of those would make things worse.

Each week records: demand, opening stock, receipts, consumption, closing stock, shortfall, stockout flag, order placed, reorder level used, and forecast used. Holding cost is 18%/year. A stockout week costs 5 line-stop days for a critical material, 1 otherwise. Service level is a true fill rate: `100 × (1 − shortUnits / demandUnits)`.

Service level is a **value-weighted** fill rate: `100 × (1 − Σ(shortfall × cost) / Σ(demand × cost))`. It used to sum raw units, which added cubic metres of oxygen to tonnes of nickel and produced a dimensionless number dominated by whichever material was counted in the smallest unit.

`productionStoppedINR` measures what the shortages actually cost: for each week, the **single worst** material shortage scaled by the share of that week's requirement missed. It is deliberately not a sum across materials — nearly every material here feeds all 240 products, so adding per-material figures counts the same stopped tonnage many times over and yields a number several times the plant's entire output.

`signalToOrderDays` is the one hard-coded pair in the file: **38 days** (old) versus **6 days** (new).

### 6.7 `scenario.ts` — what-if and costed options

`runScenario()` re-runs `computeInventory` across all 40 materials under changed levers (demand %, grade filter, supplier delay, supplier filter, service level, lead-time buffer, excess target). Both "now" and "scenario" go through the identical function, which is what makes the comparison honest.

`buildPlanOptions()` produces four options for a material at risk — **A Do nothing**, **B Expedite** (marked recommended, 88% confidence), **C Transfer then order normally**, **D Partial cover now** — each with revenue at risk, extra cost, cash impact, late orders, resulting service level, arrival days and a three-step action list.

### 6.8 `engine/index.ts` — the orchestrator

`runPlanning()` in nine steps.

**Step 0 — the signal lookup.** For each of the 960 SKU×region pairs, finds every `Demand`-kind signal whose grade and region match, and computes:

```
uplift = Σ (effectPct × confidence × signalWeightPct/100 × 0.45)
clamped to [−35, +45]
```

`signalFlag[]` is set to 1 from the signal's week onwards — feature 9 of the ridge model.

**Step 1 — forecast.** 960 calls to `forecastSeries`. Per SKU, region results are summed into a total, and accuracy metrics are **volume-weighted** (`weight = max(0.01, recentAvg)`) so a tiny C-class product cannot distort the headline. The SKU's headline model is the one its **biggest region** chose.

**Step 2 — anomalies.** 960 calls to `detectAnomalies`, each given only the signals matching its grade and region.

**Step 3 — materials.** Forward weekly usage from forecast × BOM; historical usage over 26 weeks for the variability figure; driver attribution (which open anomalies and signals touch each material, with a plain-language note); then `computeInventory` per material, a 12-week stock projection, cover by warehouse, and a transfer suggestion when one warehouse holds > 2.5× another's days.

**Step 4 — MRP**, seeded with scheduled receipts derived from open POs, de-rated by `receivedPct`.

**Step 5 — procurement recommendations.**

**Step 6 — replay.**

**Step 7 — 22 KPIs.** Accuracy and bias are volume-weighted; inventory health and days-of-inventory are **stock-value-weighted**; days of cover is capped at 400 to stop one dormant material dominating.

**Step 8 — the workbench.** One queue merging four sources:

| Source | Queue | Cap |
|---|---|---|
| Recommendations | Order now / Expedite / Delay / reduce / Bring forward | all |
| Open anomalies, severity ≠ Low | Unusual demand | 14 |
| Capacity-constrained weeks | Capacity overload | 6 |
| Critical materials with no backup supplier | Missing data | 5 |

Sorted by severity, then due date. Every item carries a `linkId` so nothing is a dead end.

**Step 9 — insights.** Auto-written prose per screen, composed from the actual computed numbers. Tested to be non-empty and over 20 characters.

---

## 7. The worker and the store

### `worker/engine.worker.ts`

43 lines. Caches the dataset (built once), runs `runPlanning`, posts three progress messages (8% loading data, 30% fitting models, 100% done) then the result. Errors are caught and posted as `{ type: 'error' }` rather than crashing.

### `store/useStore.ts`

Zustand. Holds dataset, settings, result, loading/progress/error, UI state (role, dark, sidebar, command palette, tour step), and all demo state (weeksAdvanced, overrides, anomalyResolutions, approvals, rejected, dismissed, planHistory, toasts).

**`rerun()` is debounced by 120 ms**, which is what makes dragging a settings slider smooth — you get one recalculation at the end, not one per pixel.

Actions that mutate planning input all call `rerun()`: `setSetting`, `resetSettings`, `stepWeek`, `setWeeksAdvanced`, `resetDemo`, `addOverride`, `removeOverride`, `resolveAnomaly`.

Actions that do **not** rerun (they are records of decisions, not inputs): `approveRecommendation`, `rejectRecommendation`, `dismissItem`, `commitPlan`, `revertHistory`.

Almost every action writes a `PlanHistoryEntry`, giving a real audit trail. `revertHistory` marks an entry reverted but **keeps it on the record** — "Entry reverted. It stays on the record."

---

## 8. The shell, routing and navigation

### Routes (`App.tsx`)

| Path | Screen | Gated |
|---|---|---|
| `/` | Health | yes |
| `/exceptions` | Exceptions | yes |
| `/forecast` | Forecast | yes |
| `/signals` | Signals | yes |
| `/anomalies` | Anomalies | yes |
| `/models` | Models | yes |
| `/stock` | Stock | yes |
| `/plan` | Plan & MRP | yes |
| `/buy` | Recommendations | yes |
| `/orders` | Orders | yes |
| `/simulate` | Simulate | yes |
| `/proof` | Proof | yes |
| `/setup` | Setup | **no** |
| `*` | → redirect to `/` | — |

The `Gate` component shows the loading screen until `result` exists, or an error panel with a Reload button. Setup is deliberately ungated so parameters remain reachable even if the engine fails.

### Sidebar — 5 groups, 12 items

| Group | Items | Live badge |
|---|---|---|
| Overview | Health, Exceptions | workbench length |
| Demand | Forecast, Signals, Anomalies, Models | open anomalies |
| Supply | Stock, Plan & MRP | materials at risk |
| Buy | Recommendations, Orders | open recommendations |
| Decide | Simulate, Proof | — |

Collapsible to a 52 px icon rail.

### Top bar

Sidebar toggle · Search button (`⌘K`/`Ctrl+K`) · **WeekMenu** · "+1 week" · theme toggle · role selector (Planner / Buyer / Manager) · Setup cog · Tour.

### WeekMenu

Shows the **real** date, with a `+Nw` chip when advanced. Opens a 288 px panel containing: today's real date, the planning week range, the seven days of that week with the real today highlighted, Back / Advance buttons, a 13-button jump grid (now, +1 … +12), and Reset demo.

### Command palette (`Ctrl+K`)

Indexes screens, all 240 products, all 40 materials, all 15 suppliers, 16 signals, 30 anomalies and every recommendation. Arrow keys navigate, Enter opens, Escape closes. Each hit routes to a deep link (`/forecast?s=SKU-001`, `/stock?m=RM-105`).

### Tour — 8 steps

Health → Signals → Anomalies → Models → Stock → Plan → Buy → Proof. Keyboard: ← → to move, Esc to exit.

---

## 9. Every screen, section by section

### 9.1 Health (`/`) — the overview

**Header:** "240 products · 40 materials · 4 regions", plus an at-risk chip.

**6 KPI tiles:**

| Tile | Value | Sub | Links to |
|---|---|---|---|
| Accuracy | `forecastAccuracyPct` | delta vs old method | `/models` |
| Anomalies | `openAnomalies` | `N high` | `/anomalies` |
| Stockout risk | `stockoutRiskCount` | `N at reorder` | `/stock` |
| Stock value | `inventoryValueINR` | `N days` | `/simulate` |
| Excess | `excessValueINR` | `N materials` | `/stock` |
| Service | `serviceLevelPct` | "demand met" | `/proof` |

**The Chain rail** — six clickable cards showing the signal-to-order chain, each with a live count: Signals (unread) → Forecast (accuracy) → Plan (planned orders) → Stock (at risk) → Buy (to approve) → Orders (open). This is capability K6 made literal.

**Charts:** "Demand by region" (10 weeks actual + 6 weeks forecast, 4 lines) and "Stock health" (bar chart of the four status buckets).

**"Needs a decision"** — the top 7 workbench items: severity chip, queue chip, title, confidence bar, days-due (showing a red **now** when overdue), each routing to its `linkId`.

### 9.2 Exceptions (`/exceptions`) — the work queue

**5 tiles:** Open · Critical · High · Confident (≥ 80%) · Value (sum of |valueINR|).

**2 charts:**
- "What the queue is made of" — horizontal stacked bars per queue, splitting Critical/High from Medium/Low. *Note: "Critical and high severity are counted separately: those are the ones with a deadline that has teeth."*
- "When each decision is due" — six buckets: Overdue, Today, 2–3 days, This week, Next week, Later.

**Filter chips** for all 6 queues, then one card per item: checkbox (for bulk accept) · severity · queue · subject (links to the material/SKU) · title + recommended action · confidence · due · **Why** / ✓ / ✗ buttons.

**The Why drawer** shows the recommended action, the reason, the weighted signal bars, and a 3-up row of queue/due/value.

### 9.3 Forecast (`/forecast`) — capability K1

**6 tiles:** Accuracy (with delta vs old) · Bias (with "runs high/low") · Series (`240 × 4 = 960`) · Next 12 wk tonnage · Horizon · Overrides.

**Selectors:** grade → product → region. The default product is the 316L cold-rolled 1.0 mm 2B — the story SKU.

**Five tabs:**

**Chart tab** — the forecast chart (actual line, forecast dashed line, 80% confidence band as a gradient area, old-method line, and a "fence" reference line at +3 weeks), plus two side panels:
- *Model chosen* — a bar per candidate model with its MAPE, the winner highlighted. "Lower bar = lower error. Tested on 12 held-out weeks."
- *Drivers* — the top 5 ridge feature weights.
- *Override* — appears only when one is set, with a Remove button.

**Parts tab** — the stacked decomposition (base + trend + season + signal) over 10 weeks, with a per-week average panel.

**Levels tab** — next-13-week tonnage by grade and by region, plus a 316L-by-region 4-up.

**Heatmap tab** — top 18 products × 4 regions, coloured by percentage change vs the previous 8 weeks (green positive, red negative, intensity scaled to the max absolute value). Clicking a cell jumps to that product/region on the chart tab. **This is where the South 316L story is visible at a glance.**

**Table tab — 9 columns:**

| Column | Content |
|---|---|
| Product | SKU code, monospace |
| Grade | chip |
| Model | chip, colour-coded (purple = Ridge, blue = Holt-Winters) |
| Now | `recentAvg` in tonnes |
| 12 wk | sum of forecast weeks 0–11 |
| Change | `changePct`, green > +8%, red < −8% |
| Error | MAPE (with a glossary tooltip) |
| vs old | `spreadsheetMape − mape`, green when the model wins |
| Trend | Improving / Stable / Getting worse chip |

**Override modal** — adjustment % and a **required** reason. Writes to plan history and triggers a full recalculation.

### 9.4 Signals (`/signals`)

**5 tiles:** Demand · Supply · Price counts (each a filter) · High severity · Signal → order days (showing "was 38").

**Alloy price index chart** — 12 months of molybdenum, nickel and ferrochrome.

**Weighting panel** — shows the current signal weight and explains the formula: "A signal's stated effect × its confidence × this weight is added to the forecast for matching products."

**Signal cards** — source-type icon, severity, kind, "new" badge, date, title, then effect % / confidence / scope chips.

**Detail drawer** — the full explanation, a 3-up showing expected effect / confidence / **applied as** (the actual computed uplift), scope chips, a **Materials reached** list with each material's live status and cover, and — critically — **"Demand did move — N anomalies"**, linking the signal to the anomalies it explains, each showing how many days it took to catch.

### 9.5 Anomalies (`/anomalies`) — capability K2

**6 tiles:** Open · High · Above forecast (stockout risk) · Below forecast (excess risk) · Sensitivity (σ, links to Setup) · Impact (₹).

**"How one is decided"** — a 4-step explainer: ① Expected (from the 10 weeks before, adjusted for last year) ② Wobble (how much this product normally varies) ③ Compare (flag if the gap exceeds Nσ) ④ Materiality (ignore gaps under 14% or too few tonnes).

**Filters:** status (Open / Accepted / Ignored / Investigating / All) and severity.

**Table — 10 columns:** Sev · Product · Region · Gap (signed %, coloured) · Expected · Actual · Weeks · **Caught** (days, green) · Impact (₹) · Status.

**Detail drawer:** an expected-vs-actual chart over the surrounding weeks; a 4-up of expected / actual / z-score / caught-after; **Likely cause** (the linked signal title, or an honest "No matching market signal…"); **Materials affected** sorted by tightest cover; and **Suggested action**.

**Resolution modal** — three actions (New trend / One-off / Investigating), each requiring a reason. Accepting as a new trend feeds back into the next engine run.

### 9.6 Models (`/models`)

**6 tiles:** Accuracy · Beats old (% and count) · Bias · Drifting · Model fits (`240 × 4 × 3 = 2,880`) · Run time (seconds).

**3 charts:** which model wins (count per model) · error by grade (DemandPilot vs old, side by side) · what the ML model uses (mean driver weights).

**Drifting panel** — appears only when some products are getting worse; shows up to 8 cards with an accuracy ring, error, bias and model.

**Table — 8 columns:** Product · Model · Error · Old method · **Gain** · Bias · Trend · a warning icon for drifting rows.

**Retrain modal** — shows series count, fit count and last run time, then re-runs everything.

### 9.7 Stock (`/stock`) — capability K3

**6 tiles**, four of which are filters: Stockout risk · At reorder · Healthy · Excess (with ₹ value) · Stock value (with days) · Health /100.

**2 charts:**
- "Stock value — next 12 weeks" — all 40 materials summed in crore, with the combined safety floor as a dashed line.
- "Cover against lead time — tightest nine" — paired bars. *"Where the cover bar is shorter than the lead-time bar, ordering today is already late."* The sort key is `daysOfCover − leadTimeDays`, i.e. slack.

**List tab — 11 columns:**

| Column | Content |
|---|---|
| Material | code + name |
| On hand | quantity + unit |
| Cover | mini bar (scaled to 70 days) + days, coloured by `toneForCover` |
| Safety | computed safety stock |
| Reorder | computed reorder point |
| **Old rule** | `staticMinLevel`, greyed — the direct before/after comparison |
| Order by | days, or a red **passed** |
| Lead | supplier lead time |
| Value | stock value ₹ |
| Health | 0–100, colour-coded |
| Status | status chip |

Footer: "Under 7 days of cover = order now · 7–14 = review · above 14 = monitor."

**Regions tab** — a material × warehouse matrix showing quantity and days per warehouse (red under 10 days, amber over 70), plus a **"Transfer instead of buy"** panel comparing transfer days against purchase lead time.

**Health tab** — overall ring with availability and excess bars, then two side-by-side lists: **"Raise the buffer"** (lowest health) and **"Cut the order"** (highest excess value).

**Detail drawer** — the richest in the app:
- "Why demand moved" callout when an anomaly drives this material
- 4-up: on hand / cover / order by / health
- 12-week projection chart (on hand area, safety dashed, reorder dashed)
- **The numbers** — safety stock, reorder point, old fixed rule, order-by. The first, second and fourth are **clickable**, opening the formula with real values substituted.
- **Suppliers** — primary and backups with lead time and OTIF; shows "no approved alternative" when there is none.
- **Why we need it** — pegging: which SKUs pull this material, as proportional bars.
- **Recommended** — any live recommendations for this material.

### 9.8 Plan & MRP (`/plan`) — capability K4

**6 tiles:** Planned orders · Already late · Over capacity (weeks) · Plan volume · Planned spend · Stockouts in plan.

**Run MRP** animates the five stages at 420 ms intervals, each showing its real count.

**Capacity tab** — a composed chart: planned tonnes stacked with over-capacity tonnes in red, with the capacity line dashed over the top. Plus load-by-line over 8 weeks, and the line list with weekly capacity and shift count.

**Recipe tab** — pick any SKU, see its attributes and every BOM line: material, category, qty/t (4 dp), cost/t, and the material's live stock status. This is where "one tonne of 316L needs 28 kg of molybdenum" becomes concrete.

**MRP grid tab** — the classic time-phased grid. 12/25/40 materials × 10 weeks, each material showing **five rows**:

| Row | Field | Meaning |
|---|---|---|
| Gross | `grossRequirement` | What the plan needs this week |
| Receipts | `scheduledReceipts` | Already on the way |
| **On hand** | `projectedOnHand` | Running balance — amber if below safety, **red if negative** |
| Order recv | `plannedOrderReceipt` | Quantity that must arrive |
| Order place | `plannedOrderRelease` | Quantity that must be **ordered**, offset back by the lead time |

Legend: amber = below safety, red = stockout.

**Planned orders tab** — Material · Qty · Needed (full date) · Place by (full date) · late/on-time chip.

### 9.9 Recommendations (`/buy`) — capability K5

**Role gate:** only Buyer and Manager can approve. A Planner sees a warning chip — "switch role to Buyer to approve" — and disabled buttons. Planners recommend; buyers approve.

**6 tiles:** Waiting · Order-by passed · To spend · To release · Approved · Net cash.

**2 charts:**
- "Cash out and cash back, by order-by week" — spend in red against release in green, in crore.
- "What is riding on each decision" — production value at risk against the order's own cost. *"Crore. Production value exposed if nobody acts, against what the order itself costs."*

**Recommendation cards:** urgency · type · material code · "Order/Release N unit · Supplier" · reason · value (green when freeing cash) · **order by** (red at 0, amber ≤ 7 days) · confidence · ✓ Approve / ✎ Edit / ✗ Reject.

**Detail drawer:**
- 4-up: quantity / cost-or-freed / order by / arrives
- **Supplier** — the plain-language note explaining why this supplier
- **Confidence** — the five weighted signal bars
- **Quantity** — the full calculation in words
- **If nobody acts** — an amber callout
- **Stock if we do nothing** — projection chart
- **Alternatives** — three costed options with signed rupee deltas

**Approve / Edit / Reject modal.** Edit allows changing quantity and shows the recomputed order value live. **Reject requires a reason.** Approving creates a PO that appears immediately on the Orders screen.

### 9.10 Orders (`/orders`)

Merges locally approved orders with the 230 generated POs.

**6 tiles:** Open · Late · Approved here · Received · **Avg arrival** (days early) · Total value.

**"Where orders sit"** — six clickable stage cards: Recommended → Approved → Sent → Confirmed → In transit → Received.

**"What arrives when"** — stacked bars by expected week; red is money arriving *after* the week it is needed.

**Table — 9 columns:** PO · Material · Supplier · Qty · Value · Expected (red when slipped) · **Arrives** (`Nd early` / `Nd late`, with a just-in-time tooltip — green near zero, amber over 28 days early, red when late) · Received (% bar) · Status.

**Detail drawer:** a 6-stage progress rail; quantity/value/received/payment; **four dates** (ordered, promised, expected, needed) with expected highlighted red when it slips past promised; a just-in-time verdict panel — *"Arrives well before it is needed — paying to store it"* — and the supplier's OTIF, quality, lead and terms.

### 9.11 Simulate (`/simulate`)

**What-if tab** — six ready-made presets (South 316L +20%, Imports slip 2 wk, Service 99%, 430 falls 15%, Lean to 40 days, All suppliers +1 wk) and five live levers: demand change (−50…+60%), grade filter, supplier filter, supplier delay (0–42 days), service level, excess target.

Results appear as a comparison chart (counts and scores only, so one scale holds them) and an **8-row table**: materials at risk · stockout risk · overstocked · stock value · purchase spend · service level · days of inventory · health. Each row shows Now, Scenario and a signed change coloured by whether that direction is good.

**Plan options tab** — pick a material at risk (defaults to ferromolybdenum), then a 4-column comparison matrix across six measures (revenue at risk, extra cost, late orders, service, arrives, confidence), with the recommended column highlighted and a Commit button per option. Below, four panels give each option's numbered steps.

**Cash tab** — six tiles including holding cost per week (18%/year), a 10-week cash in/out chart, and a "Where cash sits idle" table of the top 8 releasable materials.

**History tab** — the full audit trail: type · what + reason (italic) · who · impact ₹ · in-force/reverted · Revert button.

**Commit modal** requires a reason and writes to history.

### 9.12 Proof (`/proof`)

**Three outcome cards**, each old-vs-new:

| Card | Old way | DemandPilot | |
|---|---|---|---|
| Stockouts | 71 weeks | 3 | win |
| Storage cost | ₹16.91 Cr | ₹34.77 Cr | **trade-off** |
| End to end | 38 days signal→order | 6 days | win |

The middle card is deliberately not a win. It compares rupees with rupees, both drawn from the replay,
and carries a `trade-off` chip so it cannot be mistaken for one.

**Side by side tab** — a 7-row measure table (stockout weeks, materials short, line-stop days, service level, average stock, days of inventory, signal to order) and a per-material stockout bar chart.

**Week by week tab** — pick any material; see both stock curves plus weekly usage, and a 16-row table: week · use · **old level** · **new level** · left (showing **OUT** in red on a stockout). Footer: *"The old level never changes. The new one moves every week."*

**Why tab** — two 4-point panels contrasting forecast / reorder level / timing / supplier, then:

**What both sides share** — a panel listing the fairness controls: same opening stock, same inbound deliveries, same demand, same supplier panel, same order-up-to rule, and supplier slips that hit whichever method placed the order. Only four things differ.

**The honest trade — DemandPilot does not win on stock** — the panel that carries the page. It states that DemandPilot holds **more** stock (₹627.8 Cr vs ₹305.2 Cr) and costs **₹17.86 Cr more** to hold, explains that this is arithmetic rather than policy, and names the material responsible — found at runtime by largest stock gap rather than hard-coded, so the explanation stays true if the data moves. Three figures then price the trade: extra cost of cover (₹17.86 Cr), production it protects (₹1,159 Cr), and the return (65×). A footnote points at the genuine inventory reduction, which lives on `/stock`, not here. This panel is the single best thing in the application: it reports an uncomfortable result rather than hiding it.

**The five problems** — C1–C5 mapped to the screen that solves each.

### 9.13 Setup (`/setup`)

**Parameters tab** — three panels (Service & buffers, Forecasting, Ordering) plus a **"What each one touches"** table listing current value, default, and every downstream consequence.

**Alerts tab** — 12 toggleable rules, each with trigger, severity, channels (Email/SMS/In-app icons), audience and frequency. *"Severity sets the channel, the audience and the frequency — not just a colour."*

**Master data tab** — 6 count tiles, then browsable tables for Products (9 cols), Materials (9 cols), Suppliers (7 cols), and a Plants/Warehouses view. All CSV-exportable.

**Your data tab** — a real CSV upload. Parsed **entirely in the browser**; column detection is by regex (`/sku|product|item|code/i`, `/qty|quantity|volume|sales|tonnes|demand/i`, etc.); series with ≥ 8 points are grouped and the top 40 kept. Then **the real forecast engine runs on the uploaded data** and shows the chosen model, error, bias, and comparison to a three-month average — including an honest verdict when the simple method wins. Three downloadable templates provided.

**Glossary tab** — all 39 terms, searchable, each with a plain definition and a worked example.

---

## 10. The UI kit

`ui/kit.tsx` is a deliberately small vocabulary.

**`TONE_OF`** maps every status string in the app to one of seven tones, so `<Status v="Stockout risk" />` is always red everywhere without any screen deciding.

| Component | Purpose |
|---|---|
| `Chip` / `Status` / `Dot` | status vocabulary |
| `LV` / `LVRow` | the core `{label, value}` primitive |
| `Tile` / `Tiles` | KPI tiles with optional delta, sub-label, sparkline, link |
| `Spark` | inline SVG sparkline |
| `Bar` / `Ring` | meters |
| `Signals` | weighted signal bars — used wherever a score is explained |
| `Confidence` | % chip, green ≥ 80, amber ≥ 60 |
| `Panel` / `Head` / `Tabs` / `Empty` | layout |
| `Drawer` | right-hand detail panel (max 640 px), Esc to close |
| `Modal` | centred dialog |
| **`Why`** | the (i) tooltip — looks the term up in the glossary |
| **`Calc`** | a clickable number that opens its formula with real values filled in |
| `Field` / `Loading` | forms and loading state |

`Why` and `Calc` are the two components that deliver the "nothing is unexplainable" principle.

---

## 11. Charts and colour

`ui/colors.ts` opens with a comment that documents a real, previously-hit bug:

> SVG presentation attributes such as `stroke` and `fill` are parsed before custom properties are resolved, so `stroke="rgb(var(--primary))"` is invalid and renders nothing at all — which is exactly how you end up with a blank chart.

So chart colours are **literal hex values** in two palettes (LIGHT and DARK), selected by `usePalette()`. **A unit test enforces this**, scanning the UI source for any SVG attribute handed a CSS variable.

`ui/charts.tsx` wraps Recharts. A second documented gotcha: `ResponsiveContainer` clones its child with `width`/`height`, so every wrapper must pass those through via the `Sized` interface — otherwise the chart renders nothing.

Chart components: `Forecast` (actual + forecast + confidence band + old method + fence line) · `StockChart` (on hand + safety + reorder) · `Bars` (vertical/horizontal, stacked) · `Lines` · `Decomp` (stacked base/trend/season/signal) · `CapacityChart` (stacked bars + capacity line) · `Heat` (CSS heatmap, intensity scaled to max absolute value).

---

## 12. Planner settings and what each one moves

| Setting | Default | Range | What it changes |
|---|---|---|---|
| `serviceLevelPct` | **97%** | 90–99 | Z value → safety stock → reorder points → recommendations → cash |
| `anomalyThreshold` | **2.5σ** | 1.5–4.0 | How many anomalies are flagged → exception queue |
| `horizonWeeks` | **26** | 12–26 | Forecast length · MRP grid width · planned orders |
| `leadTimeBufferDays` | **5** | 0–14 | Effective lead time → safety stock → order-by dates |
| `excessCoverDays` | **60** | 30–120 | What counts as overstocked → releasable cash |
| `respectLotSizes` | **on** | on/off | Order quantities → purchase spend |
| `signalWeightPct` | **70%** | 0–100 | Forecast level → everything downstream |

Every one of these triggers a full re-run of all nine engine steps. A unit test asserts the causal direction: raising the service level to 99% cannot *decrease* the count of materials at risk.

---

## 13. The story the demo tells

The narrative is built into the **history**, not typed into the screens. Everything downstream is computed.

1. **A signal arrives** (week 100). New pharmaceutical and food-processing plants announced in the South. Those buyers specify 316L. *(SIG-001, +32%, confidence 0.82)*
2. **Demand moves.** From week 101, South 316L steps up by 35% — and **stays** up, because it is a market change, not a blip.
3. **The anomaly is caught in 3 days.** The rolling z-score flags it on the second week of the episode. A 13-week average would take roughly five more weeks to notice.
4. **The knock-on.** 316L is the only grade using molybdenum (RM-105), which has a **42-day import lead time**. At the new demand level, cover is 22.6 days — the order-by date passed **36 days ago**.
5. **The reorder level moves by itself**, because usage and variability both rose. Status flips to Stockout risk.
6. **A costed recommendation appears:** expedite 129 t from Supplier C (12-day lead, +8.4% price) instead of Supplier B (42-day lead). Four options are priced side by side.
7. **The opposite problem, simultaneously.** Grade 430 has been declining all year, so ferrochrome (RM-102) sits at **97 days of cover** — about **₹35.98 Cr** that could be released. That cash more than covers the expedite.
8. **The proof.** The same 16 weeks replayed both ways through one engine: the spreadsheet method hits **71 stockout weeks across 22 materials and 171 line-stop days**; DemandPilot hits **3 weeks across 3 materials and 7 line-stop days** — and holds more stock to do it, which the page says out loud.

Steps 3 through 8 are all *computed*. The only things written by hand are the signal text and the 35% uplift in the history.

---

## 14. Tests

**90 tests across 5 files, all passing** (~7 s).

### `engine/engine.test.ts` — 38 tests

- **Inventory maths (8)** — Z increases with service level; `ROP = d×LT + SS`; safety stock rises with service level and with lead-time variability; days of cover; excess flagging; stockout-risk flagging; weekly→daily conversion.
- **Forecasting (9)** — model selection and output length; tracks a flat series; never negative; signal uplift applied; override applied on top; band contains the forecast; short history detected; spreadsheet method is a flat average; **beats the spreadsheet on a strongly seasonal series**.
- **Anomaly detection (6)** — nothing in a steady series; finds a sustained step up; finds a sustained drop; a higher threshold flags fewer; ignores tiny series; respects an existing resolution.
- **Plan options (1)** — the recommended option reduces revenue at risk.
- **Dataset integrity (10)** — correct volumes; 104 weeks for every series; enough held-back weeks for every calendar step; **no demand cliff when advancing**; **repeatable from the same seed**; **metallurgy is sensible**; every product has a recipe; the South 316L step is really in the history; the critical material has short cover and a long lead; every material's supplier exists.

### `engine/smoke.test.ts` — 23 tests

Full-run integration, the planning calendar, and advancing the week. The headline assertions now test
for a large improvement *and* against a suspiciously perfect one:

```ts
expect(after.totalStockouts).toBeGreaterThan(0)              // not a clean sweep
expect(after.totalStockouts).toBeLessThan(before.totalStockouts * 0.15)
expect(after.serviceLevelPct).toBeGreaterThan(99)
expect(after.serviceLevelPct).toBeLessThan(100)              // never 100%
// And the old method must genuinely fail, or the comparison proves nothing.
expect(before.totalStockouts).toBeGreaterThan(20)
expect(before.materialsWithStockout).toBeGreaterThan(5)
```

Three further tests were added in this pass: one asserting the stock trade-off is reported rather than
hidden (`after.avgInventoryValueINR > before`, and that the protected production exceeds the extra
holding cost), one asserting the fill rate is value-weighted, and one cross-screen consistency check
that `kpis.serviceLevelPct` equals `replay.after.serviceLevelPct` so the Health tile and the Proof
table can never disagree.

### `screens/render.test.tsx` — 20 tests

Mounts **all 13 screens** in jsdom and asserts they paint, then re-mounts all 13 **six weeks advanced**. Also tests deep links (`?m=`, `?s=`) and that a non-existent material id does not crash.

### `ui/charts.test.tsx` — 5 tests · `ui/colors.test.ts` — 4 tests

Charts draw real geometry and axis ticks. Palette values are literal colours, light and dark differ, six distinct series colours per theme, and **no SVG attribute anywhere in the UI is handed a CSS variable**.

---

## 15. Live numbers from a real run

Captured by running the engine on 23 October 2026, default settings, `weeksAdvanced: 0`.

### Performance
| | |
|---|---|
| Full planning run | **~590 ms** |
| Model fits per run | 2,880 (+ 960 refits) |

### Forecast accuracy
| | |
|---|---|
| DemandPilot (volume-weighted) | **88.8%** |
| Three-month average | **84.3%** |
| **Gain** | **+4.5 points** |
| Bias | −3.3% (runs slightly low) |

### Model mix across 240 products
| Model | Count | Share |
|---|---|---|
| Ridge regression | **147** | 61% |
| Seasonal naive | 65 | 27% |
| Holt-Winters | 25 | 10% |
| Look-alike | 3 | 1% |

### Planning position
| | |
|---|---|
| Open anomalies | 189 |
| Materials at risk | 2 |
| Materials overstocked | 6 |
| Inventory health | 89 / 100 |
| Stock value | ₹892.83 Cr |
| Open recommendations | 8 (2 buys, 6 reductions) |

### The story, verified
| | |
|---|---|
| South 316L anomalies found | **28** |
| Largest | SS-316L-HR-1.0-BA at **+70.4%**, caught after **3 days** |
| Ferromolybdenum | **22.6 days** cover · **Stockout risk** · order-by **−36 days** |
| Ferrochrome (HC) | **97 days** cover · **Excess** · **₹35.98 Cr** releasable |

### The replay — 16 weeks, two methods
| Measure | Spreadsheet | DemandPilot | |
|---|---|---|---|
| Stockout weeks | 71 | **3** | ✅ |
| Materials short | 22 | **3** | ✅ |
| Line-stop days *(total across all lines)* | 171 | **7** | ✅ |
| Service level *(by value)* | 88.7% | **99.3%** | ✅ |
| Production stopped | ₹1,272 Cr | **₹113 Cr** | ✅ |
| Average stock | **₹305.2 Cr** | ₹627.8 Cr | ⚠️ |
| Days of inventory | **20.9** | 38.6 | ⚠️ |
| Storage cost | **₹16.91 Cr** | ₹34.77 Cr | ⚠️ |
| Signal → order | 38 days | **6 days** | ✅ |

**The trade, stated plainly:** DemandPilot costs **₹17.86 Cr more** to hold stock over the 16 weeks,
and that cover protects **₹1,159 Cr** of production the old method could not make — a return of
roughly **65×**. It does *not* win on inventory, and the page leads with that rather than burying it.
The genuine inventory reduction lives elsewhere: the ₹57.23 Cr of excess the live plan flags on
`/stock` for release.

### Why DemandPilot cannot hold less here

This was re-tuned rather than assumed. Three genuine reductions were applied — a shorter ordering
cycle (3 → 2 weeks), an excess ceiling, and removal of the forecast's perfect foresight — which took
average stock from ₹741 Cr to ₹628 Cr. The remaining gap is arithmetic, not policy:

| | Nickel cathode (RM-104) |
|---|---|
| Lead time | **35 days** |
| Opening cover, both methods | 62 days |
| Old rule reorders at | **14 days** — cannot be replaced before it runs out |
| DemandPilot reorders at | 53 days (lead time + buffer + safety stock) |
| Old-way cover by week | 55 48 41 34 27 20 13 7 **0 0 0** 15 7 **0 0 0** |
| DemandPilot cover by week | 55 48 41 59 53 46 60 53 46 60 53 46 61 54 47 40 |

Nickel alone was ₹277 Cr of the original ₹394 Cr gap, and the top five materials were ₹387 Cr of it —
all long-lead, high-value and critical. The old method's lower average inventory is not efficiency; it
is the arithmetic consequence of sitting at zero for 6 of 16 weeks.

### Auto-written overview insights

> • South demand for grade 316L is running about 26% above forecast across 28 products, detected 3 days after it began.
> • Ferromolybdenum has 23 days of cover against a 11-day run to the safety level, and a six-week import lead time.
> • Top action: expedite 129.00 t of Ferromolybdenum from Supplier C — Specialty Alloys, order within 0 days.
> • Ferrochrome (high carbon) is carrying 97 days of cover — about ₹35.98 Cr that could be released.
> • Across 240 products and 4 regions, 2 materials need attention and 6 are overstocked.

---

## 16. Findings: discrepancies and dead code

Things I found while reading that do not match the documentation, or are unreachable. None of them breaks the application; all are worth knowing.

### 16.1 README undercounts customer orders by 4×

`README.md` states:

> | Customer orders | 600+ · Purchase orders | 200+ |

The generator actually produces **2,500** customer orders. Purchase orders at 230 are correct. The orders figure appears to be stale from an earlier tuning of `buildOrders`' 16% per-week probability.

### 16.2 `ROLE_HOME` is dead code pointing at routes that no longer exist

`lib/view.ts:74`:

```ts
export const ROLE_HOME: Record<string, string> = {
  Planner: '/workbench',
  Procurement: '/procurement',
  Management: '/before-after',
}
```

Three problems: it is **never imported anywhere**; all three paths **404** (the real routes are `/exceptions`, `/buy`, `/proof`); and the role names do not match the actual `Role` union, which is `Planner | Buyer | Manager`. It looks like a survivor of a screen rename. Safe to delete.

### 16.3 Three `RecType` variants are declared but never emitted

`procurement.ts:15` declares six recommendation types:

```ts
export type RecType = 'Order now' | 'Expedite' | 'Bring forward'
                    | 'Reduce / delay' | 'Transfer stock' | 'No source'
```

`buildRecommendations` only ever emits **`Order now`**, **`Expedite`** and **`Reduce / delay`**. `Transfer stock` and `No source` are never produced anywhere, and `Bring forward` is only ever *mapped* in the workbench switch (`engine/index.ts:543`) — a branch that cannot be reached.

This is visible in the UI: the Buy screen's filter chips offer `All / Order now / Expedite / Reduce / delay`, correctly omitting the three dead variants. Transfer *is* implemented, but through a different route — `MaterialView.transferSuggestion`, surfaced on the Stock screen's Regions tab rather than as a recommendation type.

### 16.4 The `Recommendation.type` ternary has a redundant branch

`procurement.ts`:

```ts
const type: RecType = orderByDays <= 0 ? 'Expedite'
  : inv.status === 'Stockout risk' ? 'Order now'
  : 'Order now'
```

The last two branches are identical, so the `Stockout risk` test does nothing. Harmless, but it reads as though a third outcome was intended.

### 16.5 `MrpCell.plannedOrderRelease` is initialised twice

In `mrp.ts` the cell is created with `plannedOrderRelease: 0`, then a second pass writes the real release quantities back onto the correct week. Correct, but the two-pass approach is easy to misread as a bug on first reading — worth a comment.

### 16.6 `signalToOrderDays` is the one hard-coded outcome *(still open)*

Everything else on the Proof screen is simulated. `replay.ts` returns:

```ts
signalToOrderDays: mode === 'spreadsheet' ? 38 : 6,
```

These two numbers are asserted, not computed. Given how carefully the rest of the file avoids assuming its result, this stands out — and the Proof screen presents it with the same visual weight as the genuinely simulated stockout figures. Worth either simulating or labelling as an estimate.

### 16.7 Fixed in this pass

Four credibility defects on the Proof page were found and corrected:

| | Was | Now |
|---|---|---|
| **Perfect score** | 0 stockouts, 0 materials short, 0 line-stop days, 100% service | 3 / 3 / 7 / 99.3% — the replay now carries real forecast error and real supplier slip |
| **Mismatched card** | "Storage cost: 22 days vs ₹57.23 Cr" — days against rupees, and the rupee figure came from the live plan, not the replay | ₹16.91 Cr vs ₹34.77 Cr, both from the replay |
| **Unit-mixed fill rate** | Summed m³ of oxygen with tonnes of nickel and "nos" of brick | Value-weighted, which also drops the old method's score from a flattering 99.5% to a truthful 88.7% |
| **Double-counted exposure** | *(found while adding it)* per-material production loss summed to ₹3,865 Cr — more than twice total plant output for the period | Binding constraint per week: ₹1,272 Cr |

The stock trade-off itself could not be tuned away and is now reported as a trade-off rather than a
win — see §15.

---

## Summary

The thing that makes this codebase work is a single architectural decision: **one calculation feeds everything.** `runPlanning()` is the only source of displayed numbers, so consistency across thirteen screens is structural rather than maintained by hand.

The second-best decision is that the story lives in the generated *history*, not in the screens. Because South 316L genuinely steps up in the data, and because 316L is genuinely the only grade containing molybdenum, the chain from market signal to anomaly to material shortage to expedite recommendation is **derived** rather than scripted. Change the anomaly threshold and the chain genuinely changes.

The third is intellectual honesty, and it shows up in places that cost something:

- The replay gives both methods the same opening stock, the same inbound pipeline and the same ordering rule, so the comparison isolates exactly one variable.
- The app reports that DemandPilot carries **more** inventory than the spreadsheet method, and explains why, rather than quietly reporting a saving that is not there.
- Where a three-month average beats the ML model on a series, the app says so.
- The tests assert that the old method genuinely fails, not just that the new one succeeds.

The weakest point is the hard-coded 38-vs-6 day signal-to-order figure (§16.6), which is presented with the same authority as the simulated results but is not simulated. The rest of the findings are tidy-ups rather than defects.
