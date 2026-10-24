# CORES report glossary

Agreed names for the parts of the CORES reports and the rendered Daily Report, so layout requests are
unambiguous. Three columns per entry: **your name** (from the annotate list) → **parser field** (the JSON key
written by `cores_parse.py`) → **source** (the CORES label or element it comes from).

Reports handled: `Anesthesia Report` (report_id 281, nine columns), `I-PASS Detailed` (report_id 8, six
columns) and `Medicine Report +VS/Meds` (report_id 7, five columns; its sources are listed in their own section
below). Fields marked *Anes only* / *I-PASS only* exist in one layout.

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

Rendered "BP" item (in the Vitals line) = SBP/DBP (MAP) mmHg; it uses the arterial line values when present, else
cuff. Hover BP to see which ("BP from the arterial line" / "BP from the cuff").

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
| last dose | `meds.<section>[].last_dose` | `@ 6 hrs` after PRN entries (I-PASS and Medicine) |
| drip rate | `meds.infusions[].rate` | `norepinephrine @ 0.18 mcg/kg/min` after IV Meds entries (Medicine only); rendered as `@ 0.18 mcg/kg/min` |

## Medicine Report +VS/Meds (report_id 7)
Five columns: Pt Info, Pt Summary, Vitals/Meds, Tasks/Plan, Notes. No labs, vent, I&O, lines or admit diagnosis
(its `Admission Dx` section is commented out in the CORES template).

| Source | Parser field |
|---|---|
| Pt Info gray bar | `patient_name` |
| Pt Info first row: MRN, DOB, age, sex | `mrn`, `dob`, `age`, `sex` |
| `MICU - MI25 01` | `unit`, `room`, `bed`, `location` |
| `LOS:`, `COVID:` (only when tested, e.g. `Not Detected (09/27)`), `Allergies:`, `Diet:` | `los_days`, `covid`, `allergies`, `diet` |
| Pt Summary gray bar: Stable / Watcher / Unstable | `severity` |
| `Patient Summary` text | `summary` (narrative and status lines, as in I-PASS) |
| Vitals table, LAST / MIN / MAX rows: Temp (degrees C), SBP, DBP, HR, RR, SpO2 | `vitals.<temp/sbp/dbp/hr/rr/spo2>.last` / `.min` / `.max` |
| Vitals table `O2` column | not parsed: it seems to mix every result with O2 in its name, blood gases included (VBG pO2, FiO2, flow, saturations) |
| `Scheduled Meds`, `PRN Meds`, `Abx Meds`, `IV Meds` | `meds.scheduled`, `meds.prn`, `meds.antibiotics`, `meds.infusions` |
| Tasks/Plan gray bar `Code Status:` | `code_status` |
| `Action Items` (a checklist, no done state) | `tasks` (`[ ] …`) |
| `Sit. Aware. / Contingency` | `sit_awareness` |
| Notes | `notes` |

The Daily Report flags a temperature under 50 as degrees C (normal 36.1 to 37.9), so this report's temperatures are
not all marked low.

## Rendered Daily Report (names shown by the Inspect toggle)
Toolbar: search, Unit / Severity / O2 filters, Open tasks only, Sort, Reset, **Breakdown** (Off / By unit, and By team
once any Patient block carries a team: the **Breakdown** line above the table, a Breakdown total, a Breakdown chip per
unit outlined in its unit color with the count of patients shown and printed, and a dashed Breakdown blank chip; printed
when on), **+ Blank patient**, **Print all** (puts back every patient left out with Don't print), Print, **B&W** (black and white: see
README, Printing), Paper, Optimize widths, Reset columns, **Sections**
(a checklist, grouped by column, that hides or shows any subsection, whole column, or the PRN row; indented
entries are parts of the entry above them — Admission, Allergy / Diet block, Vitals, Ventilation, Volume, Trends, Labs —
and a parent or a column disappears by itself when every one of its parts is unchecked; choices and dragged
column widths are remembered by the browser), **Fields** (the Fields menu: add a per-patient field by name — Dispo,
Code status override, … — or remove one; Team is there to start with; Forget typed data erases every value and note this browser holds), a **Team** filter (the teams typed on this
report, and No team; hidden when Team is removed), Inspect. Sort also lists every field; patients with nothing typed sort
last.

Typed on the report (kept in this browser only, never in the report file): **Custom fields** in the Snapshot column,
under Code status — one line per field, "<name> field" (e.g. Team field): a box with the values already typed on this
report as suggestions; Enter goes to the same field of the next patient shown, Shift+Enter the previous. **Typed notes**
is a box filling the Notes column. Printed, each prints as plain text; an empty field is left out and empty Notes stay
blank for handwriting. Which fields exist is a browser preference (`cores-report-fields-v1`); the values are patient
data (`cores-report-data-fields-v1`, `cores-report-data-notes-v1`), keyed by MRN: field values carry over to later
reports of the same patient, Notes only to reports of the same day. Values are dropped once their patient has not been
on a report for 60 days (Notes 14).

The report is set in the UAB Medicine brand (dpo.uab.edu/brandguide/uab-medicine): UAB Green `#1a5632` is the primary
color, Healing Teal `#007580` the secondary, Trust Teal `#68c6b8` and its tints the only accents, no gold; Aktiv Grotesk
where it is installed, else Arial. The **Report header** is a green band — a "UAB Medicine · CORES Daily Report" eyebrow
and the Current service / team in a teal tint, the Source report format in white, the CONFIDENTIAL line in white, a
Healing Teal rule under it — the column headers are a green band with white text, the toolbar a light teal tint with a
green Print button, and each Patient block ends in a green rule. Section headings (VITALS, VOLUME, ADMISSION, TASKS, …)
are green capitals with no rule under them; a thin rule divides the sections of a cell from each other. Clinical signals
keep their own colors: red for an abnormal value or an allergy, amber for a Watcher, the unit palette for Location
blocks; the time since a PRN's last dose is teal. B&W takes all of it to black on white.

Each patient is a **Patient block** of two rows. Row 1: Snapshot column (header "Snapshot"; the Location block, a unit / room-bed chip
outlined and lettered in that unit's color, then 8 px to its right the Patient name, last name and comma on the
first line, first name and MI on the second, and the Isolation tag (a Lucide biohazard icon in a box, red, black in B&W; hover
shows the isolation text) to the right of the name when the patient is on isolation; then the Severity chip, and
the Allergy / Diet block at the bottom) · Hospital Summary column (Admission at the top, then the Patient summary
and Status lines) · Vitals column (header "Vitals · Vent · Volume · Labs · Lines": Vitals across the top, then
Ventilation, then Volume and Labs side by side with a rule between them — Labs goes under Volume when the column
is too narrow, as in portrait — then Tubes / Lines / Drains; Labs, heading "LABS (today)", was a column of its own
until 2026-10-10) · Meds column (Infusions,
Antibiotics, Scheduled stacked) · Sit Awareness column (header "Tasks / Sit. Awareness"; Tasks, Situational Awareness) · Notes column (Typed notes, else blank
for handwriting; under the Snapshot, on screen only, the **Patient controls**: Don't print button — the patient stays on
screen, dimmed, and is left out of the printout and of Optimize widths; remembered by MRN for 30 days — and Blank below button). Row 2: **PRN row**, full width, PRN meds flowing into as many columns as fit. Same-name drugs are merged onto one line with doses comma-separated.
A **Blank patient block** (+ Blank patient, or Blank below on a patient) has the same two rows, empty and tall enough to
write in, with a Blank patient name to type into (optional) and a Remove blank button; it is never filtered out, stays
after the patient it was added below whatever the sort, prints like any patient, and is kept for that report.
Unit colors (`UNIT_PALETTE` in `cores_report.py`): MICU, MCCU, CCU, ICVU, NICU, BMT and UED always get the
same color (`UNIT_PINNED`); any other unit gets a color no other unit on that report has, starting from one picked
from its name, so it can differ from day to day. Past thirteen units two unpinned units share a color, never a pinned
unit's. A chip with no unit is gray. In a Snapshot column too narrow
for the chip and the name side by side, the name moves under the chip.
Inside them: Location block (Unit, Room, Bed), Severity chip, Isolation tag (boxed biohazard icon), Patient name (Last name, First name
and MI), MRN and Date of birth on one line ("MRN … | DOB …", labels bold, values plain),
Age, Sex, Code status, Admission ("Dx: …", the Admit diagnosis with the `ADMIT:` prefix stripped; "Date: MM/DD/YY (LOS n days)", the Admit date
and Length of stay; only the labels bold),
Patient summary, Status lines, Allergy / Diet block (Allergies — "No Known Medication Allergies" or "No Known Drug
Allergies" shown as NKDA, alone or in a list ("NKA, NKDA"); search finds either form — Diet — each diet order up to its
first comma, the orders joined by " / " ("NPO / Regular"): CORES separates orders with a bare comma and an order's
details with a comma and a space; a comma inside parentheses or a number like 1,800 does not count, and an order listed
twice shows once; hovering shows the whole field, and search still finds all of it —
TF, Restraints), Tasks, Situational Awareness, Vitals (one line under a VITALS heading, "T … °F | HR … bpm | BP SBP/DBP (MAP) mmHg | RR … bpm | SpO2 …% on NC |
GCS …" (°C for a temperature under 50; O2 delivery after SpO2, shortened: Room air RA, Nasal cannula NC, High
flow nasal cannula HFNC, Ventilator vent, Non-rebreather mask NRB, anything else as CORES writes it), labels bold, values plain and red when out of range, units gray, only the ones CORES reported: Temperature, Heart rate, Blood
pressure, Respiratory rate, SpO2, O2 delivery, GCS),
Ventilation (Vent settings, Vent measurements, Blood gas; left out when there are none), Volume (the I&O; heading VOLUME; Volume chart — one mirror column per
day, today's column left out (only the days before the report date): intake rises in UAB Green, output hangs below in teal with urine solid Healing Teal at the baseline and other output continuing
in the lighter Trust Teal, edged in Healing Teal, then under the bars a small table of In, Out and Net rows, one value per day (— where CORES gave no
value), a rule above Net; the rows are labelled with Lucide icons in the chart's left gutter (In row label:
square-arrow-right-enter turned 90° clockwise; Out row label: square-arrow-right-exit turned 90°; Net row label:
square-sigma; hover names them); the zero line starts at the table's left edge; legend (Volume legend) 8 px to the
right of the bars with its middle entry, Urine, level with the zero line; scaled to that patient's largest value;
Net I&O since admission: "Σ<sub>cum</sub> = total" on one line, a larger Σ (14 px) and its subscript bold, the rest regular,
8 px to the right of the table and level with the Out row (under the heading when there is no chart), hover for its name),
Tubes / Lines / Drains (TLD item), Labs — today's values only, as classic fishbones, row 1: CBC fishbone (spine
with forked ends: WBC left, Plt right, Hgb over Hct) beside the Coags fishbone (inverted Y: PT left, PTT right,
INR below); row 2: BMP fishbone (Na | Cl | BUN over K | CO2 | Cr, Glu in the open angle at the end) beside the
Ca/Mg/Phos fishbone (bracket with three ticks); row 3: LFT fishbone (X: TBili top, ALT left, AST right, AlkP bottom); Other labs (TP, Alb, DBili) as a
labelled list beside the LFT X (lactate appears only in its trend line). A small red ▲ / ▼ after a value
marks it above / below the adult reference range in `LAB_RANGES` (textbook ranges; Hgb, Hct and creatinine
are sex-specific); Trends (Glucose trend, Lactic acid trend).
Med entry = name · dose (with route) · frequency, separated by small bullets; the frequency is split off at the
first frequency word (Daily, BID, TID, QID, Every N hr, Nightly, Once, Mon/Wed/Fri…).
