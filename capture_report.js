// CORES report capture — run from the DevTools console (or a Sources > Snippets snippet) of the CORES PATIENT LIST
// window (the Cerner-hosted one). Paste this whole file, press Enter, then run:
//
//     captureCores(281)                      // 281 = Anesthesia ICU w/ Meds
//     captureCores(8)                        // 8   = I-PASS Detailed
//     captureCores(281, {download: false})   // clipboard only: no download, no save dialog
//     captureCores(281, {folder: true})      // also write the file into a folder you pick once (remembered)
//     captureCores(281, {timeout: 180})      // seconds to wait for the report (default 120)
//
// (`cores capture` on your PC puts this file on the clipboard with the captureCores(...) line already added.)
//
// It opens the report the same way CORES does (a popup whose opener is the patient list, so the report can borrow
// the Cerner CCL bridge from it) and grabs the fully rendered report HTML:
//   - for PDF-type reports it intercepts the hidden form the app submits to generate_pdf_2.php and keeps its "html"
//     field instead of letting it turn into a PDF;
//   - for HTML-type reports it waits until the patient rows have rendered and settled, then takes the document.
// The HTML is then delivered every way that is switched on (defaults: clipboard + download):
//   - clipboard: the whole report goes on the clipboard, which Citrix relays to your PC; there run
//         cores run --clipboard            (or keep  cores watch --clipboard --print  running)
//     and it is saved into reports\ and turned into the Daily Report without any download;
//   - download: saved by the browser as "CORES report <id> <date> <time>.html", as before;
//   - folder: written straight into a folder chosen with the browser's folder picker (Chromium's File System
//     Access API; the choice is remembered in this browser; one click when the browser asks for permission again).
// The popup closes itself. The HTML is also kept in window.coresCaptured.
(function () {
  var BASE = location.origin + '/cores/uab/prod/cores.4.11.0/base/public_web/';
  var DB = 'cores-capture', STORE = 'kv';

  function log(msg, ok) { console.log('%cCORES capture: ' + msg, ok === false ? 'color:#b00020;font-weight:bold' : 'color:green;font-weight:bold'); }

  // ---- a small banner at the top of the patient list, for the steps that need a click
  var banner = null;
  function showBanner(msg, buttons) {
    if (!banner || !banner.isConnected) {
      banner = document.createElement('div');
      banner.id = 'cores-capture-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1f4e79;color:#fff;' +
        'font:14px/1.5 Segoe UI,Arial,sans-serif;padding:8px 40px 8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.4)';
      document.body.appendChild(banner);
    }
    banner.innerHTML = '';
    banner.appendChild(document.createTextNode(msg + ' '));
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.textContent = b[0];
      el.style.cssText = 'font:inherit;margin-left:8px;padding:3px 10px;cursor:pointer';
      el.onclick = function () { b[1](el); };
      banner.appendChild(el);
    });
    var x = document.createElement('button');
    x.textContent = '×'; x.title = 'close';
    x.style.cssText = 'position:absolute;top:6px;right:10px;font:inherit;cursor:pointer';
    x.onclick = function () { banner.remove(); banner = null; };
    banner.appendChild(x);
  }

  // ---- IndexedDB, to remember the chosen folder handle (a DirectoryHandle can be stored, unlike a path)
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        t.onsuccess = function () { res(t.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
        t.onsuccess = function () { res(); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  // ---- clipboard: DevTools' own copy() helper first (it works from the console even while the page is not focused),
  // then the async clipboard API, then the old execCommand path; the last resort is a button, since a click always works
  function copyText(text, name) {
    var done = 'report HTML is on the clipboard (' + text.length.toLocaleString() + ' chars); on your PC run   cores run --clipboard';
    try {
      if (typeof copy === 'function' && !Object.prototype.hasOwnProperty.call(window, 'copy')) { copy(text); log(done); return Promise.resolve(true); }
    } catch (e) {}
    var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard API'));
    return p.then(function () { log(done); return true; }, function () {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e) {}
      if (ok) { log(done); return true; }
      showBanner('CORES capture "' + name + '" is ready.', [['Copy to clipboard', function (el) {
        navigator.clipboard.writeText(text).then(function () { el.textContent = 'Copied'; log(done); },
          function (e) { el.textContent = 'Copy failed: ' + e.message; });
      }]]);
      log('could not copy automatically; click "Copy to clipboard" in the banner at the top of the patient list', false);
      return false;
    });
  }

  // ---- folder: File System Access API (Chromium). The picker and permission prompts need a click, hence the banner.
  function pickFolder() {
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'cores-capture' }).then(function (dir) {
      return idbSet('dir', dir).catch(function () {}).then(function () { return dir; });  // remembered when the browser allows it
    });
  }
  function writeInto(dir, text, name) {
    return dir.getFileHandle(name, { create: true })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
      .then(function () { log('saved ' + name + ' into the folder "' + dir.name + '"'); showBanner('CORES capture: saved ' + name + ' into "' + dir.name + '".'); return true; });
  }
  function saveToFolder(text, name) {
    if (!window.showDirectoryPicker) {
      log('this browser has no folder picker (File System Access API); the folder option is ignored', false);
      return Promise.resolve(false);
    }
    var failed = function (el) { return function (e) { el.textContent = 'Failed: ' + e.message; log('folder save failed: ' + e.message, false); }; };
    return idbGet('dir').catch(function () { return null; }).then(function (dir) {
      if (!dir) {
        showBanner('CORES capture "' + name + '" is ready. Choose the folder for captures (remembered next time):',
          [['Choose folder…', function (el) { pickFolder().then(function (d) { return writeInto(d, text, name); }).catch(failed(el)); }]]);
        return false;
      }
      return dir.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state === 'granted') return writeInto(dir, text, name);
        showBanner('CORES capture "' + name + '" is ready.', [
          ['Save to "' + dir.name + '"', function (el) {
            dir.requestPermission({ mode: 'readwrite' }).then(function (s) { if (s !== 'granted') throw new Error('permission ' + s); return writeInto(dir, text, name); }).catch(failed(el));
          }],
          ['Choose another folder…', function (el) { pickFolder().then(function (d) { return writeInto(d, text, name); }).catch(failed(el)); }]
        ]);
        return false;
      });
    }).catch(function (e) { log('folder save failed: ' + e.message, false); return false; });
  }

  // ---- deliver the captured HTML every way that is switched on
  function deliver(html, name, opts) {
    opts = opts || {};
    var text = '<!-- CORES capture ' + name + ' -->\n' + html;   // the name travels with the text (used by cores --clipboard)
    window.coresCaptured = text;
    var jobs = [];
    if (opts.clipboard !== false) jobs.push(copyText(text, name));
    if (opts.folder) jobs.push(saveToFolder(text, name));
    if (opts.download !== false) {
      try {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        log('download started: ' + name);
      } catch (e) { log('download failed: ' + e.message, false); }
    }
    return Promise.all(jobs);
  }

  window.captureCores = function (reportId, opts) {
    opts = opts || {};
    var inPowerChart = false;
    try { inPowerChart = 'DiscernObjectFactory' in window.external; } catch (e) {}
    if (!inPowerChart && !localStorage.getItem('site_code_response')) {
      console.warn('CORES capture: this window is not Cerner-hosted and has no CORES site-code record; ' +
        'the report will probably fail to initialise. Run this from the CORES patient list window.');
    }
    var url = BASE + '?prg_name=univ_wa_rnd_build_report&options=report_id:' + reportId +
      '&mode=pcedge&emr_type=CERNER-CCL-V4&report_name=univ_wa_rnd_api';
    var popup = window.open(url, 'cores_capture_' + reportId, 'width=1400,height=900');
    if (!popup) {
      console.error('CORES capture: window.open was blocked. Allow popups for this site and try again.');
      return;
    }

    var done = false, lastRows = 0, lastChange = Date.now(), timer, killer;

    function wrap(inner) { return '<html>' + inner + '</html>'; }

    function finish(html, how) {
      if (done) return;
      done = true;
      clearInterval(timer); clearTimeout(killer);
      var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes());
      var name = (opts.name || ('CORES report ' + reportId)) + ' ' + stamp + '.html';
      var rows = (html.match(/class="row_template[ "]/g) || []).length;
      log('captured (' + how + '): ' + html.length.toLocaleString() + ' chars, ' + rows + ' patient rows -> ' + name);
      deliver(html, name, opts);
      setTimeout(function () { try { (popup.__realClose || popup.close).call(popup); } catch (e) {} }, 1500);
      return name;
    }

    timer = setInterval(function () {
      var w = popup, d;
      if (w.closed) { clearInterval(timer); clearTimeout(killer); if (!done) console.error('CORES capture: the report window closed before anything was captured.'); return; }
      try { d = w.document; } catch (e) { return; }  // cross-origin (e.g. login redirect) = wait
      if (!d || !d.location || d.location.href === 'about:blank') return;
      if (!w.__coresHooked) {
        w.__coresHooked = true;   // marker lives on the inner window, so a re-navigation gets re-hooked
        // PDF-type reports: the app builds <form><input name=options><input name=html></form> and calls form.submit()
        w.HTMLFormElement.prototype.submit = function () {
          var f = this.querySelector('input[name="html"]');
          if (f && /<\w+/.test(f.value)) finish(f.value, 'form submit intercepted');
          else console.warn('CORES capture: a form was submitted without an html field', this);
        };
        // HTML-type reports: the app may call window.print() once rendered
        w.print = function () { finish(wrap(d.documentElement.innerHTML), 'window.print intercepted'); };
        w.__realClose = w.close;
        w.close = function () { console.warn('CORES capture: report window tried to close itself; ignored'); };
      }
      // Fallback for HTML-type reports: rows rendered and stable for 6 s with no loading mask
      var rows = d.querySelectorAll('tr.row_template').length;
      if (rows !== lastRows) { lastRows = rows; lastChange = Date.now(); }
      var masked = d.querySelector('.loadmask, .loadmask-msg');
      if (rows > 0 && !masked && Date.now() - lastChange > 6000) finish(wrap(d.documentElement.innerHTML), 'rendered and idle');
    }, 25);

    killer = setTimeout(function () {
      if (done) return;
      clearInterval(timer);
      var d = null; try { d = popup.document; } catch (e) {}
      var rows = d ? d.querySelectorAll('tr.row_template').length : 0;
      if (rows) finish(wrap(d.documentElement.innerHTML), 'timeout with rows present');
      else console.error('CORES capture: timed out with no report rows. Check the popup window for an error dialog.');
    }, (opts.timeout || 120) * 1000);

    log('opened report ' + reportId + ' in a popup; waiting for it to render…');
    return 'capturing…';
  };
  // helpers, also usable on their own:  captureCores.chooseFolder()  shows the folder button;  captureCores.deliver(html, name, opts)
  window.captureCores.chooseFolder = function () {
    if (!window.showDirectoryPicker) { log('this browser has no folder picker', false); return; }
    showBanner('Choose the folder for CORES captures:', [['Choose folder…', function (el) {
      pickFolder().then(function (d) { el.textContent = 'Saving into "' + d.name + '"'; log('captures will be saved into "' + d.name + '"'); },
        function (e) { el.textContent = 'Failed: ' + e.message; });
    }]]);
  };
  window.captureCores.deliver = deliver;
})();
