# CORES Daily Report

Turns a UAB CORES ("Core Work Mgr") ICU handoff report into a clean, filterable, printable **Daily Report** with one
command: `cores run`.

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
   closes itself. (`cores capture --direct` makes the script open the report itself instead, `--id 8` for I-PASS
   Detailed; CORES sometimes answers "Can't Load Patient List" to a window it did not open, so this is the fallback.)
3. **`cores run --clipboard --print`** saves the report from the clipboard into `reports\`, checks that it parses,
   writes `reports\CORES report 281 <date> <time> - Daily Report.html`, opens it and brings the print dialog up (or
   prints without a dialog once a printer is configured, see *Printing*). Leave off `--print` to just open it.
   **`cores run`** without `--clipboard` uses the downloaded file instead: the newest capture in Downloads is moved
   into `reports\` and processed the same way.

Hands-free: keep `cores watch --clipboard --print` running in a terminal; every capture is saved, rendered and
printed as it arrives, from the clipboard or from Downloads.

Order matters with the clipboard: run `cores run --clipboard` *before* the next `cores capture`, because the latter
puts the script on the clipboard. If you do it the other way round nothing is lost: `cores capture` first saves any
report it finds on the clipboard into `reports\` and tells you so; `cores run` then builds it. Inside Citrix the
browser's download may land in a Citrix folder rather than your Downloads, which is why the clipboard is the
dependable route.

No terminal handy? Drop the downloaded file onto **Make Daily Report.cmd** or **Print Daily Report.cmd**, or
double-click either to use the newest capture in Downloads. (A file dropped from anywhere other than Downloads or
this folder is copied into `reports\`, and the original stays where it was; the window says so and stays open for a
few seconds.)

**About "allow pasting".** The first time you paste into the DevTools console, Chrome refuses and makes you type
`allow pasting` and press Enter; paste again after that. It cannot be part of the paste, but Chrome remembers it.
DevTools > *Sources* > *Snippets* never asks: paste the script into a new snippet once and run it with Ctrl+Enter.

**Saving straight into a folder.** `cores capture --folder` makes the patient list show a *Choose folder* button
after the first capture; pick a folder once (for example this folder's `reports\` through the Citrix client drive)
and every later capture is written there, with at most one click when the browser asks again. It works only if the
Cerner-hosted browser allows the folder picker (the File System Access API); the clipboard route needs nothing.

`cores` on its own shows the help and what `cores run` would use next.

## Setup (once per computer)

1. Install Python 3.10 or newer from python.org (keep the *py launcher* option ticked; `cores.cmd` uses `py -3`, or
   `python` on PATH if there is no launcher, or `.venv\Scripts\python.exe` if you make a venv in the folder).
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

### No Python on the other computer?

Run `cores bundle` once on a computer that has Python and internet. It downloads python.org's embeddable Python
(the version you are running, or `--version 3.13.7` for another) and the two packages into `python\` inside this
folder, about 20 MB to download and 40 MB on disk. From then on `cores.cmd` uses that private Python first, so the
folder runs on any Windows PC with nothing installed: copy it (without `reports\`) and use `.\cores` as usual.
`cores bundle --dry-run` only shows what would be downloaded; `--force` replaces an existing `python\`.
Microsoft Edge (present on every Windows PC) is still what makes PDFs and prints without a dialog.

## Commands

`FILE` is optional everywhere: the newest matching file is used.

| Command | What it does |
|---|---|
| `cores run [FILE \| --clipboard] [--print] [--pdf] [--no-open] [--copy] [--clean]` | capture -> `reports\` -> JSON -> Daily Report -> browser. `--clipboard` takes the report captureCores put on the clipboard. `FILE` may also be a `.json` or a Daily Report. `--copy` leaves the capture in Downloads instead of moving it. `--to PRINTER`, `--kiosk` and `--dialog` choose how to print and imply `--print`. |
| `cores capture [--direct [--id 281]] [--no-download] [--folder] [--no-run]` | capture script plus its `captureCores(...)` call to the clipboard, and the steps; default captures the window CORES opens, `--direct` opens the report itself |
| `cores watch [--clipboard] [--print] [--pdf] [--no-open] [--copy] [--clean] [--inbox DIR] [--interval S]` | process every new capture automatically (Ctrl+C stops), from Downloads and, with `--clipboard`, from the clipboard; a re-capture that reuses a file name is processed too |
| `cores open [FILE]` | open a Daily Report in the browser |
| `cores print [FILE] [--to PRINTER \| --kiosk \| --dialog]` | print a Daily Report (see *Printing*) |
| `cores pdf [FILE] [-o X.pdf] [--open]` | Daily Report -> PDF with headless Edge/Chrome, letter landscape |
| `cores parse FILE [-o X.json] [--copy]` | capture -> JSON only (a capture in Downloads or next to the scripts is moved into `reports\` first) |
| `cores render FILE [-o X.html] [--open] [--copy]` | capture or JSON -> Daily Report only (same rule for captures) |
| `cores latest` | newest capture / JSON / Daily Report / PDF, and what `run` would use |
| `cores clean [--keep N] [--inbox] [--dry-run] [-y]` | delete older capture sets from `reports\` (default keeps 3); `--inbox` also removes captures left in Downloads that are identical to a copy already in `reports\` |
| `cores annotate FILE [--open] [--copy]` | annotatable copy of a capture: hover shows the parser field, click names it (same rule for captures) |
| `cores har FILE` | fallback capture: recover the report HTML from a DevTools HAR export or a copied cURL |
| `cores doctor` | environment check |
| `cores setup [--add-path]` | install packages, create `reports\`, doctor |
| `cores config [--init] [--set KEY VALUE]` | show settings; write `cores.config.json`; change one setting |
| `cores help [COMMAND]` | this list, or one command's options (`cores help run`) |
| `cores bundle [--dry-run] [--force] [--version X.Y.Z]` | put a private Python plus packages in `python\` so the folder needs no installed Python |

`cores -h`, `cores -help`, `cores /?` and `cores <command> -h` all work as well, and `cores` on its own shows the help
followed by what `cores run` would use next. The pipeline pieces still work on their own too:
`python cores_parse.py X.html` and `python cores_report.py X.html`.

## Printing

The Daily Report prints letter landscape; a patient block never straddles a page break.

- **`cores print`** or **`cores run --print`**: the report opens in your browser with the print dialog already up.
  Choose the printer and press Print. (Ctrl+P in an open report does the same.) Once a printer is set in the config
  this prints without a dialog instead; `--dialog` brings the dialog back for one run.
- **`cores print --to "PRINTER NAME"`**: no dialog. A PDF is made with headless Edge/Chrome and Adobe Acrobat sends it
  to that printer. `cores doctor` lists the printer names. Save it once with
  `cores config --set printer "PRINTER NAME"` and every `--print` goes straight there. Acrobat stays open in the
  background after printing; that is how Acrobat behaves, and the PDF stays in `reports\`.
- **`cores print --kiosk`**: no dialog, to the Windows default printer, using Edge/Chrome kiosk printing. Check what
  the default printer is first (`cores doctor` marks it); a virtual "PDF" printer as default will ask for a file name.
  If printing has not finished after two minutes the browser is closed and the command reports an error.
- On `run` and `watch`, `--to`, `--kiosk` and `--dialog` imply `--print`.
- **`cores pdf`** writes `reports\<capture> - Daily Report.pdf` to keep, email, or print later.

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
| `keep` | `3` | capture sets kept by `cores clean` and `run --clean` |
| `open_after_run` | `true` | `cores run` opens the Daily Report |

## Files

| File | Role |
|---|---|
| `cores.py`, `cores.cmd` | the command and its Windows launcher |
| `Make Daily Report.cmd`, `Print Daily Report.cmd` | drag-and-drop targets |
| `capture_report.js` | pasted into the CORES window's console to capture a report |
| `cores_parse.py`, `cores_parse_anes.py` | capture HTML -> JSON (I-PASS six-column and Anesthesia nine-column layouts) |
| `cores_report.py` | JSON -> Daily Report HTML: search, filters, sort, Sections menu, Inspect, print layout |
| `annotate_source.py`, `har_extract.py` | helpers used by `cores annotate` and `cores har` |
| `REPORT_GLOSSARY.md` | agreed names for every element of the reports and the parser fields |
| `requirements.txt` | Python packages |
| `cores.config.json` | optional settings |
| `python\` | optional, made by `cores bundle`: a private Python so nothing needs installing |
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
  this dialog was up is the empty report template; it is named `... UNRENDERED.html` and `cores run` refuses it.
- **The report window shows another error dialog or is slow**: the console prints what the window shows when the wait
  runs out; `captureCores(281, {timeout: 180})` waits longer.
- **The console says it could not copy to the clipboard**: the page cannot write the clipboard while the report window
  or DevTools has the focus, so the script tries from the report window first and retries for a few seconds after
  that window closes. If it still fails, click *Copy to clipboard* in the banner at the top of the patient list; one
  click always works. (DevTools' own `copy()` helper is not available in the CORES console, because the CORES page
  defines a function of that name.) The download still happens either way.
- **Fallback capture**: with DevTools *Network* open and *Preserve log* ticked, open the report as usual, right-click
  the request list, *Save all as HAR with content*, then `cores har file.har`.
- **`cores run --clipboard` says there is no report on the clipboard**: Citrix may block or cap clipboard transfer
  from the session to your PC (a capture is 0.4 to 2 MB of text). The console in CORES says whether the copy worked;
  if the banner at the top of the patient list offers *Copy to clipboard*, click it. Otherwise use the downloaded
  file: plain `cores run`.
- **`cores` is not recognised**: use `.\cores` from this folder, or run `.\cores setup --add-path` and open a new
  terminal.
- **`cores run` says "no capture found"**: `cores latest` shows where it looked; `cores config` shows the inbox
  folders.
- **The Daily Report looks wrong for a field**: `cores annotate` shows how the source maps to parser fields;
  `REPORT_GLOSSARY.md` has the agreed names.

## Moving to another computer

Copy the folder without `reports\` and without any leftover captures, JSON files, Daily Reports or PDFs next to the
scripts (all PHI; `cores clean` lists them), then `.\cores setup --add-path`. Nothing else is needed. If the other
computer has no Python, run `cores bundle` here first and copy the `python\` folder along with the rest.
