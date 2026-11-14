# CORES Daily Report

Turns a UAB CORES ("Core Work Mgr") ICU handoff report into a clean, filterable, printable **Daily Report** with one
command: `cores generate`.

> The captures, the JSON files and the Daily Reports contain PHI. Everything here runs on your own computer and
> nothing is sent anywhere. Keep `reports\` and Downloads tidy with `cores clean`.

## Every day

1. **`cores capture`** puts the capture script on the clipboard, with its `captureCores()` call already at the end,
   and prints the steps below.
2. **In the CORES patient-list window** (the Cerner-hosted one, inside Citrix): press F12, open *Console*, paste,
   press Enter, then open the report from CORES as you normally do (its own report / print button). The script
   captures the window CORES opens as soon as the report has rendered, so it works whenever CORES's own button
   works. The report's HTML is put on the clipboard, which Citrix relays to your PC, and unless you used
   `cores capture --no-download` it is also downloaded as `CORES report 281 <date> <time>.html`. The report window
   closes itself. From the moment the script is armed, the **CORES Capture HUD** in the bottom-right corner of the
   patient list follows the capture: the step under way with a spinner and the elapsed time, patient rows, reloads, and
   the same messages as the console, neutral unless they say how something went (green done, yellow a problem worked
   around, red failed). A capture ends in one verdict line: **SUCCESS** (green), **CAPTURED WITH PROBLEMS** (yellow:
   the report is in hand but something needs a look, such as a click on the banner or an unrendered report) or
   **FAILED** (red). Drag the HUD by its title bar, resize it from any edge or corner, collapse it with –, hide it with ×;
   its place and size are remembered. Its magnifying glass opens **Find in CORES**, which finds where CORES keeps
   something: type words with a comma between (`pulm, interv`, or a number for an id) and press Find. The answer goes
   into the HUD: whether each word was found, where (page, list rows, including heading rows that group rows under
   them, and the page's data with the names of the fields beside each match), and what that suggests; names that do not
   look like a programmer's field name show as `<name>` and no values are included. **Copy for Claude** copies it to
   paste into a chat. In the Console the same search is `probeCores('pulm', 'interv')`. Beside Find, **Describe** shows the layout of the CORES patient records (each patient's data on the list): which fields are filled, in how many records, and what kind of thing each holds (text, a number, a list and its entries' fields, JSON or HTML text), with a guess at which fields could hold each part of the Daily Report; never a value. Type a data path such as `window.some.list` in the box first to describe that instead; in the Console, `describeCores()`. **Columns**, with CORES's column picker open, lists every column name it offers (found by its *Microbiolgy Results* column, CORES's spelling, or by an XPath typed in the box), with the highlighted ones marked; in the Console, `listCoresColumns()`. The capture also records each patient's rounding team from the CORES patient list (CORES's Service - Team, e.g. *Pulmonary - Consult*), so the Daily Report's header names your teams and each patient's **Team** field is filled in; anything typed there overrides it, and clearing it goes back to the CORES team. (`cores capture --direct` makes the script open the report itself instead, `--id 8` for I-PASS
   Detailed; CORES sometimes answers "Can't Load Patient List" to a window it did not open, so this is the fallback.)
3. **`cores generate`** takes the newest capture in Downloads or, when there is none (it says so), the report on the
   clipboard. It saves it into `reports\`, checks that it is complete and parses, writes
   `reports\CORES report 281 <date> <time> - Daily Report.html` and opens it. Every option is optional: `--print`
   also brings the print dialog up (or prints without a dialog once a printer is configured, see *Printing*), and
   `--clipboard` uses the clipboard even when Downloads has a capture.

Hands-free: keep `cores watch --clipboard --print` running in a terminal; every capture is saved, rendered and
printed as it arrives, from the clipboard or from Downloads.

Order matters with the clipboard: run `cores generate` *before* the next `cores capture`, because the latter
puts the script on the clipboard. If you do it the other way round nothing is lost: `cores capture` first saves any
report it finds on the clipboard into `reports\` and tells you so; `cores generate` then builds it. Inside Citrix the
browser's download may land in a Citrix folder rather than your Downloads, which is why the clipboard is the
dependable route.

No terminal handy? Drop the downloaded file onto **Make Daily Report.cmd** or **Print Daily Report.cmd**, or
double-click either to use the newest capture in Downloads, else the clipboard. (A file dropped from anywhere other than Downloads or
this folder is copied into `reports\`, and the original stays where it was; the window says so and stays open for a
few seconds.)

**About "allow pasting".** The first time you paste into the DevTools console, Chrome refuses and makes you type
`allow pasting` and press Enter; paste again after that. It cannot be part of the paste, but Chrome remembers it.
DevTools > *Sources* > *Snippets* never asks: paste the script into a new snippet once and run it with Ctrl+Enter.

**Saving straight into a folder.** `cores capture --folder` makes the patient list show a *Choose folder* button
after the first capture; pick a folder once (for example this folder's `reports\` through the Citrix client drive)
and every later capture is written there, with at most one click when the browser asks again. It works only if the
Cerner-hosted browser allows the folder picker (the File System Access API); the clipboard route needs nothing.

`cores` on its own lists just these two commands; `cores latest` shows what `cores generate` would use next.

## Setup (once per computer)

1. Install Python 3.10 or newer from python.org (keep the *py launcher* option ticked; `cores.cmd` uses `py -3`, or
   `python` on PATH if there is no launcher, or `.venv\Scripts\python.exe` if you make a venv in the folder).
   Cannot install anything on this PC? Skip this step and run `.\bundle` instead -- see
   [No Python on the computer?](#no-python-on-the-computer) -- then carry on at step 2.
   Microsoft Edge or Google Chrome is needed for PDF output and no-dialog printing; Adobe Acrobat (or Reader) for
   printing to a named printer.
2. Copy this folder anywhere. It is self-contained. Open a terminal in it and run

   ```
   .\cores setup --add-path
   ```

   That installs the two Python packages (`beautifulsoup4`, `lxml`), creates `reports\`, runs `cores doctor`, and
   adds the folder to your user PATH so that `cores` works from any folder once you open a new terminal. Leave off
   `--add-path` to keep using `.\cores` from inside the folder.

`cores doctor` at any time lists what is installed, the printers Windows knows, the inbox folder and the reports folder.

### No Python on the computer?

Run `.\bundle`. It needs internet once and nothing else -- in particular it does **not** need Python, so you can run
it on the locked-down PC that has none, which is the whole point:

```
.\bundle
```

It downloads python.org's embeddable Python and the packages into `python\` inside this folder (about 17 MB to
download, 35 MB on disk). From then on `cores.cmd` uses that private Python in preference to any other, so the folder
runs on any Windows PC with nothing installed. Copy it (without `reports\`) and use `.\cores` as usual.

| | |
|---|---|
| `.\bundle` | build `python\`, replacing whatever is there |
| `.\bundle -DryRun` | only list what would be downloaded |
| `.\bundle -Version 3.13.7` | a particular Python, if PyPI has no lxml wheel for the default yet |
| `.\bundle -Arch arm64` | the Windows build (default: this machine) |

How it manages without Python: if the PC has one, `.\bundle` uses it to run `cores bundle`. If it has none, it
unpacks python.org's embeddable build into `%TEMP%`, runs `cores bundle` with *that*, and deletes it again -- so the
downloading, checksums and verification only ever exist in one place, `cores.py`. Nothing is installed, no admin
rights are needed and nothing outside this folder changes.

`cores doctor` reports the bundle by running it, not by looking for the file: a `python\` that quietly borrows an
installed Python's standard library (an embeddable build missing its `python*._pth`) works on the PC that made it and
fails on the PC you copied it to, so doctor marks it `!!` and `cores.cmd` ignores it in favour of a real Python until
you rebuild it.

Microsoft Edge (present on every Windows PC) is still what makes PDFs and prints without a dialog.

## Updates

`cores update` installs the newest release from
[GitHub Releases](https://github.com/davideAurum/cores-report/releases) into this folder. It shows what changed and asks
first. `reports\`, `python\` and `cores.config.json` are never touched. The download is checked against the checksum
the release publishes, every Python file is compiled before anything is replaced, and the files are swapped all at
once: if one cannot be replaced (an editor has it open), everything is put back as it was.

`cores generate` and `cores capture` end with a one-line note when a newer release is out. They ask GitHub at most
once a day, in the background, and say nothing when there is no internet. `cores doctor` checks too; turn the note off
with `cores config --set check_updates false`.

| | |
|---|---|
| `cores update` | install the newest release (`-y`: without asking) |
| `cores update --check` | only say whether there is a newer one, and what changed |
| `cores update --version 1.2.0` | install that release, also to go back to an older one |
| `cores update --from cores-report-1.2.0.zip` | install a release zip downloaded by hand, with no internet |
| `cores --version` | the version installed |

A release that needs different Python packages says so after updating (run `cores setup`, or `.\bundle` if the folder
has `python\`). A folder that is a git checkout is updated with `git pull` instead; `cores update` refuses to overwrite
tracked files.

**First install.** Download `cores-report-X.Y.Z.zip` from the Releases page, unzip it anywhere, and carry on at
*Setup* step 2. A folder copied from before releases existed has no `cores update`: install the zip over it once
(copying the files in is fine; `reports\` and your settings stay), and from then on `cores update` works.

### Making a release

On the development copy (a git checkout with the GitHub CLI `gh` logged in), on `main` with everything committed and
pushed:

```
py release.py patch      # fixes:        1.4.2 -> 1.4.3
py release.py minor      # new features: 1.4.2 -> 1.5.0
py release.py major      # 1.4.2 -> 2.0.0, or give a version: py release.py 2.0.0
```

It sets `VERSION` in `cores.py`, commits *Release X.Y.Z*, tags `vX.Y.Z`, builds `dist\cores-report-X.Y.Z.zip` from
the tag with `git archive`, unpacks it and checks it the way `cores update` will, then asks before pushing and
publishing the release with the zip and its `.sha256` attached. The release notes are the commit subjects since the
previous release; `--notes "..."` replaces them, and they can be edited on GitHub afterwards.
`py release.py minor --dry-run` builds and checks the zip without committing, tagging or pushing anything; try it on a
copy of the folder with `cores update --from dist\cores-report-X.Y.Z.zip`.
`release.py` itself is not in the zip (`.gitattributes` leaves it out), and `.gitattributes` makes the `.cmd` and
`.ps1` files CRLF in the zip whatever the building machine uses.

## Commands

`FILE` is optional everywhere: the newest matching file is used.

| Command | What it does |
|---|---|
| `cores generate [FILE \| --clipboard] [--print] [--pdf] [--no-open] [--copy] [--clean]` | newest capture in Downloads, else the clipboard -> `reports\` -> JSON -> Daily Report -> browser. `--clipboard` uses the clipboard even when Downloads has a capture. `FILE` may also be a `.json` or a Daily Report. `--copy` leaves the capture in Downloads instead of moving it. `--to PRINTER`, `--kiosk` and `--dialog` choose how to print and imply `--print`. |
| `cores capture [--direct [--id 281]] [--no-download] [--folder] [--no-run]` | capture script plus its `captureCores(...)` call to the clipboard, and the steps; default captures the window CORES opens, `--direct` opens the report itself |
| `cores watch [--clipboard] [--print] [--pdf] [--no-open] [--copy] [--clean] [--inbox DIR] [--interval S]` | process every new capture automatically (Ctrl+C stops), from Downloads and, with `--clipboard`, from the clipboard; a re-capture that reuses a file name is processed too |
| `cores open [FILE]` | open a Daily Report in the browser |
| `cores reload [FILE]` | re-render a Daily Report in place (default: the newest), then press F5 in the tab that has it open |
| `cores print [FILE] [--to PRINTER \| --kiosk \| --dialog]` | print a Daily Report (see *Printing*) |
| `cores pdf [FILE] [-o X.pdf] [--open]` | Daily Report -> PDF with headless Edge/Chrome, on the `paper` setting's size (legal unless set), in the `orientation` setting's direction and the `black_and_white` setting's colors |
| `cores parse FILE [-o X.json] [--copy]` | capture -> JSON only (a capture in Downloads or next to the scripts is moved into `reports\` first) |
| `cores render FILE [-o X.html] [--open] [--copy]` | capture or JSON -> Daily Report only (same rule for captures) |
| `cores latest` | newest capture / JSON / Daily Report / PDF, and what `generate` would use |
| `cores clean [--keep N] [--inbox] [--dry-run] [-y]` | delete older capture sets from `reports\` (default keeps 3); `--inbox` also removes captures left in Downloads that are identical to a copy already in `reports\` |
| `cores annotate FILE [--open] [--copy]` | annotatable copy of a capture: hover shows the parser field, click names it (same rule for captures) |
| `cores har FILE` | fallback capture: recover the report HTML from a DevTools HAR export or a copied cURL |
| `cores doctor` | environment check |
| `cores setup [--add-path]` | install packages, create `reports\`, doctor |
| `cores config [--init] [--set KEY VALUE]` | show settings; write `cores.config.json`; change one setting |
| `cores help [COMMAND]` | this list, or one command's options (`cores help generate`) |
| `cores bundle [--dry-run] [--force] [--version X.Y.Z]` | put a private Python plus packages in `python\` so the folder needs no installed Python |
| `cores update [--check] [--version X.Y.Z] [--from ZIP] [-y]` | install the newest release from GitHub, or the one given (see *Updates*) |
| `.\bundle` (not a `cores` command) | the same thing on a PC with no Python at all -- see [No Python on the computer?](#no-python-on-the-computer) |

`cores` on its own (or `cores -h`, `-help`, `/?`, `cores help`) lists only `capture` and `generate`; every command
above still works, and `cores <command> -h` or `cores help <command>` shows its options. The pipeline pieces still
work on their own too:
`python cores_parse.py X.html` and `python cores_report.py X.html`.

## Printing

The Daily Report prints on legal paper (8.5 x 14 in), landscape, unless you choose letter or portrait; a patient block
never straddles a page break. Legal landscape gives every column about a third more width than letter, so most patients
take fewer lines and more of them fit on a page.

- **Paper** (toolbar): Legal or Letter, then Landscape or Portrait. The report sets the paper itself, so the browser's
  own Paper size and Layout choices are greyed out or ignored in the print dialog; use these switches instead, and load
  legal paper in the printer's tray. Your choices are remembered, and column widths are kept separately for each paper
  and orientation (the letter widths you had saved before legal was added are kept). `cores pdf`, `--to` and `--kiosk`
  print in a browser that has not seen these switches, so they use the `paper` and `orientation` settings
  (`cores config --set paper letter`, `cores config --set orientation portrait`).
- **B&W** (toolbar): black and white, for a black-and-white printer. Nothing is told apart by color alone: headings,
  unit chips and the isolation icon turn black, abnormal vital signs are bold and underlined, abnormal labs keep their
  ▲/▼ arrows (now black), severity shows as a fill (Unstable black, Watcher gray, Stable white), highlighted meds are
  underlined, and the Volume chart's intake, urine and other output are dark gray, mid-gray and hatched. Your choice is remembered; `cores pdf`,
  `--to` and `--kiosk` use the `black_and_white` setting (`cores config --set black_and_white true`).
- **Older reports**: a Daily Report made by an older version of cores or of `unit_locations.json` (one from before the
  Paper switch can only print landscape), or for other paper or B&W than the `paper`, `orientation` and
  `black_and_white` settings, is re-rendered from its JSON when
  `cores open`, `cores print` or `cores pdf` uses it. Double-clicking the file shows it as it was made; open it with
  `cores open` instead.
- **Optimize widths** (toolbar): picks column widths for the patients and sections currently shown. It lays the
  report out off-screen the way it prints, measures how tall every patient's cells are at every column width, then
  searches for the widths that (1) cut off the least content at the right edge, (2) use the fewest pages, and
  (3) take up the least height overall. The toolbar then shows the page count before and after (estimates, usually
  exact). The Notes column keeps its width. Press it again after changing sections, filters or paper. *Reset columns*
  undoes it. If it says cells are still cut off, the shown sections do not fit the paper; hide one in *Sections*
  (portrait usually needs that).

- **`cores print`** or **`cores generate --print`**: the report opens in your browser with the print dialog already up.
  Choose the printer and press Print. (Ctrl+P in an open report does the same.) Once a printer is set in the config
  this prints without a dialog instead; `--dialog` brings the dialog back for one run.
- **`cores print --to "PRINTER NAME"`**: no dialog. A PDF is made with headless Edge/Chrome and Adobe Acrobat sends it
  to that printer. `cores doctor` lists the printer names. Save it once with
  `cores config --set printer "PRINTER NAME"` and every `--print` goes straight there. Acrobat stays open in the
  background after printing; that is how Acrobat behaves, and the PDF stays in `reports\`.
- **`cores print --kiosk`**: no dialog, to the Windows default printer, using Edge/Chrome kiosk printing. Check what
  the default printer is first (`cores doctor` marks it); a virtual "PDF" printer as default will ask for a file name.
  If printing has not finished after two minutes the browser is closed and the command reports an error.
- On `generate` and `watch`, `--to`, `--kiosk` and `--dialog` imply `--print`.
- **`cores pdf`** writes `reports\<capture> - Daily Report.pdf` to keep, email, or print later.

## Unit locations

`unit_locations.json` maps each unit, exactly as CORES prints it (`MICU`, `MCCU`, `UED` …), to where it is, in a few
words such as `North Pavilion` (the building, no floor). A unit with a location gets a **Building** line in each patient's Snapshot (it can be hidden
in *Sections*), its location in the Location block's tooltip and in the Unit filter, and the toolbar's Breakdown gains
*By building*, which counts patients per building. Search finds patients by location too.

```json
"MICU": {"location": "North Pavilion", "verified": true}
```

`"verified": false` prints the location with a `?` after it until you confirm it. `cores generate` names every unit on
the report that has no location yet, so the file fills in from real reports. A report re-renders on `cores open`,
`print` or `pdf` after the file changes. Unit names are not PHI; keep patient details out of this file.

## Settings

Defaults work as they are. `cores config --init` writes `cores.config.json` next to `cores.py`; edit it in any editor
or use `cores config --set KEY VALUE`.

| Key | Default | Meaning |
|---|---|---|
| `reports_dir` | `reports` | where captures are collected and outputs written (relative to this folder, or absolute) |
| `inbox_dirs` | `["~/Downloads"]` | where the browser saves captures; several allowed (`--set inbox_dirs "~/Downloads;D:/drop"`) |
| `import_mode` | `move` | `move` or `copy` captures from the inbox into `reports_dir` (move leaves no PHI behind) |
| `browser` | auto | path to `msedge.exe` / `chrome.exe` for PDF and kiosk printing |
| `printer` | none | printer name for no-dialog printing (needs Acrobat) |
| `acrobat` | auto | path to `Acrobat.exe` / `AcroRd32.exe` |
| `keep` | `3` | capture sets kept by `cores clean` and `generate --clean` |
| `open_after_run` | `true` | `cores generate` opens the Daily Report |
| `paper` | `legal` | paper size Daily Reports print on, `legal` or `letter`; the report's Paper switch overrides it in your browser |
| `orientation` | `landscape` | paper Daily Reports print on, `landscape` or `portrait`; the report's Paper switch overrides it in your browser |
| `black_and_white` | `false` | Daily Reports start in black and white, for a black-and-white printer; the report's B&W box overrides it in your browser |
| `check_updates` | `true` | `generate` and `capture` say when a newer release is out (asks GitHub at most once a day) |

## Files

| File | Role |
|---|---|
| `cores.py`, `cores.cmd` | the command and its Windows launcher |
| `bundle.cmd`, `bundle.ps1` | build `python\` on a PC with no Python installed |
| `Make Daily Report.cmd`, `Print Daily Report.cmd` | drag-and-drop targets |
| `capture_report.js` | pasted into the CORES window's console to capture a report |
| `cores_parse.py`, `cores_parse_anes.py`, `cores_parse_med.py` | capture HTML -> JSON (I-PASS six-column, Anesthesia nine-column and Medicine five-column layouts) |
| `cores_report.py` | JSON -> Daily Report HTML in the UAB Medicine brand (UAB Green and Healing Teal, Aktiv Grotesk or Arial): search, filters, sort, Sections menu, Inspect, paper orientation, B&W, Optimize widths, print layout |
| `annotate_source.py`, `har_extract.py` | helpers used by `cores annotate` and `cores har` |
| `REPORT_GLOSSARY.md` | agreed names for every element of the reports and the parser fields |
| `unit_locations.json` | where each unit is (see *Unit locations*); edit it in any editor |
| `make_synthetic.py` | writes a made-up report (`reports\SYNTHETIC test report.json`, no real patients) for trying layout and printing |
| `requirements.txt` | Python packages |
| `release.py` | publishes a release (development copy only; not in the release zip) |
| `.cores-update.json` | made by `cores update`: when GitHub was last asked, and the files the installed release put here |
| `cores.config.json` | optional settings |
| `python\` | optional, made by `.\bundle`: a private Python so nothing needs installing |
| `reports\` | created on first run: captures, JSON, Daily Reports, PDFs (PHI) |

Captures left next to the scripts from before the `reports\` folder existed are still found; the first command that
uses one moves it into `reports\`. JSON files, Daily Reports, PDFs and annotate copies left next to the scripts are
PHI too: `cores clean` mentions them but never touches them (it only cleans `reports\`), so delete them or move them
into `reports\` by hand.

## If something does not work

- **Nothing downloads after `captureCores(281)`**: allow popups for the CORES site and run it again. The console must
  belong to the Cerner-hosted patient-list window; a report opened in a plain browser tab has no CORES session.
- **The report window says "Can't Load Patient List / Unable to load the patient list from CORES"**: CORES itself
  failed to fetch the list for the report. The script presses OK and the window's Reload button for you (twice by
  default; `captureCores(281, {retries: 4})` for more) and reports the dialog text if it keeps failing. If it does,
  press F5 in the CORES patient-list window, open your list again, and run the capture again. A capture made while
  this dialog was up is the empty report template; it is named `... UNRENDERED.html` and `cores generate` refuses it.
- **The report window shows another error dialog or is slow**: the console prints what the window shows when the wait
  runs out; `captureCores(281, {timeout: 180})` waits longer.
- **The console says it could not copy to the clipboard**: the page cannot write the clipboard while the report window
  or DevTools has the focus, so the script tries from the report window first and retries for a few seconds after
  that window closes. If it still fails, click *Copy to clipboard* in the banner at the top of the patient list; one
  click always works. (DevTools' own `copy()` helper is not available in the CORES console, because the CORES page
  defines a function of that name.) The download still happens either way.
- **Fallback capture**: with DevTools *Network* open and *Preserve log* ticked, open the report as usual, right-click
  the request list, *Save all as HAR with content*, then `cores har file.har`.
- **`cores generate` says there is no report on the clipboard**: Citrix may block or cap clipboard transfer
  from the session to your PC (a capture is 0.4 to 2 MB of text). The console in CORES says whether the copy worked;
  if the banner at the top of the patient list offers *Copy to clipboard*, click it. Otherwise use the downloaded
  file: `cores generate` uses it whenever Downloads has one.
- **`cores generate` says the capture "is incomplete"**: the file or clipboard text stops part-way (a whole capture
  ends with `</html>`), so patients at the end would be missing; it is refused rather than turned into a Daily
  Report with patients left out. A capped Citrix clipboard transfer or an interrupted download does this. Capture
  again; if the clipboard copy is cut short every time, use the downloaded file (`cores generate FILE`).
- **`cores` is not recognised**: use `.\cores` from this folder, or run `.\cores setup --add-path` and open a new
  terminal.
- **`cores generate` says "no CORES report in Downloads or on the clipboard"**: `cores latest` shows where it looked; `cores config` shows the inbox
  folders.
- **`cores generate` says the capture is "a CORES report this tool has no parser for"**: the capture is fine, but
  it is a report whose columns no parser reads (only I-PASS Detailed, report 8; Anesthesia ICU w/ Meds, report 281; and
  Medicine Report +VS/Meds, report 7, are supported). Capture one of those; the message names the report and its columns.
- **The Daily Report looks wrong for a field**: `cores annotate` shows how the source maps to parser fields;
  `REPORT_GLOSSARY.md` has the agreed names.

## Moving to another computer

Copy the folder without `reports\` and without any leftover captures, JSON files, Daily Reports or PDFs next to the
scripts (all PHI; `cores clean` lists them), then `.\cores setup --add-path`. Nothing else is needed. If the other
computer has no Python, either run `.\bundle` here first and copy the `python\` folder along with the rest, or copy
the folder as it is and run `.\bundle` there -- it works on a PC with no Python.
