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
  // fk_mode=cores (the default): CORES's own three buttons, and pressing them by hand
  var FEATURES = 'left=100,top=100,width=1250,height=850,menubar=1,toolbar=1,resizeable=1,status=1,scrollbars=1';
  function navReports(p) { return p.d.querySelector('#fake_nav div.t4m_rnd_nav_bar_container').querySelectorAll('span.nav_button')[1]; }
  function menuItems(p) { return [].slice.call(p.d.querySelectorAll('div.t4m_rnd_nav_menu > div.t4m_rnd_menu_report_item_container > div.t4m_rnd_nav_menu_item')); }
  function menuItem(p, text) { return menuItems(p).filter(function (x) { return x.textContent === (text || 'ANES ICU w/ Meds'); })[0]; }
  function justPrint(p) { return p.d.querySelector('div.t4m_rnd_dialog_content div.t4m_rnd_report_dialog_just_print_btn'); }
  async function openReportCores(p, text) {
    navReports(p).click();
    menuItem(p, text).click();
    (await until(function () { return justPrint(p); }, 'the Just Print button')).click();
    return until(function () { return p.w.fakeCores.lastReport; }, 'the report window');
  }

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

  // the default mode: the report opens the way the Trace run in CORES showed (Reports, the menu item, Just Print)
  tests.fake_cores_mode = async function () {
    var p = await openList('');
    try {
      check('cores is the default mode', p.w.fakeCores.mode === 'cores' && p.w.fakeCores.fill === 'index');
      check('the nav bar: span.nav_button in div.t4m_rnd_nav_section_dark in div.t4m_rnd_nav_bar_container, inside the list\'s container',
        p.d.querySelectorAll('div.t4m_rnd_pt_list_main > div.t4m_rnd_nav_bar_relative_anchor > div.t4m_rnd_nav_bar_container > div.t4m_rnd_nav_section_dark > span.nav_button').length === 6);
      check('the older modes\' Reports button and menu are not on the page', !p.d.querySelector('button.t4m_rnd_reports_btn') && !p.d.getElementById('t4m_reports_menu'));
      check('no records, no menu and no dialog to begin with', !('global_constant_row_info' in p.w) && !menuItems(p).length && !justPrint(p));
      navReports(p).click();
      var rows = p.w.global_constant_row_info;
      check('the Reports click fills the records at once: 5, made in this page, no report window', records(p) === 5 && rows instanceof p.w.Array && rows[0].patient_name === 'ZZTEST, ALPHA' && p.w.fakeCores.opened === 0);
      check('... and shows the menu: three items, "ANES ICU w/ Meds" first', menuItems(p).length === 3 && menuItems(p)[0].textContent === 'ANES ICU w/ Meds');
      menuItem(p).click();
      check('the menu item removes the menu; the dialog waits for its template', !p.d.querySelector('div.t4m_rnd_nav_menu') && !justPrint(p));
      var jp = await until(function () { return justPrint(p); }, 'the Just Print button');
      check('the dialog: div.t4m_rnd_dialog_content > div > div > the Just Print button',
        p.d.querySelector('div.t4m_rnd_dialog_content > div > div > div.t4m_rnd_report_dialog_just_print_btn.t4m_rnd_btn.t4m_rnd_btn_flat_blue_filled').textContent === 'Just Print');
      var t1 = performance.now();
      jp.click();
      check('Just Print closes the dialog; no window yet', !p.d.querySelector('div.t4m_rnd_dialog') && p.w.fakeCores.opened === 0);
      var pop = await until(function () { return p.w.fakeCores.lastReport; }, 'the report window');
      var dt = Math.round(performance.now() - t1);
      check('the report window opens about half a second after Just Print', dt >= 450 && dt < 2000, dt + ' ms');
      check('... by window.open with CORES\'s features', p.w.fakeCores.lastFeatures === FEATURES && p.w.fakeCores.opened === 1);
      await until(function () { return /univ_wa_rnd_build_report/.test(pop.location.href) && pop.document.querySelectorAll('tr.row_template[id]').length === 5; }, 'the report rows');
      check('the report window has CORES\'s address shape', /prg_name=univ_wa_rnd_build_report&options=report_id:281&mode=pcedge&emr_type=[^&]+&report_name=/.test(pop.location.search));
      await until(function () { return p.w.fakeCores.logPosts === 1; }, 'the usage log line');
      check('the records are the list\'s own: filled once, not by the report window', p.w.fakeCores.fills === 1 && p.w.global_constant_row_info instanceof p.w.Array);
      check('the hidden copy of the nav bar was not used', p.w.fakeCores.hiddenClicks === 0);
    } finally { p.close(); }
    p = await openList('fk_role=ask');
    try {
      navReports(p).click();
      check('fk_role=ask: the Reports click asks first: a prompt, no menu, no records', !!p.d.querySelector('div.t4m_rnd_prompt') && !menuItems(p).length && records(p) === 0);
      [].filter.call(p.d.querySelectorAll('div.t4m_rnd_prompt div.t4m_rnd_btn'), function (b) { return b.textContent === 'Provider'; })[0].click();
      check('... and goes on when it is answered', !p.d.querySelector('div.t4m_rnd_prompt') && menuItems(p).length === 3 && records(p) === 5);
    } finally { p.close(); }
    p = await openList('fk_mode=opener');
    try {
      check('an older mode has its plain Reports button and no nav bar', !!p.d.querySelector('button.t4m_rnd_reports_btn') && !p.d.querySelector('.nav_button'));
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
      has(t, /^\u2714 WHO WROTE THE RECORDS: the report window\. Its code put 5 records on this page \(its opener\), [\d.]+ s after it was opened\. The function that wrote them belongs to the report window; the list itself was made in the report window\.$/m, 'verdict: the report window wrote them into its opener');
      has(t, /^\u2192 skip\?  Not by leaving the report window out: the records came to this page FROM the report window, after 1 request of its own \(the \[R\] request lines\), and this page sent no request in between\./m, 'skip? hint: not without the report window');
      has(t, /^\u2192 automate\?  Looks possible\. The report window was opened by a plain window\.open call: 127\.0\.0\.1 fake_report\.html \?prg_name=univ_wa_rnd_build_report, options\{report_id:281\}[^\n]*, name "rnd_report_window", features "width=1100,height=800,resizable=yes,scrollbars=yes"\. It came \d+ ms after a click on [^\n]*a\.x-menu-item\.t4m_rnd_report_item\[role=menuitem\] "Anesthesia ICU w\/ Meds" \[handlers: jQuery click \(delegated on div#t4m_reports_menu\.x-menu\) t4m_fake_report_item_click[^\n]*\]\. Called from: t4m_fake_open_report \(fake_cores\.html:\d+:\d+\)/m, 'automate? hint: the click and the window.open call that opened the report');
      check('the verdict comes before the timeline', t.indexOf('WHO WROTE THE RECORDS') < t.indexOf('TIMELINE') && t.indexOf('automate?') < t.indexOf('TIMELINE'));
      check('window.coresTrace.verdict', p.w.coresTrace.verdict.who === 'report_window' && p.w.coresTrace.verdict.records === 5);
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
      has(p.w.coresTrace.text, /^\u2716 WHO WROTE THE RECORDS: not seen\. Nothing wrote window\.global_constant_row_info in the [\d.]+ s the Trace was armed, and no report window was opened: open the report while the Trace is armed\.\n\u2192 skip\?  No answer from this run\.\n\u2192 automate\?  Not seen: no window\.open call while the Trace was armed\./m, 'verdict: not seen, with what to do');
      check('verdict: not_seen', p.w.coresTrace.verdict.who === 'not_seen' && p.w.coresTrace.verdict.records === 0);
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
      has(t, new RegExp('^✔ WHO WROTE THE RECORDS: this page \\(the patient list\\)\\. Its own code wrote 5 records, while the answer to its request #' + (m && m[1]) + ' was being handled\\. Request #' + (m && m[1]) + ': XHR GET 127\\.0\\.0\\.1 fake_rows\\.json \\?prg_name=univ_wa_rnd_row_info, report_id=281, person_ids, mrn, patient_name  → 200, ', 'm'), 'verdict: this page, after its own request, named');
      has(t, /^→ skip\?  Maybe\. This page loads the records itself \(the report window does not hand them over\), but it did so [\d.]+ s after the report was opened, with a request it sent \d+ ms after window\.open \(sent from: t4m_fake_get \(fake_cores\.html:\d+:\d+\) ← t4m_fake_load_rows_xhr/m, 'skip? hint: maybe, with the request and where it is sent from');
      has(t, /^→ automate\?  Looks possible\./m, 'automate? hint');
      check('verdict: list_page', p.w.coresTrace.verdict.who === 'list_page' && p.w.coresTrace.verdict.records === 5);
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
      // the fake page's two fetches (the records, the log POST) are answered within a millisecond or two of each other,
      // so either can be the nearest one before the write: that is why the verdict calls it a hint, and both pass here
      has(t, /^✔ WHO WROTE THE RECORDS: this page \(the patient list\)\. Its own code wrote 5 records, \d+ ms after the answer to its request #\d+ came back \(the nearest request before the write(; \d+ more were answered in the 5 s before)?: a hint, not proof\)\. Request #\d+: fetch (GET 127\.0\.0\.1 fake_rows\.json \?program=univ_wa_rnd_row_info, report_id=281, person_ids, mrn|POST 127\.0\.0\.1 univ_wa_log\.php  body: JSON program=univ_wa_rnd_log, username, patients, note)  → 200/m, 'verdict: this page, after a fetch (the nearest request, as a hint)');
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
      check('no window.open in the timeline', !/^\s*[\d.]+  open  /m.test(t));
      has(t, /^\u2714 WHO WROTE THE RECORDS: this page \(the patient list\)\. Its own code wrote 5 records, with no request of this page answered in the 5 s before\./m, 'verdict: this page, no request');
      has(t, /^\u2192 skip\?  Yes, by this run: the records were written with no report window opened since the Trace was armed\./m, 'skip? hint: yes (the control)');
      has(t, /^\u2192 automate\?  Not seen: no window\.open call while the Trace was armed\./m, 'automate? hint: not seen');
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
      has(t, /RECORDS  \[L\] changed \(seen by polling\): 5 records, 38 fields each\. BY THIS PAGE \(the code that wrote them could not be read, so this rests on where the list was made; the list itself was made in this page\)\. Report windows open: 0\./, 'the write is still seen, and whose list it is');
      has(t, /^\u2714 WHO WROTE THE RECORDS: this page \(the patient list\), probably\. Its own code wrote 5 records/m, 'verdict: this page, probably (polled)');
      var d = Object.getOwnPropertyDescriptor(p.w, 'global_constant_row_info');
      check('the page\'s own property was never touched', d.configurable === false && Array.isArray(d.value));
      restored(p, 'declared');
    } finally { p.close(); }
  };
  tests.trace_poll_option = async function () {
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      p.w.traceCores({ poll: true });
      check('traceCores({poll: true}) leaves the records property alone', !('global_constant_row_info' in p.w));
      openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      check('... and the list itself', !Object.prototype.hasOwnProperty.call(p.w.global_constant_row_info, 'push'));
      await sleep(200);
      var t = p.w.traceCores('stop').text;
      has(t, /armed\. Records then: none \(watched by polling only, as asked: no call stacks\)/, 'the result says it only polled');
      has(t, /RECORDS  \[L\] changed \(seen by polling\): 5 records, 38 fields each\. BY THE REPORT WINDOW \[R1\] \(the code that wrote them could not be read, so this rests on where the list was made; the list itself was made in the report window\)\. Report windows open: 1\./, 'the write is seen, and whose list it is');
      has(t, /^✔ WHO WROTE THE RECORDS: the report window, probably\./m, 'verdict: the report window, probably');
      restored(p, 'poll option');
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
  // what the Trace run in CORES showed (2026-11-14): the list page assigns an empty list at the Reports click and
  // fills it by index within a few milliseconds, so the fill is seen only by polling; the report opens later. The
  // verdict has to name the assignment (it has the call stack), as sure, and "skip?" has to name the click
  var IN_TWO = 'it assigned an empty list and filled it in place within \\d+ ms \\(the fill was seen by polling, so the call stack is the assignment\'s\\): ';
  tests.trace_click_fill = async function () {
    var p = await loadHud(await openList('fk_mode=click&fk_fill=index'));
    try {
      p.w.traceCores();
      await sleep(100);
      p.d.querySelector('button.t4m_rnd_reports_btn').click();
      await until(function () { return records(p) === 5; }, 'the records');
      check('the Reports click filled the records, with no report window opened', p.w.fakeCores.opened === 0 && p.w.global_constant_row_info instanceof p.w.Array);
      await until(function () { return p.w.global_constant_row_info[0].col_async_data_loaded === 1; }, 'the async columns');
      p.d.querySelector('a.t4m_rnd_report_item[data-report="281"]').click();
      await until(function () { try { return /generate_pdf/.test(p.w.fakeCores.lastReport.location.href); } catch (e) { return false; } }, 'the fake PDF page');
      await sleep(200);
      var t = p.w.traceCores('stop').text;
      note(t.split('\n').join('\n    '));
      has(t, /RECORDS  \[L\] assigned: 0 records\. BY THIS PAGE \(the function that wrote them belongs to this page, and no report window code called it; the list itself was made in this page\)\. Report windows open: 0\.\n\s+call stack: t4m_fake_set_rows \(fake_cores\.html:\d+:\d+\) \[this page\] ← \S*t4m_fake_toggle_reports/, 'the empty list assigned, with its call stack');
      has(t, /RECORDS  \[L\] changed in place \(seen by polling\): 5 records, 38 fields each\. BY THIS PAGE \(the code that wrote them could not be read, so this rests on where the list was made; the list itself was made in this page\)\. Report windows open: 0\./, 'the fill by index, seen only by polling');
      has(t, new RegExp('^✔ WHO WROTE THE RECORDS: this page \\(the patient list\\)\\. Its own code wrote 5 records: ' + IN_TWO +
        't4m_fake_set_rows \\(fake_cores\\.html:\\d+:\\d+\\) \\[this page\\] ← \\S*t4m_fake_toggle_reports \\(fake_cores\\.html:\\d+:\\d+\\) \\[this page\\][^\\n]*\\. That was with no request of this page answered in the 5 s before\\. ' +
        'The function that wrote them belongs to this page, and no report window code called it; the list itself was made in this page\\.$', 'm'), 'verdict: this page, sure, naming the assignment\'s call stack');
      check('verdict: not "probably"', !/WHO WROTE THE RECORDS: this page \(the patient list\), probably/.test(t));
      has(t, /^→ skip\?  The records do not need the report window, but they do need a click: they were written \d+ ms after a click on [^\n]*button\.x-btn\.x-btn-text\.t4m_rnd_reports_btn "Reports" \[handlers: onclick → t4m_fake_toggle_reports\], before any report window was opened \(the first opened [\d.]+ s later\)\. That click set the loading off; the report window was not involved\./m, 'skip? names the click, its handlers, and says the report window was not involved');
      check('skip? is not a bare Yes', !/skip\?  Yes/.test(t));
      has(t, /^→ automate\?  Looks possible\. The report window was opened by a plain window\.open call/m, 'automate? hint');
      check('verdict: list_page, 5 records', p.w.coresTrace.verdict.who === 'list_page' && p.w.coresTrace.verdict.records === 5);
      check('nothing that could tell a patient, and no parameter values', leaks(t).length === 0, leaks(t).join(', '));
      restored(p, 'click fill');
    } finally { p.close(); }
  };
  // the whole of it on the fake page's default mode: the three clicks by hand, and a Trace that reads like the one
  // from CORES
  tests.trace_cores_mode = async function () {
    var p = await loadHud(await openList(''));
    try {
      p.w.traceCores();
      await sleep(100);
      var pop = await openReportCores(p);
      await until(function () { try { return /generate_pdf/.test(pop.location.href); } catch (e) { return false; } }, 'the fake PDF page');
      await sleep(200);
      var t = p.w.traceCores('stop').text;
      note(t.split('\n').join('\n    '));
      has(t, /click    \[L\] div\.t4m_rnd_nav_bar_relative_anchor > div\.t4m_rnd_nav_bar_container > div\.t4m_rnd_nav_section_dark > span\.nav_button \(in the patient list: text not read\)\n\s+handlers: jQuery click \(anonymous\) → [^\n]*self\.checkRequiredRoles, [^\n]*t4m\.cores\.ui\.simplePrompt, [^\n]*self\.showReportMenu/, 'the Reports click: the nav button, no text, its jQuery handler\'s calls');
      has(t, /RECORDS  \[L\] assigned: 0 records\. BY THIS PAGE [^\n]*Report windows open: 0\.\n\s+call stack: t4m_fake_set_rows \(fake_cores\.html:\d+:\d+\) \[this page\] ← \S*printReportLegacy [^\n]*onPrintReport [^\n]*broadcast [^\n]*showReportMenu /, 'the empty list: printReportLegacy < onPrintReport < broadcast < showReportMenu');
      has(t, /RECORDS  \[L\] changed in place \(seen by polling\): 5 records, 38 fields each\. BY THIS PAGE [^\n]*Report windows open: 0\./, 'the fill by index, no report window open');
      has(t, /click    \[L\] [^\n]*div\.t4m_rnd_nav_menu > div\.t4m_rnd_menu_report_item_container > div\.t4m_rnd_nav_menu_item "ANES ICU w\/ Meds"\n\s+handlers: jQuery click \(anonymous\) → t4m\.cores\.PrintReportDialog, oPrintReportDialog\.render, domReportMenu\.remove; jQuery click \(anonymous\) → oDialog\.close/, 'the menu item click, with both handlers');
      has(t, /request  \[L\] #\d+ XHR GET 127\.0\.0\.1 fake_report_template\.html \?<name>  → 200, \d+ chars, \d+ ms/, 'the template request before the dialog');
      has(t, /click    \[L\] div\.t4m_rnd_dialog_content > div > div > div\.t4m_rnd_report_dialog_just_print_btn\.t4m_rnd_btn\.t4m_rnd_btn_flat_blue_filled "Just Print"\n\s+handlers: jQuery click \(anonymous\) → _printReport\.call, oPrintReportDialog\.close/, 'the Just Print click');
      has(t, new RegExp('open     \\[L\\] window\\.open 127\\.0\\.0\\.1 fake_report\\.html \\?prg_name=univ_wa_rnd_build_report, options\\{report_id:281\\}, mode, emr_type, report_name, fk_mode, fk_fill  name "<name>"  features "' + FEATURES + '"  → the report window \\[R1\\]'), 'window.open with CORES\'s features');
      has(t, new RegExp('^✔ WHO WROTE THE RECORDS: this page \\(the patient list\\)\\. Its own code wrote 5 records: ' + IN_TWO + 't4m_fake_set_rows \\(fake_cores\\.html:\\d+:\\d+\\) \\[this page\\] ← \\S*printReportLegacy ', 'm'), 'verdict: this page, by the assignment\'s stack');
      has(t, /^→ skip\?  The records do not need the report window, but they do need a click: they were written \d+ ms after a click on [^\n]*span\.nav_button \(in the patient list: text not read\) \[handlers: jQuery click \(anonymous\) → [^\n]*self\.showReportMenu\], before any report window was opened \(the first opened [\d.]+ s later\)\./m, 'skip?: the Reports click, not the report window');
      has(t, /^→ automate\?  Looks possible\. [^\n]*It came \d+ ms after a click on [^\n]*div\.t4m_rnd_report_dialog_just_print_btn[^\n]* "Just Print" \[handlers: jQuery click \(anonymous\) → _printReport\.call, oPrintReportDialog\.close\]/m, 'automate?: the Just Print click and window.open');
      var m = /It came (\d+) ms after a click/.exec(t);
      check('window.open came about half a second after Just Print', m && +m[1] >= 450 && +m[1] < 2000, m && m[1]);
      check('nothing that could tell a patient, and no parameter values', leaks(t).length === 0, leaks(t).join(', '));
      restored(p, 'cores mode');
    } finally { p.close(); }
  };
  tests.trace_index_fill_variants = async function () {
    // no click and no report: still "Yes, by this run", with the assignment's stack
    var p = await loadHud(await openList('fk_mode=timer&fk_delay=400&fk_fill=index'));
    try {
      p.w.traceCores();
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(150);
      var t = p.w.traceCores('stop').text;
      has(t, new RegExp('^✔ WHO WROTE THE RECORDS: this page \\(the patient list\\)\\. Its own code wrote 5 records: ' + IN_TWO + 't4m_fake_set_rows \\(fake_cores\\.html:\\d+:\\d+\\) \\[this page\\] ← t4m_fake_timer_fill', 'm'), 'on a timer, filled by index: this page, sure, by the assignment\'s stack');
      has(t, /^→ skip\?  Yes, by this run: the records were written with no report window opened since the Trace was armed\./m, 'with no click before it, skip? stays "Yes, by this run"');
    } finally { p.close(); }
    // the report window assigning an empty list into its opener and filling it by index
    p = await loadHud(await openList('fk_mode=opener&fk_fill=index'));
    try {
      p.w.traceCores(); openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(150);
      t = p.w.traceCores('stop').text;
      has(t, new RegExp('^✔ WHO WROTE THE RECORDS: the report window\\. Its code put 5 records on this page \\(its opener\\), [\\d.]+ s after it was opened: ' + IN_TWO + 'fake_fill_opener \\(fake_report\\.html:\\d+:\\d+\\) \\[report window\\] ← fake_after_render', 'm'), 'the report window filling by index: sure, by the assignment\'s stack');
      has(t, /^→ skip\?  Not by leaving the report window out/m, 'skip? for the report window is unchanged');
      restored(p, 'opener index');
    } finally { p.close(); }
    // one assignment right after the click, and no report opened at all
    p = await loadHud(await openList('fk_mode=click'));
    try {
      p.w.traceCores();
      p.d.querySelector('button.t4m_rnd_reports_btn').click();
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(100);
      t = p.w.traceCores('stop').text;
      has(t, /^✔ WHO WROTE THE RECORDS: this page \(the patient list\)\. Its own code wrote 5 records, with no request of this page answered in the 5 s before\./m, 'one assignment after the click: worded as before');
      has(t, /^→ skip\?  The records do not need the report window, but they do need a click: they were written \d+ ms after a click on [^\n]*t4m_rnd_reports_btn "Reports" \[handlers: onclick → t4m_fake_toggle_reports\], before any report window was opened \(none was opened while the Trace was armed\)\./m, 'skip? names the click when no report was opened at all');
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

  // ================= M3: the result in the HUD =================
  tests.trace_result_in_hud = async function () {
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      var copied = null;
      p.w.navigator.clipboard.writeText = function (x) { copied = x; return Promise.resolve(); };
      p.w.traceCores({ hud: true });
      openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      p.w.traceCores('stop', { hud: true });
      var hud = p.d.getElementById('cores-capture-overlay'), box = [].filter.call(hud.querySelectorAll('div'), function (d) { return d.firstChild && d.firstChild.textContent === 'Trace: what loads CORES\'s patient records'; })[0];
      check('the result is shown in the HUD, title first', !!box);
      var shown = [].map.call(box.children, function (c) { return c.tagName === 'BUTTON' ? '' : c.textContent; }).join('\n');
      check('the HUD shows the verdict and the timeline', /WHO WROTE THE RECORDS: the report window/.test(shown) && /skip\?/.test(shown) && /automate\?/.test(shown) && /TIMELINE/.test(shown) && /RECORDS  \[L\] assigned: 5 records/.test(shown));
      check('nothing that could tell a patient anywhere in the HUD', leaks(hud.textContent).length === 0, leaks(hud.textContent).join(', '));
      var cb = box.querySelector('button');
      check('it has a Copy for Claude button', !!cb && cb.textContent === 'Copy for Claude');
      cb.click();   // swallowed by the page; caught by the HUD on window
      await until(function () { return copied !== null; }, 'the copy');
      check('Copy for Claude puts the whole result on the clipboard', copied === p.w.coresTrace.text && /TIMELINE/.test(copied));
      await until(function () { return /^Copied for Claude/.test(cb.textContent); }, 'the button to say Copied');
      check('nothing that could tell a patient in what is copied', leaks(copied).length === 0, leaks(copied).join(', '));
    } finally { p.close(); }
  };
  tests.trace_already_there = async function () {
    var p = await loadHud(await openList('fk_mode=timer&fk_delay=100'));
    try {
      await until(function () { return records(p) === 5; }, 'the records');
      await sleep(600);   // the columns have loaded too
      p.w.traceCores();
      await sleep(200);
      var t = p.w.traceCores('stop').text;
      has(t, /^\u2716 WHO WROTE THE RECORDS: not seen\. They were already on the page when the Trace was armed \(5 records\) and nothing rewrote them\. For the answer: press F5 in CORES/m, 'armed too late: says so, and what to do');
      check('verdict: already_there', p.w.coresTrace.verdict.who === 'already_there');
      check('the HUD warned at arming', /the patient records are already on this page \(5\)/.test(p.d.getElementById('cores-capture-overlay').textContent));
      restored(p, 'already there');
      check('the records are untouched', records(p) === 5 && Object.getOwnPropertyDescriptor(p.w, 'global_constant_row_info').writable === true);
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

  // ================= M4: the HUD's event log, carried by each capture =================
  var LOG_KEY = 'cores-capture-log';
  function logOf(capture) {   // the capture's CORES log comment, and where it sits
    var m = /<!-- CORES log (\{.*\}) -->\n<\/html>$/.exec(capture);
    return m ? { json: m[1], data: JSON.parse(m[1]), afterData: /<!-- CORES data \{.*\} -->\n<!-- CORES log \{.*\} -->\n<\/html>$/.test(capture) } : null;
  }
  function badEvents(events) {   // the shared contract with the PC side: these keys, these shapes, nothing else
    return events.filter(function (e) {
      var ks = Object.keys(e).filter(function (k) { return ['id', 't', 'ev', 'k', 'n', 'ms'].indexOf(k) < 0; });
      return ks.length || typeof e.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(e.id) || typeof e.t !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.t) || isNaN(Date.parse(e.t)) ||
        typeof e.ev !== 'string' || !/^[a-z_]{2,30}$/.test(e.ev) || (e.k !== undefined && (typeof e.k !== 'string' || !/^[a-z0-9_]{1,30}$/.test(e.k))) ||
        (e.n !== undefined && !(Number.isInteger(e.n) && e.n >= 0)) || (e.ms !== undefined && !(Number.isInteger(e.ms) && e.ms >= 0));
    });
  }
  function find(events, ev, k) { return events.filter(function (e) { return e.ev === ev && (k === undefined || e.k === k); }); }
  async function capture(p, opts) {
    var before = p.w.coresCaptured;
    p.w.coresCaptured = undefined;
    p.w.captureCores(opts);
    openReport(p);
    await until(function () { return typeof p.w.coresCaptured === 'string'; }, 'the capture', 15000);
    void before;
    return p.w.coresCaptured;
  }
  tests.log_comment = async function () {
    localStorage.removeItem(LOG_KEY);
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      var cap = await capture(p, { download: false, clipboard: false });
      var lg = logOf(cap);
      check('the capture ends with a CORES log comment, just before </html>', !!lg, cap.slice(-300));
      check('it comes after the CORES data comment', lg.afterData);
      check('{"v":1,"events":[...]}', lg.data.v === 1 && Array.isArray(lg.data.events) && Object.keys(lg.data).join() === 'v,events');
      var ev = lg.data.events;
      note(lg.json);
      check('every event keeps to the contract (id, t, ev, optional k / n / ms; nothing else)', badEvents(ev).length === 0, JSON.stringify(badEvents(ev)));
      check('ids are unique, one session prefix + a counter', new Set(ev.map(function (e) { return e.id; })).size === ev.length && new Set(ev.map(function (e) { return e.id.split('-')[0]; })).size === 1);
      check('key order as in the contract', /^\{"v":1,"events":\[\{"id":"[a-z0-9]{6}-1","t":"[^"]+","ev":"armed","k":"window"\}/.test(lg.json), lg.json.slice(0, 200));
      check('armed (window), report_opened (window), report_loaded with ms', find(ev, 'armed', 'window').length === 1 && find(ev, 'report_opened', 'window').length === 1 && find(ev, 'report_loaded').length === 1 && find(ev, 'report_loaded')[0].ms >= 0);
      var r = find(ev, 'rendered', 'form_submit')[0];
      check('rendered: how, patient rows, duration', !!r && r.n === 5 && r.ms > 0, JSON.stringify(r));
      check('teams and clinical: found, 5 patients', find(ev, 'teams', 'found')[0].n === 5 && find(ev, 'clinical', 'found')[0].n === 5);
      check('this capture\'s own verdict is not in it yet (it travels in the next one)', find(ev, 'verdict').length === 0);
      check('escaped like the CORES data comment: no <, > or -- inside', !/[<>]|--/.test(lg.json));
      await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 1; }, 'the verdict event');
      var v = find(p.w.captureCores.events(), 'verdict')[0];
      check('verdict: success, 5 rows, ms', v.k === 'success' && v.n === 5 && v.ms > 0, JSON.stringify(v));
      check('the events are kept in localStorage', JSON.parse(localStorage.getItem(LOG_KEY)).events.length === p.w.captureCores.events().length);

      // a HUD tool, then a second capture in the same session, with the clipboard on
      p.w.mapCores({ hud: true });
      var copied = null; p.w.navigator.clipboard.writeText = function (x) { copied = x; return Promise.resolve(); };
      await sleep(700);   // the first report window has closed
      var cap2 = await capture(p, { download: false });
      var ev2 = logOf(cap2).data.events;
      check('the next capture carries the first one\'s verdict and the tool use', find(ev2, 'verdict', 'success').length === 1 && find(ev2, 'tool', 'map').length === 1 && find(ev2, 'armed').length === 2);
      check('still to the contract', badEvents(ev2).length === 0, JSON.stringify(badEvents(ev2)));
      await until(function () { return find(p.w.captureCores.events(), 'copied').length === 1; }, 'the copied event');
      check('copied: which way', ['popup', 'window', 'exec'].indexOf(find(p.w.captureCores.events(), 'copied')[0].k) >= 0);
      await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 2; }, 'the second verdict');

      // log: false leaves the comment out
      await sleep(700);
      var cap3 = await capture(p, { download: false, clipboard: false, log: false });
      check('captureCores({log: false}) leaves the comment out', !/CORES log/.test(cap3) && /<!-- CORES data \{.*\} -->\n<\/html>$/.test(cap3));
      await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 3; }, 'the third verdict');
    } finally { p.close(); }

    // a new session (a new paste of the script): the stored events travel on, under a second session prefix
    var stored = JSON.parse(localStorage.getItem(LOG_KEY)).events.length;
    p = await loadHud(await openList('fk_mode=opener'));
    try {
      var cap4 = await capture(p, { download: false, clipboard: false, data: false });
      var ev4 = logOf(cap4).data.events;
      check('a later session carries the earlier sessions\' events', ev4.length > stored && new Set(ev4.map(function (e) { return e.id.split('-')[0]; })).size === 2, ev4.length + ' vs ' + stored);
      check('data: false is logged as clinical off, and the log comment stands alone before </html>', find(ev4, 'clinical', 'off').length === 1 && !/CORES data/.test(cap4));
      check('oldest first', ev4.every(function (e, i) { return !i || ev4[i - 1].t <= e.t; }));
      await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 4; }, 'the fourth verdict');
    } finally { p.close(); }

    // what is stored is never trusted: anything off the contract is dropped, and only the newest 300 travel
    var old = [], junk = [
      { id: 'junk-1', t: '2026-11-14T07:00:00.000Z', ev: 'verdict', k: 'success', text: 'ZZTEST, ALPHA' },        // an extra key
      { id: 'junk-2', t: '2026-11-14T07:00:00.000Z', ev: 'dialog', k: 'ZZTEST said no' },                          // free text as k
      { id: 'junk-3', t: '2026-11-14T07:00:00.000Z', ev: 'searched_for_zztest' },                                  // not in the vocabulary
      { id: 'junk-4', t: '2026-11-14T07:00:00.000Z', ev: 'rendered', n: -1 }, { id: 'junk-5', t: '2026-11-14T07:00:00.000Z', ev: 'rendered', n: '9990001' },
      { id: 'JUNK 6', t: '2026-11-14T07:00:00.000Z', ev: 'armed' }, { id: 'junk-7', t: 'ZZTEST', ev: 'armed' }, 'ZZTEST, ALPHA', null];
    for (var i = 0; i < 310; i++) old.push({ id: 'oldone-' + i, t: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(), ev: 'reload', n: i });
    localStorage.setItem(LOG_KEY, JSON.stringify({ v: 1, events: junk.concat(old) }));
    p = await loadHud(await openList('fk_mode=opener'));
    try {
      var cap5 = await capture(p, { download: false, clipboard: false });
      var l5 = logOf(cap5), ev5 = l5.data.events;
      check('only the newest 300 events travel', ev5.length === 300 && ev5[ev5.length - 1].ev === 'clinical' && ev5[0].id.indexOf('oldone-') === 0, ev5.length);
      check('stored events off the contract are dropped', badEvents(ev5).length === 0 && !/junk|JUNK|ZZTEST|9990001|searched/.test(l5.json), l5.json.slice(0, 300));
      await until(function () { return find(p.w.captureCores.events(), 'verdict').length >= 1; }, 'the verdict');
      check('the stored log is capped at 300 too', JSON.parse(localStorage.getItem(LOG_KEY)).events.length === 300);
    } finally { p.close(); localStorage.removeItem(LOG_KEY); }
  };
  tests.log_trace_events = async function () {
    localStorage.removeItem(LOG_KEY);
    var p = await loadHud(await openList('fk_mode=opener'));
    try {
      p.w.traceCores(); openReport(p);
      await until(function () { return records(p) === 5; }, 'the records');
      p.w.traceCores('stop');
      var ev = p.w.captureCores.events();
      check('trace_started, then trace_done with who, records and duration', ev.length === 2 && ev[0].ev === 'trace_started' && ev[1].ev === 'trace_done' && ev[1].k === 'report_window' && ev[1].n === 5 && ev[1].ms > 0, JSON.stringify(ev));
      check('to the contract', badEvents(ev).length === 0);
    } finally { p.close(); localStorage.removeItem(LOG_KEY); }
  };

  // ================= selftest.html?capture=1: no tests, one capture of the fake report =================
  // For trying the PC side on a capture with no patient in it (node test/run_selftest.mjs --capture FILE, then
  // cores generate FILE): the second of two captures in a row, so its CORES log comment also carries the first
  // one's verdict.
  if (new URLSearchParams(location.search).get('capture')) {
    (async function () {
      try {
        var p = await loadHud(await openList('fk_mode=opener'));
        await capture(p, { download: false, clipboard: false });
        await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 1; }, 'the first verdict', 15000);
        await sleep(800);   // the first report window has closed
        var text = await capture(p, { download: false, clipboard: false });
        await until(function () { return find(p.w.captureCores.events(), 'verdict').length === 2; }, 'the second verdict', 15000);
        p.close();
        document.getElementById('result').textContent = 'fake capture made (' + text.length + ' chars)';
        window.selftestDone = { ok: true, capture: true, text: text };
      } catch (e) { window.selftestDone = { ok: false, text: 'the fake capture failed: ' + (e && e.stack || e) }; }
    })();
    return;
  }

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
