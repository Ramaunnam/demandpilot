# Demand-Driven Material Planning — Case Study & POC Walkthrough

**Prepared:** 22 October 2026
**Scope:** One case-study slide + two live proof-of-concept applications, reviewed end to end.

| Artefact | Location |
|---|---|
| Case study slide | `Downloads/image (2).png` — "Case Study: Demand-Driven Material Planning" |
| POC 1 — **ProdPlanner** | https://prodplanner.joulestowatts.online (entry link given: `/demand-forecast`) |
| POC 2 — **PlanForge AI** | https://planforge.joulestowatts.online |

**How this was reviewed.** Both apps are single-page React/Vite applications. I read the shipped JavaScript bundles to extract the complete route tables (44 routes in ProdPlanner, 22 in PlanForge), then rendered and read **every** route individually, and cross-checked the figures against the raw data objects in the bundles. Nothing below is inferred from the marketing copy — it is what the applications actually show.

---

## 0. Executive Summary — the one-paragraph version

The case study describes a manufacturer that outgrew spreadsheet-based demand planning and replaced it with an ML forecasting engine feeding an automated MRP system. The two POCs are **not two versions of the same thing** — they are two different halves of that story, built for two different manufacturing archetypes:

- **ProdPlanner** is the *high-volume, many-SKU, short-cycle* answer. Think FMCG chemicals — cleaning and personal-care products, 1,247 SKUs, days-of-cover measured in days, MRP runs nightly. It is the literal implementation of the case study: forecast → MRP → reorder point → procurement recommendation, plus a full traceability spine.
- **PlanForge AI** is the *low-volume, high-value, long-cycle* answer. Think capital equipment — gas turbines and compressors, 1,183 orders worth ₹2,233 Cr, delivery horizons of 212 days average, bay-level capacity. It is about *replanning*: when a disruption hits, which orders break, what does it cost, and which mitigation plan do you commit?

Both share a design philosophy worth naming: **the system does the arithmetic and raises the exception; the planner makes the decision.** Neither app auto-commits. Every AI recommendation carries a confidence score, an explicit rationale, and the underlying signals that produced it — and every one terminates in a human "Accept / Override / Commit" button.

---

# PART 1 — The Case Study, Decoded

## 1.1 What the slide says

**Client:** Leading Manufacturing Enterprise · **Domain:** Manufacturing

### The Challenge (as written)

> A manufacturer running hundreds of SKUs across multiple grades and regions had outgrown human demand planning. A planner working from spreadsheets caught a regional demand shift only after it had started to bite, by which point a needed reorder hadn't gone out. Forecasts built from experience were fine in stable periods, wrong in ways that compounded fast — excess inventory locked up capital while stockouts halted lines and sent procurement scrambling. No planner could hold the full picture across SKUs and regions at once.

### The Solution (as written)

> An ML-based demand forecasting engine was deployed alongside an automated MRP system, both running from the same data and dashboard. The forecasting layer ingests historical sales, seasonal patterns, and external market signals to produce SKU-level predictions, and flags anomalies before they distort the plan. Those forecasts feed an MRP engine that translates production schedules into precise material needs, calculates reorder points dynamically, and generates procurement recommendations. Planners set the parameters; the system does the arithmetic and raises the exceptions.

### Six Key Capabilities Claimed

| # | Capability | Claim |
|---|---|---|
| 1 | **ML-Based Demand Forecasting** | SKU-level predictions from sales history, seasonal variation, market signals — at a scale no human planner can match |
| 2 | **Anomaly Detection** | Identifies demand anomalies in real time, flags them before they distort procurement or production plans |
| 3 | **Dynamic Reorder & Safety Stock** | Computes optimal reorder points and safety stock per SKU continuously — live parameters replacing static rules |
| 4 | **Automated MRP Generation** | Converts production schedules directly into material requirements, eliminating lag between plan and procurement trigger |
| 5 | **Procurement Guidance** | Recommends what to buy, how much, and by when, from live forecasts and current inventory |
| 6 | **End-to-End Planning Visibility** | Single dashboard spanning demand signal, inventory position, and PO status across the full chain |

### Three Claimed Outcomes

- **Zero stockouts** — through predictive planning
- **Optimized** storage costs — with just-in-time arrival
- **End-to-end** visibility — from demand signal to procurement

## 1.2 Reading between the lines — the actual problem being solved

The challenge paragraph is unusually precise about *failure mechanics*, and it is worth separating the four distinct failures it names, because the POCs are organised around them:

1. **Detection latency.** "Caught a regional demand shift only after it had started to bite." The problem isn't that the planner was wrong, it's that they were *late*. → This is why both POCs lead with a **signal feed** and an **alerts panel**, not a forecast chart.
2. **Action latency.** "By which point a needed reorder hadn't gone out." Detection without a triggered action is worthless. → This is why every alert row in both apps ends in an action button (`Raise PO`, `Simulate impact`, `Expedite`).
3. **Non-linear error.** "Fine in stable periods, wrong in ways that compounded fast." Spreadsheet forecasting degrades gracefully right up until it doesn't. → This is why the POCs expose MAPE/WAPE *by SKU and by category* with improving/degrading trends, rather than a single accuracy number.
4. **Cognitive ceiling.** "No planner could hold the full picture across SKUs and regions at once." → This is the actual justification for automation, and it is why both POCs are built around an **exception queue** — the machine holds the full picture, the human looks only at the 15 things that are broken.

The symmetric cost statement — "excess inventory locked up capital **while** stockouts halted lines" — is the key insight. These are normally treated as a trade-off dial. The case study's claim is that bad forecasting produces *both simultaneously*, because the error is mis-distributed across SKUs rather than uniformly biased. You are overstocked on the wrong things and understocked on the right things at the same time. That is why ProdPlanner's inventory health page scores *both* stockout frequency *and* excess/obsolescence in one composite.

## 1.3 A note on the claimed outcomes

The three outcome figures are qualitative, not numeric — "Zero stockouts", "Optimized", "End-to-end". This is a deliberate and defensible choice for a POC-stage case study: there is no baseline period being compared. But it should be read as *capability demonstrated*, not *benefit measured*. The POCs reflect this honestly — ProdPlanner's own dashboard shows Inventory Health at **74/100 against an 80 target**, 14 materials at risk, and 42 active stock-exhaustion alerts. The product does not pretend the problem is solved; it pretends to make the problem visible and actionable. That is the more credible claim, and it is the one the software actually supports.

---

# PART 2 — POC 1: ProdPlanner (Material Planning & ERP)

**URL:** https://prodplanner.joulestowatts.online
**Internal product name:** MatrixOps
**Demo tenant:** MatrixOps Manufacturing Pvt. Ltd. — GSTIN 27AABCM1234F1Z5, CIN U24100MH2018PTC123456, Plot 42 MIDC Hinjewadi, Pune 411057
**Demo user:** Rajesh Kumar (Admin)
**Simulated "today":** 23 March 2026
**Routes:** 44

## 2.1 What it is

ProdPlanner is the direct, literal build of the case study. It is a full material-planning and light-ERP suite for a **high-SKU-count, fast-moving chemicals manufacturer** — cleaning products, personal care, industrial, disinfectants. Industrial Cleaner 5L, Dish Wash Liquid 500ml, Hand Wash 250ml, Floor Polish 1L and so on, built from raw chemicals (Sodium Lauryl Sulphate, Stearic Acid, EDTA, TiO2) and packaging (HDPE bottles, shrink labels, foil seals).

The operating footprint is four locations:

| Location | Code | Type | Manager | SKUs | Area |
|---|---|---|---|---|---|
| Pune Plant | WH-PUN | Manufacturing | Rajesh Kumar | 1,247 | 45,000 sq ft |
| Mumbai WH | WH-MUM | Distribution | Vikram Thakur | 842 | 28,000 sq ft |
| Delhi Depot | WH-DEL | Distribution | Arun Mehra | 620 | 18,000 sq ft |
| Chennai Hub | WH-CHE | Distribution | Karthik Rajan | 580 | 15,000 sq ft |

Production runs on **4 lines** at Pune across **8 work centres** spanning three plants.

## 2.2 Module map (all 44 routes)

| Module | Pages |
|---|---|
| **Dashboard** | Planning Overview |
| **Material Planning** (10) | MRP Run & Results · Material Master · Material Requirements · BOM Management · Safety Stock · Substitutes · Capacity Planning · Spare Parts Planning · Planner's Workbench · Stock Exhaustion Alerts |
| **Planning Scenarios** (6) | Scenario Simulator · Plan Comparison · Plan Revisions · Cash-Flow Impact · Production Mix Optimizer · Disruption Signal Feed |
| **Production** (4) | Production Schedule · Work Orders · Constraints · Schedule Updates |
| **Inventory** (4) | Stock Overview · Multi-Location · Batch & Serial Tracking · Inventory Health |
| **Purchase** (4) | Purchase Planning · Purchase Orders · Vendor Management · Procurement Analytics |
| **Demand & Forecasting** (4) | Demand Forecast · Available-to-Promise · Forecast vs. Actuals · Sales Order Intake |
| **Traceability** (1) | BOM Traceability |
| **Analytics & Reports** (5) | BI Dashboard · Material Coverage · Procurement Reports · MRP Efficiency · Custom Reports |
| **Settings** (4) | Company & Warehouses · Users & Roles · Integrations · Alert Configuration |

---

## 2.3 The Dashboard — Planning Overview (`/`)

This is the "single dashboard" the case study promises, and it is genuinely cross-functional. **16 KPI tiles**, each deep-linking into its owning module:

| KPI | Value | Signal |
|---|---|---|
| Materials at Risk | **14 SKUs** | up from 9 last week |
| Open Purchase Orders | **87** | ₹4.2 Cr value |
| Schedule Adherence | **91.4%** | +2.1% |
| Inventory Health | **74 / 100** | Below 80 target |
| Pending Work Orders | **23** | 6 overdue |
| Plan Attainment | **94.2%** | Planned vs actual |
| Forecast Accuracy | **85.8%** | WAPE 14.2% |
| Order Fill / OTIF | **96.2%** | Last 30 days |
| Inventory Turns | **9.6x** | 38 days of inventory |
| Cash in Inventory | **₹6.84 Cr** | −₹1.9L this plan |
| Active Scenarios | **2** | 15 open exceptions |
| Trace Completeness | **92.4%** | +1.2% |
| Mean RCA Time | **14.7 hrs** | Target < 12 hrs |
| Active Suspect Lots | **2** | up from 0 last week |
| Recall Accuracy | **97.1%** | Field containment |

Note the deliberate mix: operational (adherence, work orders), financial (cash in inventory, PO value), statistical (WAPE), and quality/compliance (RCA time, recall accuracy). That combination on one screen is the "end-to-end visibility" claim made concrete.

**Charts:** Material Coverage Trend (12 weeks, 5 materials tracked — Polypropylene, Stearic Acid, HDPE Resin, EDTA, TiO2, with a 2-week critical floor line); Trace Completeness by Assembly Line (7-day, Lines 1–4).

**MRP Run Status panel:** Last run 23 Mar 2026 06:30, duration 4m 12s, 312 planned orders, 18 exceptions, `Re-run MRP Now` button.

**Stock Exhaustion Alerts panel** (top 7, sorted by urgency):

| Material | Qty | Days left | Action |
|---|---|---|---|
| Fragrance Blend FG-04 | 22 L | 3.7d | Raise PO |
| Stearic Acid | 180 kg | 4.3d | Raise PO |
| EDTA Disodium Salt | 95 kg | 5.1d | Raise PO |
| Shrink Labels (Type B) | 1,200 pcs | 6.2d | Raise PO |
| Titanium Dioxide | 640 kg | 8.2d | Review |
| Foil Seals 5L | 3,400 pcs | 9.1d | Review |
| Sodium Lauryl Sulphate | 520 kg | 11.4d | Monitor |

Notice the action verb changes with the tier — **Raise PO** under ~7 days, **Review** at 8–10, **Monitor** beyond. The system is not just colour-coding severity, it is prescribing a different response per tier. That is capability #5 (procurement guidance) in its simplest form.

**Production Schedule (next 7 days)** — 7 products, 1,500–10,000 units each, with a readiness traffic light and a status of Confirmed / Planned / **At Risk**. Dish Wash Liquid 500ml (8,000 units, 25 Mar) is red/At Risk.

**Missing Scan Exceptions** — 5 unresolved, e.g. WO-2026-0862 / RM-4023 / Mixing Station A / Shift A / 18 Mar, each with a `Resolve` action.

---

## 2.4 Demand & Forecasting — the forecasting layer

### `/demand-forecast` — Demand Forecast (the page you linked)

This is capability #1 and #2 of the case study.

**KPIs:** Avg Monthly Demand **5,120 units** (+8.2% YoY) · Next Quarter Forecast **18,900 units** (Apr–Jun 2026) · Forecast Accuracy **85.8%** (MAPE 14.2%)

**Demand chart.** A line chart plotting **confirmed orders vs statistical forecast** across months, split by a **demand fence** — a vertical boundary separating the near-horizon where orders are confirmed from the far horizon where only the statistical forecast exists. This is an important and correct piece of planning UX: it tells the planner exactly where committed reality stops and prediction starts, which is precisely the boundary the spreadsheet planner in the case study could not see.

**Category breakdown.** Bar chart, current vs forecast demand across Cleaning, Personal Care, Industrial, Disinfectant.

**Product Forecast table (8 SKUs).** Columns: Product & size · **Forecasting method** · Current demand · 3-month demand · Growth % · Confidence · Seasonality · Adjust action.

The forecasting-method column is the most important thing on this page. It exposes **per-SKU method selection** — exponential smoothing, seasonal, moving average, or manual override. This directly reflects the case study's "ingests historical sales, seasonal patterns" claim: different SKUs get different models depending on their demand signature, and a planner can override to manual. Growth projections across the eight SKUs run **+6.8% to +33.3%**, each with a confidence level and a seasonality indicator, and each with an **Adjust** button — the human stays in the loop.

### `/forecast-actuals` — Forecast vs. Actuals

The accuracy accountability page, and the evidence for whether capability #1 is actually working.

**KPIs:** Overall **MAPE 14.2%** · Forecast Bias **+3.1%** ("slight over-forecast") · Best category **Polymers 8.4%** · Worst category **Specialty Chemicals 24.1%**

**Chart:** 12-month forecast vs actual dual-line (Apr–Mar, 0–6,000 units).

**Per-SKU table:**

| Material | Forecast | Actual | Error % | MAPE | Trend |
|---|---|---|---|---|---|
| Polypropylene Granules | 14,200 kg | 15,100 kg | 6.3% | 8.4% | Improving |
| HDPE Bottle 5L | 28,000 pcs | 29,200 pcs | 4.3% | 6.8% | Stable |
| Titanium Dioxide | 5,200 kg | 6,100 kg | 17.3% | 24.1% | **Degrading** |
| Fragrance Blend FG-04 | 420 L | 510 L | 21.4% | 22.8% | **Degrading** |

This page is the honest counterweight to the forecasting page. It says plainly: the model is good on high-volume commodity polymers (6–8% error) and bad on low-volume specialty chemicals and fragrances (21–24% error, and getting worse). **Reporting bias separately from MAPE is the mark of someone who knows forecasting** — MAPE tells you how wrong you are, bias tells you which direction you are consistently wrong in, and a +3.1% systematic over-forecast is a fixable calibration problem rather than a noise problem.

It is also no coincidence that Fragrance Blend FG-04 is simultaneously the worst-forecast SKU (22.8% MAPE, degrading) and the most urgent stockout on the dashboard (3.7 days of cover). The POC's seeded data is internally coherent — bad forecasting causes the stockout, and you can trace that causal chain across three separate screens.

### `/atp` — Available-to-Promise

Answers "when can I promise this order?" by projecting cumulative availability forward across weekly buckets: on-hand, minus allocated, plus incoming POs, plus planned production.

| Bucket | Date | On Hand | Allocated | Incoming PO | Planned Prod | Source |
|---|---|---|---|---|---|---|
| Now | 18 Jun 2026 | 256 | 188 | — | — | — |
| Wk +1 | 25 Jun 2026 | 68 | 153 | 487 | — | PO-2026-0212 |
| Wk +2 | 02 Jul 2026 | 402 | 43 | — | 357 | WO-2026-0860 |
| Wk +4 | 16 Jul 2026 | 1,394 | 152 | — | 546 | WO-2026-0860 |

Example runs Industrial Cleaner Bulk from 256 L now to 1,940 L by week 4. Crucially each bucket **cites its source document** (the specific PO or work order), so a promised date is auditable back to the supply that justifies it.

### `/sales-orders` — Sales Order Intake

**KPIs:** 8 open orders · 3 due this week worth **₹26.2L** · 5 received today worth **₹79.8L** · MTD dispatch **₹1.42 Cr** against ₹1.35 Cr target.
Statuses: New 5 · Processing 1 · Confirmed 2 · Dispatched 1 · Delivered 3.
Customers are the Indian modern-trade and e-commerce set: Reliance Retail (₹8.4L, High priority), Amazon India (₹18.9L), Flipkart (₹14.2L), DMart (₹12.6L), JioMart (₹16.4L). Orders span 22–23 March with deliveries through 6 April 2026.

---

## 2.5 Material Planning — the MRP engine

### `/mrp-run` — MRP Run & Results

Capability #4. **Last run:** 23 Mar 2026 06:30, **4m 12s**, **full regenerative**, **unconstrained** planning mode, producing **312 planned orders** and **18 exceptions**.

Two run modes are offered — **full regenerative** (rebuild the whole plan) and **net change** (incremental). Three result views: **Planned Orders · Exceptions · Pegging View**. The pegging view is the one that matters technically: pegging traces each material requirement back up to the specific demand that caused it, which is what makes the plan explainable rather than a black box.

Planned-order columns: Code · Material · Level · Make/Buy · Warehouse · Required Qty · Order Date · Required Date · Vendor · Lead Time · Status. Statuses are **Firmed / Planned / Exception**.

Sample rows: PM-1000 Foil Seals 5L (Buy, Mumbai WH, 1,000 pcs, order 27 Mar for 11 Apr, GAIL India, 13d, Firmed) · RM-1001 Demineralised Water (Make, Pune Plant, 4,600 L, 9d, Firmed) · RM-1002 HDPE Resin (Buy, Delhi Depot, 5,000 kg, Aarti Industries, 5d, Planned).

Orders can be grouped by **planning level**, i.e. BOM explosion depth — the classic MRP low-level-code sequencing.

### `/material-master` — Material Master & Planning Parameters

The parameter layer. **39 items** · 12 Make · 27 Buy · **4 missing parameters** · 5 below safety stock.

14 columns per item: Code · Description · Category · UoM · Make/Buy · **Policy** · **Reorder Point** · **Safety Stock** · **Procurement Lead Time** · **Manufacturing Lead Time** · **Lot Rule** · **ABC/XYZ** · Primary Vendor · Standard Cost.

Item hierarchy spans RM (raw) → PM (packaging) → SA (sub-assembly) → SF (semi-finished) → FG (finished) → SP (spare). Filters by plant and an "only missing parameters" toggle.

This page is the case study's "**Planners set the parameters**" clause made literal. The "4 missing parameters" counter is a nice touch — it surfaces data-quality debt that would otherwise silently produce bad MRP output.

### `/material-requirements` — time-phased netting

The actual MRP arithmetic, per material: **Opening Stock → Gross Requirements → Scheduled Receipts → Net Requirements → Safety Stock → Reorder Qty → Coverage → Status**.

Showing 20 of 20 materials: 5 Critical, 7 Low, rest Adequate. Stearic Acid shows a **440 kg shortage at 4-day coverage**; Fragrance Blend FG-04 **63 L short at 3-day**; against which HDPE Resin sits at 38 days and Demineralised Water at 45. Filters by category (Polymer/Chemical/Packaging/Fragrance), warehouse, and a "show only shortages" toggle.

### `/bom-management` — BOM Management

Multi-level BOM for Industrial Cleaning Compound 5L: **FG-001** (1 unit out) → **SA-101 Concentrate Base** (2.5 L, 1-day lead) → **5 raw materials** (2–14 day leads) + **3 packaging materials** (4–5 day leads).

Alongside: Current Stock 1,450 kg · Open POs 800 kg (ETA 2 Apr) · Standard Cost ₹185/kg · Last Purchase Price ₹182/kg.

**Revision history with ECO control:**

| Rev | Date | ECO | Change |
|---|---|---|---|
| A | 2024-06-01 | ECO-2024-011 | Initial release |
| B | 2025-02-15 | ECO-2025-003 | Purity spec change 92% → 95% |
| C | 2025-11-10 | ECO-2025-018 | Heavy metals limit added |

Current Rev C, effectivity 2025-11-10 to 2027-11-10. Actions: Edit BOM · Compare Versions · **Where-used** · Export. Date-effective revisions with ECO linkage and where-used is proper engineering-change discipline, not a toy BOM viewer.

### `/safety-stock` — Dynamic Safety Stock

Capability #3, and the clearest demonstration of "live parameters replacing static rules."

**KPIs:** 847 materials with safety stock · **34 below safety stock now** · **112 with no buffer defined**.

The table exposes the full statistical input set per material — **Avg Daily consumption · Standard Deviation · Lead Time (days) · Lead-Time Variability (Low/Medium/High) · Current SS · Recommended SS · Gap · Action**.

Example — Polypropylene Granules: 280 kg/d average, standard deviation 45 kg, 7-day lead, Medium variability, giving Current SS 500 kg against **Recommended 680 kg, Gap −180 kg**, Action `Update`.

This is textbook statistical safety stock (service-factor Z times demand sigma times root of lead time, adjusted for lead-time variance). What makes it the case study's "continuous" claim rather than a one-off calculation is the **Gap** column plus an `Apply Recommended (Selected)` bulk action: the recommendation is recomputed against live consumption and the planner accepts it in bulk. The 112 materials with *no* buffer defined is again honest surfacing of coverage gaps.

### `/substitutes` — Alternate Materials

12 rules · 8 approved · 3 pending · 1 retired. Columns: Rule ID · Primary Item · Substitute Item · **Ratio** · Priority (1–5) · Plants · Validity · Status.

Example — SUB-001: Sodium Lauryl Sulphate (RM-4023) substituted by Coconut Diethanolamide (RM-4128) at **1:1.10**, priority 1, Pune Plant + Mumbai WH, valid until 31 Dec 2026, approved.

The conversion ratio, plant scoping, time-bounded validity and approval state together make this usable by the simulator: when SLS goes short, the engine knows there is an approved 1:1.10 alternative valid at those two plants. Substitution is a *planning lever*, not a note in a spreadsheet.

### `/capacity-planning` — Work-Centre Load vs Capacity

> "Work-centre load against capacity across the horizon — resolve overloads before they block orders."

**8 work centres** · **3 overloaded** · average utilisation **91%** · peak **112%**.

| Centre | Plant / Line | Shifts | Capacity |
|---|---|---|---|
| Mixing Vessel 01 | Pune — Liquids A | 2 x 8h | 320h |
| Filling Line 02 | Pune — Packaging A | 3 x 8h | 480h |
| Blending Reactor 03 | Pune — Liquids B | 2 x 8h | 320h |
| Filling Line 04 | Mumbai WH — Packaging B | 2 x 8h | 320h |
| Labelling Station 05 | Pune | 2 x 8h | 320h |
| Carton Packing 06 | Mumbai WH | 1 x 8h | 160h |
| Mixing Vessel 07 | Chennai — Liquids C | 2 x 8h | 320h |
| QC / Inspection 08 | Pune | 2 x 8h | 320h |

**Overloads:** Mixing Vessel 01 — 358h / 320h = **112%** · Filling Line 04 — 352h / 320h = **110%** · QC/Inspection 08 — 332h / 320h = **104%**. Two more are "Tight" at 93%. Load is charted across weeks 14–19.

Note that MRP runs **unconstrained** but capacity is checked **separately** — the classic MRP-then-CRP two-step. Mixing Vessel 01 at 112% is the system's identified primary bottleneck, and it reappears as the optimisation constraint in the Production Mix Optimizer.

### `/spare-parts` — Spare Parts Planning

Service-parts replenishment, netted against production demand. **20 spare SKUs** · service fill rate **96.4%** · **7 parts at risk** · 3 slow-moving · **2 dual-use items netted with production**.

Columns: Spare Item · Category (Filling/Capping/Conveyor) · Service Demand/month · **Forecast Method** (Installed-base / Consumption-based / Manual) · Current Stock · Reorder Point · Recommended Order · Coverage · Status.

Example — SP-9001 Filling Nozzle Assembly: 18/month, 22 in stock, **At risk**, 37 days cover. RM-4031 HDPE Resin is flagged **dual-use** — 40/month service demand on top of production demand, netted together so the same stock is not promised twice. Items fall to "At risk" below roughly 48 days cover.

**Installed-base forecasting** is a genuinely different method from the demand-forecasting module — you forecast from the population of machines in the field and their failure rates, not from sales history. Including it shows the forecasting layer is method-aware rather than one-size-fits-all.

### `/planners-workbench` — the exception cockpit

**This is the single most important page in the application** and the direct answer to the case study's "no planner could hold the full picture" problem.

**KPIs:** 15 open exceptions · 3 critical · 5 high · **7 high-confidence suggestions (AI >= 80%)**.

**Eight exception queues:**

| Queue | Count | Meaning |
|---|---|---|
| Reschedule In | 2 | Pull an incoming order earlier |
| Reschedule Out | 2 | Defer a receipt — excess stock |
| Expedite | 3 | Urgently accelerate critical supply |
| Past Due | 1 | Overdue PO |
| No Source | 1 | No vendor/lead time assigned |
| Below Safety Stock | 3 | Replenishment needed |
| Capacity Overload | 2 | Production bottleneck |
| Excess / Obsolete | 1 | Rationalise inventory |

Columns: Item · Exception · Severity · Order/Demand · Current date · **Suggested** date/action · **Recommended Action** (narrative) · **AI confidence (42–91%)**. Filters by plant (4), category (8) and severity.

**The explainability design is the standout feature.** Each recommendation carries not just a confidence percentage but a plain-English rationale *and* the weighted signals behind it. Pulled directly from the application data:

> **Confidence 79% (high)** — *"22 days coverage and low variability; deferring avoids unnecessary inventory build."*
> Signals: `Days of coverage — 82 (22d)`, `Demand volatility — 22 (Low)`

> **Confidence 48% (low)** — *"Used only as the approved substitute for FG-04; expedite only if the primary fragrance PO slips further."*
> Signals: `Substitute role — 60 (Backup)`, `Lead-time variability — 55 (Medium)`

> **Confidence 66% (medium)** — *"Packing of WO-0848 starts 17 Apr; carton ETA currently 24 Apr leaves a gap."*
> Signals: `Order priority — 64 (Medium)`, `Supplier flexibility — 70 (High)`

The full signal vocabulary the engine scores against: **ABC class · Days of coverage · Demand volatility · Lead-time variability · Order priority · Current load · Downstream slack · Alt capacity · Incident history · Cash impact · Substitute role · Supplier flexibility.**

Two things deserve credit here. First, **the system publishes its low-confidence recommendations** (42%, 48%) rather than hiding them — a planner can see the machine is unsure and apply judgement. Second, the recommendations are *conditional and contextual* ("expedite only if the primary PO slips further"), not blanket instructions. Bulk actions: Accept · Reschedule · Expedite · Create PO · Dismiss.

### `/stock-alerts` — Stock Exhaustion Alerts

**42 active alerts** in three tiers: **Critical < 3 days (7)** · **High 3–7 days (12)** · **Medium 7–14 days (23)**.

11 columns: Level · Material · Warehouse · Current Stock · Daily Use · **Days Cover** · Required By · **Reorder By** · Lead (d) · Vendor · Action.

Days cover = current stock divided by daily use. Worked example — **EDTA Disodium Salt, Pune Plant: 108 kg / 172 kg per day = 0.6 days**, depleting 23 March 2026, against a **5-day lead time** from Jayant Agro. The vendor physically cannot deliver in time; the stockout is already locked in. Shrink Labels (Type B) sit at 23 kg / 15 kg per day = 1.5 days.

The two-date design — **Required By** *and* **Reorder By** — is what turns this from a dashboard into capability #5. Reorder By = Required By minus lead time. It tells the planner the last responsible moment to act, which is the exact failure the case study opens with ("by which point a needed reorder hadn't gone out").
---

## 2.6 Planning Scenarios — the "what if" layer

This module is the most ambitious part of ProdPlanner and goes **beyond** what the case study slide claims. The case study describes a forecast-to-MRP pipeline; this module adds disruption modelling, costed mitigation options, and an auditable commit.

### `/disruption-feed` — Disruption Signal Feed

The intake point. **8 signals in 7 days** · 3 unread · 1 critical · 4 high.

Sources are deliberately heterogeneous — **supplier emails** (Galaxy Surfactants, Givaudan India, Spencer's Retail), **carrier APIs** (BlueDart), **market data** (Commodity Index), **WMS** (Pune WMS), **logistics feeds** (Maersk Tracking). Three signal types: Supply, Demand, Capacity.

| Severity | Type | Item | Signal | Source | When |
|---|---|---|---|---|---|
| Critical | Supply | RM-4023 Sodium Lauryl Sulphate | +9 days ETA slip (plant maintenance) | Supplier email | 18 Jun 08:42 |
| High | Demand | SO-4544 Hand Wash 250ml | Rush order 2,400 units by 22 Jun | Retail email | 17 Jun 09:40 |
| Medium | Capacity | WC-MIX-01 Mixing Vessel | 1.5 shifts lost, unplanned downtime | WMS | 17 Jun 11:08 |

Every row terminates in **`Simulate impact`**, which routes the signal into the Scenario Simulator. This is the architectural answer to the case study's detection-latency problem: an external signal arrives, and in one click becomes a modelled scenario rather than an email someone reads on Monday.

### `/scenario-simulator` — Scenario Simulator

> "Model compound supply, demand, capacity and parameter disruptions, then compare ranked mitigation plans."

**Disruption palette**, four categories. The Supply category alone offers: PO ETA slips by N days · partial delivery · supplier goes offline · inbound shipment delayed · material price rises. Demand, Capacity and Parameter categories follow the same pattern.

The key word is **compound** — multiple disruptions can be stacked into one scenario, which is how real disruptions actually arrive (the supplier slips *and* a rush order lands *and* a vessel goes down).

**Baseline (committed plan):** Orders affected 0 · Units at risk 0 · Revenue at risk ₹0 · Margin impact ₹0 · New shortages 0 · **OTIF 96.2%** · Cash at risk ₹0.

Running a scenario produces the delta against that baseline — at-risk orders, new shortages, capacity overloads, and ranked mitigation recommendations.

### `/plan-comparison` — Plan Comparison & Commit

The payoff screen, and the best single page in either application. Four plans side by side against one disruption:

| Metric | Baseline (do nothing) | PLAN-A (Expedite & protect revenue) | PLAN-B (Substitute & resequence) | PLAN-C (Absorb) |
|---|---|---|---|---|
| **Revenue at risk** | ₹42.6L | **₹4.6L** | ₹14.1L | ₹42.6L |
| **Cost** | ₹0 | ₹3.8L | ₹1.2L | ₹0 |
| **Cash impact** | ₹0 | −₹3.8L | −₹1.2L | ₹0 |
| **OTIF %** | 81.5% | **93.8%** | 88.4% | 81.5% |
| **Late orders** | 6 | **1** | 3 | 6 |
| **Expedite spend** | ₹0 | ₹3.8L | ₹0.4L | ₹0 |
| **Inventory change** | ₹0 | +₹2.1L | −₹0.6L | ₹0 |
| **AI confidence** | — | **88%** | 72% | 38% |

Read the economics: PLAN-A spends **₹3.8L to protect ₹38.0L** of at-risk revenue — a 10:1 return — and lifts OTIF by 12.3 points. PLAN-B is the cheaper, lower-confidence option. PLAN-C is included deliberately as the honest null: doing nothing costs nothing and achieves nothing, and the model's 38% confidence says so.

**This table is what separates a planning tool from a dashboard.** It converts a material shortage into a costed business decision with a stated confidence, in the currency a CFO reads. The chosen plan is then **committed into live MRP with an audit trail**.

### `/plan-revisions` — Plan Revisions

> "Auditable history of every committed plan change — the system of record for scenario decisions."

**4 revisions** · 3 committed · **1 reverted** · 4 this month.

| Rev | Decision | Impact | Author |
|---|---|---|---|
| REV-0042 | Air-freight expedite | Protected ₹38.0L revenue | Priya S. |
| REV-0041 | Alternate vendor sourcing | Avoided ₹2.6L cost increase | Vikram T. |
| REV-0040 | Resequence plan — **reverted** | ₹14.2L revenue | Arun M. |
| REV-0039 | Safety-stock policy change | +₹3.4L inventory buffer | — |

Captured per revision: revision ID, plan name and strategy, timestamp to the minute, author and role, linked scenario ID, business rationale, financial impact, and operational metrics (OTIF, revenue, costs). The presence of a **reverted** revision is a good sign — the system records decisions that were wrong, not just ones that worked. Combined with the `Commit reason` field, this makes planning decisions reviewable after the fact, which is exactly what you need when the question is "why did we air-freight that in March?"

### `/cash-flow-impact` — Cash-Flow & Working-Capital Impact

Translates the plan into treasury terms.

**KPIs:** Net Cash Impact **−₹1.9L** (scenario vs baseline) · Cash at Risk **₹31.2L** · Collection Slipping **₹9.2L** · Inventory Value **₹6.84 Cr** · Days of Inventory **38 (target 32)** · Capital Freed **₹1.9L** · Capital Locked **₹3.8L**.

**Chart:** Projected cash timeline, weeks 25–32 in ₹ lakh — dual line for baseline vs scenario cumulative cash, with stacked inflow (revenue) and outflow (purchase) bars. The scenario line runs ~₹1.9L below baseline by week 32.

**Table — orders driving cash movement:** Ref · Driver · Type (inflow/outflow) · Amount · Period. Includes ₹3.8L expedited HDPE outflow, ₹18.4L Reliance inflow, ₹1.9L deferred HDPE resin payment.

The working-capital logic is explicit: capital locked (₹3.8L in expedites and buffers) netted against capital freed (₹1.9L in deferrals) gives the −₹1.9L net. This page is what lets a planner defend an expedite decision to finance — and 38 days of inventory against a 32-day target quantifies exactly how much capital the plan is currently sitting on.

### `/production-mix` — Production Mix Optimizer

Constrained optimisation against the identified bottleneck, **Mixing Vessel 01 (WC-MIX-01)**.

**Objective:** Maximise margin (alternatives: maximise throughput, maximise revenue).
**Result:** Contribution margin **₹42.6L → ₹48.9L**, uplift **+₹6.3L (+14.8%)**. Bottleneck utilisation **93% → 100%**.

**Secondary constraints shown:** Filling Line 02 at 88% · SLS availability 82% · HDPE Bottle supply 71% · QC inspection 64%.

| Product | Unit margin | Margin per bottleneck-hour | Change |
|---|---|---|---|
| Industrial Cleaner 5L | ₹142 | — | **+400 units** |
| Floor Cleaner 5L | ₹124 | — | **−200 units** |
| Surface Disinfectant 1L | ₹38 | — | **+3,000 units** |
| Hand Wash 250ml | ₹16 | — | no change |

The critical column is **margin per bottleneck-hour**, not unit margin. That is why Surface Disinfectant 1L at ₹38/unit gains 3,000 units while Floor Cleaner 5L at ₹124/unit *loses* 200 — the cheaper product earns more per hour of the constrained resource. This is correct theory-of-constraints reasoning, and it is the kind of result that is counter-intuitive to a human planner ranking products by unit margin. `Apply optimized mix` pushes the result into the plan.

---

## 2.7 Production

### `/production-schedule` — Production Schedule

Gantt or list view across **24–30 March**, four lines:

- **Line 1:** Floor Polish, Surface Disinfectant
- **Line 2:** Dish Wash, Toilet Cleaner, Bathroom Cleaner
- **Line 3:** Industrial Cleaner, Glass Cleaner, Multi-Surface
- **Line 4:** Hand Wash, Fabric Softener

**3 active constraints overlaid on the schedule:** Material Shortage (High) — Stearic Acid 320 kg short for WO-0849 · Maintenance (Low) — Line 2 PM on 26 Mar 06:00–08:00 · Capacity Overload (Medium) — Line 3 over-scheduled 28 Mar at 110%.

Overlaying constraints directly on the Gantt is the right call — the planner sees the schedule and the reason it will break in the same view.

### `/work-orders` — Work Orders

**234 work orders:** Draft 18 · Released 67 · In Progress 41 · Completed 90 · On Hold 12 · **Overdue 6**.

Columns: Work Order · Product · Ordered · **Produced** · BOM version · Scheduled · Due · Line · **Trace %** · Status.

Samples: WO-2026-0984 Glass Cleaner 9,000/9,000 complete at 98% trace · WO-2026-0951 Surface Disinfectant 1,527/2,000 (82%) · **WO-2026-1076 Dish Wash Liquid overdue at 760/4,000**.

The **BOM version** and **Trace %** columns on a work order are what make the traceability module work — every unit produced is bound to the BOM revision it was built against.

### `/production-constraints` — Constraints

**3 open** · 2 mitigated · 1 scheduled · 1 resolved. Seven constraint types: Material Shortage · Machine Maintenance · Capacity Overload · Labour Shortage · Quality Hold · Utility Outage.

Columns: ID · Type · Resource · Impact · Severity · Date · Resolution · Status · **Owner**.

- **C-001** Stearic Acid shortage hitting WO-2026-0849 — emergency procurement, ETA 1 Apr
- **C-003** Line 3 capacity conflict 28 Mar — 4-hour overlap requires rescheduling
- **C-006** Caustic Soda batch quality hold 22 Mar — retest due 24 Mar
- **C-007** Boiler outage affecting Lines 1 and 3 — backup running at 80%

Named owners and recorded resolutions turn a constraint list into an accountable work queue.

### `/schedule-updates` — Schedule Updates

A live shop-floor event stream. Event types: Material Issue · Production Start · QC Passed · Quantity Update · Delay Alert · Schedule Change · Material Receipt · Completion · Shift Handover · Rework · Material Alert.

Columns: Event Type · Details · Timestamp (relative — "2 min ago") · Actor (user/system/department) · Reference (WO, batch, GRN, line).

Samples: RM-2087 Stearic Acid 120 kg issued to WO-2026-0847 · WO-2026-0840 at 6,200/10,000 units (62%) · Fragrance Blend FG-04 down to 22 L, below safety · **Batch B-2026-0412 passed all 14 quality parameters**.

This is the feedback loop that keeps the plan honest — actual consumption and output flowing back against planned.

---

## 2.8 Inventory

### `/stock-overview`

**1,247 SKUs** · **₹8.4 Cr total stock value** · 34 below reorder point · **89 dead-stock SKUs (>90 days) worth ₹0.62 Cr**.

Columns: Material code, name, category, UoM · stock by location (Pune, Mumbai, …) · total · reorder point · safety stock · average cost · total value · status.

Critical items: RM-2087 Stearic Acid 180 kg (₹0.26L) · RM-5018 EDTA 95 kg (₹0.40L) · RM-8012 Fragrance Blend 22 L (₹0.62L).

The ₹0.62 Cr of dead stock against ₹8.4 Cr total — **7.4% of inventory value is immobile** — is precisely the "excess inventory locked up capital" half of the case study's challenge, quantified.

### `/multi-location`

Stock by material across the four locations, each cell showing **quantity and days of cover**:

| Material | Pune Plant | Mumbai WH | Delhi Depot | Chennai Hub |
|---|---|---|---|---|
| Polypropylene Granules | 4,200 kg (15d) | 1,800 kg (6d) | — | 800 kg (4d) |
| HDPE Resin | 6,200 kg (20d) | 3,600 kg (18d) | 1,200 kg (12d) | 2,400 kg (15d) |
| HDPE Bottle 5L | 5,200 u (12d) | 3,000 u (9d) | — | 1,800 u (8d) |

Showing **cover days alongside quantity** is the whole point — 800 kg at Chennai is not comparable to 4,200 kg at Pune until you know Chennai has 4 days and Pune has 15. This is how you spot that a transfer, not a PO, is the right answer.

**Stock In-Transit table:** Source · Destination · Material · Qty · Dispatched · ETA · Status. E.g. Mumbai WH → Pune Plant, 2,000 kg HDPE Resin, dispatched 21 Mar, ETA 23 Mar, In Transit.

This page is the direct answer to the case study's "multiple grades and **regions**" framing — regional imbalance is visible at a glance.

### `/batch-tracking` — Batch & Serial Tracking

**Backward trace 100%** · **Forward trace 100%** · 1 open containment action.

Fields per batch: Batch ID · Material & size · Qty · Mfg date · Expiry · Warehouse · **Bin** · **Formula/revision version** · # inputs · QC status · Age (days).

**Genealogy for batch B-2026-0412:**
- **Backward (5 inputs):** Sodium Lauryl Sulphate 640 kg · EDTA Disodium Salt 36 kg · Demineralised Water 3,600 L · Fragrance Blend 18 L · HDPE Bottles 1,800 pcs — each with its own supplier lot code
- **Forward (2 customer shipments):** 800 units delivered to Reliance Retail (20 Mar) · 500 units in transit to DMart (22 Mar) · 500 units remaining at Pune Plant

**Expiry alert:** B-2025-1245 Bathroom Cleaner 500ml, 40 units expiring 15 Apr 2026 (~15 days), value ₹0.12L.

8 batches shown, spanning Dec 2025 to Mar 2026, QC statuses **Approved / Quarantine**.

### `/inventory-health` — Inventory Health Scoring

**Composite score 74/100** against an 80 target, decomposed into:
- **Stock Availability: 81**
- **Turnover Efficiency: 68**
- **Excess & Obsolescence: 72**

Per-material scores with prescriptions:

| Material | Score | Diagnosis & recommendation |
|---|---|---|
| Stearic Acid | **32** | Frequent stockouts — increase safety stock by 180 kg |
| Fragrance Blend FG-04 | 38 | Needs a second vendor source |
| EDTA Disodium Salt | 41 | Place advance POs |
| Shrink Labels Type B | 45 | Review MOQ |
| Pine Oil | 48 | Supply variability — 3-week buffer |
| LDPE Granules | 52 | **Excess** — 45 days cover, reduce 25% |
| Titanium Dioxide | 58 | 18% price volatility over 6 months |
| Polypropylene Granules | 65 | Below-target turnover |
| Sodium Hypochlorite | 71 | Moderate shortage, monitor weekly |
| HDPE Resin | **88** | No penalties — maintain |

**Chart:** 12-month score trend (Apr–Mar, 50–100 range).
**Financial recommendations:** free ₹1.4L working capital by reducing HDPE safety stock · 8% saving via consolidated label procurement.

**This page is the intellectual core of the whole application.** Scoring availability *and* excess in one composite is the direct implementation of the case study's twin-cost insight. The page simultaneously tells you to *raise* Stearic Acid buffer (score 32, stockouts) and *cut* LDPE by 25% (score 52, excess). A single inventory-level dial cannot produce both instructions; a per-SKU scored model can. That is the argument for the whole system in one screen.

---

## 2.9 Purchase

### `/purchase-planning`

**47 pending requisitions worth ₹2.8 Cr** · **89 planned POs worth ₹6.1 Cr** · 6 overdue POs.

Two recommendation sources: **MRP-driven** (from BOM explosion and production schedule) and **Min-Max** (threshold-triggered). Priority: Critical / Medium / Low.

Columns: Material · Qty required · Requirement date · Vendor · Lead time · **Order By** · Suggested order qty (may exceed requirement for lot-size economics) · Estimated cost · Planning source · Priority · action.

`Create Purchase Orders (Selected)` does bulk PO generation. **This page is capability #5 in full — "recommends what to buy, in what quantity, and by when."** All three are literal columns, and the "Order By" date closes the action-latency gap.

### `/purchase-orders`

**412 POs.** Value range ₹0.53L–₹10.38L each. Nine statuses: Draft 8 · Pending Approval 12 · Approved 24 · Ordered 87 · **Partially Received 34** · Fully Received 241 · Cancelled 6.

Columns: PO Number · Vendor · Order Date · Expected Delivery · Value · Items · **Received %** · Payment (Pending/Partial/Paid) · Status.

Samples: PO-2026-0998 Aarti Industries ₹3.79L, 4 items, 0% received, Draft · PO-2026-0749 Galaxy Surfactants ₹1.68L, 100% received, Paid · PO-2026-0852 Gujarat Alkalies ₹2.64L, **71% received**, Partially Received.

Tracking **partial receipt percentage separately from payment status** matters — a 71%-received PO is a live planning input (the other 29% is still an open requirement), not just an accounting record.

### `/vendor-management` — Vendor Scorecard

12 columns of supplier performance: Vendor · PO Value (6 months) · **OTD %** · **Rejection %** · Avg Lead time · **Price Variance %** · **Score** · **COPQ YTD** · Trend.

Observed ranges: OTD **75–94%** · Rejection **0.3–3.5%** · Lead time **4–14 days** · Price variance **−2.1% to +6.2%** · Composite score **68–92**.

Best performer — **Mold-Tek Containers:** ₹62L PO value, 94% OTD, 0.5% rejection, 5-day lead, −0.5% price variance, score 92, COPQ ₹0.6L, trending up.

**COPQ (Cost of Poor Quality) in rupees** is the sophisticated inclusion here. Rejection percentage tells you how often a vendor ships bad material; COPQ tells you what that actually costs you in rework, scrap and line downtime. It is the number that justifies paying a 2% price premium for a better supplier.

### `/procurement-analytics`

**KPIs:** Avg PO cycle time **12.4 days** · On-time delivery **83.2%** (target 90%) · Price variance **+2.1%** (over budget) · Top vendor volume **₹1.2 Cr** (Reliance Polymers).

**Charts:** Procurement value trend (₹L/month, Apr–Mar, 0–140 range, split by Polymers / Chemicals / Packaging / Other) · Price trends for top materials (₹/kg, 6 months, Polypropylene / Stearic Acid / TiO2 / SLS, 80–320 range).

Note the dashboard OTIF of 96.2% is *customer-facing*; this 83.2% is *supplier-facing*. The company is considerably better at delivering to its customers than its suppliers are at delivering to it — which is only possible because inventory is absorbing the difference. That is the working-capital cost of supplier unreliability, and it is visible by reading two pages together.

---

## 2.10 Traceability

### `/traceability` — BOM Traceability

Tabbed: **Trace Search · Lot Register · Population at Risk · Supplier Quality**.

**2 critical alerts:** suspect lot **LOT-2026-0189** in active production · revision mismatch at assembly **SN-2026-00467**.

**Trace Search** accepts a serial or lot number. The demo offers three deliberately different cases: `LOT-2026-0178` (valid) · `LOT-2026-0189` (quarantine) · `LOT-2026-0204` (non-ASL — i.e. from a supplier not on the Approved Supplier List).

**The LOT-2026-0189 storyline is the showcase, and it runs end to end:**

1. **Source:** Sodium Lauryl Sulphate (RM-4023) from **Galaxy Surfactants**, consumed at Mixing station
2. **Supplier quality:** defect rate **5.8%**, **COPQ YTD ₹4.2L** — the worst of the five tracked suppliers
3. **SCAR-2026-008** (22 Mar, Open): *"Material grade mismatch — Industrial grade supplied instead of Cosmetic grade for SLS lot GS-SLS-2026-044"*
4. **Field consequence — warranty claims traced back to this lot:**
   - **WC-2026-0031** (20 Mar), SN-2026-00467, BigBasket: *"Skin irritation complaint — possible surfactant contamination"*, status investigating, RCA 22 hrs
   - **WC-2026-0035** (23 Mar), SN-2026-00472, DMart: *"Underfill — bottle volume below label claim (4.88L vs 5L)"*, status open, RCA 8 hrs
5. **Alert TA-004** (high): *"Field return cluster on LOT-2026-0189 — 3 warranty claims in 4 days all trace back to lot LOT-2026-0189 from Galaxy Surfactants."*
6. **Containment:** Containment Funnel, Containment Panel and **Containment Priority** drive the recall scope

**Supplier Quality tab** — defect rate and COPQ by supplier lot:

| Part | Supplier | Defect rate | COPQ YTD | Lot |
|---|---|---|---|---|
| RM-4023 Sodium Lauryl Sulphate | Galaxy Surfactants | **5.8%** | **₹4.2L** | LOT-2026-0189 |
| RM-2087 Stearic Acid | Rashtriya Chemicals | 3.5% | ₹2.8L | LOT-2026-0195 |
| RM-5018 EDTA Disodium Salt | Aarti Industries | 1.8% | ₹1.1L | LOT-2026-0215 |
| PM-1001 HDPE Bottle 5L | Mold-Tek Containers | 0.5% | ₹0.6L | LOT-2026-0210 |
| RM-8012 Fragrance Blend FG-04 | Givaudan India | 0.3% | ₹0.3L | LOT-2026-0178 |

Also tracked: **TA-007** — supplier lot LOT-2026-0178 approaching expiry (SLS from Galaxy expires 2027-02-10, 120 kg remaining, consume within 30 days).

**Why this module matters more than it first appears.** It is not in the case study's six capabilities at all, but it is the strongest part of the build. It closes a loop the forecasting story leaves open: a quality failure at a supplier becomes a field return becomes a recall scope becomes a vendor scorecard penalty becomes a sourcing decision. Note that Galaxy Surfactants' SLS is *also* the material driving the critical stock alert and the headline simulator scenario — so one supplier is simultaneously a supply-risk, a quality-risk and a cost-of-poor-quality problem, and the system shows all three views of the same vendor.

---

## 2.11 Analytics & Reports

### `/bi-dashboard` — BI Dashboard

Charts: Inventory Value by Category · **ABC Analysis** · Dead Stock Trend (₹L, 12 months, 0–80 range) · **Schedule Adherence (12 weeks, W1–W12, 80–100%)** with **Savings YTD ₹18.4L** · Spend by Vendor (₹L, top 10 — Galaxy, Aarti, Tronox, Deepak, Gujarat, Reliance, 0–120 range).

### `/material-coverage` — Material Coverage Monitor

**Chart:** weeks of stock across a **13-week horizon (W1–W13)**, with a **critical threshold line at 2 weeks**.

Columns: Material · Coverage (days) · Trend (Declining/Stable/Improving) · **Risk Level** (Critical/High/Medium/Low/None) · Next PO Due · **Action** (Emergency PO / Expedite / Monitor / Planned / none).

Observed coverage range 3.7–38 days. Materials below 14 days trigger escalating actions; 3.7–6.2 days warrants emergency intervention; above 15 days is planned ordering only. Again the action verb is derived from the tier, not left to the planner.

### `/procurement-reports`

**499 POs (6 months)** · **₹5.88 Cr total spend** · avg lead time **7.2 days** · **Cost savings YTD ₹12.4L (+18% vs last year)**.

Vendor table (8 rows): Vendor · POs · Total Value · OTD % · Avg Lead · Savings. Top: Reliance Polymers (18 POs, ₹1.2 Cr, 92% OTD) · Mold-Tek (15 POs, 94% OTD). Worst: **Rashtriya Chemicals (12 POs, 78% OTD, −₹0.8L savings)** — a *negative* savings figure, i.e. that vendor cost more than baseline.

### `/mrp-efficiency`

Meta-monitoring: is the planning engine itself healthy?

**KPIs:** Plan adherence **91%** (+5% vs Q3) · avg run duration **4m 19s** · **exception resolution 86% within SLA** · 18 open exceptions (6 high).

**Run-type profile:** Full regenerative — 4m 38s, ~309 planned orders, ~21 exceptions. Net change — **1m 42s**, 48 planned orders, 5 exceptions. (The 2.7x speed difference is why both modes exist.)

**Charts:** MRP plan adherence over 12 months (70% in April to 100% in July–August) · Exception types over 30 days, **104 total**:

| Exception type | Count |
|---|---|
| Material Shortage | 42 |
| Late Delivery Risk | 28 |
| Excess Stock Alert | 15 |
| Capacity Constraint | 11 |
| BOM Missing/Error | 8 |

**Table:** MRP Run History, last 7 executions with type, duration, planned orders, exceptions, status.

Tracking **exception resolution rate against an SLA** is the detail that shows planning maturity. It measures whether the humans are keeping up with what the machine raises — which is the real failure mode once you automate detection.

### `/custom-reports`

**6 templates** with configurable field counts: Inventory Valuation (12 fields) · Purchase Order Aging (10) · Material Consumption (14) · Supplier Lead Time Analysis (8) · Production Yield (11) · **Safety Stock Review (15)**.

**8 saved scheduled reports:**

| Report | Type | Schedule | Last run |
|---|---|---|---|
| MRP Exception Analysis | Planning | Daily 07:00 | 23 Mar 2026 |
| Weekly Stock Coverage | Inventory | Monday 06:00 | 17 Mar 2026 |
| Production Efficiency | Production | Weekly | 17 Mar 2026 |
| Monthly Procurement Summary | Purchase | 1st of month | 1 Mar 2026 |
| Vendor Performance Scorecard | Vendor | Monthly | 1 Mar 2026 |
| Dead Stock Valuation | Inventory | Monthly | 1 Mar 2026 |
| Cost Variance Analysis | Finance | Monthly | 1 Mar 2026 |
| Batch Traceability Audit | Quality | On demand | 15 Mar 2026 |

Columns include row counts (48–1,247) and Run/Download actions. Export to **Excel and PDF**.

---

## 2.12 Settings

### `/company-settings` — Company & Warehouses
Legal entity details (GSTIN, PAN, CIN, address, contact) plus the four-location table given in §2.1, each with code, type, manager, SKU count, area and active status.

### `/users-roles` — Users & Roles

**12 users across 4 roles:**

| Role | Users | Permissions |
|---|---|---|
| **Admin** | 2 | Full system access — all modules, settings, user management |
| **Planner** | 3 | Material planning, BOM, safety stock, MRP, forecasting, inventory view |
| **Procurement** | 2 | Purchase orders, vendor management, procurement analytics, price management |
| **Operations** | 5 | Production schedule, work orders, shop floor, inventory issue/receipt |

Columns: Name · Email · Role · Department · Last Login · Status. 11 active, 1 inactive (Sunita Reddy, Planner/Quality). The permission boundaries are sensible: planners can *view* inventory but procurement *transacts* it.

### `/integrations` — Integration Hub

> "Live monitoring of all external data pipelines connected to MatrixOps."

**11 connectors across 6 categories — 9 healthy, 1 degraded, 1 error. 1,858 records today, average uptime 98.8%.**

| Connector | Category | Status | Uptime | Latency | Error rate | Records today | Last sync |
|---|---|---|---|---|---|---|---|
| **1C:Enterprise ERP** | ERP | Active | 99.4% | 640ms | 0.18% | 1,284 | 8 min ago |
| **Tally Prime** | Financial | Healthy | 99.94% | 180ms | 0.02% | 342 | 2 min ago |
| **Zoho Books** | Financial | **Degraded** | 97.2% | 2.4s | 1.7% | 0 | 3 hrs ago |
| **WooCommerce** | Commerce | Healthy | 99.88% | 320ms | 0.08% | 28 | 5 min ago |
| **Amazon Seller Central** | Commerce | Healthy | 99.91% | 450ms | 0.12% | 15 | 12 min ago |
| **IndiaMART** | Commerce | Healthy | 99.5% | 890ms | 0.45% | 8 | 30 min ago |
| **GSTN Portal** | Compliance | Healthy | 99.6% | 1.8s | 0.3% | 45 | 1 hr ago |
| **Transport Management** | Logistics | **Error** | 92.1% | — | **100%** | 0 | 6 hrs ago |
| **Quality Management** | Quality | Healthy | 99.97% | 95ms | 0% | 12 | 25 min ago |
| **HR & Payroll** | Workforce | Healthy | 99.8% | 1.2s | 0% | 0 | 2 hrs ago |
| **Email/SMS Gateway** | Notifications | Healthy | 99.99% | 42ms | 0.01% | 124 | Just now |

**Two live failures, each with a real diagnostic message:**
- **Zoho Books:** *"14 records failed validation — schema mismatch on tax_code field since Zoho API v2.8 update"*
- **Transport Management:** *"API rate limit exceeded at 06:18 AM — 429 Too Many Requests. Auto-retry in backoff. Last successful batch: 186 records."*

The connector choice is notably **India-SMB-realistic** rather than generic enterprise — 1C:Enterprise as system of record, **Tally Prime** for accounting, **GSTN** for e-invoicing and e-way bills, **IndiaMART** for RFQ lead capture. Someone picked these for an actual Indian mid-market manufacturer, not from a generic integration list. And showing two *broken* connectors with authentic error semantics (a 429 with backoff, a schema drift after a vendor API version bump) is a deliberate credibility choice.

### `/alert-config` — Alert Configuration

**19 rules, 17 active. 47 emails and 8 SMS sent today.**

Columns: Enabled · Alert Rule · **Trigger Condition** · Channel(s) · Recipients · Frequency · Actions.

| Rule | Trigger | Channels | Recipients | Frequency |
|---|---|---|---|---|
| Stock Exhaustion — Critical | Coverage < 3 days | Email, SMS, In-App | Planner, Procurement Head | Immediate |
| Stock Exhaustion — High | Coverage 3–7 days | Email, In-App | Planner | Daily digest |
| Stock Exhaustion — Medium | Coverage 7–14 days | In-App | Planner | Weekly digest |
| PO Overdue | Expected delivery passed | Email, In-App | Procurement | Daily |
| MRP Exception — High | High severity exception | Email, SMS | Planner, Operations | Immediate |
| Production Delay | Work order behind schedule > 4h | Email, SMS | Operations, Plant Head | Immediate |
| Quality Hold | QC failure or quarantine | Email, In-App | Quality, Operations | Immediate |
| Batch Expiry Warning | Batch expiring in < 30 days | Email | Warehouse, Sales | Weekly |
| Price Variance Alert | PO price > 5% above last price | Email | Procurement, Finance | Per PO |
| Dead Stock Alert | No movement > 90 days | In-App | Planner, Finance | Monthly |
| Integration Failure | Sync failure | Email, SMS | IT Admin | Immediate |
| Capacity Overload | Production line > 100% scheduled | Email | Operations | Daily |
| **Suspect Lot in Production** | Failed lot consumed | Email, SMS, In-App | Quality, Operations, Plant Head | Immediate |
| **Revision Mismatch at Assembly** | Non-current EBOM revision used | Email, SMS, In-App | Quality, Engineering | Immediate |
| Lot Scan Coverage Below Threshold | Line scan coverage < 90% | Email, In-App | Operations, Quality | Per Shift |
| **Non-ASL Supplier Lot Consumed** | Unapproved supplier lot used | Email, SMS | Quality, Procurement | Immediate |
| **Field Return Cluster** | >= 3 returns on same lot in 7 days | Email, SMS, In-App | Quality, Plant Head, Sales | Immediate |
| ECO Effectivity Approaching | Revision effectivity ends in < 30 days | Email | Engineering, Quality | Weekly |
| Supplier Lot Expiry | Lot expires in < 60 days | Email, In-App | Warehouse, Quality | Weekly |

**The escalation grammar is the thing to notice.** The same underlying metric — days of cover — produces three completely different behaviours: under 3 days it pages two people immediately on three channels; 3–7 days is a daily digest to one person; 7–14 days is a weekly in-app note. Severity determines **channel, audience and cadence**, not just colour. That is what stops an alerting system from being ignored, and it is the operational detail that most "AI planning" demos skip entirely.
---

# PART 3 — POC 2: PlanForge AI (Intelligent Replanning)

**URL:** https://planforge.joulestowatts.online
**Tagline:** "Intelligent Replanning"
**Demo user:** R. Krishnamurthy (Production Planner)
**Simulated "today":** ~23 March 2026
**Routes:** 22

## 3.1 What it is — and why it is a different animal

PlanForge addresses the same underlying discipline from the opposite end of the manufacturing spectrum. Where ProdPlanner plans **thousands of cheap SKUs on short cycles**, PlanForge plans **a few hundred enormous orders on year-long cycles**.

The domain is **heavy capital equipment** — industrial gas turbines, steam turbines, compressors and generators for the energy sector. Products: **GT-7000, GT-9500, ST-4000, CP-2200, GP-6000, GP-8500**. Customers: NTPC Ltd., Adani Power, Tata Power, ONGC Offshore, GAIL, BHEL, Reliance Energy, JSW, Cairn, L&T, and export accounts — **Saudi Aramco, ADNOC, Qatar Energy LNG, Petronas**.

The scale changes everything:

| | ProdPlanner | PlanForge |
|---|---|---|
| Planning object | SKU / material | **Order** |
| Volume | 1,247 SKUs | **1,183 orders** |
| Cycle | Days | **212 days average to delivery** |
| Unit value | ₹16–₹142 margin | **₹66–₹246 Cr per order** |
| Portfolio value | ₹8.4 Cr inventory | **₹2,233 Cr order book** |
| Constraint unit | Work-centre hours | **Assembly bays** (7 total) |
| Replan trigger | Nightly MRP | **Disruption event** |

When a single order is worth ₹246 Cr, you do not optimise it with a reorder point. You simulate it. That is why PlanForge is organised around **replanning in response to disruption** rather than periodic planning.

**Two plants, seven bays:**
- **Pune** — 4 bays, 87% utilisation, 19 active orders, **342 workers on shift**
- **Vadodara** — 3 bays, 68% utilisation, 13 active orders

## 3.2 Module map (all 22 routes)

| Section | Pages |
|---|---|
| **Command Center** | `/` Dashboard |
| **Order Book** | Active Orders · Order Detail · Priority Matrix |
| **Plan & Simulate** | Simulate · Scenario Intelligence · Plan Comparison · Production Plan · Allocation · Pull-In / Push-Out |
| **Factory Operations** | Factory — Pune · Factory — Vadodara |
| **Supply Chain** | Materials · Suppliers · Disruptions |
| **Demand Intelligence** | Demand Forecast · Demand Changes |
| **System** | Integrations · Settings · Login |

---

## 3.3 Command Center (`/`)

**Headline KPIs:**

| KPI | Value | Signal |
|---|---|---|
| Active Orders | **1,183** | 28 added this week |
| On-Time Delivery | **86.7%** | ↓ 1.8% vs last week |
| Plant Utilization | **Pune 87%** (4 bays) · **Vadodara 68%** (3 bays) | 19-point imbalance |
| Revenue at Risk | **₹142 Cr** | ↑ 4 critical shortages |

The Pune/Vadodara imbalance — 87% vs 68% — is the single most actionable number on the page, and it is what the entire Allocation module exists to fix.

**Order Status Distribution:** On Track 21 · At Risk 11 · Critical 1 · Delayed 2 · Completed 24.

**Capacity Timeline:** 8-week forward view, W16–W23, utilisation 0–100% per bay.

**Upcoming Milestones:** 10 orders with customer, days remaining, and status.

**Active Alerts — 10 live, with order counts and revenue impact attached to each:**

| ID | Sev | Alert | Orders | Revenue |
|---|---|---|---|---|
| ALT-001 | **Critical** | Bharat Forge: rotor forging for GT-9500 delayed 14 days | 6 | ₹87 Cr |
| ALT-007 | **Critical** | Pune Bay 3 utilisation exceeds 95% for weeks 22–24; 3 GT-9500 orders competing for the same window | 3 | **₹328 Cr** |
| ALT-004 | Warning | Combustion Liner CL-7000 drops below safety threshold in 21 days | 18 | **₹396 Cr** |
| ALT-008 | Warning | Precision Castparts batch #PCB-4472 turbine blades failed dimensional inspection; rework ~10 days | 8 | ₹176 Cr |
| ALT-006 | Warning | Allegheny Technologies export shipment held at customs; est. 8–12 day delay | 4 | ₹164 Cr |
| ALT-002 | Warning | NTPC order #PF-2025-0312 pulled in 4 weeks; capacity conflict Pune W22–23 | 3 | ₹48 Cr |
| ALT-010 | Warning | Forex: INR/USD movement adds est. **+₹2.8 Cr** on outstanding import POs | — | ₹2.8 Cr |
| ALT-003 | Info | Vadodara Line 2 crane maintenance W24; 5 steam turbine orders need reallocation | 5 | — |
| ALT-005 | Info | Saudi Aramco #PF-2025-0078 spec revision; BOM update for compressor blade Stage 4 | — | — |
| ALT-009 | Info | Vadodara Bay 3 test cell upgrade completed early — **+12% capacity from W20** | — | — |

Every alert carries **`Simulate Impact`** and **`View Orders`**.

Three design points worth drawing out. First, **every alert is priced** — not "material shortage," but "18 orders, ₹396 Cr." In a business where one order is ₹246 Cr, severity without a rupee figure is meaningless. Second, the alert set spans supply, capacity, quality, customs, customer change, **and foreign exchange** — PlanForge treats currency movement on import POs as a planning disruption, which is correct for an importer of specialty alloys. Third, **ALT-009 is good news** (a capacity upgrade finished early, freeing 12%). A feed that only carries bad news gets read as noise; one that also surfaces newly available capacity is a planning input.

---

## 3.4 Order Book

### `/orders` — Active Orders

**35 orders shown · ₹2,233 Cr total revenue · 212 days average to delivery.**

Columns: Order ID · Customer · Product · Quantity · **Priority (P1–P4)** · Factory (Pune / Vadodara / **Unassigned**) · Planned Start · Delivery Date · Days · **Material %** · Status · Revenue (₹ Cr).

Status split: On Track 22 · At Risk 10 · **Critical 1** · Delayed 2.

Notables: highest-value single order **₹246 Cr (Qatar Energy LNG, GT-9500E)** · critical order **PF-2025-0056, ₹66 Cr, 68% material complete** · lowest material readiness **18% (PF-2025-0350)** · latest delivery **28 Mar 2027**.

Filters: Product, Factory, Priority, Status, Customer.

The **Material %** column is the bridge to the supply-chain module — it is the single number that predicts whether an order will hit its date, and the **Unassigned** factory value is what feeds the allocation engine.

### `/orders/PF-2025-0012` — Order Detail

The deep-dive view, and the clearest demonstration of how PlanForge thinks about an order.

**Header:** PF-2025-0012 · **P1** · On Track · Pune · **NTPC Ltd.** · GT-9500E Gas Turbine Package · Qty 2 · ₹82 Cr/unit · **₹164 Cr total** · Contract NTPC/GT/2025/0312 · Ordered 12 Aug 2025 · **Committed delivery 22 Sep 2026**.

**Production timeline — six stages, plan vs actual:**

| Stage | Planned | Actual |
|---|---|---|
| Engineering | 14 Apr – 12 May 2026 | started 14 Apr — in progress |
| Procurement | 20 Apr – 15 Jun 2026 | started 22 Apr — in progress |
| Fabrication | 01 Jun – 20 Jul 2026 | — |
| Assembly | 21 Jul – 25 Aug 2026 | — |
| Testing & QC | 26 Aug – 12 Sep 2026 | — |
| Packaging & Dispatch | 13 – 22 Sep 2026 | — |

**Material Readiness — top 10 BOM components**, each with Required / Available / Short / Supplier / ETA / Status:

| Component | Req | Avail | Short | Supplier | ETA | Status |
|---|---|---|---|---|---|---|
| Rotor Forging Assembly | 2 | 1 | **1** | Bharat Forge Ltd. | 02 May 2026 | **Critical** |
| Combustion Liner CL-7000 | 6 | 4 | 2 | Precision Castparts India | 18 May 2026 | Warning |
| Generator Stator Winding GSW-8500 | 2 | 1 | 1 | Siemens Gamesa | 20 May 2026 | Warning |
| IGBT Excitation Module EX-400 | 4 | 2 | 2 | ABB India | 25 Apr 2026 | Warning |
| (6 further components) | | | 0 | | | OK |

**Capacity Allocation:** Pune, **Assembly Bay 3**, production window **W16–W26**, bay utilisation **92%**.

**Risk Summary:** **Delivery confidence 78%** · Top risk: material shortage, 2 units short, supplier ETA 25 Apr · Secondary: Pune Bay 3 exceeds 92% utilisation in W22.

**Actions:** Run Simulation · Change Priority · Reassign · **View in Oracle** · **Simulate Alt. Supplier** · **Explore Reallocation**.

**Delivery confidence as a single percentage is the right abstraction for this business.** It fuses material shortfall and capacity contention into one number a sales director can act on — 78% means there is roughly a one-in-four chance NTPC's turbine is late, and the page immediately tells you which two things are causing it. The three contextual actions (simulate an alternative supplier, explore reallocation, run full simulation) map one-to-one onto the two named risks.

Note also `View in Oracle` — PlanForge positions itself as a **planning layer on top of an existing ERP**, not a replacement for it. That is a materially different go-to-market posture from ProdPlanner, which *is* the ERP.

### `/priority-matrix` — Order Priority Matrix

A scatter plot: **X-axis = Days to Delivery (0–380)**, **Y-axis = Revenue (₹ Cr, 0–260)**, giving four quadrants:

| | Near deadline | Far out |
|---|---|---|
| **High value** | **Act now** — urgent, high revenue | Protect — profitable, time available |
| **Lower value** | Time-sensitive, lower revenue | Deprioritise |

Points are coloured by status (On Track / At Risk / Critical / Delayed / Completed) and filterable by factory and product line.

The useful property of this view is that it finds **mismatches between assigned priority and actual exposure** — a P3 order sitting in the high-value/near-deadline quadrant is a labelling error you want to catch before it becomes a delay.

---

## 3.5 Plan & Simulate — the core of the product

### `/simulate` — Scenario Simulator

**Six disruption types:** Supplier Delay · Demand Change · Capacity Loss · Material Shortage · Rush Order · Custom.

**Input levers:** select disruption type(s) · target supplier (Bharat Forge Ltd., Precision Castparts India, ABB India, Allegheny Technologies, Sandvik India) · target material (e.g. "GT-9500 Rotor Forgings") · **duration, 1 to 8 weeks**.

> "The AI engine will analyze cascading impact across all **1,183 orders**."

**Compound simulations** are supported by selecting multiple disruptions. `Simulate Impact` runs it.

The word doing the work is **cascading**. In a bay-constrained factory, delaying one order does not just delay that order — it shifts every subsequent order queued in that bay, which displaces orders at the other plant, which breaks delivery dates for customers unrelated to the original disruption. Computing that across 1,183 orders is exactly what a human planner cannot do, and it is this POC's central claim.

### `/scenario-intelligence` — Scenario Intelligence

**The most intellectually interesting page across both applications.**

**KPIs:** 4 active risk scenarios · **2 "known unknowns"** · **2 "unknown unknowns"** · total exposure **₹900 Cr+** under compound conditions · live market data (4 minutes old).

The page explicitly splits risk into **quantifiable** and **unquantifiable** categories:

**Known Unknowns — probability is meaningful:**

| Risk | Probability | Impact | Driver |
|---|---|---|---|
| **Geopolitical Escalation** | **35%** | **₹492 Cr** across Gulf clients (ADNOC, Saudi Aramco, Qatar Energy) | Strait of Hormuz closure since 28 February |
| **Steel Cost Passthrough** | **90%** | 4–7% margin compression on ₹246 Cr | HRC steel up **15.5% YoY**; Section 232 tariffs locked 2 April |

**Unknown Unknowns — probability is stated but explicitly disclaimed:**

| Risk | Stated prob. | Characterisation |
|---|---|---|
| **Regulatory Export Control** | 12% — *acknowledged as meaningless* | "Black swan: MoD/DGFT directive could freeze exports within 72 hours" |
| **Tier-2 Supplier Insolvency** | 18% | Pune Bay 3 production halt; 14–30 day recovery minimum |

**External market feeds referenced:** Steel HRC (US Midwest) · **Baltic Dry Index** (Baltic Exchange) · INR/USD · metals pricing API · SteelRadar.

**Why this page deserves particular credit.** Almost every "AI risk" dashboard assigns a tidy probability to everything and implies the numbers are comparable. This one refuses to. It states plainly that the 12% on a regulatory export freeze is *not a real probability* — there is no precedent base in transformer manufacturing history to estimate from — while the 90% on steel passthrough is well-founded because the tariff is already locked and the HRC index is already up 15.5%.

That distinction is epistemically honest and operationally useful: you **hedge** a known unknown and you **build optionality** against an unknown unknown. They require different responses, and most tools blur them. The page's call to action — "Build compound contingency plan" when multiple risks activate together — also acknowledges that risks compound non-linearly rather than adding up.

This also quietly fulfils a case-study claim the forecasting page doesn't: *"external market signals."* Here they are concrete and named — steel index, freight index, currency, tariff policy, shipping-lane status.

### `/plan-comparison` — Plan Comparison

Three plans compared on seven metrics:

| Metric | Current Plan | Scenario A — Bharat Forge Delay | Scenario B — NTPC Pull-In |
|---|---|---|---|
| On-Time Delivery | 86.7% | 84.2% (−2.5%) | 83.9% (−2.8%) |
| Revenue at Risk | ₹142 Cr | ₹154 Cr (+₹12 Cr) | ₹168 Cr (+₹26 Cr) |
| Pune Utilization | 87% | 82% (−5%) | 91% (+4%) |
| Vadodara Utilization | 68% | 74% (+6%) | 68% (no change) |
| Delayed Orders | 41 | 44 (+3) | 47 (+6) |
| **Overtime Hours** | 0 | **120 hrs** | **240 hrs** |
| **Additional Cost** | — | **₹18 L** | **₹42 L** |

Also shown: per-order timeline shifts (+8d, +14d under Scenario A).

Scenario A is the better outcome on every axis — ₹18L vs ₹42L cost, 44 vs 47 delayed orders, ₹154 Cr vs ₹168 Cr exposure. Note the useful second-order effect: Scenario A *reduces* Pune utilisation by 5 points while *raising* Vadodara by 6 — the disruption inadvertently rebalances the plants. Scenario B does the opposite, pushing Pune to 91% while Vadodara sits unchanged at 68%.

Translating a schedule change into **overtime hours and rupees** is the move that makes this a management tool. "Three more orders late" is abstract; "₹18 lakh of overtime" is a budget line.

### `/production-plan` — Production Plan

A **12-week Gantt (W16–W27)** of order allocations across all 7 bays, with **3 scheduling conflicts** called out:

1. **Pune Bay 3** — orders overlap in **weeks 22–24**, utilisation over 95%
2. **Pune Bay 2** — orders share weeks 25–26, with material-dependency chain risk
3. **Vadodara Bay 2** — one-week cascading delay between consecutive orders

Bays carry orders from Adani, Tata, ONGC, L&T, Reliance, NTPC, ADNOC, GAIL, JSW, BHEL, Qatar Energy, Cairn.

Pune Bay 3 in weeks 22–24 is the recurring villain of this application — it appears on the Command Center (ALT-007, ₹328 Cr), on the order detail page (92% utilisation, secondary risk), on the factory page (95%, top bottleneck) and here. **The seeded data tells one coherent story across every screen**, which is what makes the demo convincing.

### `/allocation` — Multi-Plant Allocation

Decides **which plant builds which order**.

**Allocation rules applied:** prefer existing tooling at the target plant · account for specialised assembly capability (rotor, steam turbine) · evaluate capacity headroom against a **70–90% utilisation target** · factor setup cost of tooling transfer · align with existing batch schedules.

**Recommendations table:** Order ID (PF-2025-0112 / 0223 / 0340) · Customer · Product · **Recommended plant** · **Reasoning** · Alternative plant · utilisation impact · **confidence 85–92%** · `Accept` / `Override`.

Projected plant utilisation lands at **76–91%** across weeks 28–42.

Two things matter here. The **70–90% target band** is a planning maturity signal — the goal is not to maximise utilisation (100% means zero resilience to disruption) but to hold a band that absorbs shocks. And as everywhere else in both POCs, the AI recommends and the human **accepts or overrides**; the reasoning is shown so the override can be informed.

### `/pull-in-push-out` — Pull-In / Push-Out Impact

Manages customer-driven date volatility. **Pull-in** = customer wants it earlier; **push-out** = later.

**This quarter:** 34 total changes · **21 pull-ins averaging −22 days** · **13 push-outs averaging +41 days** · **8 unresolved** · net capacity impact **+2.4% Pune / −1.8% Vadodara**.

Columns: Change ID · Order ID · Customer · Original date · Requested date · **Shift (± days)** · Direction · **Impact assessment** · Status (Accepted / Rejected / Under review / Simulating) · `Simulate`.

Example — **DC-047, NTPC Ltd., −28 day pull-in, displaces 3 orders at Vadodara, status "Under review."**

The asymmetry is the insight: pull-ins outnumber push-outs 21 to 13, but push-outs move nearly twice as far (+41d vs −22d). So the order book is being *compressed at the front and stretched at the back* simultaneously — which is a capacity-shaping problem, not a scheduling one. And the `Simulate` button before `Accept` means a customer's "can you do it four weeks earlier?" gets answered with a modelled consequence ("yes, but it displaces three orders at Vadodara") rather than a salesperson's optimism.

---

## 3.6 Factory Operations

### `/factory/pune` and `/factory/vadodara`

Both render the same structure. Pune's figures:

**KPIs:** Planned output **8 units** this week · Actual **7** (−1) · Utilisation **87%** · Active orders **16** · **Workforce 342 on shift**.

| Bay | Status | Current Order | Customer | Product | Complete | Util | Next |
|---|---|---|---|---|---|---|---|
| Bay 1 | On Track | PF-2025-0034 | Adani Power | GT-7000 | 45% | 85% | PF-2025-0099 |
| Bay 2 | On Track | PF-2025-0067 | Tata Power | CP-2200 | 30% | 82% | PF-2025-0245 |
| **Bay 3** | **At Risk** | PF-2025-0012 | NTPC Ltd. | GT-9500 | 22% | **95%** | PF-2025-0178 |
| Bay 4 | On Track | PF-2025-0267 | ADNOC | CP-2200 | 18% | 78% | PF-2025-0167 |

**Top bottleneck: "Bay 3 — GT-9500 assembly backlog."**

**Order queue:** 19 orders — On Track 11 · At Risk 7 · Delayed 1 (PF-2025-0038) · Critical 1 (PF-2025-0056). **Bay 3 alone holds 5 GT-9500 orders**, which is the mechanical cause of the backlog: the largest, longest product is concentrated in one bay.

Queue columns: Order ID · Customer · Product · Bay · Start · Delivery · Status.

The diagnosis chain here is complete and legible: 5 GT-9500s queued in one bay → 95% utilisation → 7 of 19 orders at risk → PF-2025-0012's 78% delivery confidence → ₹328 Cr of revenue exposed in ALT-007. Vadodara at 68% with free capacity is the obvious relief valve, which is precisely what the Allocation page is for.

---

## 3.7 Supply Chain

### `/materials` — Material Availability

> "Component readiness across the order book."

**847 components:** Fully available **612 (72%)** · Partial **178 (21%)** · **Critical shortage 57 (7%)**.

**Top shortages by revenue exposure:**

| Component | Short | Orders hit | Revenue at risk | Supplier | Resupply |
|---|---|---|---|---|---|
| GT-9500 Rotor Forging | 4 units | — | **₹574 Cr** | Bharat Forge Ltd. | 2 May 2026 (delayed) |
| Hot Gas Path Transition Piece TP-9500 | 8 units | — | **₹492 Cr** | Precision Castparts India | 28 May 2026 |
| Combustion Liner CL-7000 | 18 units | **18 orders** | **₹396 Cr** | Precision Castparts India | 18 May 2026 |

Columns: Component · 90-day requirement · Available · Shortfall · Affected orders · **Revenue exposure** · Supplier · Resupply date with delay notes · Status (**6 Critical, 5 Warning**).

Flagged: a **crossover point in May 2026** where demand for Combustion Liner CL-7000 exceeds available supply. Customs delays are noted on specialty alloys.

Ranking shortages by **revenue exposure rather than quantity** is the correct prioritisation for this business. A 4-unit shortfall (rotor forgings) outranks an 18-unit shortfall on exposure, because of what those four units unlock. Supplier concentration is also visible: Precision Castparts India alone owns ₹888 Cr of the top-three exposure.

### `/suppliers` — Supplier Performance

**22 active suppliers:** On Track 17 · At Risk 4 · **Critical 1**.

Scorecard dimensions: Components supplied · Active orders · **Dependent production orders** · On-Time % · Quality Score (/100) · Avg Lead Time with trend · **Risk Score (0–100)** · Status.

| Tier | Suppliers (risk score) |
|---|---|
| **On Track** | Voith Turbo India (94) · SKF India (92) · Forbes Marshall (92) |
| **At Risk** | Bharat Forge Ltd. (74) · Mitsubishi Heavy Industries (72) · Precision Castparts India (68) · Walchandnagar Industries (65) |
| **Critical** | **Allegheny Technologies (62)** — Imported Specialty Metals, 4 active orders, **76% on-time**, **24-week lead time** |

The "**Dependent On**" column — how many downstream production orders rely on this supplier — is the differentiator from a conventional scorecard. It converts supplier risk into *blast radius*. Allegheny at a 24-week lead time is the structural problem: a supplier you cannot react to, because by the time you detect a slip, re-ordering takes six months. That is a sourcing-strategy issue, and it is also the supplier sitting behind the escalated customs hold (DIS-003).

### `/disruptions` — Disruption Tracker

**6 active disruptions · 41 orders affected · ₹1,460 Cr total revenue at risk · 1 escalated.**

| ID | Type | Description | Orders | Revenue | Source | Detected | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| DIS-001 | Supplier Delay | Rotor forging delayed 14 days (quality hold at supplier) | 6 | **₹574 Cr** | Bharat Forge Ltd. | 18 Mar | Investigating | R. Mehta |
| DIS-002 | Material Shortage | Combustion liner CL-7000 below safety stock in 21 days | **18** | ₹396 Cr | Precision Castparts India | 20 Mar | Mitigation in progress | S. Kulkarni |
| DIS-004 | Quality Issue | Turbine blade batch #PCB-4472 failed dimensional inspection | 8 | ₹176 Cr | Precision Castparts India | 22 Mar | Under review | A. Desai |
| DIS-003 | Customs Hold | Specialty alloy import held — documentation issue | 4 | ₹164 Cr | Allegheny Technologies | 19 Mar | **Escalated** | P. Sharma |
| DIS-006 | Logistics Delay | Inbound from Sagamihara delayed, port congestion | 2 | ₹82 Cr | Freight & Logistics | 22 Mar | Monitoring | K. Reddy |
| DIS-005 | Equipment Downtime | Vadodara Bay 2 crane hydraulic failure, part on order | 3 | ₹68 Cr | Vadodara Plant | 21 Mar | Parts on order | V. Patel |

Actions per row: **`Simulate Impact`** · **`Acknowledge`**.

Every disruption has a **named owner** and a **working status** — this is a case-management queue, not a notification list. And ₹1,460 Cr at risk against a ₹2,233 Cr order book means **65% of the book is touched by at least one active disruption**, which is the number that justifies the product's existence.

---

## 3.8 Demand Intelligence

### `/demand-forecast`

**KPIs:** 12-month forecast volume **562 units** · Revenue forecast **₹5,020 Cr** · **3 capacity-constrained months** · **3-month forecast accuracy 91.2%**.

**Method:** "12-month order intake forecast with capacity overlay" across combined plants.

**Charts:** Forecast vs Available Capacity (Apr 2026 – Mar 2027, forecast units and actual intake against a max-capacity ceiling, 0–60 units) · Demand by Product Line (Apr–Sep, all six SKUs: GT-7000, GT-9500, ST-4000, CP-2200, GP-6000, GP-8500).

**Capacity alert: "Months exceeding capacity: Jun, Aug, Sep 2026."**

The **capacity overlay on the forecast** is the right design for capital equipment. ProdPlanner forecasts demand and checks capacity separately; PlanForge plots them on the same axes, because when demand exceeds capacity in a one-unit-per-bay-per-quarter business, the answer is not "build more" — it is "which orders do we decline, subcontract or push out?" Three constrained months out of twelve is a commercial decision surfaced a year ahead.

Also note **91.2% accuracy here vs 85.8% in ProdPlanner**. That is consistent with the domain: capital equipment demand arrives as a visible, long-dated sales pipeline, so it is inherently more forecastable than retail offtake of hand wash.

### `/demand-changes` — Demand Change Log

> "Historical log of all demand modifications."

The archival companion to Pull-In / Push-Out — the live view manages open requests, this one retains the full history for pattern analysis (which customers habitually move dates, by how much, and in which direction). This page is the thinnest in the application; it is a log table with seven entries and no analytics layer on top of it yet.

---

## 3.9 System

### `/integrations`

**10 connected systems — 8 healthy, 2 degraded. 181,000 records in 24 hours.**

| System | Function | Protocol | Last sync | Records (24h) | Data quality |
|---|---|---|---|---|---|
| **Oracle ERP** | Orders, BOM, Inventory, Procurement | API | 2 min | 14,280 | 98.2% |
| **MES — Pune** | Production status, bay utilisation, output | **CDC** | 5 min | 8,420 | 99.1% |
| **MES — Vadodara** | Production status, bay utilisation | **CDC** | 8 min | 5,180 | 98.7% |
| **Salesforce CRM** | Customer orders, demand signals, contracts | API | 15 min | 3,240 | 97.5% |
| **Workday** | Workforce availability, shift schedules | API | 1 hour | 890 | 96.8% |
| **Supplier Portal** | Delivery commitments, shipment tracking | API | 30 min | 4,560 | **94.2%** |
| **Quality Management System** | Inspection results, NCRs | File | 45 min | 1,240 | 99.4% |
| **SAP Ariba** | Procurement, PO tracking (import suppliers) | API | 2 hours | 680 | **91.5%** |
| **IoT Gateway — Pune** | Machine utilisation, cycle times | **CDC** | **Real-time** | **142,000** | 99.8% |
| **Freight & Logistics Tracker** | Inbound shipment ETAs | API | 3 hours | 420 | **88.3%** |

This is a **large-enterprise** stack — Oracle, SAP Ariba, Salesforce, Workday, plant MES, IoT — in deliberate contrast to ProdPlanner's Tally/Zoho/GSTN/IndiaMART SMB stack. The two POCs are aimed at different buyers, and the integration lists say so more clearly than any marketing page.

Three technical details worth noting: **CDC (change data capture)** is used for the high-frequency plant and IoT feeds while polling APIs serve the slower business systems — the correct architectural split. The IoT gateway alone is 142,000 of the 181,000 records, i.e. **78% of all data volume is machine telemetry**. And **data quality is tracked per source**, with the external and least-controlled feeds scoring worst: Freight 88.3%, SAP Ariba 91.5%, Supplier Portal 94.2%, versus 98–99.8% for internal systems. Since supplier ETAs and freight tracking are exactly what the disruption engine consumes, that is an honest statement of where the model's inputs are weakest.

### `/settings`

**Planning Parameters:** Default Planning Horizon (7) · Safety Stock Threshold (%) · **Capacity Utilization Target** (%) · **Over-Capacity Warning Threshold** (%) · Lead Time Buffer (weeks) · **Priority Escalation Window** (days) · **Auto-Replan Trigger** · **Cross-Factory Transfer Lead Time** (weeks).

Plus **Constraint Configuration** and **Alert Rules** sections, and `Save Changes`.

These eight parameters are effectively the product's control surface. **Auto-Replan Trigger** is the most consequential — it governs when the system replans without being asked — and **Cross-Factory Transfer Lead Time** is what prices the Pune↔Vadodara reallocation decisions. Note the deliberate pairing of a *target* utilisation with a separate *warning* threshold, which is how the 70–90% band on the Allocation page is enforced.

### `/login`
Standard authentication screen. PlanForge carries a real **Supabase** backend with authentication and tables for `suppliers`, `supplier_lots`, `supplier_audits`, `supplier_certifications`, `supplier_corrective_actions`, `purchase_orders` and `warranty_claims`.
---

# PART 4 — The Two POCs Side by Side

## 4.1 Direct comparison

| Dimension | **ProdPlanner** | **PlanForge AI** |
|---|---|---|
| Positioning | Material Planning **& ERP** (system of record) | Intelligent **Replanning** (layer on top of Oracle) |
| Internal brand | MatrixOps | PlanForge AI |
| Industry | FMCG chemicals — cleaning & personal care | Heavy capital equipment — turbines & compressors |
| Planning object | SKU / material | Order |
| Scale | 1,247 SKUs, 39 masters, 412 POs | 1,183 orders, 847 components, 22 suppliers |
| Portfolio value | ₹8.4 Cr inventory | ₹2,233 Cr order book |
| Time horizon | Days to 13 weeks | 8 weeks to 380 days |
| Planning rhythm | **Scheduled** — nightly MRP, 4m 12s | **Event-driven** — triggered by disruption |
| Constraint | 8 work centres (hours) | 7 assembly bays (weeks) |
| Core unit of risk | Days of cover | Revenue at risk (₹ Cr) |
| Forecast accuracy | 85.8% (MAPE 14.2%) | 91.2% (3-month) |
| Forecast method | Per-SKU statistical (exp. smoothing, seasonal, MA, manual) | Order-intake pipeline + capacity overlay |
| Integration stack | **India SMB** — 1C, Tally, Zoho, GSTN, IndiaMART, WooCommerce | **Global enterprise** — Oracle, SAP Ariba, Salesforce, Workday, MES, IoT |
| Data volume | 1,858 records/day | 181,000 records/day |
| Routes | 44 | 22 |
| Users modelled | 12 users, 4 roles | 1 planner persona |
| Standout module | Planner's Workbench + Traceability | Scenario Intelligence |
| Backend | None — fully seeded demo | Supabase (auth + supplier-quality tables) |

## 4.2 What they share — the common design DNA

Despite completely different domains, both were built on the same five principles. This consistency is strong evidence they come from one team with a coherent product thesis, rather than two unrelated demos.

1. **Exception-first, not data-first.** Neither app opens on a data table. Both open on a dashboard of what is broken, counted and priced. The planner's attention is the scarce resource being managed.

2. **Every row ends in a verb.** `Raise PO` · `Simulate impact` · `Expedite` · `Accept` · `Override` · `Commit`. There is no screen in either product that informs without offering an action. This is the direct answer to the case study's action-latency failure.

3. **AI recommends, humans decide.** Confidence scores everywhere (42–91% in ProdPlanner, 85–92% in PlanForge), always paired with a rationale and an Accept/Override control. Neither product auto-commits. The case study's own phrasing — "Planners set the parameters; the system does the arithmetic and raises the exceptions" — is honoured literally.

4. **Everything resolves to money.** ProdPlanner: ₹3.8L spend to protect ₹38.0L revenue. PlanForge: ₹18L overtime vs ₹42L, ₹574 Cr exposure on four rotor forgings. Operational metrics are always carried through to a rupee figure, because that is the currency in which the decision is actually made.

5. **Decisions are auditable.** ProdPlanner's Plan Revisions is explicitly "the system of record for scenario decisions," with commit reasons, authors, timestamps, linked scenarios, and reverted entries preserved. PlanForge assigns a named owner to every disruption.

## 4.3 Where they genuinely differ in approach

- **Scheduled vs event-driven planning.** ProdPlanner's heartbeat is a nightly MRP run. PlanForge has no equivalent — it replans when something happens. The Auto-Replan Trigger setting is the closest analogue, and it is reactive by design.
- **Capacity treatment.** ProdPlanner runs MRP *unconstrained*, then checks capacity in a separate CRP step. PlanForge treats bay capacity as a primary constraint from the start and overlays it directly on the demand forecast.
- **Risk modelling.** ProdPlanner models *operational* risk (will this material run out?). PlanForge models *strategic* risk (what if the Strait of Hormuz stays closed?). Only PlanForge separates known unknowns from unknown unknowns.
- **Substitution vs reallocation.** ProdPlanner's flexibility lever is material substitution (SUB-001, 1:1.10 ratio). PlanForge's is plant reallocation (move the order from Pune to Vadodara). Each is the correct lever for its domain — you cannot substitute a rotor forging, and you cannot move a chemical blend to another plant mid-batch.
- **Traceability.** ProdPlanner has a deep lot-genealogy and recall module, driven by regulatory need for consumer chemicals. PlanForge has serial-level order tracking but no equivalent recall capability — unsurprising when you ship two turbines, not 10,000 bottles.

## 4.4 How they would fit together

They are complementary, not competing, and could plausibly be sold as one platform with two front ends:

```
            SIGNALS                    DECISION                 EXECUTION
  ┌──────────────────────┐    ┌────────────────────┐    ┌──────────────────┐
  │ Supplier email       │    │  Scenario          │    │ MRP / Planned    │
  │ Carrier API          │───▶│  Simulator         │───▶│ orders           │
  │ Market index (HRC,   │    │        ↓           │    │ Purchase orders  │
  │   Baltic Dry, FX)    │    │  Ranked plans      │    │ Production sched │
  │ WMS / MES / IoT      │    │  (cost, OTIF,      │    │ Bay allocation   │
  │ Customer date change │    │   cash, conf.)     │    │                  │
  └──────────────────────┘    │        ↓           │    └──────────────────┘
                              │  Human commit      │              │
                              └────────────────────┘              │
                                        ▲                         │
                                        └─────────────────────────┘
                                          actuals feed back
```

Both implement this identical pipeline. ProdPlanner instantiates it for materials, PlanForge for orders. A combined product would run the same simulate-compare-commit-audit engine over whichever planning object the customer's business is built on.

---

# PART 5 — Case Study Claims vs What the POCs Actually Deliver

| # | Claimed capability | Where it lives | Verdict |
|---|---|---|---|
| 1 | **ML-Based Demand Forecasting** | PP `/demand-forecast` (per-SKU method selection, demand fence, 8 SKUs), `/forecast-actuals` (MAPE 14.2%, bias +3.1%, per-SKU trends); PF `/demand-forecast` (562 units, 91.2%, capacity overlay) | **Demonstrated.** Method-per-SKU and separate bias reporting go beyond the claim. No model internals are exposed — "ML" is asserted by the method labels, not shown. |
| 2 | **Anomaly Detection** | PP `/disruption-feed` (8 signals, 5 source types), `/stock-alerts` (42, 3 tiers), `/alert-config` (19 rules); PF `/disruptions` (6 tracked, ₹1,460 Cr), Command Center (10 alerts) | **Demonstrated, and the strongest area.** Alerts are tiered, routed, owned and priced. Statistical anomaly *detection* on the demand series itself is less visible than threshold-based alerting. |
| 3 | **Dynamic Reorder & Safety Stock** | PP `/safety-stock` (847 materials, daily consumption + σ + lead time + variability → recommended SS with Gap), `/material-master` (reorder point, lot rule, ABC/XYZ) | **Demonstrated.** Full statistical input set is visible and the recommendation is bulk-appliable. Genuinely "live parameters replacing static rules." |
| 4 | **Automated MRP Generation** | PP `/mrp-run` (312 planned orders in 4m 12s, full-regen + net-change, pegging view), `/material-requirements` (time-phased netting), `/bom-management`, `/capacity-planning` | **Demonstrated, and technically credible.** Pegging, low-level-code sequencing, ECO-controlled date-effective BOMs and separate CRP are real MRP mechanics, not a mock-up. |
| 5 | **Procurement Guidance** | PP `/purchase-planning` ("what to buy, how much, by when" as literal columns + Order By date), `/stock-alerts` (Reorder By), `/vendor-management` (COPQ), `/substitutes` | **Fully demonstrated.** The Reorder By / Order By date is the precise fix for the case study's opening failure. |
| 6 | **End-to-End Planning Visibility** | PP `/` (16 cross-functional KPIs), `/bi-dashboard`, `/integrations` (11 connectors); PF `/` Command Center, `/integrations` (10 systems) | **Fully demonstrated.** Demand signal → inventory → PO status → production → quality → cash, on one dashboard, with the data pipelines that feed it also monitored. |

### On the three claimed outcomes

- **"Zero stockouts through predictive planning."** The POCs do *not* show zero stockouts — ProdPlanner shows 7 critical alerts, 34 materials below safety stock and an EDTA position at 0.6 days of cover against a 5-day lead time. What they demonstrate is the *mechanism* by which stockouts get prevented: tiered detection, a Reorder By date, and a routed alert. Treat "zero stockouts" as the target state the system is built to reach, not a measured result.
- **"Optimized storage costs with just-in-time arrival."** Partially evidenced: ProdPlanner shows 38 days of inventory against a 32-day target, ₹0.62 Cr of dead stock, and specific recommendations to free ₹1.4L of working capital. The gap to target is visible and quantified — which is the honest version of this claim.
- **"End-to-end visibility from demand signal to procurement."** This one is delivered without qualification. It is the most completely realised claim on the slide.

### What the POCs deliver that the case study does not claim

Four significant capabilities appear in the software but not on the slide:

1. **Scenario simulation with costed, ranked, committed mitigation plans** (PP Planning Scenarios; PF Simulate/Compare). This is arguably the most valuable thing in either product and it is entirely absent from the case-study narrative.
2. **Full lot genealogy, recall containment and supplier-quality cost accounting** (PP Traceability — COPQ, SCARs, warranty-claim-to-lot tracing, non-ASL detection).
3. **Working-capital and cash-flow modelling** (PP Cash-Flow Impact — treasury-grade output from a planning decision).
4. **Strategic risk intelligence with known/unknown-unknown separation** (PF Scenario Intelligence).

If these POCs are to be sold off the back of the case study, **the slide is underselling the build.**

---

# PART 6 — Technical Architecture

Both applications are **React single-page applications built with Vite**, served as static bundles with client-side routing.

| | ProdPlanner | PlanForge |
|---|---|---|
| Bundle | `index-CC_xCrW6.js`, 1.25 MB | `index-BF_FsZSm.js`, 1.33 MB |
| Stylesheet | `index-CiNjte3-.css` | `index-BUIVjR1a.css` |
| Fonts | Inter (300–900) + JetBrains Mono (400–600) | identical |
| Routing | React Router, 44 routes + 404 | React Router, 22 routes + 404 |
| Backend | **None detected** — all data seeded in-bundle | **Supabase** (`utpgbkguaododzamunaz.supabase.co`) — auth + tables |
| External refs | none | metals-api.com, balticexchange.com |

**Shared design system.** Identical font stack, identical token vocabulary (`bg-primary`, `bg-accent`, `bg-warning`, `bg-danger`, `text-muted-foreground`), the same status-chip component (`{status: "green"|"amber"|"red"|"gray", label}`), the same KPI-tile and data-table primitives, and the same J2W logo asset (`jouletowatts_logo-Ciku0jzB.png`) byte-for-byte. Charting appears to be Recharts. UI primitives (`DismissableLayer`, `ForwardRef` wrappers) indicate Radix UI, consistent with a shadcn/ui foundation. Tailwind utility classes throughout.

**PlanForge's Supabase layer** carries authentication (`supabase.auth` session/user/state-change handling) and queries these tables: `suppliers`, `supplier_lots`, `supplier_audits`, `supplier_certifications`, `supplier_corrective_actions`, `purchase_orders`, `warranty_claims`. Interestingly, that is a **supplier-quality schema** — the same conceptual model as ProdPlanner's traceability module. This suggests a shared backend design being developed against PlanForge first, with ProdPlanner's equivalent still seeded.

**Analytics:** both carry `/~flock.js` and an `/__l5e/events...js` event-tracking script.

**What this means practically.** ProdPlanner is a **pure front-end prototype** — every number is a literal in the JavaScript bundle. Nothing recalculates. Clicking `Run MRP Now` does not run MRP. PlanForge is **marginally further along**, with real authentication and at least a partial persistence layer, but the bulk of its displayed data is also seeded.

This is entirely appropriate for a POC, and it should be stated plainly in any client conversation. The POCs prove **the interaction model, the information architecture, and the decision workflow** — which is the hard, valuable design work. They do not prove the forecasting engine, the MRP solver, or the optimiser, none of which exist yet.

---

# PART 7 — Honest Assessment

## 7.1 Genuine strengths

1. **Domain depth that is difficult to fake.** Pegging views, low-level-code sequencing, lot-size rules, ABC/XYZ classification, date-effective BOM revisions with ECO linkage, unconstrained-MRP-then-CRP, installed-base forecasting for spares, non-ASL lot detection, COPQ, SCARs, margin-per-bottleneck-hour. Someone with real supply-chain expertise specified this.

2. **Explainable AI done properly.** The Planner's Workbench pattern — confidence score + plain-English rationale + weighted contributing signals + accept/override — is better than most shipping commercial products. Publishing *low*-confidence recommendations rather than suppressing them is a deliberate trust-building choice.

3. **Internally coherent demo data.** The LOT-2026-0189 storyline threads through six screens (supplier defect rate → SCAR → warranty claims → field-return cluster → containment → vendor scorecard). Pune Bay 3 threads through four. Fragrance FG-04 is simultaneously the worst-forecast SKU and the most urgent stockout. This coherence is what makes a demo convincing, and it is rare.

4. **India-realistic context.** GSTIN/PAN/CIN, Tally Prime, GSTN e-invoicing, IndiaMART, real vendor names (Galaxy Surfactants, Aarti Industries, Mold-Tek, Bharat Forge), real customers (NTPC, Adani, Reliance Retail, DMart), rupee-denominated with correct lakh/crore conventions throughout.

5. **The willingness to show failure.** Two broken integrations with authentic error semantics. Inventory health at 74 against an 80 target. A reverted plan revision. Degrading forecast accuracy on two SKUs. A supplier with negative savings. An admitted-meaningless probability estimate. This is far more persuasive than a demo where everything is green.

6. **Escalation grammar.** Severity driving channel, audience *and* cadence (19 alert rules) is the operational detail that determines whether an alerting system gets used or ignored.

## 7.2 Gaps and weaknesses

1. **No working engine.** The most important caveat. ProdPlanner has no backend at all; PlanForge has partial persistence. The forecasting model, MRP solver, and mix optimiser are all asserted, not implemented. A client asking "can I run this on my data?" gets a no today.

2. **"ML" is a label, not a demonstration.** The method names (exponential smoothing, moving average, seasonal) are classical statistical forecasting, not machine learning. That is a perfectly good choice — classical methods often beat ML on sparse SKU-level demand — but the case study says "ML-based" and the POC shows statistical. Worth aligning the language before a technical buyer notices.

3. **Thin pages.** `/demand-changes` in PlanForge is a bare log table with no analytics. `/priority-matrix` has the axes and quadrants but no populated row detail. `/bi-dashboard` in ProdPlanner has chart frames with some series unlabelled.

4. **Single-persona demo in PlanForge.** ProdPlanner models 12 users across 4 roles with differentiated permissions; PlanForge has one planner. For a product whose output is consumed by sales, finance and plant management, role-differentiated views are missing.

5. **No mobile or shop-floor view.** Everything is a desktop planner's screen. The Missing Scan Exceptions and Schedule Updates data clearly originates on the shop floor, but there is no interface for the person generating it.

6. **No model-governance surface.** Nothing shows how a forecast model is trained, retrained, validated or rolled back — no drift detection, no champion/challenger, no feature view. For a product leading with "ML-based," that is the first question a mature buyer will ask, and `/forecast-actuals` (which reports *degrading* accuracy on two SKUs) is exactly where a "retrain" action belongs.

7. **Unquantified outcome claims.** The three case-study outcomes have no baseline comparison. This is fine for a POC but will not survive procurement diligence.

## 7.3 Recommendations

**To strengthen the case study:**
- Add the scenario-simulation capability to the slide — the ₹3.8L-to-protect-₹38.0L plan comparison is the most compelling single artefact across both builds, and it is currently invisible in the narrative.
- Either substantiate "ML-based" or soften it to "statistical and ML forecasting."
- Replace one qualitative outcome with a quantified before/after as soon as a baseline exists.

**To strengthen the POCs:**
- Wire one vertical slice end to end on real data — ideally demand forecast → safety stock → MRP → purchase recommendation for a handful of SKUs. One working slice beats forty mocked screens in a buyer conversation.
- Add a model-governance page to ProdPlanner: training window, features used, last retrain, drift indicator, and a retrain action on `/forecast-actuals`.
- Finish `/demand-changes` and `/priority-matrix` in PlanForge, or remove them from the demo path.
- Add role-based views to PlanForge, mirroring ProdPlanner's four-role model.
- Make the demo script explicit about which storyline to walk. The LOT-2026-0189 trace (ProdPlanner) and the Bharat Forge → Pune Bay 3 → ₹328 Cr cascade (PlanForge) are the two strongest narratives in the builds and should be the spine of any demonstration.

## 7.4 The bottom line

These are two unusually well-specified POCs. The information architecture, decision workflow and domain modelling are the hard parts of this problem, and both are solved to a standard above typical prototype quality — the explainable-recommendation pattern and the costed plan-comparison table in particular are production-grade thinking.

What exists is **a complete and credible design for a demand-driven planning system, rendered as two working front ends with seeded data**. What does not exist is the engine underneath. That is the right order to build in, and the honest framing for a client: *this is exactly what the system will look like and how a planner will use it; the next phase builds the maths behind it.*

---

# Appendix A — Complete Route Index

## ProdPlanner — 44 routes

| # | Route | Page |
|---|---|---|
| 1 | `/` | Dashboard — Planning Overview |
| 2 | `/login` | Login |
| 3 | `/mrp-run` | MRP Run & Results |
| 4 | `/material-master` | Material Master & Planning Parameters |
| 5 | `/material-requirements` | Material Requirements |
| 6 | `/bom-management` | BOM Management |
| 7 | `/safety-stock` | Safety Stock |
| 8 | `/substitutes` | Substitutes & Alternate Materials |
| 9 | `/capacity-planning` | Capacity Planning |
| 10 | `/spare-parts` | Spare Parts Planning |
| 11 | `/planners-workbench` | Planner's Workbench |
| 12 | `/stock-alerts` | Stock Exhaustion Alerts |
| 13 | `/scenario-simulator` | Scenario Simulator |
| 14 | `/plan-comparison` | Plan Comparison & Commit |
| 15 | `/plan-revisions` | Plan Revisions |
| 16 | `/cash-flow-impact` | Cash-Flow & Working-Capital Impact |
| 17 | `/production-mix` | Production Mix Optimizer |
| 18 | `/disruption-feed` | Disruption Signal Feed |
| 19 | `/production-schedule` | Production Schedule |
| 20 | `/work-orders` | Work Orders |
| 21 | `/production-constraints` | Production Constraints |
| 22 | `/schedule-updates` | Schedule Updates |
| 23 | `/stock-overview` | Stock Overview |
| 24 | `/multi-location` | Multi-Location Inventory |
| 25 | `/batch-tracking` | Batch & Serial Tracking |
| 26 | `/inventory-health` | Inventory Health Scoring |
| 27 | `/purchase-planning` | Purchase Planning |
| 28 | `/purchase-orders` | Purchase Orders |
| 29 | `/vendor-management` | Vendor Management |
| 30 | `/procurement-analytics` | Procurement Cycle Analytics |
| 31 | `/demand-forecast` | Demand Forecast |
| 32 | `/atp` | Available-to-Promise |
| 33 | `/forecast-actuals` | Forecast vs. Actuals |
| 34 | `/sales-orders` | Sales Order Intake |
| 35 | `/traceability` | BOM Traceability |
| 36 | `/bi-dashboard` | BI Dashboard |
| 37 | `/material-coverage` | Material Coverage Monitor |
| 38 | `/procurement-reports` | Procurement Reports |
| 39 | `/mrp-efficiency` | MRP Efficiency Analytics |
| 40 | `/custom-reports` | Custom Reports |
| 41 | `/company-settings` | Company & Warehouses |
| 42 | `/users-roles` | Users & Roles |
| 43 | `/integrations` | Integration Hub |
| 44 | `/alert-config` | Alert Configuration |

## PlanForge AI — 22 routes

| # | Route | Page |
|---|---|---|
| 1 | `/` | Command Center |
| 2 | `/login` | Login |
| 3 | `/orders` | Active Orders |
| 4 | `/orders/:orderId` | Order Detail (demo: `/orders/PF-2025-0012`) |
| 5 | `/priority-matrix` | Order Priority Matrix |
| 6 | `/simulate` | Scenario Simulator |
| 7 | `/scenario-intelligence` | Scenario Intelligence |
| 8 | `/plan-comparison` | Plan Comparison |
| 9 | `/production-plan` | Production Plan |
| 10 | `/allocation` | Multi-Plant Allocation |
| 11 | `/pull-in-push-out` | Pull-In / Push-Out Impact |
| 12 | `/factory/pune` | Factory Operations — Pune |
| 13 | `/factory/vadodara` | Factory Operations — Vadodara |
| 14 | `/materials` | Material Availability |
| 15 | `/suppliers` | Supplier Performance |
| 16 | `/disruptions` | Disruption Tracker |
| 17 | `/demand-forecast` | Demand Forecast |
| 18 | `/demand-changes` | Demand Change Log |
| 19 | `/integrations` | System Integrations |
| 20 | `/settings` | Settings |
| 21–22 | `*` | 404 / catch-all |

---

# Appendix B — Suggested Demo Scripts

## ProdPlanner — "the stockout that shouldn't have happened" (8 minutes)

1. **`/`** — open on the dashboard. 14 materials at risk, Inventory Health 74/100, Fragrance FG-04 at 3.7 days.
2. **`/forecast-actuals`** — show *why*: FG-04 runs 22.8% MAPE and is **degrading**. The forecast failed first.
3. **`/stock-alerts`** — show the consequence and the fix: EDTA at **0.6 days cover against a 5-day lead time**. Point at the **Reorder By** column — the date the PO should have gone out.
4. **`/planners-workbench`** — the machine has already triaged it. 15 exceptions, ranked, each with a confidence score, a rationale and the signals behind it.
5. **`/scenario-simulator` → `/plan-comparison`** — the close. **₹3.8L spent to protect ₹38.0L, OTIF 81.5% → 93.8%, AI confidence 88%.** Commit it.
6. **`/plan-revisions`** — and the decision is now on the record, with its reason and its author.

## PlanForge — "the ₹328 Cr bay conflict" (8 minutes)

1. **`/`** — Command Center. ALT-001 (Bharat Forge, 14-day delay, ₹87 Cr) and ALT-007 (Pune Bay 3 over 95%, ₹328 Cr).
2. **`/orders/PF-2025-0012`** — NTPC's ₹164 Cr turbine. **Delivery confidence 78%**, rotor forging 1 short, Bay 3 at 92%.
3. **`/factory/pune`** — the root cause: **5 GT-9500 orders stacked in Bay 3**, 7 of 19 orders at risk. Vadodara sits at 68%.
4. **`/simulate`** — model it: Bharat Forge delay, 2 weeks, cascading across all 1,183 orders.
5. **`/plan-comparison`** — Scenario A costs ₹18L and 120 overtime hours; Scenario B costs ₹42L and 240. Pick A.
6. **`/scenario-intelligence`** — the strategic frame: ₹492 Cr of Gulf exposure at 35%, steel passthrough at 90% — and an honest "this 12% number is meaningless" on the export-control black swan.
