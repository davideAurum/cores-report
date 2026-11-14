# Code review: CORES Daily Report

Reviewed 2026-11-14, at commit `6630b7d` (the start of the `cores-load-map` goal). Every `file:line` below refers to
that commit and was read, not guessed. Not reviewed: the Trace being added to `capture_report.js` and the new
`cores_log.py`, which other lanes are writing at the same time. No capture, report or JSON file was opened; nothing
in this document is patient data.

Part 1 is a map of the code. Part 2 is the ranked findings, starting with a Top 10 table.

## Part 1. Map of the codebase

About 6,750 lines of code in 16 files, three of which hold 75% of it.

### What each file does

| File | Lines | Job | Main entry points |
|---|---|---|---|
| `cores.py` | 1,964 | The `cores` command: every sub-command, the settings, finding and moving files, PDF and printing, the clipboard, the private Python (`bundle`) and `update`. | `main` :1934, `build_parser` :1756, one `cmd_*` function per command (:1015 to :1751) |
| `cores_report.py` | 1,616 | Parsed JSON to the Daily Report page. 743 of its lines are the page's CSS (:189-393) and JavaScript (:394-931), held in two Python strings. | `render` :1521, `render_row` :1437, `load_unit_locations` :68, `main` :1598 |
| `capture_report.js` | 1,524 | Pasted into the CORES console. Captures the report window, reads CORES's own patient data, delivers the capture, shows the HUD. About 600 lines (:884-1482) are the exploring tools Find, Describe, Columns and Map. | `captureCores` :1487, `probeCores` :900, `describeCores` :1136, `listCoresColumns` :1301, `mapCores` :1356 |
| `cores_parse.py` | 405 | Capture HTML to JSON. Picks the report layout, parses the I-PASS (six-column) layout itself, and attaches the team and clinical-data comments. Holds the helpers the other two parsers import. | `parse_file` :382, `row_parser` :292, `parse_row` :272, `attach_teams` :317, `attach_clinical` :354 |
| `cores_parse_anes.py` | 199 | Row parser for report 281, Anesthesia ICU w/ Meds (nine columns). This is the one used every day. | `parse_row` :185 |
| `cores_parse_med.py` | 122 | Row parser for report 7, Medicine Report +VS/Meds (five columns). | `parse_row` :112 |
| `cores_compare.py` | 198 | `cores compare`: counts where the printed report and CORES's own data agree. Prints counts and shared labels only. | `compare` :100, `load` :187 |
| `annotate_source.py` | 167 | `cores annotate`: a copy of a capture where hovering shows the parser's name for each part. | `main` :148 |
| `har_extract.py` | 72 | `cores har`: recovers the report HTML from a DevTools HAR export (fallback capture). | `main` :50 |
| `make_synthetic.py` | 117 | Writes a made-up **parsed** report (JSON, 14 invented patients) for trying layout and printing. It does not make a capture (HTML), so it exercises the renderer only, never a parser. | `main` :95, `patient` :41 |
| `release.py` | 200 | Publishes a GitHub release: sets `VERSION`, commits, tags, builds and checks the zip, pushes. Not in the zip. | `main` :125, `build_zip` :72, `check_zip` :91 |
| `bundle.ps1` | 115 | Finds (or downloads into `%TEMP%`) a Python able to run `cores.py bundle`. | script body :94-115, `Find-Python` :47, `Get-BootstrapPython` :65 |
| `cores.cmd` | 28 | Launcher: picks `python\`, then `.venv`, then `py -3`, then `python`, and runs `cores.py`. | |
| `bundle.cmd` | 7 | Runs `bundle.ps1` with the execution policy set for that one run. | |
| `Make Daily Report.cmd`, `Print Daily Report.cmd` | 10, 9 | Drag-and-drop targets: `cores generate` and `cores generate --print`. | |

Data and settings: `unit_locations.json` (unit to building), `requirements.txt` (`beautifulsoup4`, `lxml`),
`.gitignore` (keeps captures, reports and JSON out of git), `.gitattributes` (CRLF for `.cmd`/`.ps1`; leaves
`release.py` out of the release zip). Documents: `README.md`, `CORES_PAGE_NOTES.md`, `REPORT_GLOSSARY.md`.
There are no tests.

### Inside the three big files

`cores.py`, by line range:

| Lines | What |
|---|---|
| 1-170 | constants, settings (`load_config` :93), folders |
| 173-311 | telling files apart and moving them (`kind_of` :217, `looks_like_capture` :189, `import_capture` :285) |
| 313-438 | glue to the parser and renderer (`parse_capture` :323, `do_parse` :360, `do_render` :370, `refresh_report` :395) |
| 441-723 | browser, PDF and printing (`open_in_browser` :511, `make_pdf` :627, `do_print` :687) |
| 725-856 | clipboard through the Windows API (`to_clipboard` :744, `clipboard_capture` :811), user PATH |
| 858-972 | the pipeline and cleaning (`run_pipeline` :860, `clean_sets` :929) |
| 975-1315 | the commands (`generate_source` :992, `cmd_capture` :1019, `cmd_watch` :1118, `cmd_doctor` :1234) |
| 1317-1460 | `cores bundle` (`bundle_check` :1325, `cmd_bundle` :1398) |
| 1463-1701 | `cores update` (`github_release` :1497, `install_release` :1556, `cmd_update` :1635) |
| 1704-1964 | help, `config`, the argument parser, `main` |

`capture_report.js` is one closure: the HUD (:54-395), banner, folder and clipboard helpers (:397-541), reading
CORES's patient records (`clinicalFromCores` :577, `teamsFromCores` :614), `deliver` (:632), `watchReport` (:699),
`arm` (:855), the exploring tools (:884-1482) and `captureCores` (:1487).

`cores_report.py`: constants and reference ranges (:1-187), CSS (:189-393), JavaScript (:394-931), then one Python
function per section of a patient block (:934-1500) and `render` (:1521).

### How a capture becomes a printed report

```
PC: cores capture ──clipboard──▶ CORES console: captureCores() ──▶ report window ──▶ capture text
                                                                                        │ clipboard (Citrix) / download
PC: cores generate ◀────────────────────────────────────────────────────────────────────┘
      parse (cores_parse*) ──▶ JSON ──▶ render (cores_report) ──▶ Daily Report.html ──▶ browser ──▶ printer
```

1. **`cores capture`** (`cmd_capture`, cores.py:1019). Saves any report still on the clipboard into `reports\` first
   (`clipboard_capture` :811), reads `capture_report.js`, adds the `captureCores(...)` call (:1026), puts it on the
   clipboard (`to_clipboard` :744) and prints the steps.
2. **Paste in the CORES console.** `captureCores` (capture_report.js:1487) has two ways to get a report window:
   - **window-capture ("armed") mode**, the default, `arm` (:855): replaces the page's `window.open` and waits; the
     next window CORES opens whose address looks like a report is handed to `watchReport`;
   - **direct mode**, `captureCores(281)` (:1497-1499): the script opens the report address itself and hands that
     window to `watchReport`.
3. **Watching the report window**, `watchReport` (:699), the same for both modes. Every 25 ms it looks at the
   window. Once the report page is there it replaces that window's `form.submit`, `print` and `close` (:805-818).
   Report 281 is turned into a PDF by CORES submitting a form that holds the report's HTML; the script takes the
   HTML from that form instead (:809). For a report shown as a page it waits until the patient rows have not
   changed for 6 seconds (:841). If CORES says "Can't Load Patient List" it presses OK and Reload (`recover`
   :762). After 120 seconds it gives up (`killer` :844).
4. **Finishing**, `finish` (:706). Names the capture `CORES report <id> <date> <time>.html` (:712), reads each
   patient's team (`teamsFromCores` :614) and CORES's clinical data (`clinicalFromCores` :577) from
   `window.global_constant_row_info`, then `deliver` (:632) builds the capture text: a name comment, a teams
   comment, the report HTML, and the clinical data as a comment just before `</html>`. It goes to the clipboard
   (`copyText` :458), to a download (:646-654) and, if asked, into a chosen folder (`saveToFolder` :518). The HUD
   shows the verdict (`ovVerdict` :362) and the report window closes.
5. **To the PC.** Citrix relays the clipboard; the download lands in Downloads when that folder is mapped.
6. **`cores generate`**: `main` (cores.py:1934), `cmd_generate` (:1015), `generate_source` (:992). It takes the
   file given, else the newest capture in Downloads (`files_of_kind` :230, `kind_of` :217), else the clipboard
   (`clipboard_capture` :811 saves it into `reports\` under the name in its first comment).
7. **Check and parse**, `run_pipeline` (:860), `take_capture` (:430), `parse_capture` (:323), which calls
   `cores_parse.parse_file` (cores_parse.py:382): read the header (`parse_header` :283), find the patient rows
   (`tr.row_template`, :390), choose the layout from the column names (`row_parser` :292, `LAYOUTS` :29), run that
   layout's `parse_row` on every row (:392), then attach teams (`attach_teams` :317) and clinical data
   (`attach_clinical` :354). `parse_capture` then refuses a capture that does not end in `</html>` (cut short,
   cores.py:337), a report with no parser (:342), one with no rows (:350) and the unrendered template (:352-356).
   Only a capture that passes is moved into `reports\` (`import_capture` :285).
8. **JSON**: `do_parse` (:360) writes `<capture>.json` next to the capture.
9. **Render**: `do_render` (:370) calls `cores_report.render` (cores_report.py:1521), which builds one block per
   patient with `render_row` (:1437) (vitals :968, ventilation :1004, volume chart :1083, labs :1286, lines :1174,
   meds :1355), adds the CSS and JavaScript, and writes `<capture> - Daily Report.html`.
10. **Open or print**: `open_in_browser` (cores.py:511) or `do_print` (:687). The default opens the report with
    `#print` on its address, and the page's own script brings the print dialog up (cores_report.py:919-929).
    `--to PRINTER` makes a PDF with headless Edge or Chrome (`make_pdf` :627) and hands it to Acrobat; `--kiosk`
    uses Edge or Chrome kiosk printing. In the browser the page's script does the filtering, sorting, typed Team
    and Notes, Sections, Optimize widths and saved views (cores_report.py:394-931), keeping them in the browser.
11. **Afterwards**: `cores open`, `print` and `pdf` re-render an older report first (`refresh_report` :395);
    `cores clean` deletes older capture sets (`clean_sets` :929).

Side paths: `cores watch` runs steps 6 to 10 for every new capture (`cmd_watch` :1118); `cores compare`
(`cmd_compare` :1067) and `cores annotate` (`cmd_annotate` :1207) read a capture without making a report;
`cores har` (`cmd_har` :1223) is the fallback capture.

## Part 2. Ranked findings

**Value** is what fixing it is worth in daily use (high, medium, low). **Effort** is S (under an hour), M (an
afternoon) or L (days). "Unconfirmed" marks what I suspect but could not check without the live CORES page or a
real capture. "Tried" means I ran the code on made-up data in a scratch folder.

**Is any patient data in git?** No. At the reviewed commit `git ls-files` lists 25 files: no capture, report, PDF
or HAR, and the only JSON is `unit_locations.json`. No file with such a name was ever added on any branch
(`git log --all`, names only).

### Top 10

| # | Finding | Value | Effort | Where |
|---|---|---|---|---|
| 1 | `cores annotate`'s "Copy list" carries patient text meant for pasting into a chat | high | S | `annotate_source.py:115,133` |
| 2 | The whole report stays on the clipboard after `cores generate` | high | S | `cores.py:811-834` |
| 3 | One unreadable patient row stops the whole report | high | M | `cores_parse.py:392` |
| 4 | No tests; six small test files on made-up data would cover most of it | high | M | whole repo |
| 5 | The script-opened report uses an address fixed to CORES 4.11.0 | high | S | `capture_report.js:36,1497` |
| 6 | A capture with no team or clinical data still ends in a green SUCCESS | medium | S | `capture_report.js:722-733` |
| 7 | `cores generate` prefers an old or broken Downloads capture to a fresh one on the clipboard | medium | S | `cores.py:996-1001` |
| 8 | Report window closed early: the HUD spins for ever (the error line can never run) | medium | S | `capture_report.js:783-790` |
| 9 | PDF and no-dialog printing leave out what was typed and chosen in the browser | medium | M | `cores.py:638-644,700-703` |
| 10 | CORES's own data could replace the text-matching for handoff text, code status, vitals and five labs | high | L | table under finding 10 |

### 1. `cores annotate`'s "Copy list" carries patient text meant for pasting into a chat (high, S)

For every part you name, the annotate copy keeps the first 80 characters of that part's text
(`annotate_source.py:115`) and puts them in the copied list as `e.g.: ...` (`:133`). The panel says the list is
"text for Claude" (`:48`). The same samples are saved in the browser's storage (`:55-58`), which `cores clean`
cannot reach. On a real capture a sample is a name, an MRN or a line of a summary, so following the tool's own
instruction pastes patient data into a chat. It breaks the rule the HUD tools follow (never show a value). Raised
as a deviation (commit `c84a5ab`).
**Fix:** leave the sample out of the copied list and out of storage; keep the name you gave, the parser's name and
the element path. Until then, do not paste a Copy list made from a real capture.

### 2. The whole report stays on the clipboard after `cores generate` (high, S)

`clipboard_capture` (`cores.py:811-834`) reads the capture and saves it; nothing clears the clipboard afterwards.
It holds every patient's report (0.4 MB to several MB of text) until something else is copied; only the next
`cores capture` replaces it (`:1034`). One stray Ctrl+V into an email, a chat or a search box pastes the lot.
Whether Windows clipboard history (Win+V) also keeps a text this size is unconfirmed.
**Fix:** once the capture is saved, put one line on the clipboard instead ("CORES report saved as ..."), in
`generate` and `watch`. `watch` already remembers the text's checksum (`:1148`), so it will not loop.

### 3. One unreadable patient row stops the whole report (high, M)

`parse_file` runs the row parser over every row in one expression (`cores_parse.py:392`). The row parsers read
cells by name (`c['Results']`, `cores_parse_anes.py:193`) and by position (`f[6]` to `f[9]`,
`cores_parse.py:170-172`; `rows[0]`, `rows[1]`, `cores_parse_med.py:24-25`). A row that lacks one raises an error,
and `parse_capture` reports "could not parse ... (KeyError: 'Results')" (`cores.py:348`): no report at all, and no
word on which row. Tried with three made-up rows, the middle one missing a cell: no records. One patient with an
unusual row means no Daily Report that morning.
**Fix:** parse each row inside its own `try`. A row that fails becomes a visible block ("this patient could not be
read, see CORES", with whatever bed and name were readable), and `generate` says "1 of 57 rows could not be read".
Never drop a patient silently.

### 4. No tests; six small test files on made-up data would cover most of it (high, M)

Nothing checks the code before David uses it on rounds. `make_synthetic.py` makes parsed JSON only, so nothing
made-up can go through a parser today. With the standard `unittest` (pytest is not installed here; none needed):

1. **`test_render.py`**: `make_synthetic` patients through `cores_report.render` for both papers, both
   orientations, color and B&W: no error, every name present, no `__PLACEHOLDER__` left. (Tried: 8 variants in
   0.12 s.) Plus the small pure functions: `merge_doses`, `split_dose`, `diet_text`, `allergy_text`, `lab_flag`,
   `flag`, `admit_date`, `io_day_labels`, `unit_colors`.
2. **`test_js.py`**: `node --check` on `capture_report.js` and on the JavaScript string in `cores_report.py`
   (skipped where there is no node; node 24 is on this PC and both pass today), and no function declared twice at
   the top level of `capture_report.js` (the `copyText` accident in CORES_PAGE_NOTES.md).
3. **`test_parse_anes.py`**: three hand-written report-281 rows with invented patients, built from the class
   names the parser looks for, through `parse_file`: name, MRN, code status, vitals, O2, meds with day counts,
   tasks; every key the renderer reads is there; the result renders. (Tried: works.) I-PASS and Medicine later.
4. **`test_capture_checks.py`**: `cores.parse_capture` on that fixture: whole is accepted; cut short, unknown
   columns, and the empty template are each refused with the right message. `attach_teams` and `attach_clinical`
   read comments written the way `capture_report.js:636-638` writes them, including `<` and `--`.
5. **`test_files.py`**, in a temporary folder: `stem_of`, `derived`, `kind_of`, `import_capture`, and above all
   `clean_sets` (`cores.py:929`), the one function that deletes patient files: it keeps the newest N sets and
   never deletes a file that is not part of a capture set.
6. **`test_update.py`**: `parse_version`; `open_release_zip` refuses unsafe paths; `install_release` puts
   everything back when one file cannot be replaced.

Files 1 and 2 catch the most for the least: a broken renderer or a broken pasted script means no report that day.
`release.py` should then run `python -m unittest` before it tags. Tests 5 and 6 need `HERE` and `CONFIG_FILE`
(`cores.py:31,37`) to be patched or passed in. The fake CORES page from the `load-trace` lane can later drive one
end-to-end test.

### 5. The script-opened report uses an address fixed to CORES 4.11.0 (high for stage 2, S)

Direct mode builds the report's address from `BASE`, which is the site plus the fixed path
`/cores/uab/prod/cores.4.11.0/base/public_web/` (`capture_report.js:36`, used at `:1497-1498`). The day CORES moves
to another version, `captureCores(281)` opens a dead or old page. Stage 2 wants the script to open the report, so
this becomes the main path.
**Fix:** take the path from the page the script runs in (`location.pathname`, or the address of a CORES script the
page has loaded), keep the constant only as a fallback, and say in the HUD which was used. Unconfirmed: that the
patient list's own address has the same path (CORES_PAGE_NOTES.md suggests it does).

### 6. A capture with no team or clinical data still ends in a green SUCCESS (medium, S)

In `finish`, missing teams give a neutral line (`capture_report.js:724`) and missing clinical data gives no line
at all (`:725-733` logs only on success or on an error). Neither counts as a problem, so the verdict is green
(`:742`). On the PC, `describe` (`cores.py:315-320`) says nothing about either, and the number of patients matched
to CORES data is worked out (`cores_parse.py:372-379`) but never shown. CORES fills its patient records only after
a report has been opened from the list; whether a report the script opens fills them is unconfirmed, and is what
the Trace should settle. Until then a capture can lose its teams and data with no one noticing.
**Fix:** a yellow HUD line and "CAPTURED WITH PROBLEMS" when either is missing; `cores generate` prints
"teams: 57 of 57 patients, CORES data: 57 of 57" (or "none in this capture").

### 7. `cores generate` prefers an old or broken Downloads capture to a fresh one on the clipboard (medium, S)

`generate_source` takes the newest capture in Downloads and looks at the clipboard only when Downloads has none
(`cores.py:996-1001`). A capture that fails its checks is "left where it is" (`:328-329`), so it is picked again
on the next run, while the fresh capture on the clipboard is ignored unless `--clipboard` is given. Nothing looks
at how old the capture is: a file from days ago becomes today's Daily Report, and only the "data as of" date shows
it.
**Fix:** compare the times (the capture's name carries its date and time, `STAMP_RE`, `:61`) and take the newer of
Downloads and clipboard; say which was used and how old it is; warn in yellow when it is older than a few hours;
skip a Downloads capture that already failed (or rename it `... REFUSED.html`).

### 8. Report window closed early: the HUD spins for ever (medium, S)

When the report window closes before a capture, the timer calls `stop()` and then checks `if (!done)` before
showing the error (`capture_report.js:783-790`). `stop()` has just set `done = true` (`:704`), so the error line
and the red FAILED verdict can never run. The HUD keeps its spinner and clock going, with nothing to say the
capture is over.
**Fix:** remember `done` before calling `stop()` (`var was = done; stop(); if (!was) ...`).

### 9. PDF and no-dialog printing leave out what was typed and chosen in the browser (medium, M)

`cores pdf`, `--to PRINTER` and `--kiosk` open the report in a fresh, empty browser profile (`cores.py:638-644`,
`:700-703`). Everything the page keeps in the browser is therefore missing from those printouts: typed Team,
fields and Notes (`cores_report.py:498-519`), "Don't print" (`:592-597`), hidden sections and column widths
(`:688-708`), saved views. README.md says so for paper, orientation and B&W only. In the other direction, "Don't
print" is remembered by MRN for 30 days (`:596`), so a patient left out once stays out of every later printout
from the dialog until restored; only the toolbar count shows it.
**Fix:** let "Don't print" last for one report (key it by report, as blank blocks are, `:598`), or show a line
above the table and on paper ("2 patients not printed"). For PDF and kiosk, either write the typed values into the
HTML before printing (a small export button, or `cores print` reading a file the page saves) or say plainly in the
`cores print` output that typed fields are not included.

### 10. CORES's own data could replace the text-matching for handoff text, code status, vitals and five labs (high, L)

The capture already carries CORES's structured data (`clinicalFromCores`, `capture_report.js:577-612`), and only
`cores compare` reads it. The parsers get the same facts by matching text patterns in the printed report. (In
the last column, line numbers are in `capture_report.js`.)

| Part of the Daily Report | Read today by | CORES data that could replace it | In the capture? |
|---|---|---|---|
| Code status | a guess by exclusion (`cores_parse_anes.py:22`) | `code_status[]` | yes (`:599`), unused |
| Summary, situational awareness, tasks, handoff notes | `parse_summary`, `parse_action`, `parse_handoff` (`cores_parse_anes.py:46,134,144`) | `handoff_fields[]`, tasks with due time and done flag | yes (`:601-607`), unused |
| HR, RR, BP, SpO2: last, min, max | one regular expression over the cell's text (`cores_parse.py:143-154`) | `result_list` values with their times | yes, newest 120 per column (`:576-591`) |
| O2 delivery, vent mode, FiO2 | text patterns (`cores_parse.py:153`, `cores_parse_anes.py:74-83`) | results *Oxygen Therapy*, *Ventilator Mode*, *FiO2* | yes, not compared yet |
| Na, K, Mg, Cr, BUN and their high/low marks | fishbone cell classes (`cores_parse.py:47-63,113-140`); marks from textbook ranges (`cores_report.py:103-122`) | `result_list` with `abnormal_ind` and `critical_ind`, the lab's own flags | yes |
| Anti-infectives, day count, last dose | `parse_meds_row` (`cores_parse_anes.py:156`) | `med_list` (`abx_day`, `last_dose_date`) | yes (`:572-575`) |
| Unit, room, bed, admit date | positions in the Bed cell (`cores_parse_anes.py:14-26`); admit date worked out as report date minus LOS (`cores_report.py:1376`) | `unit`, `room`, `bed`, `admit_dt_tm` | yes (`:582`) |
| Name, DOB, age, sex | `DOB:` pattern (`cores_parse_anes.py:36`) | `patient_name`, `birth_date`, `age`, `gender` | not carried |
| Pending results, microbiology | not on the report | `pending_results`, results | yes; nothing shows them |

Still only in report 281: temperature, GCS, CBC, LFTs, coags, the full med list, I&O, lines, allergies, diet.
**Fix:** leave the parsers as the fallback and add one overlay step after parsing (a `cores_merge.py`) that
replaces a section with CORES's data, one section at a time, each value keeping where it came from and its time.
Turn a section on only when `cores compare` shows it agrees. Start with the handoff text, tasks and code status
(plain text, no timing question), then location and admit date, then vitals and the five labs. CORES's values can
be newer than the report's snapshot, so decide per section which one rounds should show. If the Trace shows the
records can be filled without report 281, this overlay is what a report-less capture would stand on.

### 11. Window-capture mode works once, and the wrong window can use it up (medium, S to M)

`arm` replaces `window.open` and hands the next window to `watchReport` unless its address is clearly not a report
(`capture_report.js:859-872`). A window opened with an empty address counts as the report (`:863`), disarms the
script (`:868`) and then waits 120 seconds before failing (`:844-851`). After any ending, good or bad, it stays
disarmed: capturing again means typing `captureCores()` in the Console or pasting the script again (what the
failure message advises, `:756`); the HUD has no button for it. While armed there is no time limit: if CORES
opens the report from another frame, nothing happens and the HUD waits (`:875-878`). The poll runs
every 25 ms and reads the text of every patient row each time (`:781`, `:660-664`), which is heavy on a 57-patient
report while it renders.
**Fix (stage 2 decides how much survives):** a "Capture again" button in the HUD that re-arms or re-opens without
a new paste; keep the script armed until a real report page is seen; poll every 250 ms.

### 12. `cores config --set` with a wrong value locks every command (medium, S)

`cmd_config` saves the value first (`cores.py:1743-1745`) and checks it afterwards (`:1746`). `main` loads the
settings before any command runs (`:1944`). Tried: after `cores config --set paper a4`, every command, including
`cores config --set paper legal`, answers `"paper" in the config must be "legal" or "letter"` until
`cores.config.json` is edited by hand. The same holds for `orientation` and `import_mode`. A mistyped yes/no is
saved as `false` without a word (`:1735`).
**Fix:** check before saving (build the new settings, run the same checks, then write), and let `cores config`
run with a broken file so it can repair it.

### 13. Patient data outside `reports\` that `cores clean` never touches (medium, M)

`cores clean` deletes from `reports\`, plus exact duplicates in Downloads (`cores.py:929-972`). It lists report
files next to the scripts but leaves them (`:947-953`); the main checkout has 7 such files now (by name: two
captures, their JSON and Daily Reports, an annotate copy). Also out of its reach: the browser's storage, where
the Daily Report keeps typed fields and notes under each MRN for up to 60 days (`cores_report.py:498-513`) and
the annotate copy keeps samples (finding 1); a HAR file after `cores har`, which holds every request unredacted
and is not mentioned again (`har_extract.py:62-66`); the originals left by `--copy`; `core pdf dump\`.
**Fix:** `cores clean --everywhere` that also offers the files next to the scripts, HAR files and `core pdf dump\`;
`cores har` ending with "delete the HAR file now"; `cores doctor` printing a short "patient data on this PC" list
with counts and a reminder of the report's own *Forget typed data* button.

### 14. 743 lines of JavaScript and CSS live inside Python strings (medium, M)

`cores_report.py:189-931`. No editor or tool checks them; backslashes must be doubled (`:472`, `:602`; see the
gotcha in CORES_PAGE_NOTES.md); the script is one block, so an error anywhere stops everything after it, including
the automatic print at the very end (`:919-929`) that `cores print --kiosk` waits two minutes for (`cores.py:705`).
**Fix:** move them to `report.css` and `report.js` next to `cores_report.py`, read at render time and added to the
`RENDERER` fingerprint (`cores_report.py:42`); put the auto-print first, or in its own `<script>`; check the file
with `node --check` in the tests. The page stays one self-contained HTML file.

### 15. `capture_report.js` is one 1,524-line block, and 39% of it is exploring tools (medium, M)

Find, Describe, Columns and Map (`capture_report.js:884-1482`) are pasted into CORES with every capture, though a
capture never uses them. Helper names repeat inside them (`safe` at `:915`, `:1139`, `:1358`; `kindOf` at `:1194`,
`:1393`; `done` three times), and the search for the window holding the records is written twice (`:553-560`,
`:616-618`). In one block a repeated top-level name silently replaces the earlier one (the `copyText` accident).
The Trace will add more.
**Fix:** two files, capture and tools; `cores capture` pastes the capture alone and `cores capture --tools` both;
shared helpers defined once at the top; the duplicate-name test from finding 4.

### 16. The three parsers repeat each other, and nothing states the shape of a record (medium, M)

The same code twice or three times: the I&O table (`cores_parse.py:224-229` and `cores_parse_anes.py:125-130`,
identical); the rule splitting a summary into narrative and status lines (`cores_parse.py:181-186`,
`cores_parse_anes.py:56-61`); the action list (`cores_parse.py:190-196`, `cores_parse_anes.py:144-153`); one
medication entry (`cores_parse.py:239-267`, `cores_parse_anes.py:166-180`, `cores_parse_med.py:68-89`), where
"highlighted" is decided three different ways (`cores_parse.py:243`, `cores_parse_anes.py:175`,
`cores_parse_med.py:82`). `annotate_source.py:16-23` repeats the lab slot table of `cores_parse.py:47-63`. The
renderer reads some 20 keys with `r['...']`
(`cores_report.py:1387-1393`, `:1438-1489`); three parsers and `make_synthetic.py` must each supply them, and only
a crash says when one does not (tried: a record without `summary` gives a `KeyError` traceback).
**Fix:** shared `io_table`, `summary_lines` and `med_item` helpers in `cores_parse.py`; one `RECORD_KEYS` list with
a `check_record` used by the tests (and by `do_render` to give a clear message).

### 17. Some HUD and error lines repeat text that comes from the page (low to medium, S)

The HUD says it "only ever shows the script's own messages" (`capture_report.js:50`), but it prints up to 120
characters of a window's address (`:864`, `:870`), the report window's title and up to 200 characters of a dialog
(`:687-690`), and it saves the last Find words in the browser (`:166`). On the PC a parser error's own text is
printed (`cores.py:348`). Unconfirmed that any of these ever holds a patient's identifier; an address is the
likeliest (ids in its query). It matters more now that HUD events and command outcomes go into a log that syncs.
**Fix:** show the report id and the page's file name instead of the address; the dialog only when it matches
`CORES_DIALOG`; in the logs, codes and error type names only (the plan already says so; a test should hold it).

### 18. An unexpected error shows a Python traceback (low to medium, S)

`main` catches `CoresError`, `PermissionError` and Ctrl+C only (`cores.py:1955-1960`). Tried: `cores render` on a
JSON file with a syntax error (`:375`) or a missing key ends in a long traceback. `render`, `compare` and
`annotate` also parse captures but are not in `NEEDS_PACKAGES` (`:1894`), so on a PC without the packages they end
the same way instead of offering `cores setup`.
**Fix:** a last `except Exception` that prints one line (what failed, the error type, "run again with `--debug`
for details") and writes the outcome to the new log; check a JSON file's shape in `do_render`.

### 19. `.gitignore` misses a few names a capture can have (low to medium, S)

It covers `reports/*`, `CORES report *`, `iPASS Detailed Report*`, `*.har` and `*.pdf`. Not covered: the files
`cores har` writes, named `<prefix> - UAB Core Work Mgr ....html` (`har_extract.py:61-62`), a page saved from the
browser under CORES's title (which `looks_like_capture` accepts, `cores.py:191`), and any other `.html` or `.json`
put next to the scripts. The global gitleaks hook looks for secrets, not patient data.
**Fix:** ignore `/*.html` and `/*.json` at the top of the repo, with `!unit_locations.json`; add
`*UAB Core Work Mgr*`; one test that `git ls-files` holds no `.html`, `.pdf` or `.har` outside `test/` and `tests/`.

### 20. `release.py` commits and tags before it has built and checked the zip (low to medium, S)

It writes `VERSION`, commits and tags (`release.py:173-175`), and only then builds and checks the zip (`:176-177`).
A failed check leaves the commit and tag behind, and the undo hint is printed only when you answer "no" at the end
(`:183`). The check compiles the Python files (`:105-106`) but does not look at `capture_report.js`, and no test
runs. `git archive` ships every tracked file: `docs/`, `tests/` and `test/` will go into every release zip.
**Fix:** build and check from `HEAD` first, as `--dry-run` already does (`:167-168`), then commit and tag; run the
tests and `node --check`; add `docs/`, `tests/` and `test/` to `.gitattributes` as `export-ignore` if they should
stay out. `cores update` itself reads well: checksum, compile check, all-or-nothing swap with everything put back
on failure (`cores.py:1556-1605`), and it refuses a git checkout (`:1663`). One gap: it removes only files that an
earlier update installed (`:1565-1566`), so a file dropped from a release stays in a folder first set up by hand.

### 21. `cores bundle` removes the working `python\` before the new one is downloaded (low, S)

`cmd_bundle` deletes `python\` (`cores.py:1427-1434`) and then downloads Python and four packages
(`:1437-1451`). If a download fails part-way, a PC with no other Python is left with none, or with a half-built
one. The python.org zip is not checked against a checksum (`:1412`, `:1437`; `bundle.ps1:75`); the packages are.
**Fix:** build into `python.new\`, run `bundle_check` on it, then swap the folders.

### 22. Small slips in the parsers and helpers (low, S each)

- Anesthesia summary: `lines` is overwritten by each section while `narrative` adds up
  (`cores_parse_anes.py:55`), so with two sections the search text (`cores_report.py:1392`) loses the first.
  Tried with made-up rows. Unconfirmed that report 281 ever has two.
- Teams and CORES data are matched "by MRN, else FIN" (`cores_parse.py:337`, `:374`), but no parser reads a FIN,
  so the fallback never works.
- `VITAL_RE` (`cores_parse.py:143`) has no word boundary before `T`, `HR`, `RR`: a label ending in those letters
  would be read as that vital. Unconfirmed that the report has one.
- `attach_clinical` drops unreadable data without a word (`cores_parse.py:361-364`).
- `make_synthetic.py` gives `days_on` and line days as text (`:37`, `:61`) and `procedures` as a list (`:67`);
  the parsers give numbers and text (`cores_parse_anes.py:73`, `:98-101`, `:178`).
- `cores capture --id` is written into the pasted JavaScript unchecked (`cores.py:1023-1026`); accept digits only.
- `datetime.utcfromtimestamp` (`cores_compare.py:65`) is deprecated since Python 3.12.

### 23. `cores.py` does everything in 1,964 lines (low, M)

Settings, files, printing, the Windows clipboard, the bundle and the updater share one file with the 20 commands.
It works, but it is hard to test (module constants `HERE` and `CONFIG_FILE`) and `cores doctor` checks a list of
module names typed by hand (`:1259`), which the new `cores_log.py` will not be on unless someone adds it.
**Fix, only when next working there:** move update and bundle (`:1317-1701`) and printing (`:441-723`) into their
own modules; build doctor's list from one `MODULES` constant that `release.py` also checks against the zip.

### 24. For stage 2: what changing how the report is opened touches (a checklist, not a defect)

- **The two modes** meet in one place, `captureCores` (`capture_report.js:1487-1514`): no id calls `arm`
  (`:855-882`), an id opens the address. Everything after that (`watchReport`, `finish`, `deliver`) is shared, so
  dropping window-capture mode removes `arm`, the `window.open` replacement and the help texts (`:1-34`,
  `:875-878`); the "paste the script again" advice (`:756`) should change with it.
- **On the PC** the mode is chosen when the call is written (`cores.py:1024-1026`), described in the steps
  (`:1044-1048`) and offered as `--direct` and `--id` (`:1771-1772`); README.md "Every day" and "If something
  does not work" describe both modes.
- **If no report is opened at all**, the PC side needs a new kind of capture, because today it insists on report
  rows: `looks_like_capture` (`cores.py:191,203`), `clipboard_capture` (`:816`), the "no patient rows" and
  "unrendered template" refusals (`:350-356`), and `parse_file`, which makes records only from `tr.row_template`
  (`cores_parse.py:390-392`). The ending check (`cores.py:337`) is worth keeping: end a data-only capture with
  `</html>` too. `deliver` (`capture_report.js:632`, also `captureCores.deliver`, `:1523`) can already send any
  text; `finish` (`:706`) assumes report HTML. The renderer already hides sections with no data
  (`cores_report.py:995-997`, `:1160`, `:1289`). Finding 10's overlay is the missing piece.
- Fix findings 5, 6 and 8 first; each sits on the path stage 2 will lean on.
