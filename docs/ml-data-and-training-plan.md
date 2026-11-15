# BoreSakshi: data and model training plan

Research date: 1 November 2026. Pilot area: Namakkal / Tiruchengode, crystalline hard rock.

## Summary

- **Labels limit this project, not algorithms.** Public maps of terrain, rainfall and geology are plentiful. Public records of dry borewells barely exist, and the model can't learn failure without them.
- **Rig operator records are the most valuable dataset.** Collecting 500 to 1,000 records with real dry holes matters more than any other step here.
- **Public data is still useful**, as a head start and for extra features. It must never be merged into the training labels as if it were the same kind of data.
- **"Accuracy" is the wrong target.** In the public data, 86.6% of wells meet a 1 unit/second yield, so a model that always says "water" scores about 85%. Measure dry-hole detection and calibration instead.

## 1. What the best public dataset can do

The most useful find is a public ArcGIS layer of CGWB-coded wells. I downloaded it and tested it. The 125 readings inside the pilot box were deleted at the owner's request, and every figure in this section is calculated without them.

| Measure | Result |
|---|---|
| Wells in India | 8,052 |
| Wells in Tamil Nadu | 1,502 (discharge recorded for 54.2%) |
| Crystalline-rock wells in India | 2,864 (Tamil Nadu 993, Karnataka 538, Telangana 421, Kerala 330) |
| Years covered in Tamil Nadu | 1981 to 2018 |
| Tamil Nadu depth to bedrock | Median 10.2 m |

Tamil Nadu discharge has a median of 5.22. The layer doesn't state the unit. If it is litres per second, as is usual for CGWB, that is about 313 LPM.

### Problems found

1. **There are almost no dry wells.** Only 9 Tamil Nadu rows say "nil" or "dry". Blank discharge can't be read as dry: blanks are about equally common across well types, and they vary by decade instead (61% blank in the 1990s, 38% in the 2010s). They look like untested wells.
2. **A false signal appears through drilling year.**
   - The spatially blocked test on Tamil Nadu crystalline wells gave R² 0.37 and AUC 0.78 using lithology and year.
   - Lithology alone gave **R² -0.06 and AUC 0.468, which is no better than chance**.
   - Median discharge jumps from 1.5 in the 2000s to 9.5 in the 2010s.
   - The likely causes are a units change or a different drilling programme. I couldn't confirm either.
   - Drilling year must never be a feature, and the jump must be explained before these yields are used.
3. **Wells at the same site can leak answers.** A quarter of wells have a neighbour at the same coordinates (nearest distance 0 km), which suggests exploratory and observation wells at one site. Splitting them across train and test leaks the answer, so they must be grouped by site.
4. **Some fields are unreliable.** 380 of 1,037 crystalline rows have water level 0 and 29 have water level equal to drilled depth, so these look like placeholders. Other fields, such as tapped zones (1.5% filled in Tamil Nadu), are too sparse to use. Discharge, drawdown and water level are measured after drilling, so they can't be model inputs.
5. **Site selection is biased.** Government wells are sited by hydrogeologists, not by farmers, so these sites aren't representative.
6. **The licence is unknown.** The layer states no copyright or owner, and I didn't verify who maintains it.

### How far apart wells can inform each other

| Distance between wells | Correlation of log yield |
|---|---|
| 0–2 km | 0.43 (123 pairs, likely inflated by same-site wells) |
| 2–20 km | About 0.21 |
| 20–50 km | 0.12 |
| Over 50 km | About 0.05 |

Three things follow:
- Nearby wells help, but only modestly beyond 2 km. A pin can't be judged from neighbours alone, which fits fracture-controlled rock.
- `spatialBlockDeg: 0.1` (about 11 km) is too small. Correlation only fades near 50 km, so report results with blocks of about 0.5° (55 km).
- The pilot box holds only about six 0.5° blocks, so the model must be evaluated across Tamil Nadu hard rock, not just inside the box.

Scores fell as blocks grew: R² 0.43 for random splits, then 0.37, 0.38, 0.27 and 0.21 for 0.1° to 1° blocks. Those absolute numbers include the year problem, so read only the trend.

## 2. Dataset catalogue

"Checked" means I confirmed it during this research. "Unverified" means details come from general knowledge or a source I couldn't open.

### A. Labels: drilling outcomes

| Priority | Dataset | Gives | Access | Status |
|---|---|---|---|---|
| 1 | **Pilot rig operators** (app logs and old diaries) | Success, dry holes, strike depth, yield, rock layers | Partnerships | Must be collected |
| 2 | **Village borewell surveys** with failures and seasonal drying | Local failure history | Field work | Must be collected |
| 3 | **Public CGWB litholog layer** | Yield, depth, bedrock, lithology | Open service | Checked; licence unknown |
| 4 | **CGWB Well Lithology portal** | Lithology by depth, by well | `gwdata.cgwb.gov.in` | Listing seen, but page was in maintenance |
| 5 | **TWAD Board, state WRD, Jal Jeevan Mission sources** | Government bore outcomes | No public data found | Needs a formal request or RTI |
| 6 | **Farm electricity connection records (TNPDCL)** | Locations of working wells | No public data found | Needs a formal request |
| 7 | **CGWB district and firka reports** | Local context | PDFs | One read: useful context, no well table |

### B. Groundwater state

| Dataset | Gives | Status |
|---|---|---|
| Quality-controlled CGWB levels, 2,759 wells, 2000–2022, with specific yield | Depth to water, seasonal change | Checked; Figshare; Tamil Nadu count not verified |
| India-WRIS groundwater levels | About 23,000 wells, four readings a year | Checked; CSV; downloads may need an Indian IP |
| Tamil Nadu dynamic groundwater report 2024 | Firka stage of extraction: 392 of 1,202 over-exploited | Checked; must be extracted from PDF |
| CGWB Tamil Nadu year books | Regional context | Checked |
| Fan et al. water table depth | Modelled depth, global | Checked; low priority because local readings are better |

### C. Geology and fractures

These matter most for hard rock.

| Dataset | Gives | Status |
|---|---|---|
| GSI Bhukosh geological maps | Rock units, structures | Checked; registration, delivered by email; lineament file not confirmed |
| NRSC Bhuvan groundwater prospects (1:50,000) | Hydrogeomorphology, structure, prospects | Checked as view service; bulk download not confirmed |
| CoRE Stack aquifers, lithology, lineaments | National layers, CC BY 4.0 | Checked; resolution and format not stated |
| SoilGrids depth to bedrock (250 m) | Modelled weathered thickness | Checked; licence listed inconsistently |
| GLHYMPS 2.0 | Global permeability | Checked; too coarse to rank highly |

### D. Terrain, climate and surface

| Dataset | Gives | Status |
|---|---|---|
| Copernicus GLO-30 DEM | Elevation, slope, TWI, drainage | Checked. Free with attribution. It is a surface model. View service restricted from 28 July 2026, so confirm bulk access |
| IMD gridded rainfall (0.25°) | Rainfall history, the reference for India | Checked for existence; find the current download page |
| CHIRPS | Finer rainfall, ranked among the best against IMD | Checked |
| Sentinel-2 | Dry-season NDVI, NDWI | Unverified; standard open product |
| Sentinel-1 SAR | Moisture and coherence; coherence ranked highly in Chad | Unverified for access |
| ESA WorldCover, Dynamic World | Land cover | Dynamic World checked as open; WorldCover licence unverified |
| HydroSHEDS, MERIT Hydro | Drainage networks | Licence conflicting or non-commercial; generate drainage from the DEM instead |

Not worth using: GRACE satellite groundwater, which is far too coarse for a pin (general knowledge), and offshore or petroleum lithology datasets.

### E. Field geophysics (later)

Resistivity surveys can sharpen predictions at shortlisted sites. A study of 24 soundings in Indian granite linked yield to overlying resistivity and aquifer thickness, while another warns that aquifer depth is hard to pin down from soundings in granite. I found no open dataset, so collect this only for the final shortlist.

## 3. What to collect from rig operators

**Target: at least 500 records, ideally 1,000, with at least 100 dry holes, across at least 15 taluks.** These are judgement-based targets, not proven limits. For scale, the Chad study used 488 points.

Add these fields to the log form:

| Field | Why |
|---|---|
| Every water strike, with depth and estimated flow | Enables the depth curve in section 5 |
| Final depth reached, and why drilling stopped | Tells "dry at 800 ft" from "stopped at 300 ft" |
| Measured or estimated yield, and how it was measured | Lets the model weigh quality |
| Depth to hard rock | Main hard-rock predictor, currently only in free text |
| How the site was chosen (diviner, survey, neighbour) | Measures selection bias, and BoreSakshi's real value |
| Yield after one summer | "Success" that dries by May is a failure for the farmer |

Keep a confidence grade per record: G1 app with photo and GPS, G2 old record with location confirmed, G3 memory. Paying per record, with a bonus for verified dry holes, would counter the tendency to report only successes.

## 4. Define success first

The current `success` flag is whatever the operator chose. Fix a definition with a hydrogeologist before training, for example: **at least 60 LPM measured at drilling, and still yielding after the next summer.** Keep the raw yield, so that the threshold can change.

## 5. Training plan

The model should answer more than "water or not". The most useful output for a farmer is **the chance of hitting usable water by each depth**, for example 25% by 300 ft, 45% by 500 ft, 50% by 800 ft. The curve flattening tells them when to stop paying for drilling. Dry holes count correctly here as "no water down to this depth" (discrete-time survival).

### Step 0: fix the foundations

- Keep CGWB data in a separate training table. **Don't publish it to `borewells`**: it would appear on the public map, count as verified evidence, and need a `success` value it doesn't have.
- Build a source-aware dataset with unit checks, site IDs and a grade per record.
- Remove anything known only after drilling: `static_wl`, `draw_down`, discharge, `year_drill`. Note `spatialBlockDeg` needs raising, and the `min_rows: 30` gate is far too low.
- Add GeoTIFF handling. Exporting every layer to ASCII grids won't scale to 10 m data.

### Step 1: add features one group at a time

| Group | New features |
|---|---|
| Terrain | TWI, HAND, topographic position, valley position |
| Fracture | Lineament density at several radii, distance to intersections, dykes and shear zones, fracture orientation |
| Weathering | Depth to bedrock, geomorphology class, soil texture |
| Water state | Depth to water at drilling time, seasonal rise, firka stage of extraction |
| Recharge | Distance to tanks and canals, upstream area, rainfall trend |
| Surface | Dry-season NDVI, SAR coherence |
| Neighbours | Distance-weighted success, nearest dry well, wells within 2 km |

**Each group must earn its place.** Keep it only if Brier score improves under spatial validation, with an uncertainty interval that excludes no change.

### Step 2: use public wells as a head start, not as labels

1. Train **helper models** on the crystalline CGWB wells, predicting log yield and depth to bedrock. These include Karnataka, Telangana and Kerala, after the year problem is resolved.
2. Generate those predictions out-of-fold and feed them to the main model as features.
3. Train the **main model** on rig records with both successes and failures.
4. **Calibrate on rig records only**, because CGWB data has a different success rate.

This gets value from many datasets without teaching the model that nearly every well succeeds.

### Step 3: models

Use small, regularised models first. Data is scarce and noisy.

1. Baseline: nearby-well success rate. A model that can't beat this has no value.
2. Regularised logistic regression with a taluk-level effect.
3. LightGBM or XGBoost with shallow trees, monotonic limits where the physics is clear, and sample weights by grade.
4. Stacked ensemble only if it clearly beats the above.

Skip deep learning until there are thousands of labelled wells. Yield and depth use log targets with quantile models, and `conformal` intervals stay as they are.

### Step 4: evaluation

| Rule | Detail |
|---|---|
| Spatial test | About 0.5° blocks, or leave-one-taluk-out, keeping same-site wells together |
| Time test | Train on older wells, test on the newest 20% |
| Headline metrics | Brier score, calibration error, dry-hole recall and precision, PR-AUC for the dry class |
| Must beat | The local base rate and the nearby-well baseline |
| Reporting | Confidence intervals for every metric, and results by taluk |
| Tuning | Nested inside training folds, including feature selection |

Published scores can't be compared with ours. Chad's AUC above 0.87 appears to come from a 70/30 split, and I couldn't confirm how it handled spatial dependence.

### Step 5: release gates

Suggested minimums before farmers see a number. A hydrogeologist should agree these:

- At least 300 graded records with at least 60 dry holes, across at least 15 taluks.
- Beats both baselines on Brier score, with the interval excluding no change.
- Calibration error at or below 0.05 in spatial tests.
- Refuses to answer when a location is unlike the training data.
- Sense-checked by a hydrogeologist on a map.

Then run a **silent pilot**: predictions are stored but not shown, and compared with real drilling for one season. Only then show them. Retrain on a set schedule through the existing human approval path, watching for feedback bias, since farmers will start drilling where the model says yes.

## 6. Roadmap

| Stage | Work | Output |
|---|---|---|
| 1. Data audit | Resolve the 2010s jump with CGWB, confirm licences, download the Bhukosh, Bhuvan and IMD layers | Verified inventory |
| 2. Collection | Sign up rigs, extend the log form, digitise diaries, submit data requests | 300+ records |
| 3. Feature build | Pipeline upgrade, feature groups, CGWB training table | Feature set v2 |
| 4. First models | Baselines, helper models, stacked model, one-group-at-a-time tests | Honest scorecard |
| 5. Silent pilot | One season of hidden predictions | Real-world score |
| 6. Release | Gates passed, approval, then farmer-facing estimates | Model live |

## 7. Limits of this research

- **Not exhaustive:** TWAD, TNPDCL, VEDAS, Atal Jal and data.gov.in searches found nothing usable, which doesn't prove nothing exists.
- **Couldn't open:** the CGWB lithology portal (maintenance), the National Water Mission Namakkal notes (connection refused), and the Tamil Nadu borehole ML study (blocked).
- **No environmental test yet:** my experiments used only well records, so they say nothing about how much DEM, fracture or rainfall layers will add.
- **Achievable accuracy is unknown:** fracture-controlled yield may be partly unpredictable from the surface, and only the real data will show how far this can go.

## 8. Progress: 1 November 2026

### Done

- **Pilot-box readings deleted.** All 125 were removed from the local data at the owner's request. The download script drops them, and the pipeline fails if any reach training. The training table was unchanged by the deletion.
- **Training table built.** 2,823 crystalline wells at 2,180 sites in 218 blocks, kept outside `borewells`. 1,818 have a usable yield and 1,608 a usable bedrock depth.
- **Features extracted for every site** (`ml/public_data/`): Copernicus DEM terrain, a DEM-derived lineament proxy, SoilGrids, CGWB water levels, CHIRPS v3 and ESA WorldCover. Sentinel-1 and Sentinel-2 aren't done.
- **Log form extended:** water strikes, stop reason, yield method, how the site was chosen, depth to hard rock, and summer follow-ups. Yield-after-summer is a report added later to the log.
- **Silent pilot added:** `ML_SILENT_PILOT=YES`.
- **Gates raised:** 300 rows, 60 dry holes, and 0.5° blocks by default.

### Helper model results

Yield is measured relative to the well's own state and decade. All scores hold out 0.5° blocks, repeated five times.

| Test | Relative yield | Depth to bedrock |
|---|---|---|
| All map layers, regional hold-out (R²) | -0.005 | 0.057 (interval includes zero) |
| Shuffled targets (R²) | -0.038 | -0.018 |
| Train elsewhere, test Tamil Nadu (R²) | -0.043 | 0.024 |
| Feature groups that earned their place | 0 of 9 | 0 of 9 |
| Hold out sites, not regions: nearby wells only (R²) | 0.05 | 0.14 |
| Hold out sites: map layers only (R²) | 0.01 | 0.10 |
| Hold out sites: both (R²) | 0.04 | 0.16 |

**No helper model passed, so none was saved or fed forward.**

The result isn't a pipeline fault. The same code recovered planted signals that could explain 12% and 25% of variance (R² 0.08 and 0.19). It missed one that could explain 4%, so effects that small can't be ruled out.

What this does and doesn't mean:
- **Open map layers don't rank wells by relative yield in this data.** This fits fracture-controlled rock, but the public yields are noisy, so it isn't proof that the layers are useless.
- **Local evidence is the strongest signal found**, which supports collecting dense local records. It remains weak at R² 0.05 for yield.
- **The fracture group is only a DEM proxy.** Real GSI structures may do better and are the most important layer still to test.
- **Published scores may reflect weaker validation.** That can't be concluded from this data alone.

In Tamil Nadu, 4 of 35 features had a correlation interval excluding zero, led by elevation at 0.21. About 2 would be expected by chance.

### Changes to the plan

- Step 2 is on hold: no helper feeds the main model until one passes.
- Don't expect map layers alone to deliver accuracy. Prioritise local records.

### Blocked on people or accounts

| Item | Needs |
|---|---|
| Rig records with dry holes | Operator partnerships. No main model can be trained without these |
| Success definition and release gates | A hydrogeologist |
| The 2010s yield jump, and the layer's owner and licence | CGWB |
| GSI structures and NRSC layers | A Bhukosh account and Bhuvan access |
| TWAD and TNPDCL records | Formal requests |

## 9. Groundwater model: 1 November 2026

At the owner's direction, dry-hole labels wait for field visits. This model learns from measured groundwater levels instead, and field records are added later.

### What it is

- **Predicts:** depth to water before and after the monsoon, seasonal rise, and the chance that water is within 10 m before the monsoon.
- **Trained on:** 9,573 CGWB stations in peninsular India, using readings since 2015, plus 15,241 stations of longer history and 10,352 dug-well depths as local evidence.
- **Inputs:** GSI 1:2M geology and faults, Copernicus terrain, SoilGrids, CHIRPS rainfall, MODIS satellite, JRC surface water, ESA land cover.
- **Algorithm:** LightGBM on this PC's CPU.

### Results on data held out from training

| Test | Before monsoon, typical error | After monsoon, typical error |
|---|---|---|
| Stations held out, nearby stations available | 2.32 m | 1.87 m |
| Nearby-average baseline | 2.64 m | 2.14 m |
| Whole regions held out | 2.50 m | 2.06 m |
| Stations first read from 2016 | 2.49 m | 1.71 m |
| Hard-rock stations | 2.10 m | 1.85 m |
| Pilot area (142 stations) | 2.94 m | 2.96 m |

R² on the log scale is 0.37. A station's own history reaches only 0.75 (typical error 1.21 m), so that is roughly the ceiling for this data.

Water within 10 m before the monsoon, stations held out:

| Measure | Result |
|---|---|
| Accuracy | 84.6%, against 83.1% for always saying yes |
| Precision for "within 10 m" | 85.3% |
| Recall for "within 10 m" | 98.4% |
| ROC AUC | 0.81 |
| Calibration error | 0.004 |
| Deep-water warning (chance below 70%) | Flags 20% of stations, catches 51% of deep ones, right 44% of the time |

Map data does help here, unlike with yield. The gain over nearby stations is real, and 80% prediction ranges covered 79% of held-out stations. Six model settings and two forest models all landed near 2.37 m, so the limit is the data, not the algorithm.

### Limits

- **It describes the shallow water table.** Most stations are dug wells. It says nothing about the fractures a 200 m borewell depends on.
- **It can't say "no water".** Wells that go dry stop giving readings, so dry conditions are under-represented and a good map value doesn't promise a good well.
- **Yield is still unpredictable.** With GSI geology, satellite data and this model added, relative yield scored R² -0.005, and none of the 13 feature groups earned a place.
- **GSI faults are coarse.** The 1:2M layer has 227 faults across the region. The 1:50,000 Bhukosh maps remain untested.
- **Terms to confirm:** the GSI service is marked free viewing, and the litholog layer's owner and licence are unknown. Neither should be redistributed until confirmed.

### What exists

| Item | Location |
|---|---|
| Training and map code | `ml/public_data/` |
| Trained model | `ml/data_public/gw_model/groundwater_model.joblib` (git-ignored) |
| Pilot map, 8,436 points about 1 km apart | `ml/data_public/gw_pilot_map.csv` (git-ignored) |
| Query a location | `python gw_map.py at LAT LNG` |

The app does not use this model yet. Its output is groundwater context, not a borewell success prediction, so the farmer screen needs its own wording first.

### Adding field data

1. Record each visit in `ml/public_data/field_records_template.csv`, with `outcome` as `water` or `dry`.
2. Run `python retrain_with_field_data.py your_file.csv`.
3. The script joins each record to the groundwater map, trains an outcome model and tests it on held-out areas.
4. It saves a model only with 300 records, 60 dry holes and 15 areas, and only if it beats the base rate and nearby wells with calibration error at or below 0.05.

Tested on simulated records only. It saved a model with 450 simulated records and refused with 40.

Any model it saves should run as a silent pilot, with hydrogeologist review, before farmers see it. The script covers the pilot map area only.

## Sources

- [Figshare groundwater levels, version 4](https://doi.org/10.6084/m9.figshare.29293877.v3)
- [GSI 1:2M geology via OneGeology](https://hosted-metadata.bgs.ac.uk/geonetwork/srv/api/records/40db762192166d2ad26886e5a0467f64d61ff3d9)
- [Microsoft Planetary Computer (MODIS)](https://planetarycomputer.microsoft.com/api/stac/v1)
- [Macrostrat](https://macrostrat.org/api/v2/geologic_units/map?lat=11.36&lng=77.8&format=json) (checked; too coarse to use here)
- [Public CGWB litholog layer](https://livingatlas.esri.in/server/rest/services/India/Lithilog/MapServer/layers)
- [CGWB Well Lithology portal](https://gwdata.cgwb.gov.in/well-lithology-public)
- [Quality-controlled groundwater levels (Scientific Data)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12489037/) and [Figshare record](https://doi.org/10.6084/m9.figshare.29293877.v3)
- [India Data Portal: CGWB groundwater levels](https://ckandev.indiadataportal.com/dataset/groundwater/resource/580a8f6e-3d86-4ca7-ac7d-cd5df12b443c)
- [WRIS QGIS downloader](https://plugins.qgis.org/plugins/wris_extractor/json)
- [Dynamic groundwater resources of Tamil Nadu 2024](https://cgwb.gov.in/cgwbpnm/public/uploads/documents/17482438881618904436file.pdf)
- [CGWB Tamil Nadu firka reports](https://cgwb.gov.in/node/903)
- [Tamil Nadu year book 2023-24](https://gwdata.cgwb.gov.in/download/Yearbook/Tamilnadu%20&%20Puducherry_GWYB%202023-24.pdf)
- [Bhukosh description](https://community.data.gov.in/?p=102549)
- [NRSC groundwater prospects](https://www.nrsc.gov.in/readmore_geosci_grdwaterprospectmap) and [Bhuvan GWIS](https://bhuvan-app1.nrsc.gov.in/gwis/)
- [CoRE Stack layers](https://aikosh.indiaai.gov.in/home/datasets/details/geological_and_hydrogeological_layers.html)
- [SoilGrids depth to bedrock](https://data.isric.org/geonetwork/srv/api/records/f36117ea-9be5-4afd-bb7d-7a3e77bf392a)
- [GLHYMPS](https://dspace.library.uvic.ca/items/13157b31-0236-41dd-8eb4-1c2aa0851dcf)
- [Fan water table depth](https://aquaknow.jrc.ec.europa.eu/node/18916)
- [Copernicus DEM licence](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf), [Earth Engine catalogue](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1) and [view service notice](https://dataspace.copernicus.eu/node/4044)
- [IMD gridded rainfall](https://mausamjournal.imd.gov.in/index.php/MAUSAM/article/view/851) and [rainfall product comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC11589684)
- [Eastern Chad ensemble study](https://docta.ucm.es/entities/publication/82919eec-d775-452b-bb23-e5192f54956f)
- [Southern Mali yield study](https://docta.ucm.es/entities/publication/650c6441-91e4-46a8-bc1a-5c491ceeefdc/full)
- [Tamil Nadu borehole ML study](https://www.researchgate.net/publication/385954654_Predictive_modeling_for_water_borehole_drilling_using_machine_learning_techniques)
- [Borewell memory concept paper](https://zenodo.org/records/20466172)
- [Spatial validation strategies](https://arxiv.org/pdf/2303.07334), [cross-validation strategies dataset](https://datadryad.org/dataset/doi:10.5061/dryad.737gk) and [spatial autocorrelation inflation](https://rsc4earth.de/publication/kattenborn-spatially-2022/)
- [Hard-rock fracture mapping by AEM](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6344478/)
- [Maheshwaram weathering structure](https://hal-brgm.archives-ouvertes.fr/hal-03752084), [resistivity and granite aquifers](https://doi.org/10.1155/2014/585204) and [soundings and yield](https://www.meetings.copernicus.org/www.cosis.net/abstracts/EGU2007/00810/EGU2007-J-00810.pdf)
- [HydroSHEDS catalogue entry](https://dataportal.ponderful.eu/dataset/wwf-hydrosheds) (its terms conflict between catalogues)
