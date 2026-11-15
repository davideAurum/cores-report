# CORES load map

```
status     landed on main (6630b7d → 7917fa9) · 11-15 · iteration 1 · endpoint reached
stages     ✓ 1  ✓ 2
needs you  nothing
next       nothing; the goal is closed
```

## Goal

A map of how the CORES patient-list page loads and holds its data that settles whether opening report 281 can be
skipped or scripted, with a ranked review of the codebase and a persistent cores log alongside.

## Primary endpoint ✓

The map answers, from the live page, whether opening report 281 can be dropped or automated. Evidence: a Trace run
in CORES shows what fills the patient records and what the report button calls; CORES_PAGE_NOTES.md records a
yes/no for "skip" and for "automate", each with the Trace output behind it. **Met (11-15):** two Trace runs in CORES (by hand,
and with the script clicking) give both answers; the notes record them as key findings 8 and 9 (skip? no,
automate? yes); `cores capture --auto` opened and captured report 281 in CORES with no clicks by hand.

## What the Trace showed (11-14, fresh CORES session, 58 records)

- **What fills the records:** the patient list itself, the moment the Reports button is clicked: `showReportMenu`
  (t4m_cores_ptlist.js:5112) → `onPrintReport` (t4m_utility.js:7210) → `printReportLegacy`
  (t4m_cores_ptlist.js:5977) assigns an empty list, filled in place to 58 within 10 ms. No request, no report
  window open; the report opened 15 s later.
- **Skip? No, for the Daily Report:** report 281 still supplies the medications, I&O and most labs. But the report
  window is not what loads the records.
- **Automate? Yes:** three ordinary clicks (the Reports nav button; the menu item "ANES ICU w/ Meds", which opens
  a PrintReportDialog; its "Just Print" button, `.t4m_rnd_report_dialog_just_print_btn`), then a plain
  `window.open` 0.5 s later of `public_web/?prg_name=univ_wa_rnd_build_report&options=report_id:281` (+ mode,
  emr_type, report_name), features `left=100,top=100,width=1250,height=850,menubar=1,toolbar=1,resizeable=1,
  status=1,scrollbars=1`.
- **Still open:** where the report window gets its data: its only visible requests were its own template files
  (css, html, js, the pdf css), and it rendered for about 90 s before going to `generate_pdf_2.php`. Also whether
  direct mode's "Can't Load Patient List" comes from the records not being there yet.
- **Trace wording to fix:** the verdict named the polled fill, not the assignment 10 ms earlier that has the call
  stack; "skip? Yes" did not say the fill came from a click.

## Stages and milestones

### Stage 1: Build the Trace, the persistent log and the code review ✓ landed (6630b7d → 77b8586)

| Lane | Milestone | What exists after it | Commit |
|---|---|---|---|
| load-trace | M1 | Fake CORES page with invented patients, a local server and a self-test | bf40d22 |
| load-trace | M2 | Trace in the HUD: who fills the records, what the report button calls, which requests go out | e88ef75 |
| load-trace | M3 | Trace result with who / skip? / automate? and Copy for Claude | 851da63 |
| load-trace | M4 | HUD event log kept across sessions and carried in each capture | 504c3a7 |
| load-trace | M5 | CORES_PAGE_NOTES.md sections on running and reading the Trace | 41d8cf3 |
| run-log | M1 | `cores_log.py`, an append-only log with one file per computer | 209ee13 |
| run-log | M2 | Every cores command logs its outcome; a capture's HUD events are merged once | 9d39d56 |
| run-log | M3 | `cores log`, the folder in `cores doctor`, 35 tests, README section | a9a9a56 |
| code-review | M1 | Map of the codebase in `docs/code-review.md` | a947cdd |
| code-review | M2 | 23 ranked findings and a stage 2 checklist | 287346f |

**Assessed 11-14.** All three lanes merged on the goal branch with no conflicts; unit tests and the HUD self-test
pass there; end to end on invented data, a fake capture went through `cores generate` and `cores log` showed its
13 HUD events plus the run. **Accepted shortfalls:** a capture's own copied / downloaded / verdict events travel
with the next capture.

Learned:
- Two fixes since landing, on the goal branch (now e1bce24, 40 unit tests): `cores capture --trace` arms the Trace
  in the paste, because `--no-run` alone shows no HUD (b611f63); one self-test check depended on timing (e1bce24).
- The Trace shows a clicked button's text unless redaction catches it: read the result before pasting.
- Requests through Cerner's own channel (`window.external`, `XMLCclRequest`) do not show; the write they cause does.
- The automatic log folder follows each PC's own OneDrive, work account first.
- Until fixed, a `cores annotate` Copy list made from a real capture must not be pasted anywhere.
- No capture, report or patient file is tracked in Git on any branch.
- Self-test: `node test/run_selftest.mjs`; fake page: `python test/serve.py`.

### Stage 2: Act on the map ✓ landed (77b8586 → 7917fa9; plan revision 1, approved 11-14)

**Approach.** Record the two verdicts, then let the capture script press CORES's own three buttons, so one paste
captures the report with no clicks from David. Pressing CORES's buttons keeps everything CORES does by hand, which
opening the address directly does not. Alongside, fix the review items he picks and the loose ends from stage 1.

**Risks**
- The button names come from one Trace run; another role or CORES version may differ → each step that fails names
  the button to press by hand; the capture stays armed.
- The Reports button's code names a role check, so it may ask something first → the script waits a few seconds for
  the menu, then hands over.
- The browser may block a window opened after scripted clicks → the existing blocked-popup message; by hand works.
- Only David can run anything in CORES → the fake page is rebuilt to open its report the way the Trace showed; his
  one run at the end is the check.
- Clearing the clipboard after `cores generate` could break `cores watch --clipboard` → the report is saved before
  it is cleared, and both commands are tested.

**Shared assumptions**
- `cores capture --auto` ends the paste with `captureCores({auto: true})`, other options in the same object;
  `auto: true` means report 281's menu item, a text means another report. `--trace` still adds `traceCores();`.
- File ownership: `capture_report.js`, `CORES_PAGE_NOTES.md` and `test/` belong to auto-open; `cores.py`,
  `annotate_source.py`, `cores_parse.py`, `README.md`, `.gitattributes` and `tests/` to review-picks.
- The script only presses CORES's own buttons, as a hand would. It never calls CORES's functions or
  `dwh.transformativemed.com`.
- Nothing in the HUD or the log is patient data; new HUD events keep the stage 1 format, so `cores_log.py` needs
  no change.
- `--auto` is opt-in in this stage: plain `cores capture` behaves as today.
- Not in this stage: a capture with no report at all, and reading CORES's data in place of text-matching
  (finding 10).

**Lanes and milestones** (two independent lanes, from `goal/cores-load-map`; no file is edited by both)

| Lane | Milestone | What exists after it | Now |
|---|---|---|---|
| auto-open (`feat/auto-open`) | M1 | CORES_PAGE_NOTES.md records skip? (no) and automate? (yes) with the Trace output behind each; the Trace's own verdict names the write that has the call stack | ✓ ea0c1c5 |
| auto-open | M2 | Fake CORES page opens its report as CORES does: Reports fills the records, menu item, dialog, Just Print, `window.open` half a second later | ✓ b3fb7a3 |
| auto-open | M3 | `captureCores({auto: true})` presses the three buttons itself; a step it cannot do names the button to press by hand, capture still armed | ✓ 1806b4d |
| auto-open | M4 | Capture-path fixes from the review: report address taken from the page, not fixed to 4.11.0 (5); no team or clinical data ends yellow (6); a report window closed early ends the capture (8) | ✓ 4972e4d |
| review-picks (`fix/review-picks`) | M1 | `cores capture --auto`; README's daily steps and its Trace mention; `cores log` no longer logs itself; `tests/`, `test/` and `docs/` left out of release zips | ✓ 7461558 |
| review-picks | M2 | Privacy: `cores annotate`'s Copy list carries no patient text (1); the report leaves the clipboard after `cores generate` (2) | ✓ c2b7c05 |
| review-picks | M3 | Robustness: one unreadable patient row no longer stops the report (3); `cores generate` takes the fresher of clipboard and Downloads (7); a wrong `cores config --set` value is refused, not saved (12) | ✓ e69ab2d |

**Integration.** Both lanes merge into `goal/cores-load-map` in either order. Then the unit tests and the HUD
self-test on the goal worktree, and one end-to-end pass on the fake page (`cores capture --auto`, capture,
`cores generate`). Last, David's one run of `cores capture --auto --trace` in CORES, which also shows whether the
records load the same way when the script does the clicking.

**Checked so far (11-14).** Both lanes merged on the goal branch at 5be0a67 with no conflicts; 105 unit tests and
the HUD self-test (365 checks in 31 tests) pass there; end to end on invented data, an auto capture on the fake page
went through `cores generate`, and its auto steps show in `cores log`. Not yet checked: anything in CORES.

**David's run in CORES (11-14, fresh session, 14 patients): auto works.** `cores capture --auto --trace`, no clicks
by hand. Trace: Reports pressed by the script at 0.26 s; records assigned 0 by `printReportLegacy` at 0.27 s and filled
to 14 at 0.28 s (no request, no report window); "ANES ICU w/ Meds" at 0.30 s; "Just Print" at 1.02 s; CORES's own
`window.open` of report 281 at 1.53 s (511 ms after Just Print); report window closed at 41.6 s; the Trace stopped by
itself after the capture ended. CORES asked nothing first, no step was handed back, the browser did not block the
window. Not known yet: the HUD's own last line (`cores log` shows it once `cores generate` has read the capture).

**Landed 11-15** on the goal branch after David's "yes, land it": 105 unit tests and the HUD self-test (365 checks
in 31 tests) pass on 7917fa9. Lanes retired; recovery tips: `feat/auto-open` f217b11, `fix/review-picks` 0868ecc.
Not pushed (the goal branch has no upstream).

## Assessment of the goal (11-15)

**Recommendation: reached. David's call (11-15): reached**, with the shortfalls below accepted. The endpoint is met: the map answers both questions from the
live page (skip? no; automate? yes), and the "automate" answer is proved by a working run in CORES. Alongside it,
the code review (`docs/code-review.md`, 23 ranked findings, 8 fixed in stage 2) and the persistent `cores log`.

Accepted shortfalls:
- The HUD's last line (green or yellow) for the auto run in CORES was not noted; cores log shows it after the next cores generate.
- Where the report window gets its data is still not visible in a Trace.
- Whether direct mode's Can't Load Patient List comes from the records not being there is not tested.
- Review findings not picked stay open in docs/code-review.md (15 of 23), among them 10 and 17.
- --auto stays opt-in; Make Daily Report.cmd is unchanged.
- Windows clipboard history is not checked on the work PC (cores doctor reports it).

## Landed (11-15)

`goal/cores-load-map` landed on `main` by merge (a fast-forward, every milestone commit kept): 6630b7d → 7917fa9,
37 commits, 27 files. On `main` after it: 105 unit tests and the HUD self-test (365 checks in 31 tests) pass.
Bookmark before the landing: `git-goal/backup-20261115-1720`. The goal branch and its folder are retired
(recovery: `git branch goal/cores-load-map 7917fa9`). Release: v1.1.0, published 11-15 with `release.py minor` (commit d81e84c).

## Changes, from the goal log

- 11-14 · decision · Report loading step = opening report 281 by hand in CORES
- 11-14 · decision · Scope: answer first, then build in stage 2
- 11-14 · decision · Log records every run on both sides (cores commands and HUD events), no patient values
- 11-14 · decision · Log spans computers: a synced folder, one file per computer
- 11-14 · decision · Stage 1 plan approved (revision 1)
- 11-14 · decision · Log folder: OneDrive when the PC has one, else the user profile
- 11-14 · finding · code-review · `cores annotate`'s Copy list carries patient text · c84a5ab
- 11-14 · finding · run-log · automatic log folder follows each PC's own OneDrive · 310639c
- 11-14 · finding · run-log · `tests/` would ship in release zips · 83184e7
- 11-14 · finding · load-trace · three limits to know before the Trace runs in CORES · 8852d80
- 11-14 · finding · load-trace · self-test and fake-page server; `test/` in release zips · 34cb531
- 11-14 · decision · Stage 1 done and landed; loose ends go into stage 2
- 11-14 · finding · `cores capture --no-run` shows no HUD; `cores capture --trace` added · b611f63
- 11-14 · finding · one self-test check depended on timing; fixed · e1bce24
- 11-14 · finding · Trace run in CORES: the list page fills the records at the Reports click; the report opens after three clicks and a plain `window.open`. Skip: no. Automate: yes.
- 11-14 · decision · Stage 2 plan approved (revision 1), with all eight review fixes: 1, 2, 3, 5, 6, 7, 8, 12
- 11-14 · finding · review-picks · with `--auto --trace` the Trace is armed after the capture call; auto-open presses Reports from a timer · d519aad
- 11-14 · finding · review-picks · annotate copies made before the fix still copy patient text until redone or cleaned · 608cb05
- 11-14 · finding · review-picks · Windows clipboard history keeps its own copy of a report; `cores doctor` says whether it is on · 9eb226b
- 11-14 · finding · review-picks · choices that are David's to change: "old" capture = 6 hours; an unreadable row keeps bed and name only · 0868ecc
- 11-14 · finding · auto-open · a direct-mode capture in a fresh session now ends yellow (no teams or clinical data) · f217b11
- 11-14 · finding · goal branch · auto works in CORES: first run, 14 patients, no clicks by hand, nothing handed back, window not blocked · 7917fa9
- 11-15 · decision · Stage 2 done and landed on the goal branch (77b8586 → 7917fa9); lanes retired
- 11-15 · decision · Endpoint reached (David), shortfalls accepted
- 11-15 · decision · Cleanup go (David): goal branch onto main, push, retire
- 11-15 · stage · Landed on main: 6630b7d → 7917fa9

## Needs you

Nothing. Released as v1.1.0.
- 11-15 · decision · Release v1.1.0 (David); published
