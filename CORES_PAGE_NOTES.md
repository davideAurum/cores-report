# How the CORES patient-list page works (findings, 2026-11-13/14)

What was learned by probing the live CORES page from inside Citrix with the capture script's HUD tools (Find,
Describe, Columns, Map), and what was built on it. Nothing here is patient data: only field names, CORES's own
vocabulary (column types, result labels, team names) and counts. Keep it that way when updating this file.

## Key findings

1. **CORES keeps structured patient data on the patient-list page**, in `window.global_constant_row_info`: one
   record per patient (158 fields). It appears only **after a report has been opened** from the list.
2. **Each patient's team is there** (`service`, `team`, `sub_team`); the printed report never says it. The capture
   now carries it, and the Daily Report fills its Team field and names the teams in its header (done, working).
3. **The data depends on the list's columns.** Each column's `col_option` names the event sets and the look-back
   it fetches; result columns put **timed values** in `result_list` (heart rate since admission: thousands per
   patient), the meds column puts **full order records** in `med_list`, custom columns put **cell HTML** in
   `custom_fields`. Columns load asynchronously, after the list draws.
4. **The handoff text is structured** (`handoff_fields`): Patient Summary, Sit Aware/Contingenc, Action List
   (tasks with due times), Fellow Notes, Fellow Signout.
5. **CORES's values match the report's.** First comparison (57 patients): HR, BP and SpO2 agree in about 95%,
   Na, BUN and creatinine in about 84%; the differences look like CORES holding newer values than the report's
   snapshot.
6. **The page cannot replace report 281 yet**: no temperature, GCS, CBC, LFTs, coags, full medication list, I&O
   tables, lines/tubes/drains or allergies on our list. Columns exist for most of them except the full med list
   and I&O tables.
7. **Privacy tooling works**: the HUD's Find, Describe, Columns and Map show field names, CORES's vocabulary and
   counts only, redacting every identifier the page holds. Each leak found on the way (by security review or
   in use) is fixed and recorded below.

## The setting

- CORES (Transformative Med, `static.transformativemed.com/cores/uab/prod/cores.4.11.0/base/public_web/`) runs in a
  Cerner-hosted browser window **inside Citrix**. Nothing on the PC (Claude in Chrome, the PC's browsers) can reach
  it; only a script pasted into its DevTools Console can. Citrix relays the clipboard to the PC; a download stays
  inside Citrix unless its Downloads folder is mapped.
- The page is the **patient list**. Report 281 ("Anesthesia ICU w/ Meds") opens in a separate window
  (`?prg_name=univ_wa_rnd_build_report&...report_id:281`); `captureCores()` grabs that window's HTML (the report
  builds a form and submits it for a PDF; the script intercepts the submit). That HTML is what `cores_parse` reads.
- The patient list's own data loads **from `dwh.transformativemed.com`** (XHR, seen in the page's resource list).
- The page defines its own global `copy`, so DevTools' `copy()` helper is not available to the script; the clipboard
  API needs a focused document (the report window right after capture, or the list after the user clicks).

## Selection: Facility > Service > Team > Sub-team

CORES's selection menus nest four levels. Our list (2026-11-13): Facility *MAIN*; Services *MAIN - Pulmonary*,
*MAIN - Pulmonary IP*; Teams *Pulmonary - Consult*, *Pulmonary IP - IP* (later *Pulmonary - Lung Transplant*,
*Pulmonary - SCU/Pulmonary* too); Sub-teams *Consult - None*, *IP - None*. Menu labels are "parent - child".
The printed report only says `[Multiple Services Selected]` / `[Multiple Teams Selected]`; it never lists them.

## Where the data lives

### `window.global_constant_row_info`: one record per patient on the list

- A list of records with **158 fields**, the same in every record. **It exists only after a report has been opened**
  from the list (before that, the page has none); after a report it held every patient (56-58).
- Identity and place: `person_id`, `encntr_id`, `mrn`, `fin`, `mrn_mrn`, `patient_name`, `patient_name_last`,
  `birth_date`, `age`, `gender`, `unit`, `location`, `room`, `bed`, `status` (*Floor*, *ICU*), `facility`,
  `encntr_type`, `admit_dt_tm`, `admitdate` (as `DD-MON-YYYY`), `admit_day`.
- Team: `service`, `team`, `team_id`, `sub_team` (*None* when there is none), `sub_team_id`, `primary_team_name`,
  `primary_service`, `adt_service` (e.g. *Pulm-24*, *Trans Lung-75*), `list_type` (*INPATIENT*), `consult`.
  CORES's team label = `service + " - " + team` (+ `" - " + sub_team` when it is not *None*).
- `one_liner` (text, e.g. *ADMIT: ...*), `code_status[]` (`order_disp`, `order_as`, `order_detail`, `dnar`),
  `roles[]` (Primary Contact / Team Attending, with assignee names, pagers, devices), `documents`, `medrec`,
  `disch_plan`, `vte`, `pain` (MME), `sepsis` (EWS, qSOFA, SIRS), `boost`, `drg`, `cda_summary` (diabetes app).
- **`handoff_fields[]`**: the list's handoff columns, 5 per patient here, each `element_label` / `element_name` /
  `element_type` with its `value` (rich text) and `tasks[]`: *Patient Summary*, *Sit Aware/Contingenc*,
  *Action List* (TASKLIST: `tasks[]` with `descr`, `due_dt_tm`, `complete_ind`, `overdue_ind`), *Fellow Notes*,
  *Fellow Signout*. These are the report's summary, situational awareness and tasks.
- **`result_list`**: the result columns' data (see Columns below).
  - `result_list.col[i]`: one per result column: `event_set`, `since`, `since_dt_tm`, `list[]` of entries
    `{event_display, result_val, result_status, event_end_dt_tm, event_id, updt_dt_tm, abnormal_ind, critical_ind}`:
    **full time series** (heart rate since admission: up to 2,235 entries for one patient; 31,731 entries over 44
    patients with 11 columns).
  - `result_list.list[i]`: a summary per column: `last_label`, `last_value`, `last_units`, `last_date`,
    `last_event_class` (*NUM*, *TXT*, *MBO*), `count`, `abnormal_ind`, `critical_ind`.
  - Labels seen (`event_display`): *Heart Rate*, *Respiratory Rate*, *Systolic Blood Pressure*, *Diastolic Blood
    Pressure*, *Oxygen Saturation Value, Site 1*, *Oxygen Therapy*, *Oxygen Flow Rate*, *FiO2 Patient Care*,
    *Ventilator Mode*, *Sodium*, *Magnesium*, *Creatinine*, *BUN*, microbiology (*Blood Cultures*, *Gram Stain*,
    *AFB Culture*, *Fungus Culture*, *Urine Culture*, the VRP viral panel ...). Units: *bpm*, *br/min*, *mmHg*,
    *mMol/L*, *mg/dL*. Text results: *Room air*, *Nasal cannula*, *High flow nasal cannula*, *Trach collar*,
    *Ventilator*, *Auth (Verified) NEG/POS*, *Not Detected*.
- **`med_list.col[0].list[]`**: medication orders with **48 fields**: `name`, `order_mnemonic`,
  `hna_order_mnemonic`, `ordered_as_mnemonic`, `order_details`, `strdose`/`strdoseunit`, `voldose`/`voldoseunit`,
  `dose_string`, `route`, `freq`, `rate`/`rateunit`/`rate_string`, `class` (*SCH*), `order_status`, `abx`,
  `abx_day`, `last_dose_date`, `current_iv_med_rate`, `admin[]` (each administration: `admin_dt_tm`, `med_dose`,
  `med_dose_unit`, `not_given_ind`, `refused_ind`), `admin_summary_24_hour`. **Only what the meds column asks for**:
  here *ANTIINFECTIVES*, so only anti-infectives.
- `pending_results.list[]` (`catalog_desc`, `order_id`; up to 51 per patient).
- `custom_fields[]` = `{type, value}`: custom-rendered columns, **as the cell's HTML** (`IO_NET`, `CUST_DIET`).
- `oRowObject` (the row's UI object: `_oColumns`, `oColumns`), `sElmtId`, `rendered`: present for rendered rows.

### Columns: `window.prevColumns`, `window.nextColumns`, `window.t4m.<…>.elmt_to_obj[i].obj._oColumn`

Each column object: `col_type`, `col_option`, `col_label`, `col_class`, `col_seq`, `is_asynch`,
`col_async_data_loaded`, `col_async_data_error`, `element_type_id`, `calc_*`. **`col_option` carries the column's
setup**, which says exactly what data it fetches. Our list's columns (2026-11-14):

| col_type | col_option (abridged) | data lands in |
|---|---|---|
| VITALS | eventset="Heart Rate\|Respiratory Rate\|Systolic BP\|Diastolic BP\|Oxygen Saturation Value, Site 1\|Site 2", lookback=2 (h), async | result_list |
| VITALS24HR | same event set, lookback=24 | result_list |
| HR | eventset="Heart Rate", lookback=ADMIT | result_list |
| RESPRATE | eventset="Respiratory Rate", lookback=72 | result_list |
| VENT | eventset="Ventilator Settings", lookback=48 | result_list |
| RESPIRATORY | eventset="Oxygenation Data", lookback=168 | result_list |
| HFNC | eventset="FiO2 Patient Care\|Oxygen Therapy\|Oxygen Flow Rate\|High Flow …\|Total Flow Rate\|…", lookback=48 | result_list |
| OXYGENATION | eventset="FiO2 Patient Care\|Oxygen Therapy & Oxygenation Information", lookback=48 | result_list |
| O2INFO | eventset="Oxygen Therapy\|Ventilator Mode\|FiO2 Patient Care", lookback=48 | result_list |
| ELECTROLYTES | eventset="Sodium\|Postassium\|Magnesium\|Creatinine\|BUN\|", lookback=72 (CORES misspells Potassium) | result_list |
| MICROBIOLOGY | eventset="Microbiology", lookback=336, showunits=0 | result_list |
| PENDING_RESULTS | async | pending_results |
| CODE_STATUS | async | code_status |
| ANTIINFECTIVES | therapeutic_class=ANTI-INFECTIVES, async | med_list |
| IO_NET | render_fn=_ClientCustom_IO_Net, element_type_id=46, async | custom_fields (HTML) |
| CUST_DIET | async | custom_fields (HTML) |
| TEXTBOX / TASKLIST | element_type_id=909 (Patient Summary), 665 (Assessment and Plan), 3501 (Fellow Notes), 43 (Task List) | handoff_fields |
| LOCATION, PATIENT_NAME, AGE, GENDER, MRN, LOS, NEW, COLLAPSER, SEPARATOR, REMOVE_PATIENT | layout / identity | record fields |

- Result columns are **asynchronous**: they load after the list draws, and only once the column is on the list.
  A column added in the picker appears in the data only after it has loaded (scroll the list, wait).
- The **column picker** is a `<select name="t4m_rnd_user_settings_add_column_select">` with `<optgroup>`s (Location,
  Contacts / Coverage, Demographics, Encounter, Medical, Planning, Other) of `<option value="TYPE" title="…">`.
  It offers ~500 columns: vitals pieces (VITALS, VITALS24HR, TEMP, HR, RESPRATE, BP Systolic/Diastolic, GCS,
  PAINSCORE), ventilation and O2 (VENT, O2INFO, OXYGENATION, HFNC, RESPIRATORY, ABG), I&O (IO_24, IOBALANCE,
  IO_NET, URINEOUTPUT, DRAIN, STOOLS), labs (ELECTROLYTES, CREATININE, POTASSIUM, MAGRSLTS, PHOSRSLTS, HGB, HCT,
  PLATELETS, WBC, INR, LFT, BLOODGLUCOSE, RECENT_RESULTS, MICROBIOLOGY), drug classes (ANTIINFECTIVES, VASOPRESS,
  IVF, ANALGESICS, ANTICOAGULANTS, ABX_ADMIN; **no "all medications" column**), lines (ANES_TLD, CENTRAL_LINE,
  URINARY_CATHETER), ALLERGIES, CUST_DIET, CODE_STATUS, ISOLATION, DIAGNOSIS, PROBLEMS, ACUITY / ANES_ACUITY, and
  handoff elements (TEXTBOX / TASKLIST / CHECKLIST / HISTORYLIST with element ids, e.g. Patient Summary 909,
  Situational Awareness 3804, Task List 43, One liner 852, Tubes/Lines/Drains List 25).

### Other places on the page

- `window.t4m` (37 keys): CORES's app. `t4m.<…>.config` holds a 655-entry event-code table; `t4m.<…>.<…>[i]` with
  `className, timeStamp, functionName, descr, detail, debugLevel` is **CORES's activity log** (it mentions every
  column and search word; ignore it when searching). `t4m.<…>.elmt_to_obj[i].obj` = each cell's object
  (`sHTML` = the cell's HTML, `_oColumn`, `oPtData` = the patient's record again).
- `window.jQuery.cache.<…>.data.obj_inst` = cell objects too (`sHTML`, `_oTemplateData` with the patient's name
  parts). `window.univwa`, `window.MPage`, `window.domRow`, `window.oNavFilter`, `window.ObservableSlim`.
- Patient list DOM: `table.rnd_tbl_pt_list` > `tr.t4m_rnd_pt_list_row` (`_even` / `_odd`), cells
  `td.pt_list_cell` (meds cells `td.pt_list_cell_meds` > `div.t4m_rnd_pt_list_meds_display`; handoff text
  `div.t4m_rnd_pt_list_handoff_text`); header cells `th.t4m_header_cell`.

## What the page can and cannot replace (as of 2026-11-14)

- **From the page (structured):** team; code status; patient summary, situational awareness, tasks (handoff
  fields); pending results; microbiology; heart rate, respiratory rate, BP, SpO2 (time series); vent and O2
  settings; Na, K, Mg, Cr, BUN.
- **Still from report 281:** temperature and GCS (not in the VITALS event set); CBC, LFTs, coags, the rest of the
  chemistry (columns exist but were not on the list); the **full med list** (scheduled, PRN, infusions: no column
  carries it); I&O tables (IO_NET is HTML); lines / tubes / drains; allergies, diet (CUST_DIET is HTML).
- Adding columns (TEMP, HGB / WBC / PLATELETS, LFT, INR, VASOPRESS, IVF, ALLERGIES, ANES_TLD ...) should close much
  of the gap; meds and I&O look like they stay with the report.
- **First comparison** (`cores compare`, capture of 2026-11-14 00:58, 57 patients, 19,520 CORES result entries, all
  with readable times):
  - HR 53/56 agree, SBP 49/52, DBP 49/52, SpO2 53/56 (CORES label *Oxygen Saturation Value, Site 1*). The 3
    differences are most likely the same patients, with a CORES value newer than the report's "last".
  - Na 44/53, BUN 44/53, Creatinine 45/53 agree, against the report's "prior": at 00:56 the report's "current"
    (today's) labs were empty for nearly everyone, because the morning labs had not resulted. Differences: values
    newer in CORES. Mg is only in CORES; K is in the report but not matched in CORES yet (CORES's event set says
    *Postassium*; check the entry label).
  - Temperature: the list has no temperature column, so it is report only. (The first run wrongly matched the vent
    humidifier, *Aerosol Humidification Temperature*; fixed.)
  - RR: CORES only. The Anesthesia report (281) has no respiratory rate.
  - Meds: 95 drug names in both, 1,282 only in the report, 14 only in CORES: the list's only meds column is
    *ANTIINFECTIVES*.
  - Vent/O2 (*Oxygen Therapy*, *FiO2 Patient Care*, *Ventilator Mode*, *Pressure Support*, *FiO2, Set* ...) and
    microbiology are not compared yet: the report keeps them in other shapes (`vent`, `gases`).
- The capture with clinical data v1 was 6.6 MB (4.6 MB of it clinical); v2 (compact rows, 120 per column) is meant
  to cut that to about 1-1.5 MB, unconfirmed until the next capture.
- Not recommended: calling `dwh.transformativemed.com` directly (imitating CORES's own requests to a vendor
  server: fragile, and likely against hospital IT policy). A HAR export of those requests would show them, but
  holds all the data unredacted: never paste one.

## What was built (all in `main`)

- **CORES Capture HUD** (capture_report.js): status bar with a spinner for the step under way; neutral / green /
  yellow / red messages; one verdict line (SUCCESS / CAPTURED WITH PROBLEMS / FAILED); resizable from every edge
  (pointer capture, so drags survive CORES's frames); "What to do" help under a waiting step; magnifier opens the
  search bar with **Find**, **Describe**, **Columns**, **Map**.
  - Find = `probeCores(words)`: where words occur on the page, in list rows (and heading rows over groups) and in
    the page's data, with the names of the fields beside them. Describe = `describeCores(path)`: the layout of
    the patient records (or a path). Columns = `listCoresColumns()`: the column picker's options. Map =
    `mapCores()`: every field path, kinds, counts, values shared by 3+ patients, the list's columns.
- **Team auto-fill**: the capture carries `<!-- CORES teams {...} -->`; cores_parse puts `"Service - Team"` on each
  record by MRN (else FIN); the report's Team field, filter and breakdown use it; the header names the teams.
- **Clinical data in the capture**: `<!-- CORES data {...} -->` before `</html>`: per patient results (version 2:
  compact rows, newest 120 per column, `total` kept), meds (selected fields), pending, code status, custom fields,
  handoff. cores_parse attaches it as `record['cores_data']`. `captureCores({data: false})` leaves it out.
- **`cores compare [FILE]`** (cores_compare.py): per vital, lab and the meds, how often report and CORES data agree;
  counts and labels shared by 3+ patients only. Label patterns (VITALS / LABS) are first guesses to tune against
  real output (CORES calls SpO2 *Oxygen Saturation Value, Site 1*).
- `cores reload [FILE]`: re-render a Daily Report in place (F5 then shows it). Report layout: two-column Snapshot
  holding Admission, Patient Summary, Tasks, Situational Awareness; *Building* (no floor) from unit_locations.json;
  page shown at the paper's printable width; Optimize widths never narrows the Snapshot below two columns or
  Data below Labs-beside-Volume.

## Privacy rules the tools follow (and why)

Automated security reviews flagged several leaks; each was fixed. The rules now:
- Never show a value, only field names, kinds and counts, except values shared by **3+ different patients**
  (a label repeated across patients describes the page, not a patient).
- A field name is shown only if it looks like a programmer's identifier (letters, digits, `_ $ -`, a lower-case
  letter, not one capitalized word, no 3+ digit run) **and** most records share it; keys of tables (>25 keys, or
  keys not repeated across a list) are never shown. Element ids are dropped on and inside list rows; a class
  there only when more than one element has it. Loaded addresses: file name only.
- Map redacts every identifier the page holds (each patient's name and its parts, MRN, FIN, IDs, birth date,
  staff names from roles and edits) and drops dates in any form (numeric, `DD-MON-YYYY`, `Mon D`), ages and bare
  room / bed numbers. Free text never appears (it is never shared by 3 patients).
- Find always repeats the words searched for: **search CORES's vocabulary (team names, labels), never a patient's
  name**.
- Lessons: a name dictionary is not a safe redactor; date formats vary (CORES uses `DD-MON-YYYY`); an object can
  throw `SecurityError` on any property read (a closed or other-site window that CORES keeps a reference to), so
  every read in a page walker needs a try.

## Gotchas met along the way

- A second function named `copyText` (Find's) silently replaced the capture's own; keep helper names unique in
  capture_report.js (it is one closure).
- The HUD lost its flex layout when shown with `display = ''` (use `'flex'`), so the console grew past the box.
- CORES swallows clicks and keys; HUD buttons and Enter are caught in the capture phase on `window`.
- `String.replace` with a string replacement treats `$&` etc.; use a function when the replacement holds data.
- JSON carried in an HTML comment: escape `<`, `>` and `--` (`<`, `>`, `--`).
- Report 281 page script and the Daily Report's JS live inside Python strings: `\'` inside cores_report.py's JS
  must be written `\\'` (or avoided).
- The preview pane opens local files as `data:` URLs with storage disabled; test report JS over
  `.claude/launch.json`'s local server instead.

## Next steps

In order; each builds on the one before.

1. **Confirm the smaller capture.** Capture with the current script (`cores capture`, open the report): the HUD
   should end in a green SUCCESS, with a "clinical data ... KB" line well under the first capture's 4,652 KB (v2:
   compact rows, 120 per result column). If the clipboard copy still fails, lower `PER_SET` in capture_report.js.
2. **Compare again after the morning labs** (`cores generate`, `cores compare`), when the report's "current" labs
   are filled, to check today's values rather than yesterday's.
3. **Tune and widen `cores compare`**:
   - potassium: find CORES's label for K (its event set spells it *Postassium*) from the "labels no item used" list;
   - vent and O2: compare *Oxygen Therapy*, *FiO2 Patient Care* / *FiO2, Set*, *Ventilator Mode*, *Pressure
     Support*, *Vent Set Rate* with the report's `vent` and O2 delivery;
   - microbiology and pending results: compare with what the report shows;
   - the handoff fields (Patient Summary, Sit Aware, Action List) with the report's summary, situational
     awareness and tasks;
   - look at the few disagreeing patients' times (counts only) to confirm they are newer CORES values.
4. **Re-run Map** with the current script (the last Map predates the date / age / room fix) and keep this file's
   data map current.
5. **Add columns to the CORES list** for what the report has and the page lacks: TEMP (or a vitals column that
   includes temperature), GCS, HGB / WBC / PLATELETS (or a CBC column), LFT, INR, VASOPRESS, IVF, ALLERGIES,
   ANES_TLD; then Map and compare again to see what each delivers (timed results, order records, or HTML).
6. **Switch Daily Report sections to the structured data, one at a time**, where the compare shows they agree:
   likely first the handoff text (summary, situational awareness, tasks), code status, then vitals and the
   electrolytes. Keep report 281 as the source for everything else, and as the fallback when a capture has no
   clinical data. Decide per section whether the newer CORES value or the report's snapshot is wanted.
7. **Later, if the columns cover enough**: a capture that reads the list without opening report 281 at all (the
   records exist only after a report has been opened, so check whether the list can load them some other way).
8. Housekeeping: unit locations still missing (ABTX, CPCC, HNPU, HOSU, HSP2, HSP3, HSP4, HTIC, S6S, SCU, SICU,
   TBIC, W5N, W8N); the synthetic test report prints 14 pages because its 4 days of I&O push Labs under Volume at
   the default Data width (real CORES has 2 days).
