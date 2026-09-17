# CORES report glossary

Agreed names for the parts of the CORES reports and the rendered Daily Report, so layout requests are
unambiguous. Three columns per entry: **your name** (from the annotate list) → **parser field** (the JSON key
written by `cores_parse.py`) → **source** (the CORES label or element it comes from).

Reports handled: `Anesthesia Report` (report_id 281, nine columns) and `I-PASS Detailed` (report_id 8, six
columns). Fields marked *Anes only* / *I-PASS only* exist in one layout.

## Page header
| Your name | Parser field | Source |
|---|---|---|
| Source Report Format | `header.report_format` | first header cell, e.g. `UAB Core Work Mgr Anesthesia Report` |
| Current Service / Current Team | `header.service`, `header.team` | `MICU / Gold` |
| Report Date | `header.report_date` | `print_date` field, e.g. `09/15/26 19:57` |
| Printed By | `header.printed_by` (+ `printed_by_id`) | `name` / `username` fields |

## Location (Bed column in Anesthesia; LOC line in I-PASS)
| Your name | Parser field | Source |
|---|---|---|
| Unit | `unit` | `MCCU` |
| Room | `room` | `P320` |
| Bed | `bed` | `01` |
| Location | `location` | the three joined: `MCCU P320-01` (`UED` alone for ED boarders) |
| Code Status | `code_status` | `Full Code` line under the bed (Anes); `Code:` line (I-PASS, usually blank) |
| Isolation | `isolation` | `Isolation 09/08/26 12:14:09 CDT, Enhanced Contact Precautions` (Anes only) |
| COVID | `covid` | `COVID:` line when present (Anes only) |
| Severity | `severity` | Watcher / Stable / Unstable (I-PASS only) |

## Patient column
| Your name | Parser field | Source |
|---|---|---|
| Patient Name | `patient_name` | bold name |
| MRN | `mrn` | `MRN:` |
| Date of Birth | `dob` | `DOB:` first value |
| Age | `age` | `41y` |
| Sex | `sex` | `M` / `F` |
| Length of Stay (days) | `los_days` | `LOS:` |
| Admit line (computed) | rendered only | report date minus LOS; the source has no admit date (the `demo_admit_day` field is commented out in the template) |
| Admit Attending | `admit_attending` | `ADT Att:` (Anes only) |
| Admit Service | `admit_service` | `ADT Srvc:` (Anes only) |
| Allergies | `allergies` | `Allergy:` |
| Contact | `contact` | `Contact:` (Anes only) |

## Summary column
| Your name | Parser field | Source |
|---|---|---|
| Admit Diagnosis | `admit_diagnosis` | section `Dx`, e.g. `ADMIT: (RPS857) UNRESPONSIVE` (Anes only) |
| Patient Summary | `summary.narrative` (list of paragraphs) | section `Summary` free text |
| Status lines | `summary.status` (dict) | short `Label: value` lines at the end of the summary, e.g. `Abx: Unasyn/cipro`, `Pressors: Levo` |
| (all summary lines) | `summary.lines` | the raw lines, in order |

## Access column (Anesthesia) / equivalents in I-PASS
| Your name | Parser field | Source |
|---|---|---|
| Header for Tubes/Lines/Drains | rendered heading | `Tubes/Lines/Drains:` |
| TLD list | `tld` = list of `{days, description}` | one bullet per item; leading number = days since placed, e.g. `7-Left, Femoral vein 7 French CVL Insert` → days 7 |
| Vent Header | rendered heading | `Vent:` |
| Vent Mode | `vent.mode` | `Type:` (Anes) / first item (I-PASS), e.g. `PC (Pressure control)` |
| FiO2 | `vent.fio2` | `FiO2:` |
| Positive End Expiratory Pressure (PEEP) | `vent.peep` | `PEEP:` |
| Inspiratory:Expiratory Ratio | `vent.ie_ratio` | `I:E:` |
| Set respiratory rate | `vent.set_rate` | `Set Rate:` (Anes) / `Set:` (I-PASS) |
| Tidal Volume (Vt, measured) | `vent.vt_measured` | `VT vent:` |
| Tidal volume, set | `vent.vt_set` | `VT set:` |
| Tidal volume, spontaneous | `vent.vt_spont` | `VT spont:` |
| Minute volume, spontaneous | `vent.minute_volume_spont` | `Min vol spont:` |
| Pressure support | `vent.psv` | `PSV:` |
| Mean airway pressure | `vent.mean_airway_pressure` | `MAP:` inside the Vent block (not blood pressure) |
| Static compliance | `vent.static_compliance` | `Static Comp:` |
| Diet Header / Current Diet | `diet` | `Diet:` |
| Tube Feed Header / Current Tube Feed | `tube_feeds` | `TF:` (Anes only) |
| Restraint Header / Current Restraints | `restraints` | `Restraint:` (Anes only) |

Vent block split (confirmed 2026-09-15): **Vent settings** = mode, set_rate, vt_set, fio2, peep, psv, ie_ratio;
**Vent measurements** = vt_measured, vt_spont, minute_volume_spont, mean_airway_pressure (Paw), static_compliance
(Cstat). Rendered as two lines under Ventilation, "Set …" and "Measured …".

## Procedures / Vitals column
| Your name | Parser field | Source |
|---|---|---|
| Procedures header | `procedures` | `Procedures:` — content never seen populated yet (Anes only) |
| temperature (T): most recent / min / max | `vitals.temp.last` / `.min` / `.max` | `T: 98.8 (98.6 - 101.7)` |
| last HR / Min HR / Max HR | `vitals.hr.last` / `.min` / `.max` | `HR:` |
| last SpO2 / Min / Max | `vitals.spo2.last` / `.min` / `.max` | `SpO2:` |
| Respiratory rate | `vitals.rr` | `RR:` (I-PASS only) |
| GCS | `vitals.gcs` | `GCS:` (I-PASS only) |
| O2 delivery | `o2_delivery` | `O2:`, e.g. `Ventilator`, `Room air`, `Nasal cannula` |
| Systolic Blood Pressure | `vitals.sbp.last` / `.min` / `.max` | `SBP:` (cuff) |
| Diastolic Blood Pressure | `vitals.dbp.last` / `.min` / `.max` | `DBP:` (cuff) |
| Mean Arterial Pressure, cuff | `vitals.map_noninvasive` | `MAP (NON-inv):` |
| Mean Arterial Pressure, arterial line | `vitals.map_invasive` | `MAP (Invasive):` — CORES prints no min/max for it |
| Arterial line BP | `vitals.art_bp` | `Art BP 134 / 57` (I-PASS only) |

Rendered "BP" cell = SBP/DBP (MAP); it uses the arterial line values when present, else cuff. Hover the BP
header to see which.

## Results column
| Your name | Parser field | Source |
|---|---|---|
| Labs | `labs.<analyte>` = `{current, prior}` | fishbone cells; analyte from the cell's slot: wbc hgb hct plt na k cl co2 bun creatinine glucose ca mg phos pt ptt inr total_protein albumin total_bili direct_bili ast alt alk_phos (+ lactate from the LA trend) |
| Glucose Trend / data for glucose trend | `glucose_trend` (list, oldest → newest) | `Glu: 253→200→…` (Anes only) |
| Lactic Acid / data for lactic acid trend | `lactate_trend` (list, oldest → newest) | `LA: 2.6→1.2→…` (Anes only) |
| Net I&O / NEt I&O result | `net_io_since_admission` | `Fluid Balance: 958 mL (Since Admission)` (Anes only) |
| Today / Yesterday / IO date (two days before) | `io.columns` = `['Tdy','Yst','9/13']` | I&O table header |
| Intake / Output / Urine / Net rows | `io.rows.<Intake|Output|Urine|Net>` = 3 values | Urine = the part of output tracked as urine |
| ABG | `gases[]` = `{type:'ABG', time, values{pH,pCO2,pO2,HCO3,SaO2,FiO2}}` | `ABG:` lines `09/14 17:18 - 7.32 / 57 / 128 / 30 / 100% on 100%` |
| iStat | `gases[]` = `{type:'iStat', ...}` | (I-PASS only) |

## Handoff column
| Your name | Parser field | Source |
|---|---|---|
| Handoff ("we are never going to use this column") | `handoff` (dict, usually empty) | `AM Handoff:` / `PM Handoff:` — only rendered when non-empty |

## Action List column
| Your name | Parser field | Source |
|---|---|---|
| Tasks | `tasks` (list of `[ ] …` lines) | section `Action List`, `Tasks:` |
| Situational Awareness | `sit_awareness` (list of `- …` lines) | section `SIT AWARE`, `Sit Aware:` |

## Meds row (Anesthesia) / Meds column (I-PASS)
| Your name | Parser field | Source |
|---|---|---|
| Antibiotics / Scheduled Meds / PRN Meds / Infusions | `meds.antibiotics` `meds.scheduled` `meds.prn` `meds.infusions` | underlined headings; `IVF:` in Anes = infusions |
| days on medicine | `meds.<section>[].days_on` | leading `2 - ` on antibiotics |
| name of medicine | `meds.<section>[].drug` | drug name |
| dose and frequency | `meds.<section>[].dose_frequency` | gray text after the name |
| highlighted | `meds.<section>[].highlighted` | bold in CORES (meaning not yet confirmed) |
| last dose | `meds.<section>[].last_dose` | `@ 6 hrs` after PRN entries (I-PASS only) |

## Rendered Daily Report (names shown by the Inspect toggle)
Toolbar: search, Unit / Severity / O2 filters, Open tasks only, Sort, Reset, Print, Reset columns, **Sections**
(a checklist, grouped by column, that hides or shows any subsection, whole column, or the PRN row; a column
also disappears by itself when every one of its sections is unchecked; choices and dragged column widths are
remembered by the browser), Inspect.

Each patient is a **Patient block** of two rows. Row 1: Patient column (patient info with the Location block
as a square unit / room-bed chip to its right, then Severity chip and Isolation tag, the Admission block, and
the Allergy / Diet block at the bottom) · Summary column · Vitals column (vitals,
ventilation, I&O, lines) · Labs column (fishbones) · Meds column (Infusions,
Antibiotics, Scheduled stacked) · Sit Awareness column (Tasks, Situational Awareness) · Notes column (blank,
for handwriting). Row 2: **PRN row**, full width, PRN meds flowing into as many columns as fit. Same-name drugs are merged onto one line with doses comma-separated.
Inside them: Location block (Unit, Room, Bed, Severity chip, Isolation tag), Patient name, MRN, Date of birth,
Age, Sex, Code status, Admission (Admit diagnosis with the `ADMIT:` prefix stripped, Admit date, Length of stay),
Patient summary, Status lines, Allergy / Diet block (Allergies, Diet,
TF, Restraints), Tasks, Situational Awareness, Vitals (Temperature, Heart rate, Respiratory rate, Blood pressure),
Ventilation (O2 delivery, Vent settings, Vent measurements, Blood gas), I&O (I&O chart — one mirror column per
day: intake rises in blue, output hangs below in red with urine solid at the baseline and other output continuing
as a wash, values at the bar tips, the day's net underneath with a "Net:" label in the chart's left gutter, legend to
the right of the chart, scaled to that patient's largest value; Net I&O since admission, shown as
"Cumulative net" at the right of the I & O heading),
Tubes / Lines / Drains (TLD item), Labs — today's values only, as classic fishbones, row 1: CBC fishbone (spine
with forked ends: WBC left, Plt right, Hgb over Hct) beside the Coags fishbone (inverted Y: PT left, PTT right,
INR below); row 2: BMP fishbone (Na | Cl | BUN over K | CO2 | Cr, Glu in the open angle at the end) beside the
Ca/Mg/Phos fishbone (bracket with three ticks); row 3: LFT fishbone (X: TBili top, ALT left, AST right, AlkP bottom); Other labs (TP, Alb, DBili) as a
labelled list beside the LFT X (lactate appears only in its trend line). A small red ▲ / ▼ after a value
marks it above / below the adult reference range in `LAB_RANGES` (textbook ranges; Hgb, Hct and creatinine
are sex-specific); Trends (Glucose trend, Lactic acid trend).
Med entry = name · dose (with route) · frequency, separated by small bullets; the frequency is split off at the
first frequency word (Daily, BID, TID, QID, Every N hr, Nightly, Once, Mon/Wed/Fri…).
