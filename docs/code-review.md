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
