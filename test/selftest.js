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
