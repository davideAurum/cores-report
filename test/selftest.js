// The self-test's harness and tests (see selftest.html). Invented patients only.
(function () {
  var lines = [], fails = 0, passes = 0, current = '';
  var only = new URLSearchParams(location.search).get('only');
  function show() { document.getElementById('out').textContent = lines.join('\n'); }
  function note(s) { lines.push('    ' + s); show(); }
  function check(what, ok, detail) {
    if (ok) passes++; else fails++;
    lines.push((ok ? '  ok    ' : '  FAIL  ') + current + ': ' + what + (ok || detail === undefined ? '' : '   <- ' + String(detail).slice(0, 600)));
    show();
  }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function until(fn, what, ms) {
    var t0 = Date.now();
    return new Promise(function (res, rej) {
      (function poll() {
        var v; try { v = fn(); } catch (e) { v = false; }
        if (v) return res(v);
        if (Date.now() - t0 > (ms || 8000)) return rej(new Error('timed out waiting for ' + what));
        setTimeout(poll, 20);
      })();
    });
  }
  // a fake CORES list in a frame of its own
  function openList(params) {
    return new Promise(function (res, rej) {
      var f = document.createElement('iframe');
      f.onload = function () { res({ frame: f, w: f.contentWindow, d: f.contentDocument, popups: [],
        close: function () { this.popups.forEach(function (p) { try { p.close(); } catch (e) {} }); try { var lr = f.contentWindow.fakeCores.lastReport; if (lr) lr.close(); } catch (e) {} f.remove(); } }); };
      f.onerror = rej;
      f.src = 'fake_cores.html' + (params ? '?' + params : '');
      document.getElementById('frames').appendChild(f);
    }).then(function (p) { return until(function () { return p.d.querySelectorAll('tr.t4m_rnd_pt_list_row').length === 5; }, 'the list rows').then(function () { return p; }); });
  }
  // capture_report.js, loaded into the list the way a paste into its Console would run it
  function loadHud(p) {
    return new Promise(function (res, rej) {
      var s = p.d.createElement('script');
      s.onload = function () { res(p); }; s.onerror = function () { rej(new Error('capture_report.js did not load')); };
      s.src = 'capture_report.js?' + Date.now();
      p.d.head.appendChild(s);
    });
  }
  function openReport(p, id) {   // the Reports button, then the menu item: what a user does in CORES
    p.d.querySelector('button.t4m_rnd_reports_btn').click();
    p.d.querySelector('a.t4m_rnd_report_item[data-report="' + (id || 281) + '"]').click();
  }
  function records(p) { var r = p.w.global_constant_row_info; return r && typeof r.length === 'number' ? r.length : 0; }

  var tests = {};

  // ================= M1: the fake CORES page itself =================
  tests.fake_page = async function () {
    var p = await openList('');
    try {
      check('5 list rows, even and odd', p.d.querySelectorAll('table.rnd_tbl_pt_list tr.t4m_rnd_pt_list_row_even').length === 3 && p.d.querySelectorAll('tr.t4m_rnd_pt_list_row_odd').length === 2);
      check('cells and header cells', p.d.querySelectorAll('td.pt_list_cell').length === 25 && p.d.querySelectorAll('th.t4m_header_cell').length === 5);
      check('the page has its own global copy', typeof p.w.copy === 'function' && Object.prototype.hasOwnProperty.call(p.w, 'copy'));
      check('no patient records before a report is opened', !('global_constant_row_info' in p.w));
      check('patients are invented', /^ZZTEST, /.test(p.d.querySelector('td.pt_list_cell:nth-child(2)').textContent) && /^999\d{4}$/.test(p.d.querySelector('td.pt_list_cell:nth-child(3)').textContent));
      // a click outside the page's own area never reaches its target; a capture-phase listener on window still sees it
      var b = p.d.createElement('button'), got = 0, seen = 0;
      b.onclick = function () { got++; };
      p.d.body.appendChild(b);
      var spy = function (e) { if (e.target === b) seen++; };
      p.w.addEventListener('click', spy, true);
      b.click();
      p.w.removeEventListener('click', spy, true);
      b.remove();
      check('clicks outside the app are swallowed, but seen in the capture phase on window', got === 0 && seen === 1, 'got ' + got + ', seen ' + seen);
    } finally { p.close(); }
  };
  tests.fake_opener = async function () {
    var p = await openList('fk_mode=opener');
    try {
      openReport(p);
      var pop = await until(function () { return p.w.fakeCores.lastReport; }, 'the report window');
      check('the menu item opened a window', !!pop && !pop.closed);
      await until(function () { return /univ_wa_rnd_build_report/.test(pop.location.href) && pop.document.querySelectorAll('tr.row_template[id]').length === 5; }, 'the report rows');
      check('the report window has CORES\'s address shape', /prg_name=univ_wa_rnd_build_report&options=report_id:281&mode=pcedge/.test(pop.location.search));
      check('5 rendered report rows and the empty template row', pop.document.querySelectorAll('tr.row_template').length === 6);
      await until(function () { return records(p) === 5; }, 'the records');
      var rows = p.w.global_constant_row_info;
      check('the report window wrote 5 records into its opener', rows.length === 5 && rows[0].patient_name === 'ZZTEST, ALPHA');
      check('the list was made in the report window', !(rows instanceof p.w.Array) && Array.isArray(rows));
    } finally { p.close(); }
  };
  tests.fake_xhr = async function () {
    var p = await openList('fk_mode=xhr');
    try {
      await sleep(300);
      check('no records until the report opens', records(p) === 0);
      openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      check('the list page filled 5 records itself', p.w.global_constant_row_info instanceof p.w.Array);
      await until(function () { return p.w.global_constant_row_info[0].col_async_data_loaded === 1; }, 'the async columns');
      check('the columns load later, in place', p.w.global_constant_row_info[0].result_list.col.length === 3);
    } finally { p.close(); }
  };
  tests.fake_fetch = async function () {
    var p = await openList('fk_mode=fetch&fk_fill=push');
    try {
      openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      check('the list page filled 5 records with fetch, pushed one at a time', p.w.global_constant_row_info instanceof p.w.Array);
    } finally { p.close(); }
  };
  tests.fake_timer = async function () {
    var p = await openList('fk_mode=timer&fk_delay=300&fk_decl=var');
    try {
      var d = Object.getOwnPropertyDescriptor(p.w, 'global_constant_row_info');
      check('fk_decl=var: declared up front, not redefinable', !!d && d.configurable === false && d.value === undefined);
      await until(function () { return records(p) === 5; }, 'the records');
      check('the records appear with no report window', p.w.fakeCores.opened === 0);
    } finally { p.close(); }
  };

  // ================= M2: the Trace =================
  // nothing a patient could be told by may show in a Trace result: the fake's names, numbers, user and free text,
  // and the parameter values that are not program / report ids
  var SECRETS = ['ZZTEST', 'ALPHA', 'BRAVO', 'CHARLIE', '9990001', '9990002', '99900001', '99900002', 'zzuser', 'ZZDOCTOR', 'Invented', 'invented',
    'pcedge', 'CERNER', 'univ_wa_rnd_api', 'Madeupcillin', 'landscape'];
  function leaks(text) { return SECRETS.filter(function (s) { return text.indexOf(s) >= 0; }); }
  function isNative(fn) { return typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn)); }
  function restored(p, what) {
    var w = p.w;
    check(what + ': XHR, fetch, window.open and form submit are the browser\'s own again',
      isNative(w.XMLHttpRequest.prototype.open) && isNative(w.XMLHttpRequest.prototype.send) && isNative(w.fetch) && isNative(w.open) && isNative(w.HTMLFormElement.prototype.submit));
    var d = Object.getOwnPropertyDescriptor(w, 'global_constant_row_info');
    check(what + ': the records are a plain property again, with their value', !d || ('value' in d && !d.get && !d.set), d && JSON.stringify(Object.keys(d)));
    var r = w.global_constant_row_info;
    if (r) check(what + ': the list has no wrapped push / unshift / splice left', !Object.prototype.hasOwnProperty.call(r, 'push') && !Object.prototype.hasOwnProperty.call(r, 'splice') && !Object.prototype.hasOwnProperty.call(r, 'unshift'));
  }
  function has(text, re, what) { check(what, re.test(text), 'not found: ' + re + '\n' + text); }

  tests.trace_opener = async function () {
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      check('traceCores() arms', p.w.traceCores() === 'tracing…' && p.w.traceCores('status').indexOf('armed') === 0);
      var d = Object.getOwnPropertyDescriptor(p.w, 'global_constant_row_info');
      check('the records property is watched by a getter / setter', !!d && typeof d.set === 'function' && typeof d.get === 'function' && d.configurable);
      check('still no records for the page', p.w.global_constant_row_info === undefined);
      p.d.querySelector('a.fake_pt_tab').click();            // a tab with a patient's name
      p.d.querySelector('button.fake_pt_btn').click();        // a button with a patient's name and number, outside the list
      p.d.querySelector('button.t4m_rnd_row_btn').click();    // a button inside a patient row
      p.d.querySelector('td.pt_list_cell').click();           // a cell of a patient row
      openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      check('the page reads its records as before while the Trace is armed', p.w.global_constant_row_info[0].patient_name === 'ZZTEST, ALPHA' && Array.isArray(p.w.global_constant_row_info));
      await until(function () { return p.w.global_constant_row_info[0].col_async_data_loaded === 1; }, 'the async columns');
      await until(function () { try { return /generate_pdf/.test(p.w.fakeCores.lastReport.location.href); } catch (e) { return false; } }, 'the fake PDF page');
      await sleep(200);
      var out = p.w.traceCores('stop'), t = out.text;
      note(t.split('\n').join('\n    '));
      check('window.coresTrace holds the text', p.w.coresTrace && p.w.coresTrace.text === t);
      has(t, /RECORDS  \[L\] assigned: 5 records, 38 fields each\. BY THE REPORT WINDOW \[R1\] \(the function that wrote them belongs to the report window; the list itself was made in the report window\)\. Report windows open: 1\./, 'the write: 5 records, by the report window, a report window open');
      has(t, /call stack: fake_fill_opener \(fake_report\.html:\d+:\d+\) \[report window\] ← fake_after_render \(fake_report\.html:\d+:\d+\) \[report window\]/, 'the write\'s call stack: function names, file names, line:col, whose');
      has(t, /open     \[L\] window\.open 127\.0\.0\.1 fake_report\.html \?prg_name=univ_wa_rnd_build_report, options\{report_id:281\}, mode, emr_type, report_name, fk_mode, fk_fill  name "rnd_report_window"  features "width=1100,height=800,resizable=yes,scrollbars=yes"  → the report window \[R1\]/, 'window.open: host, file, parameter names, the program and report id, name, features');
      has(t, /called from: t4m_fake_open_report \(fake_cores\.html:\d+:\d+\) \[this page\] ← \S*t4m_fake_report_item_click \(fake_cores\.html:\d+:\d+\)/, 'window.open\'s call stack');
      has(t, /click    \[L\] [^\n]*div#t4m_reports_menu\.x-menu > a\.x-menu-item\.t4m_rnd_report_item\[role=menuitem\] "Anesthesia ICU w\/ Meds"\n\s+handlers: jQuery click \(delegated on div#t4m_reports_menu\.x-menu\) t4m_fake_report_item_click → [^\n]*t4m_fake_open_report/, 'the click on the menu item: element, text, the jQuery handler by name and what it calls');
      has(t, /click    \[L\] [^\n]*div\.x-toolbar > button\.x-btn\.x-btn-text\.t4m_rnd_reports_btn "Reports"\n\s+handlers: onclick → t4m_fake_toggle_reports/, 'the click on the Reports button: inline handler by name');
      has(t, /a\.x-tab-strip-text\.fake_pt_tab\[role=tab\] "<hidden: it may name a patient>"/, 'a link outside the list that names a patient: text hidden');
      has(t, /button\.x-btn\.fake_pt_btn "<hidden: it may name a patient>"/, 'a button outside the list that names a patient: text hidden');
      has(t, /click    \[L\] [^\n]*td\.pt_list_cell > button\.x-btn\.t4m_rnd_row_btn \(in the patient list: text not read\)/, 'a button inside a patient row: no text');
      check('no element id from inside a list row', !/pt_row_/.test(t), t);
      has(t, /request  \[R1\] #\d+ XHR 127\.0\.0\.1 fake_rows\.json \?prg_name=univ_wa_rnd_report_data, options\{report_id:281\}, person_ids  → 200, [\d,.   ]+ bytes, \d+ ms/, 'the report window\'s own request, from its resource timings');
      has(t, /records  \[L\] now 39 fields each \(were 38\): filled further in place/, 'the in-place fill of the columns (field count)');
      has(t, /window   \[R1\] went to 127\.0\.0\.1 generate_pdf_2\.php/, 'the report window going on to the PDF');
      has(t, /^\s+0\.00  armed\. Records then: none$/m, 'the state at arming');
      has(t, /stopped\. Records now: 5$/m, 'the state at the end');
      check('nothing that could tell a patient, and no parameter values', leaks(t).length === 0, leaks(t).join(', '));
      restored(p, 'after stopping');
      check('the records are still there after stopping', records(p) === 5 && p.w.global_constant_row_info[0].mrn === '9990001');
      check('traceCores(\'stop\') when not armed says so', p.w.traceCores('stop') === 'not armed');
    } finally { p.close(); }
  };
  tests.trace_untouched = async function () {
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      p.w.traceCores();
      await sleep(150);
      p.w.traceCores('stop');
      check('armed and stopped with nothing written: the property is gone again, as before', !('global_constant_row_info' in p.w));
      restored(p, 'untouched');
      has(p.w.coresTrace.text, /armed\. Records then: none[\s\S]*stopped\. Records now: none/, 'the timeline says there were none');
    } finally { p.close(); }
  };
  tests.trace_xhr = async function () {
    var p = await loadHud(await openList('fk_mode=xhr'));
    try {
      p.w.traceCores();
      openReport(p);
      await until(function () { return records(p) === 5 && p.w.global_constant_row_info[0].col_async_data_loaded === 1; }, 'the records and columns');
      await sleep(300);
      var t = p.w.traceCores('stop').text;
      note(t.split('\n').join('\n    '));
      has(t, /request  \[L\] #(\d+) XHR GET 127\.0\.0\.1 fake_rows\.json \?prg_name=univ_wa_rnd_row_info, report_id=281, person_ids, mrn, patient_name  → 200, [\d,.   ]+ chars, \d+ ms\n\s+sent from: t4m_fake_get \(fake_cores\.html:\d+:\d+\) ← t4m_fake_load_rows_xhr/, 'the XHR: method, host, file, parameter names, status, size, duration, where from');
      has(t, /request  \[L\] #\d+ XHR POST 127\.0\.0\.1 univ_wa_log\.php \?mode  body: form prg_name=univ_wa_rnd_log, username, patient_name, mrn  → 200/, 'the POST: body parameter names, the program id only');
      var m = /request  \[L\] #(\d+) XHR GET 127\.0\.0\.1 fake_rows\.json \?prg_name=univ_wa_rnd_row_info/.exec(t);
      has(t, new RegExp('RECORDS  \\[L\\] assigned: 5 records, 38 fields each\\. BY THIS PAGE \\(the function that wrote them belongs to this page, and no report window code called it; the list itself was made in this page\\)\\. Report windows open: 1\\. While the answer to request #' + (m && m[1]) + ' was being handled\\.'), 'the write: by this page, while that request\'s answer was being handled');
      has(t, /call stack: t4m_fake_set_rows \(fake_cores\.html:\d+:\d+\) \[this page\] ← t4m_fake_rows_loaded/, 'the write\'s call stack');
      check('nothing that could tell a patient, and no parameter values', leaks(t).length === 0, leaks(t).join(', '));
      restored(p, 'xhr');
    } finally { p.close(); }
  };
  tests.trace_fetch_push = async function () {
    var p = await loadHud(await openList('fk_mode=fetch&fk_fill=push'));
    try {
      p.w.traceCores();
      openReport(p);
      await until(function () { return records(p) === 5 && p.w.global_constant_row_info[0].col_async_data_loaded === 1; }, 'the records and columns');
      await sleep(300);
      var t = p.w.traceCores('stop').text;
      note(t.split('\n').join('\n    '));
      has(t, /request  \[L\] #\d+ fetch GET 127\.0\.0\.1 fake_rows\.json \?program=univ_wa_rnd_row_info, report_id=281, person_ids, mrn  → 200/, 'the fetch: parameter names, status');
      has(t, /request  \[L\] #\d+ fetch POST 127\.0\.0\.1 univ_wa_log\.php  body: JSON program=univ_wa_rnd_log, username, patients, note  → 200/, 'the fetch POST: the JSON body\'s key names');
      has(t, /RECORDS  \[L\] assigned: 0 records\. BY THIS PAGE/, 'the empty list first');
      has(t, /RECORDS  \[L\] filled in place with push\(\) ×5 until [\d.]+ s: 5 records, 38 fields each\. BY THIS PAGE/, 'then five pushes, as one line');
      check('nothing that could tell a patient, and no parameter values', leaks(t).length === 0, leaks(t).join(', '));
      restored(p, 'fetch');
    } finally { p.close(); }
  };
  tests.trace_timer = async function () {
    var p = await loadHud(await openList('fk_mode=timer&fk_delay=500'));
    try {
      p.w.traceCores();
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(150);
      var t = p.w.traceCores('stop').text;
      has(t, /RECORDS  \[L\] assigned: 5 records, 38 fields each\. BY THIS PAGE [^\n]*Report windows open: 0\.\n\s+call stack: t4m_fake_set_rows \(fake_cores\.html:\d+:\d+\) \[this page\] ← t4m_fake_timer_fill/, 'the control: written by this page on a timer, no report window');
      check('no window.open in the timeline', !/window\.open/.test(t));
      restored(p, 'timer');
    } finally { p.close(); }
  };
  tests.trace_declared = async function () {
    var p = await loadHud(await openList('fk_mode=timer&fk_delay=500&fk_decl=var'));
    try {
      p.w.traceCores();
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(200);
      var t = p.w.traceCores('stop').text;
      note(t.split('\n').join('\n    '));
      has(t, /armed\. Records then: none \(the page declares the variable itself, so it is watched by polling: no call stacks\)/, 'a declared variable is polled, and the result says so');
      has(t, /RECORDS  \[L\] changed \(seen by polling\): 5 records, 38 fields each\. BY THIS PAGE \(the list itself was made in this page; \(the writing code could not be read, so this rests on where the list was made\)\)\. Report windows open: 0\./, 'the write is still seen, and whose list it is');
      var d = Object.getOwnPropertyDescriptor(p.w, 'global_constant_row_info');
      check('the page\'s own property was never touched', d.configurable === false && Array.isArray(d.value));
      restored(p, 'declared');
    } finally { p.close(); }
  };
  tests.trace_opener_variants = async function () {
    var p = await loadHud(await openList('fk_mode=opener&fk_fill=strict'));
    try {
      p.w.traceCores(); openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      var t = p.w.traceCores('stop').text;
      has(t, /RECORDS  \[L\] assigned: 5 records, 38 fields each\. BY THE REPORT WINDOW \[R1\] \(the report window's own script is on the call stack; the list itself was made in the report window\)/, 'strict-mode writer in the report window: told by the call stack');
    } finally { p.close(); }
    p = await loadHud(await openList('fk_mode=opener&fk_fill=push'));
    try {
      p.w.traceCores(); openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(100);
      t = p.w.traceCores('stop').text;
      has(t, /RECORDS  \[L\] filled in place with push\(\) ×5 until [\d.]+ s: 5 records, 38 fields each\. BY THE REPORT WINDOW \[R1\] \(the function that wrote them belongs to the report window/, 'the report window pushing into its opener\'s list');
      restored(p, 'opener push');
    } finally { p.close(); }
  };
  tests.trace_hud_button = async function () {
    var p = await loadHud(await openList('fk_mode=timer&fk_delay=400'));
    try {
      p.w.traceCores(); p.w.traceCores('stop');   // builds the HUD
      var btn = [].filter.call(p.d.querySelectorAll('#cores-capture-overlay button'), function (b) { return b.textContent === 'Trace'; })[0];
      check('the HUD has a Trace button beside Find / Describe / Columns / Map', !!btn && btn.previousSibling.textContent === 'Map');
      btn.click();   // the page swallows it; the HUD catches it on window, in the capture phase
      await until(function () { return p.w.traceCores('status').indexOf('armed') === 0; }, 'the Trace to arm from its button');
      check('armed: the button says Stop trace', btn.textContent === 'Stop trace');
      await until(function () { return records(p) === 5; }, 'the records');
      btn.click();
      await until(function () { return p.w.traceCores('status') === 'not armed'; }, 'the Trace to stop from its button');
      check('stopped: the button says Trace again', btn.textContent === 'Trace');
      check('clicks on the HUD itself are not in the timeline', !/cores-capture-overlay/.test(p.w.coresTrace.text) && !/click /.test(p.w.coresTrace.text), p.w.coresTrace.text);
    } finally { p.close(); }
  };

  // the Trace and a capture together, in both orders of arming: each sees the report window, the capture still
  // works, the Trace stops by itself when the capture ends, and window.open ends up as the capture left it
  async function traceWithCapture(traceFirst) {
    var p = await loadHud(await openList('fk_mode=opener')), tag = traceFirst ? 'Trace armed first' : 'capture armed first';
    try {
      if (traceFirst) p.w.traceCores();
      p.w.captureCores({ download: false, clipboard: false });
      if (!traceFirst) p.w.traceCores();
      openReport(p);
      await until(function () { return typeof p.w.coresCaptured === 'string'; }, 'the capture', 15000);
      check(tag + ': the capture took the report (5 patient rows)', (p.w.coresCaptured.match(/id="row_template_\d+"/g) || []).length === 5);
      check(tag + ': the capture carries the teams it read through the watched property', /<!-- CORES teams \{"teams":\{"ZZ Pulmonary - Consult":3,"ZZ Pulmonary IP - IP":2\}/.test(p.w.coresCaptured));
      check(tag + ': the Trace is still armed right after the capture', p.w.traceCores('status').indexOf('armed') === 0);
      await until(function () { return p.w.traceCores('status') === 'not armed'; }, 'the Trace to stop by itself', 8000);
      var t = p.w.coresTrace.text;
      has(t, /stopped by itself, after the capture ended\. Records now: 5/, tag + ': it stopped by itself after the capture');
      check(tag + ': exactly one window.open in the timeline', (t.match(/^\s*[\d.]+  open  /gm) || []).length === 1, t);
      has(t, /RECORDS  \[L\] assigned: 5 records, 38 fields each\. BY THE REPORT WINDOW \[R1\]/, tag + ': the write is seen');
      has(t, /window   \[R1\] closed/, tag + ': the report window closing is seen');
      check(tag + ': the page\'s own window.open is what the capture kept', isNative(p.w.__coresRealOpen));
      var w2 = p.w.open('about:blank', 'fake_after', 'width=200,height=200');
      check(tag + ': window.open still opens a window afterwards', !!w2); try { w2.close(); } catch (e) {}
      check(tag + ': XHR, fetch and form submit are the browser\'s own again', isNative(p.w.XMLHttpRequest.prototype.open) && isNative(p.w.fetch) && isNative(p.w.HTMLFormElement.prototype.submit));
      check(tag + ': nothing that could tell a patient in the Trace', leaks(t).length === 0, leaks(t).join(', '));
    } finally { p.close(); }
  }
  tests.trace_then_capture = function () { return traceWithCapture(true); };
  tests.capture_then_trace = function () { return traceWithCapture(false); };

  // ================= run =================
  (async function () {
    var names = Object.keys(tests).filter(function (n) { return !only || only.split(',').indexOf(n) >= 0; });
    for (var i = 0; i < names.length; i++) {
      current = names[i];
      try { await tests[current](); }
      catch (e) { fails++; lines.push('  FAIL  ' + current + ': threw ' + (e && e.stack || e)); show(); }
    }
    var verdict = (fails ? 'FAIL' : 'PASS') + ': ' + passes + ' checks passed, ' + fails + ' failed, in ' + names.length + ' tests';
    document.getElementById('result').textContent = verdict;
    document.title = fails ? 'FAIL' : 'PASS';
    window.selftestDone = { ok: !fails, passes: passes, fails: fails, text: verdict + '\n' + lines.join('\n') };
  })();

  window.selftest = { tests: tests, check: check, note: note, sleep: sleep, until: until, openList: openList, loadHud: loadHud, openReport: openReport, records: records };
})();
