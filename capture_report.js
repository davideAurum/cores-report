// CORES report capture — run from the DevTools console (or a Sources > Snippets snippet) of the CORES PATIENT LIST
// window (the Cerner-hosted one). Paste this whole file and press Enter, then:
//
//     captureCores()          ARMED mode (default): now open the report from CORES as you normally do (its own report /
//                             print button). The window CORES opens is captured as soon as the report has rendered,
//                             with everything CORES passes it, so it works exactly when CORES's own button works.
//     captureCores(281)       DIRECT mode: the script opens the report itself in a popup (281 = Anesthesia ICU w/ Meds,
//                             8 = I-PASS Detailed, 7 = Medicine Report +VS/Meds). Quicker, but CORES sometimes answers
//                             "Can't Load Patient List" to a window it did not open itself.
//     options, either mode:   captureCores({download: false})  clipboard only, no download / save dialog
//                             captureCores({folder: true})     also write the file into a folder you pick once
//                             captureCores({timeout: 180})     seconds to wait for the report (default 120)
//                             captureCores({retries: 4})       Reload presses when CORES says it cannot load the list (default 2)
//                             captureCores(281, {download: false})   direct mode with options
//
// (`cores capture` on your PC puts this file on the clipboard with the captureCores(...) line already added.)
//
// How the report HTML is grabbed (same in both modes):
//   - for PDF-type reports the hidden form the app submits to generate_pdf_2.php is intercepted and its "html" field
//     kept, instead of letting it turn into a PDF;
//   - for HTML-type reports the script waits until the patient rows have rendered and settled, then takes the document.
// If CORES puts up "Can't Load Patient List" in the report window, the script presses OK and the window's own Reload
// button (CORES's own advice), a couple of times, before giving up and showing the dialog text.
// The HTML is then delivered every way that is switched on (defaults: clipboard + download):
//   - clipboard: the whole report goes on the clipboard, which Citrix relays to your PC; there run
//         cores generate                   (or keep  cores watch --clipboard --print  running)
//     and it is saved into reports\ and turned into the Daily Report without any download;
//   - download: saved by the browser as "CORES report <id> <date> <time>.html";
//   - folder: written straight into a folder chosen with the browser's folder picker (Chromium's File System
//     Access API; the choice is remembered in this browser; one click when the browser asks for permission again).
// The report window closes itself after a capture and stays open after a failure. If the clipboard could not be
// written automatically (the CORES page keeps the focus away from it), a banner at the top of the patient list offers
// a "Copy to clipboard" button; one click does it. The HTML is also kept in window.coresCaptured.
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

  // ---- clipboard. DevTools' own copy() helper is only visible while the pasted script is being evaluated, so it is
  // caught here, at paste time, for later; the clipboard API needs the page to be focused, which it is not while the
  // report window is up, so it is retried for a few seconds after that window has closed; then the old execCommand
  // path; the last resort is a button, since a click always works.
  var devtoolsCopy = null;
  try { if (typeof copy === 'function' && !Object.prototype.hasOwnProperty.call(window, 'copy')) devtoolsCopy = copy; } catch (e) {}

  function copyText(text, name, attempt, popup) {
    attempt = attempt || 1;
    var done = 'report HTML is on the clipboard (' + text.length.toLocaleString() + ' chars); on your PC run   cores generate';
    var why = [];
    if (devtoolsCopy) {
      try { devtoolsCopy(text); log(done + ' (DevTools copy)'); return Promise.resolve(true); } catch (e) { why.push('DevTools copy(): ' + (e && e.message || e)); }
    } else why.push('no DevTools copy() helper (the page has its own "copy")');
    // the report window is the focused one right after the capture (it was just opened by your click), and the clipboard
    // API only writes from a focused document: try from there first, then from this window
    var viaPopup = null;
    try {
      if (popup && !popup.closed && popup.navigator && popup.navigator.clipboard && popup.navigator.clipboard.writeText) {
        try { popup.focus(); } catch (e) {}
        viaPopup = popup.navigator.clipboard.writeText(text);
      }
    } catch (e) { viaPopup = Promise.reject(e); }
    if (!viaPopup) viaPopup = Promise.reject(new Error('no report window'));
    var p = viaPopup.then(function () { return 'the report window'; }, function (e1) {
      why.push('report window: ' + (e1 && e1.message || e1));
      try { window.focus(); } catch (e) {}
      if (!(navigator.clipboard && navigator.clipboard.writeText)) throw new Error('no clipboard API on this page');
      return navigator.clipboard.writeText(text).then(function () { return 'this window'; });
    });
    return p.then(function (via) { log(done + ' (via ' + via + ')'); return true; }, function (e) {
      why.push('clipboard API: ' + (e && e.message || e));
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
        if (!ok) why.push('execCommand copy refused');
      } catch (e2) { why.push('execCommand: ' + (e2 && e2.message || e2)); }
      if (ok) { log(done); return true; }
      if (attempt < 4) {   // the report window (which had the focus) closes 1.5 s after the capture: try again once it is gone
        return new Promise(function (res) { setTimeout(function () { res(copyText(text, name, attempt + 1, null)); }, 2000); });
      }
      showBanner('CORES capture "' + name + '" is ready.', [['Copy to clipboard', function (el) {
        navigator.clipboard.writeText(text).then(function () { el.textContent = 'Copied'; log(done); },
          function (e3) { el.textContent = 'Copy failed: ' + e3.message; });
      }]]);
      log('could not copy automatically (' + why.join('; ') + '). Click "Copy to clipboard" in the banner at the top of the ' +
        'patient list (one click; that always works).', false);
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
    html = String(html).replace(/\r\n/g, '\n');   // so the clipboard, download and folder copies are byte-identical
    var text = '<!-- CORES capture ' + name + ' -->\n' + html;   // the name travels with the text (used by cores --clipboard)
    window.coresCaptured = text;
    var jobs = [];
    if (opts.clipboard !== false) jobs.push(copyText(text, name, 1, opts.popup || null));
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

  // ---- looking into the report window
  // rendered patient rows: CORES gives them ids (row_template_1, row_template_2, ...); the empty template row has none
  function renderedRows(d) {
    var trs = d.querySelectorAll('tr.row_template[id]'), n = 0;
    for (var i = 0; i < trs.length; i++) if ((trs[i].textContent || '').trim()) n++;
    return n;
  }
  function buttonNamed(d, label) {
    var els = d.querySelectorAll('button, a, input[type="button"], input[type="submit"], .x-btn, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].value || els[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.toLowerCase() === label.toLowerCase()) return els[i];
    }
    return null;
  }
  // CORES's known failure dialog. Only its own wording counts, and only while no patient row has rendered: once rows
  // are there the page text is clinical free text, which must never be mistaken for a dialog nor echoed to the console
  var CORES_DIALOG = /Can't Load Patient List|Unable to load the patient list from CORES/i;
  var DIALOG_SEL = '.x-window, .x-msg-box, .x-message-box, [role="alertdialog"], [role="dialog"], .ui-dialog';
  function dialogText(d) {
    if (renderedRows(d) > 0) return '';
    var dlg = d.querySelector(DIALOG_SEL);
    var t = dlg ? (dlg.textContent || '').replace(/\s+/g, ' ') : '';
    if (!CORES_DIALOG.test(t) && d.body) t = (d.body.innerText || '').replace(/\s+/g, ' ');
    var m = CORES_DIALOG.exec(t);
    return m ? m[0] : '';
  }
  // what a report window shows when it did not render; no page text, which could be patient text
  function describePopup(d) {
    var bits = ['title "' + (d.title || '') + '"', renderedRows(d) + ' rendered rows', d.querySelectorAll('tr.row_template').length + ' row template(s)'];
    var dlg = renderedRows(d) === 0 ? d.querySelector(DIALOG_SEL) : null;
    var t = dlg ? (dlg.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : dialogText(d);
    bits.push(t ? 'dialog: ' + t : (d.body && d.body.innerText || '').length + ' chars of page text (not shown)');
    return bits.join(' | ');
  }
  function reportIdOf(href) {
    var m = /report_id(?::|%3A)(\d+)/i.exec(href || '');
    return m ? m[1] : '';
  }

  // ---- watch a report window (opened by CORES itself, or by captureCores(id)) until the report is in hand
  function watchReport(popup, opts, reportId) {
    var retries = opts.retries === undefined ? 2 : opts.retries;
    var done = false, lastRows = 0, lastChange = Date.now(), timer, killer, reloadTimer = null, ticks = 0, reloads = 0, dialogSeen = '';

    function wrap(inner) { return '<html>' + inner + '</html>'; }
    function stop() { done = true; clearInterval(timer); clearTimeout(killer); if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; } }

    function finish(html, how) {
      if (done) return;
      stop();
      var id = reportId || (function () { try { return reportIdOf(popup.location.href); } catch (e) { return ''; } })();
      var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes());
      var name = (opts.name || ('CORES report' + (id ? ' ' + id : ''))) + ' ' + stamp + '.html';
      var rows = (html.match(/id="row_template_\d+"/g) || []).length;
      log('captured (' + how + '): ' + html.length.toLocaleString() + ' chars, ' + rows + ' patient rows -> ' + name);
      if (rows === 0) {
        log('no rendered patient rows in it: CORES did not render the report. The capture is delivered anyway, marked in its name.', false);
        name = name.replace(/\.html$/, ' UNRENDERED.html');
      }
      var o = {}; for (var k in opts) o[k] = opts[k]; o.popup = popup;   // the report window is still open and focused now
      try { deliver(html, name, o); } catch (e) { console.error('CORES capture: delivery failed', e); }
      setTimeout(function () { try { (popup.__realClose || popup.close).call(popup); } catch (e) {} }, 1500);
      return name;
    }

    function fail(msg) {
      if (done) return;
      stop();
      console.error('CORES capture: ' + msg + ' The report window is left open so you can look at it.');
      log('nothing captured. Press F5 in the CORES patient list window, open your list again, then paste the script again.', false);
    }

    // CORES's own advice for "Can't Load Patient List" is to close the report window and reload it: press OK, then its
    // Reload button (or reload the window); the hooks are put back on the new document by the timer below
    function recover(w, d, text) {
      if (reloads >= retries) return false;
      reloads++;
      log('CORES says "' + text + '" - pressing OK and Reload (attempt ' + reloads + ' of ' + retries + ')', false);
      var ok = buttonNamed(d, 'OK');
      if (ok) { try { ok.click(); } catch (e) {} }
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        try {
          var rl = buttonNamed(w.document, 'Reload');
          if (rl) rl.click(); else w.location.reload();
        } catch (e) { try { w.location.reload(); } catch (e2) {} }
      }, 1500);
      lastRows = 0; lastChange = Date.now();
      return true;
    }

    timer = setInterval(function () {
      var w = popup, d;
      if (w.closed) { stop(); if (!done) console.error('CORES capture: the report window closed before anything was captured.'); return; }
      try { d = w.document; } catch (e) { return; }  // cross-origin (e.g. login redirect) = wait
      if (!d || !d.location || d.location.href === 'about:blank') return;
      if (!w.__coresHooked) {
        // wait until the window shows the report page (a window opened blank and then sent to the report is fine)
        if (!/univ_wa_rnd_build_report|report_id/i.test(d.location.href) && !d.querySelector('tr.row_template, .page_header_template')) return;
        w.__coresHooked = true;   // marker lives on the inner window, so a re-navigation gets re-hooked
        dialogSeen = '';
        if (!reportId) reportId = reportIdOf(d.location.href) || null;   // for the file name (a Reload may drop it from the URL)
        // PDF-type reports: the app builds <form><input name=options><input name=html></form> and calls form.submit().
        // While the capture is pending that submit is taken instead; afterwards (captured, or given up) CORES's own flow
        // is let through, so its PDF still appears
        var realSubmit = w.HTMLFormElement.prototype.submit;
        w.HTMLFormElement.prototype.submit = function () {
          if (!done) {
            var f = this.querySelector('input[name="html"]');
            if (f && /<\w+/.test(f.value)) finish(f.value, 'form submit intercepted');
            else console.warn('CORES capture: a form was submitted without an html field; held back', this);
            return;
          }
          return realSubmit.apply(this, arguments);
        };
        // HTML-type reports: the app may call window.print() once rendered
        w.print = function () { finish(wrap(d.documentElement.innerHTML), 'window.print intercepted'); };
        w.__realClose = w.close;
        w.close = function () { console.warn('CORES capture: report window tried to close itself; ignored'); };
      }
      ticks++;
      if (ticks % 40 === 0) {   // once a second: did CORES put up an error dialog?
        var t = dialogText(d);
        if (t && t !== dialogSeen) {
          dialogSeen = t;
          if (!recover(w, d, t)) fail('CORES could not load the report: "' + t + '" (after ' + reloads + ' reload' + (reloads === 1 ? '' : 's') + ').');
          return;
        }
      }
      // Fallback for HTML-type reports: rendered rows present and stable for 6 s with no loading mask
      var rows = renderedRows(d);
      if (rows !== lastRows) { lastRows = rows; lastChange = Date.now(); }
      var masked = d.querySelector('.loadmask, .loadmask-msg');
      if (rows > 0 && !masked && Date.now() - lastChange > 6000) finish(wrap(d.documentElement.innerHTML), 'rendered and idle');
    }, 25);

    killer = setTimeout(function () {
      if (done) return;
      var d = null; try { d = popup.document; } catch (e) {}
      var rows = d ? renderedRows(d) : 0;
      if (rows) finish(wrap(d.documentElement.innerHTML), 'timeout with rows present');
      else fail('timed out after ' + (opts.timeout || 120) + ' s with no rendered patient rows. The report window shows: ' +
        (d ? describePopup(d) : '(not readable: cross-origin or closed)') + '.');
    }, (opts.timeout || 120) * 1000);
  }

  // ---- ARMED mode: capture the next report window CORES opens itself (so it gets whatever CORES passes it)
  function arm(opts) {
    if (!window.__coresRealOpen) window.__coresRealOpen = window.open;
    var realOpen = window.__coresRealOpen;
    window.__coresArmed = opts;
    window.open = function (url, name, features) {
      var w = realOpen.apply(window, arguments);
      var u = String(url || '');
      if (window.__coresArmed && w) {
        if (u && u !== 'about:blank' && !/univ_wa_rnd_build_report|report_id/i.test(u)) {
          log('a window opened that is not the report (' + u.slice(0, 100) + '); still armed');
          return w;
        }
        var o = window.__coresArmed;
        window.__coresArmed = null;
        log('CORES opened a report window' + (u ? ' (' + u.slice(0, 120) + ')' : '') + '; capturing it when it has rendered…');
        watchReport(w, o, reportIdOf(u) || null);
      }
      return w;
    };
    log('armed. Now open the report from CORES as you normally do (its own report / print button); it is captured as soon ' +
      'as it has rendered. If nothing more appears here after you open it, CORES opened it another way: use captureCores(281).');
    return 'armed…';
  }

  window.captureCores = function (reportId, opts) {
    if (reportId && typeof reportId === 'object') { opts = reportId; reportId = null; }
    opts = opts || {};
    if (!reportId) return arm(opts);
    var inPowerChart = false;
    try { inPowerChart = 'DiscernObjectFactory' in window.external; } catch (e) {}
    if (!inPowerChart && !localStorage.getItem('site_code_response')) {
      console.warn('CORES capture: this window is not Cerner-hosted and has no CORES site-code record; ' +
        'the report will probably fail to initialise. Run this from the CORES patient list window.');
    }
    var url = BASE + '?prg_name=univ_wa_rnd_build_report&options=report_id:' + reportId +
      '&mode=pcedge&emr_type=CERNER-CCL-V4&report_name=univ_wa_rnd_api';
    var popup = (opts.open || window.__coresRealOpen || function (u, n, f) { return window.open(u, n, f); })(url, 'cores_capture_' + reportId, 'width=1400,height=900');
    if (!popup) {
      console.error('CORES capture: window.open was blocked. Allow popups for this site and try again.');
      return;
    }
    watchReport(popup, opts, String(reportId));
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
