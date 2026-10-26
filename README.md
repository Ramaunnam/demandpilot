# DemandPilot by J2W

**Demand-Driven Material Planning — a working proof of concept.**

Predict demand across 240 products and 4 regions, catch unusual changes within days, turn the plan into
exact material needs, set reorder levels automatically, and recommend what to buy and by when —
all from one data set, on one dashboard.

Every number in this application is **calculated live in the browser**. Three forecasting models are
fitted and back-tested for each product and region; safety stock, reorder points, material requirements,
purchase recommendations and the before/after proof are all derived from the result. Change a planner
setting and the entire plan recalculates.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # 90 tests: engine maths, data integrity, the planning
                   # calendar, the colour palette, and render tests that mount
                   # all 13 screens in a real DOM and assert the charts paint
```

No backend, no database, no API keys. `dist/` is a static site and can be hosted anywhere.

First load takes a few seconds while the engine fits and back-tests 2,880 models
(240 products × 4 regions × 3 models). It runs in a Web Worker, so the interface stays responsive,
and a progress indicator is shown.

---

## The story this demo tells

The whole application is built around one coherent chain of events. Every screen shows a different
part of the same story, and all of it comes from the same calculation.

1. **A market signal arrives.** New pharmaceutical and food-processing plants are announced in the
   South region. Those buyers specify grade 316L.
2. **Demand moves.** South-region 316L starts running about 35% above forecast.
3. **The anomaly is caught in days**, not weeks. A three-month average — the old method — would not
   have shown the shift for roughly five more weeks.
4. **The knock-on effect.** 316L is the only grade that uses molybdenum, which has a 42-day import
   lead time. At the new demand level, cover runs out before a normal order could arrive.
5. **The reorder level moves up by itself**, because usage and variability rose. MRP recalculates,
   and the order-by date is now very close.
6. **A costed recommendation appears**: order from the faster domestic supplier at about +8% on price,
   so it lands before the buffer is touched. Four options are priced side by side.
7. **The opposite problem**, at the same time. Grade 430 demand is falling, so ferrochrome is
   overstocked. Releasing it frees cash that covers much of the expedite.
8. **The proof.** The same 16 weeks replayed both ways through the same engine. The spreadsheet
   method hits **71 stockout weeks across 22 materials and 171 line-stop days**; DemandPilot hits
   **3 weeks across 3 materials and 7 line-stop days**, lifting the value-weighted fill rate from
   **88.7% to 99.3%**. Not zero — the replay carries the engine's real forecast error and the
   supplier panel's real on-time record, and a simulation that returns a flawless score is the least
   believable thing on the page. DemandPilot also ends up **holding more stock, not less**, and the
   page says so: see the trade-off below. Every one of those numbers is computed by the simulation,
   not written into the page, and the test suite asserts them.

Start the **tour** from the top bar to walk this in 8 steps.

---

## Where each capability lives

| ID | Capability | Screen | What actually happens |
|---|---|---|---|
| **K1** | ML-based demand forecasting | `/forecast`, `/models` | Seasonal naive, Holt-Winters and a ridge regression are each fitted and tested on held-out weeks; the winner is kept per product and region |
| **K2** | Anomaly detection | `/anomalies` | Rolling z-score against a seasonally-adjusted expectation, with a commercial-materiality filter |
| **K3** | Dynamic reorder and safety stock | `/stock` | `SS = Z × √(LT·σd² + d²·σLT²)`, recalculated every run; the old fixed rule is shown beside it |
| **K4** | Automated MRP generation | `/plan` | Forecast → capacity-constrained plan → BOM explosion → netting → lot sizing → lead-time offset |
| **K5** | Procurement guidance | `/buy` | Quantity, supplier, order-by date, confidence, signals, alternatives, and what happens if ignored |
| **K6** | End-to-end planning visibility | `/` | Chain rail on Health links every stage from signal to delivered order |

The five problems from the case study (C1–C5) are each mapped to the screen that solves them on the
**Why** tab of `/proof`.

---

## How the engine works

All planning logic is in `src/engine/` as pure functions, unit-tested with Vitest.

### `forecast.ts` — three competing models

- **Seasonal naive** — "the same week last year". The baseline every other model must beat.
- **Holt-Winters** — triple exponential smoothing with a damped trend and a multiplicative yearly
  season, fitted by a small grid search over α, β and γ.
- **Ridge regression** — a machine-learning model solved in closed form from the normal equations with
  an L2 penalty, over nine features: sales at lags 1, 2, 4 and 52, a four-week average, sine and cosine
  of the week of year, a time trend, the alloy price index, and a market-signal flag. Multi-step
  forecasts feed each prediction back in as the next step's lag.

Each is fitted on the first 92 weeks and scored on the last 12, which it never saw. The lowest-MAPE
model wins and is then refitted on the full history. The system also computes what a three-month
average would have produced, so the improvement can be shown honestly — and on some series the simple
method wins, which the app says plainly rather than hiding.

Also produced per series: bias, an accuracy trend (improving / stable / getting worse) measured by
re-running the back-test six months earlier, an 80% confidence band derived from back-test error, a
decomposition into base + trend + season + signal effect, and the ridge model's feature weights.

### `anomaly.ts`

Expected demand for each week comes from a robust average of the preceding ten weeks, adjusted by the
same-week-last-year seasonal ratio. A rolling z-score above the planner's threshold flags the week.
Consecutive flagged weeks group into one episode. An episode is only reported if it is **both**
statistically unusual (z above threshold) **and** commercially material (≥14% gap and enough tonnes to
matter) — which keeps small-volume products from dominating the list.

### `inventory.ts`

```
safety stock  = Z × √(LT × σ_demand² + demand² × σ_LT²)
reorder point = demand × LT + safety stock
days of cover = on hand ÷ daily usage
order-by      = days until the safety level − lead time
```

Also: a health score that grades **availability** and **excess** separately and combines them, so the
same screen can say "raise this buffer" and "cut that order" — which is the case study's twin problem.

### `mrp.ts`

Five stages, shown as an animation when you press **Run MRP**: read the forecast → build a weekly
production plan limited by line capacity (the melting line is the real constraint) → explode through
every product recipe including scrap → net against stock on hand, scheduled receipts and the safety
buffer → apply the lot-size rule → offset by the lead time to get the release date. Planned orders
whose release date has already passed are flagged as late.

### `procurement.ts`

Turns planned orders and stock positions into recommendations. Chooses the supplier who can actually
make the date: if the usual one's lead time is already too long, it moves to an approved faster source
and says what that costs. Also recommends *reducing* orders where cover exceeds the excess target.
Each recommendation carries a confidence score, weighted signals, a plain-language reason, the full
calculation, costed alternatives, and what happens if nobody acts.

### `scenario.ts` and `replay.ts`

`scenario.ts` re-runs the inventory engine under changed levers (demand, supplier delay, service level,
excess target) and builds four costed plan options for a material at risk.

`replay.ts` is the proof. It simulates 16 weeks of the same demand twice — once with a 13-week average
forecast and a fixed minimum stock level, once with the engine's forecast and dynamic reorder points —
and records stockouts, line-stop days, stock value, storage cost, production stopped and
signal-to-order time for each.

Both arms inherit the same opening stock and the same inbound deliveries, buy from the same supplier
panel, and use the same order-up-to rule. Deliveries slip against each supplier's real OTIF record,
and a slip is keyed to the material and arrival week so it hits whichever method placed the order.
DemandPilot's forecast is run with its own measured error rather than perfect foresight. Four things
differ, and only four: the forecast, the reorder level, the supplier choice, and an excess ceiling
that stops DemandPilot ordering past the planner's excess target.

Nothing is assumed; whatever the simulation produces is what `/proof` displays — **including
where the result is uncomfortable.** DemandPilot carries **more** stock than the spreadsheet method
and costs **₹17.86 Cr more to hold** over the period. That is arithmetic, not tuning: nickel runs a
35-day lead time, so cover below 35 days cannot be replaced before it runs out, and the old rule
reorders at 14 days. The old method's lower inventory is bought by sitting at zero. The page leads
with that trade rather than burying it, and quantifies both sides — the extra cover protects
**₹1,159 Cr** of production the old way could not make, about 65× its cost. The genuine inventory
reduction is a separate story, on `/stock`, in the excess the live plan flags for release.

---

## The data

Generated from a fixed seed in `src/data/`, so the demo is identical every run.

| | |
|---|---|
| Products | **240** — 4 grades × 3 forms × 4 thicknesses × 5 finishes |
| Regions / warehouses / plants | 4 / 6 / 2 |
| Materials | **40**, from alloys and gases to packaging and spares |
| Suppliers | **15**, with 2–3 approved sources for each critical material |
| Customers | **60** across 8 industries |
| Sales history | **104 weeks** per product per region — 960 series, plus 13 weeks held back for the Advance control |
| Customer orders | 2,500 · Purchase orders | 230 |
| Market signals | 32 over six months |
| Plan history | 21 entries |

The recipes are metallurgically sensible and the unit tests enforce it: 316L carries molybdenum and
nothing else does; 430 contains no nickel; 201 substitutes manganese for part of the nickel. That is
what makes the story's cause and effect real rather than asserted.

All names are generic. No real company, customer, supplier, publication or AI vendor appears anywhere
in the interface or the data.

---

## Design principles applied throughout

1. **The system recommends; a person approves.** No purchase order is ever placed automatically.
   Every recommendation ends in Approve / Edit / Reject, and rejecting requires a reason.
2. **Nothing is unexplainable.** Click any calculated number — safety stock, reorder point, order
   quantity — to see the formula with the real values filled in.
3. **No dead ends.** Every count, row, chart bar and alert links to the items behind it. `Ctrl+K`
   searches products, materials, suppliers, orders, anomalies, signals and screens.
4. **Honest about uncertainty.** Low-confidence recommendations are shown with their low score rather
   than hidden. Where the old method beats the model, the app says so.
5. **Plain language.** An (i) tooltip explains every planning term in one sentence with an example;
   the Glossary tab of `/setup` has all 39 of them.

---

## Project layout

```
src/
  data/      types, hand-written catalogue (materials, suppliers, BOM), seeded generator
  engine/    forecast · anomaly · inventory · mrp · procurement · scenario · replay + tests
  worker/    runs the whole planning calculation off the main thread
  store/     Zustand state: settings, approvals, overrides, role, theme, demo controls
  ui/        kit (tiles, chips, meters, drawers) · Table · charts · Shell · Palette · Tour
  content/   glossary
  screens/   13 screens
  lib/       formatting, CSV, seeded RNG, view helpers
```

## Design

Built to be read at a glance rather than studied. Semantic colour tokens with a dark mode, one- or
two-word screen names, a single short blurb per screen instead of a paragraph, and data shown as
`{label, value}` chips, tiles, meters and charts. Long explanations exist only behind an (i) or in the
glossary — the shipped bundle carries 11 prose strings over 140 characters, nine of which are glossary
definitions. Detail opens in a side drawer rather than a separate page, so you never lose your place.

| | |
|---|---|
| Screens | 13, each opening on a chart rather than a wall of text |
| Nav groups | Overview · Demand · Supply · Buy · Decide |
| Status vocabulary | healthy · reorder now · stockout risk · excess (plus severity) |
| Theme | light and dark, semantic tokens |
| Keyboard | `⌘K` / `Ctrl+K` search, `Esc` to close, arrows in the tour |

## Demo controls

- **The date chip** — shows today's real date, and opens a small calendar: the planning week it maps
  to, that week day by day with today marked, **Back** and **Advance 1 week**, a jump straight to any
  week up to twelve ahead, and Reset.
- **Advance one week** — also on the top bar. Feeds in the next week of actual orders; forecasts,
  anomalies, stock, recommendations, MRP and every KPI recalculate in the worker.
- **Reset demo** — returns everything to the starting position.
- **Role switcher** — Planner / Buyer / Manager. Planners recommend; Buyers approve.
- **Tour** — an 8-step walk-through of the whole story.
- **Theme** — light or dark.

### The calendar is live

The data set is anchored to the **Monday of the real current week**, so the dates on screen always
read as today's and the story never ages. Two years of history sit behind that Monday, and thirteen
further weeks of real demand sit in front of it, unread. Advancing the week is what reveals them: the
engine widens the window it forecasts from, so the history line genuinely grows, the back-test moves,
and the anomalies and reorder points shift with it. Those hidden weeks come from a separate random
stream, so adding them leaves every tuned number in the story — down to the 71 stockout weeks —
exactly as it was.
#   D e m a n d P i l o t  
 