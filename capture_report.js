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
// While a capture runs, a small status box (draggable, collapsible) in the patient list shows its progress and messages.
(function () {
  var BASE = location.origin + '/cores/uab/prod/cores.4.11.0/base/public_web/';
  var DB = 'cores-capture', STORE = 'kv';

  function log(msg, ok) {
    console.log('%cCORES capture: ' + msg, ok === false ? 'color:#b00020;font-weight:bold' : 'color:green;font-weight:bold');
    ovLog(msg, ok === false ? 'err' : 'ok');
  }

  // ---- status overlay: a small box in the patient list (bottom right; drag it by its title bar, collapse it with –)
  // that follows the capture from arming to delivery, mirroring the console messages. Its position and collapsed state
  // are remembered in this browser. It only ever shows the script's own messages, never report or patient text.
  var OV_KEY = 'cores-capture-overlay';
  var ov = null;
  var OV_COLORS = { idle: '#6b7a8c', busy: '#c98a00', warn: '#c75b00', ok: '#2e7d32', err: '#b00020' };
  function ovPrefs(save) {
    try {
      if (save) { localStorage.setItem(OV_KEY, JSON.stringify(save)); return save; }
      return JSON.parse(localStorage.getItem(OV_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }
  function ovEl(tag, css, text) {
    var el = document.createElement(tag);
    if (css) el.style.cssText = css;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function ovBuild() {
    if (ov && ov.root.isConnected) return ov;
    var old = document.getElementById('cores-capture-overlay');
    if (old) old.remove();   // left over from an earlier paste of the script
    var prefs = ovPrefs();
    var root = ovEl('div', 'position:fixed;z-index:2147483646;width:340px;background:#fff;color:#1b1b1b;' +
      'font:12px/1.4 Segoe UI,Arial,sans-serif;border:1px solid #1f4e79;border-radius:6px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.35);overflow:hidden;user-select:none');
    root.id = 'cores-capture-overlay';
    var head = ovEl('div', 'display:flex;align-items:center;gap:6px;background:#1f4e79;color:#fff;padding:5px 6px 5px 8px;cursor:move');
    var dot = ovEl('span', 'flex:none;width:9px;height:9px;border-radius:50%;background:' + OV_COLORS.idle);
    var title = ovEl('span', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600', 'CORES capture');
    var clock = ovEl('span', 'flex:none;font-variant-numeric:tabular-nums;opacity:.85', '');
    var btnCss = 'flex:none;width:20px;height:20px;padding:0;border:0;border-radius:3px;background:rgba(255,255,255,.15);' +
      'color:#fff;font:bold 13px/20px Segoe UI,Arial,sans-serif;cursor:pointer';
    var fold = ovEl('button', btnCss); fold.title = 'collapse / expand';
    var shut = ovEl('button', btnCss, '\u00d7'); shut.title = 'hide (it comes back on the next capture)';
    head.appendChild(dot); head.appendChild(title); head.appendChild(clock); head.appendChild(fold); head.appendChild(shut);
    var body = ovEl('div', 'padding:6px 8px 8px');
    var stats = ovEl('div', 'display:flex;gap:12px;margin-bottom:5px;color:#444');
    var rowsEl = ovEl('span', '', ''), reloadEl = ovEl('span', '', ''), modeEl = ovEl('span', '', '');
    stats.appendChild(modeEl); stats.appendChild(rowsEl); stats.appendChild(reloadEl);
    var list = ovEl('div', 'max-height:170px;overflow-y:auto;border-top:1px solid #dde3ea;padding-top:4px;' +
      'font:11px/1.4 Consolas,Menlo,monospace;user-select:text;cursor:text');
    body.appendChild(stats); body.appendChild(list);
    // Find in CORES: type words, press Find; the answer (no patient data) shows here and is copied for Claude
    var find = ovEl('div', 'border-top:1px solid #dde3ea;margin-top:6px;padding-top:6px');
    find.appendChild(ovEl('div', 'font-weight:600;color:#1f4e79;margin-bottom:3px', 'Find in CORES'));
    var frow = ovEl('div', 'display:flex;gap:4px');
    var fin = ovEl('input', 'flex:1;min-width:0;font:12px Segoe UI,Arial,sans-serif;padding:2px 4px;border:1px solid #9aa8b6;border-radius:3px;user-select:text');
    fin.placeholder = 'words, comma between: pulm, interv'; fin.value = prefs.find || '';
    var fbtn = ovEl('button', 'flex:none;font:12px Segoe UI,Arial,sans-serif;padding:2px 10px;cursor:pointer', 'Find');
    frow.appendChild(fin); frow.appendChild(fbtn); find.appendChild(frow);
    var fout = ovEl('div', 'display:none;max-height:220px;overflow-y:auto;margin-top:5px;white-space:pre-wrap;word-break:break-word;' +
      'font:11px/1.4 Consolas,Menlo,monospace;user-select:text;cursor:text;background:#f4f7fa;border-radius:3px;padding:4px 5px');
    var fcopy = ovEl('button', 'display:none;margin-top:4px;font:12px Segoe UI,Arial,sans-serif;padding:2px 10px;cursor:pointer', 'Copy for Claude');
    find.appendChild(fout); find.appendChild(fcopy); body.appendChild(find);
    function runFind() {
      var words = fin.value.split(/[,;\n]+/).map(function (w) { return w.trim(); }).filter(Boolean);
      var p = ovPrefs(); p.find = fin.value; ovPrefs(p);
      fout.style.display = '';
      if (!words.length) { fout.textContent = 'Type one or more words first, with a comma between them.'; return; }
      var r = probeCores.apply(null, words.concat([{ quiet: true }]));
      fout.textContent = r.text + '\n\nPress "Copy for Claude" and paste it into the chat (it is also in window.coresProbe).';
      fcopy.style.display = ''; fcopy.textContent = 'Copy for Claude';
    }
    fbtn.onclick = runFind;
    fin.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') runFind(); };
    fcopy.onclick = function () {
      var t = window.coresProbe && window.coresProbe.forClaude; if (!t) return;
      copyText(t).then(function (ok) { fcopy.textContent = ok ? 'Copied for Claude ✓' : 'Could not copy: select the text above'; });
    };
    root.appendChild(head); root.appendChild(body);
    document.body.appendChild(root);

    ov = { root: root, head: head, dot: dot, title: title, clock: clock, fold: fold, body: body, list: list,
           rows: rowsEl, reloads: reloadEl, mode: modeEl, started: 0, tick: null, collapsed: !!prefs.collapsed };

    function place(x, y) {   // keep the title bar on screen
      var w = root.offsetWidth, h = head.offsetHeight;
      x = Math.max(0, Math.min(x, window.innerWidth - w));
      y = Math.max(0, Math.min(y, window.innerHeight - h));
      root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto';
      return { x: x, y: y };
    }
    function setCollapsed(c) {
      ov.collapsed = c;
      body.style.display = c ? 'none' : '';
      fold.textContent = c ? '+' : '\u2013';
    }
    setCollapsed(ov.collapsed);
    if (typeof prefs.x === 'number') place(prefs.x, prefs.y);
    else { root.style.right = '16px'; root.style.bottom = '16px'; }

    fold.onclick = function (e) { e.stopPropagation(); setCollapsed(!ov.collapsed); var p = ovPrefs(); p.collapsed = ov.collapsed; ovPrefs(p); };
    shut.onclick = function (e) { e.stopPropagation(); root.style.display = 'none'; };
    head.ondblclick = function (e) { if (e.target === head || e.target === title) fold.onclick(e); };

    head.onmousedown = function (e) {
      if (e.button !== 0 || e.target === fold || e.target === shut) return;
      e.preventDefault();
      var r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, last = null;
      function move(ev) { last = place(ev.clientX - dx, ev.clientY - dy); }
      function up() {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        if (last) { var p = ovPrefs(); p.x = last.x; p.y = last.y; ovPrefs(p); }
      }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    };
    window.addEventListener('resize', function () {
      if (root.style.left) place(parseFloat(root.style.left), parseFloat(root.style.top));
    });
    return ov;
  }
  function ovClock() {
    if (!ov || !ov.started) return;
    var s = Math.floor((Date.now() - ov.started) / 1000);
    ov.clock.textContent = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  // a new capture: clear the box, show it again, start the clock
  function ovStart(mode, status) {
    try {
      ovBuild();
      ov.root.style.display = '';
      ov.list.innerHTML = '';
      ov.mode.textContent = mode;
      ov.rows.textContent = ''; ov.reloads.textContent = '';
      ov.started = Date.now();
      clearInterval(ov.tick); ov.tick = setInterval(ovClock, 1000); ovClock();
      ovStatus(status, 'busy');
    } catch (e) {}
  }
  // the one-line status in the title bar; ok / err (or final) end the clock
  function ovStatus(text, kind, final) {
    if (!ov) return;
    ov.title.textContent = text;
    ov.title.title = text;
    ov.dot.style.background = OV_COLORS[kind] || OV_COLORS.idle;
    if (final || kind === 'ok' || kind === 'err') { clearInterval(ov.tick); ov.tick = null; ovClock(); }
  }
  function ovStat(which, text) { if (ov && ov[which] && ov[which].textContent !== text) ov[which].textContent = text; }
  function ovLog(msg, kind) {
    if (!ov) return;
    try {
      var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var line = ovEl('div', 'padding:1px 0;white-space:pre-wrap;word-break:break-word;color:' +
        (kind === 'err' ? '#b00020' : kind === 'warn' ? '#a14a00' : '#1b1b1b'));
      line.appendChild(ovEl('span', 'color:#8a96a3', pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' '));
      line.appendChild(document.createTextNode(msg));
      var atEnd = ov.list.scrollHeight - ov.list.scrollTop - ov.list.clientHeight < 8;
      ov.list.appendChild(line);
      while (ov.list.childNodes.length > 200) ov.list.removeChild(ov.list.firstChild);
      if (atEnd) ov.list.scrollTop = ov.list.scrollHeight;
    } catch (e) {}
  }

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
      ovStat('rows', rows + ' patient row' + (rows === 1 ? '' : 's'));
      if (rows === 0) {
        log('no rendered patient rows in it: CORES did not render the report. The capture is delivered anyway, marked in its name.', false);
        name = name.replace(/\.html$/, ' UNRENDERED.html');
        ovStatus('Captured, but UNRENDERED', 'warn', true);
      } else ovStatus('Captured ' + rows + ' patient rows', 'ok');
      var o = {}; for (var k in opts) o[k] = opts[k]; o.popup = popup;   // the report window is still open and focused now
      try { deliver(html, name, o); } catch (e) { console.error('CORES capture: delivery failed', e); ovLog('delivery failed: ' + (e && e.message || e), 'err'); ovStatus('Delivery failed', 'err'); }
      setTimeout(function () { try { (popup.__realClose || popup.close).call(popup); } catch (e) {} }, 1500);
      return name;
    }

    function fail(msg) {
      if (done) return;
      stop();
      console.error('CORES capture: ' + msg + ' The report window is left open so you can look at it.');
      ovLog(msg + ' The report window is left open so you can look at it.', 'err');
      ovStatus('Failed - nothing captured', 'err');
      log('nothing captured. Press F5 in the CORES patient list window, open your list again, then paste the script again.', false);
    }

    // CORES's own advice for "Can't Load Patient List" is to close the report window and reload it: press OK, then its
    // Reload button (or reload the window); the hooks are put back on the new document by the timer below
    function recover(w, d, text) {
      if (reloads >= retries) return false;
      reloads++;
      log('CORES says "' + text + '" - pressing OK and Reload (attempt ' + reloads + ' of ' + retries + ')', false);
      ovStatus('Reloading report (' + reloads + ' of ' + retries + ')', 'warn');
      ovStat('reloads', reloads + ' reload' + (reloads === 1 ? '' : 's'));
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
      if (w.closed) {
        stop();
        if (!done) {
          console.error('CORES capture: the report window closed before anything was captured.');
          ovLog('the report window closed before anything was captured.', 'err');
          ovStatus('Report window closed', 'err');
        }
        return;
      }
      try { d = w.document; } catch (e) { return; }  // cross-origin (e.g. login redirect) = wait
      if (!d || !d.location || d.location.href === 'about:blank') return;
      if (!w.__coresHooked) {
        // wait until the window shows the report page (a window opened blank and then sent to the report is fine)
        if (!/univ_wa_rnd_build_report|report_id/i.test(d.location.href) && !d.querySelector('tr.row_template, .page_header_template')) return;
        w.__coresHooked = true;   // marker lives on the inner window, so a re-navigation gets re-hooked
        dialogSeen = '';
        if (!reportId) reportId = reportIdOf(d.location.href) || null;   // for the file name (a Reload may drop it from the URL)
        ovLog('report page loaded' + (reportId ? ' (report ' + reportId + ')' : '') + '; waiting for the patient rows');
        ovStatus('Report loading\u2026', 'busy');
        // PDF-type reports: the app builds <form><input name=options><input name=html></form> and calls form.submit().
        // While the capture is pending that submit is taken instead; afterwards (captured, or given up) CORES's own flow
        // is let through, so its PDF still appears
        var realSubmit = w.HTMLFormElement.prototype.submit;
        w.HTMLFormElement.prototype.submit = function () {
          if (!done) {
            var f = this.querySelector('input[name="html"]');
            if (f && /<\w+/.test(f.value)) finish(f.value, 'form submit intercepted');
            else { console.warn('CORES capture: a form was submitted without an html field; held back', this); ovLog('a form was submitted without an html field; held back', 'warn'); }
            return;
          }
          return realSubmit.apply(this, arguments);
        };
        // HTML-type reports: the app may call window.print() once rendered
        w.print = function () { finish(wrap(d.documentElement.innerHTML), 'window.print intercepted'); };
        w.__realClose = w.close;
        w.close = function () { console.warn('CORES capture: report window tried to close itself; ignored'); ovLog('report window tried to close itself; ignored', 'warn'); };
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
      if (rows !== lastRows) {
        lastRows = rows; lastChange = Date.now();
        ovStat('rows', rows + ' patient row' + (rows === 1 ? '' : 's'));
        if (rows > 0) ovStatus('Rendering\u2026 ' + rows + ' rows', 'busy');
      }
      if (rows > 0 && !done && ticks % 40 === 0) {   // once a second: how long until the rows count as settled
        var left = Math.ceil((6000 - (Date.now() - lastChange)) / 1000);
        if (left > 0) ovStatus(rows + ' rows, settling (' + left + ' s)', 'busy');
      }
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
        ovStatus('Report window open, waiting\u2026', 'busy');
        log('CORES opened a report window' + (u ? ' (' + u.slice(0, 120) + ')' : '') + '; capturing it when it has rendered…');
        watchReport(w, o, reportIdOf(u) || null);
      }
      return w;
    };
    ovStart('armed mode', 'Armed - open the report in CORES');
    ovStat('rows', '');
    log('armed. Now open the report from CORES as you normally do (its own report / print button); it is captured as soon ' +
      'as it has rendered. If nothing more appears here after you open it, CORES opened it another way: use captureCores(281).');
    return 'armed…';
  }

  // ---- Find in CORES (probeCores): where CORES keeps a word (a team name, a label) or an id, on the page, in its
  // frames and in its JavaScript data, WITHOUT reporting patient data: only the words searched for, element tags and
  // classes, the NAMES of the fields beside a match (never their values), counts, and the file names (no folders) of
  // what the page has loaded (other sites by name only). Any name that does not look like a programmer's
  // identifier (it could be a patient's name or number used as a key or an id) shows as <name>. Used by the Find box in the status box, or in the
  // Console:  probeCores('pulm')   probeCores('pulm', 'interv')   probeCores(1234)  (a number is matched as a whole id).
  var PROBE_SKIP = { location: 1, navigator: 1, history: 1, performance: 1, screen: 1, clientInformation: 1, document: 1,
    localStorage: 1, sessionStorage: 1, coresCaptured: 1, coresProbe: 1, captureCores: 1, probeCores: 1, __coresRealOpen: 1 };
  function copyText(t) {   // the clipboard, by the API when the page has the focus, else by a hidden text box
    return new Promise(function (res) {
      function old() { try { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); res(!!ok); } catch (e) { res(false); } }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { res(true); }, old); return; } } catch (e) {}
      old();
    });
  }
  function probeCores() {
    var args = [].slice.call(arguments), opt = {};
    if (args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object') opt = args.pop();
    var terms = [], ids = [];
    args.forEach(function (x) {
      x = String(x).trim();
      if (/^\d+$/.test(x)) ids.push(x); else if (x) terms.push(x.toLowerCase());
    });
    if (!terms.length && !ids.length) { console.log("probeCores: e.g. probeCores('pulm') or probeCores('pulm', 'interv') or probeCores(1234)"); return { text: '' }; }
    var searched = terms.concat(ids.map(function (i) { return 'id ' + i; })), asked = ids.length;
    function scrub(x) { return String(x).replace(/\d{3,}/g, '#'); }
    // names (field names, element ids and classes, path pieces) are reported only when they look like a programmer's
    // identifier: letters, digits and _ $ - only, at most 30 long, with no long number. Anything else could be a
    // patient's name or number used as a key, and shows as <name>.
    // and it must have a lower-case letter and not be a single capitalized word: CORES writes names in capitals
    // ("SMITH"), and "Smith" could be a surname too; field names are camelCase or snake_case
    function safe(x) { x = String(x); return /^[A-Za-z_$][\w$-]{0,29}$/.test(x) && !/\d{3,}/.test(x) && /[a-z]/.test(x) && !/^[A-Z][a-z]+$/.test(x) ? x : '<name>'; }
    function safePath(pth) { return pth.split('.').map(function (seg) { var m = seg.match(/^([^\[]*)((?:\[i\])*)$/); return m ? (m[1] === '<name>' ? m[1] : m[1] ? safe(m[1]) : '') + m[2] : '<name>'; }).join('.'); }
    var optionIds = [];   // the matched menu choices' own values, kept here for matching ids, never reported
    var out = { searched: searched, page: '', menuChoiceValues: 0, dom: [], data: [], loads: [], notes: [] };
    out.page = location.pathname.split('/').filter(Boolean).slice(-2).map(safe).join('/');
    function hit(x) {   // every search word a text or value matches, joined ('' for none)
      x = String(x);
      var m = [], l = x.toLowerCase();
      for (var i = 0; i < ids.length; i++) if (x.trim() === ids[i]) m.push(i < asked ? 'id ' + ids[i] : 'id of a menu choice found');
      for (var j = 0; j < terms.length; j++) if (l.indexOf(terms[j]) >= 0) m.push(terms[j]);
      return m.join(', ');
    }
    function desc(el) {
      // an id is shown only off the list rows (a row's id is often the patient's) and when it is not all capitals (CORES
      // writes names in capitals); a class only when more than one element has it (one on a single row could be a name)
      var d = el.tagName.toLowerCase(), doc = el.ownerDocument;
      if (el.id && /[a-z]/.test(el.id) && !up(el, ['TR', 'LI'])) d += '#' + safe(el.id);
      if (typeof el.className === 'string' && el.className.trim())
        d += el.className.trim().split(/\s+/).filter(function (c) { try { return doc.getElementsByClassName(c).length > 1; } catch (e) { return false; } })
          .slice(0, 3).map(function (c) { return '.' + safe(c); }).join('');
      return d;
    }
    function path(el) { var q = []; while (el && el.nodeType === 1 && q.length < 7) { q.unshift(desc(el)); el = el.parentElement; } return q.join(' > '); }
    function up(el, tags) { while (el && el.nodeType === 1) { if (tags.indexOf(el.tagName) >= 0) return el; el = el.parentElement; } return null; }
    function mine(el) { while (el && el.nodeType === 1) { if (el.id === 'cores-capture-overlay' || el.id === 'cores-capture-banner') return true; el = el.parentElement; } return false; }

    // 1. the page and its frames
    var domKeys = {};
    function scanDoc(doc, where) {
      var all = doc.getElementsByTagName('*');
      for (var i = 0; i < all.length && out.dom.length < 150; i++) {
        var el = all[i], own = '', attr = '';
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.nodeValue;
        var t = hit(own);
        if (!t) for (var a = 0; a < el.attributes.length; a++) if ((t = hit(el.attributes[a].value))) { attr = el.attributes[a].name; break; }
        if (!t || mine(el)) continue;
        if (/^(OPTION|INPUT)$/.test(el.tagName) && /^\d{1,12}$/.test(el.value || '') && optionIds.indexOf(el.value) < 0) optionIds.push(el.value);
        var row = up(el, ['TR', 'LI']), list = row && row.parentElement, pth = path(el), key = where + '|' + t + '|' + pth + '|' + attr;
        if (domKeys[key]) { domKeys[key].count++; continue; }
        out.dom.push(domKeys[key] = { found: t, where: where, via: attr ? 'attribute ' + attr : 'text', tag: el.tagName.toLowerCase(), path: pth, count: 1,
          selected: !!(el.selected || el.checked), visible: !!(el.offsetWidth || el.offsetHeight),
          row: row ? desc(row) : '', rowsInList: list ? list.children.length : 0,
          rowAttributes: row ? [].map.call(row.attributes, function (x) { return safe(x.name); }).slice(0, 15) : [] });
      }
    }
    scanDoc(document, 'this window');
    for (var f = 0; f < window.frames.length; f++) {
      try { scanDoc(window.frames[f].document, 'frame ' + f); } catch (e) { out.notes.push('frame ' + f + ' could not be read (another site)'); }
    }
    out.menuChoiceValues = optionIds.length;
    ids = ids.concat(optionIds.filter(function (v) { return ids.indexOf(v) < 0; }));

    // 2. the page's JavaScript data
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null, objs = 0, found = {};
    function walk(o, pth, d, parent) {
      if (o === null || o === undefined || d > 7 || objs > 60000) return;
      var ty = typeof o;
      if (ty === 'string' || ty === 'number') {
        var t = hit(o); if (!t) return;
        var key = pth.replace(/\[\d+\]/g, '[i]');
        if (!found[key]) found[key] = { path: safePath(key), found: [], count: 0, inList: /\[\d+\]/.test(pth), fieldsBeside: [] };
        t.split(', ').forEach(function (w) { if (found[key].found.indexOf(w) < 0) found[key].found.push(w); });
        found[key].count++;
        if (parent && !found[key].fieldsBeside.length) try { var pk = Object.keys(parent); found[key].fieldsBeside = pk.length > 25 ? ['(a table of ' + pk.length + ' entries)'] : pk.map(safe); } catch (e) {}
        return;
      }
      if (ty !== 'object' || o.nodeType || o.window === o) return;
      if (seen) { if (seen.has(o)) return; seen.add(o); }
      objs++;
      var ks; try { ks = Object.keys(o); } catch (e) { return; }
      var arr = Array.isArray(o);
      for (var i = 0; i < ks.length && i < 3000; i++) {
        var v; try { v = o[ks[i]]; } catch (e) { continue; }
        walk(v, pth + (arr ? '[' + ks[i] + ']' : '.' + (ks.length > 25 ? '<name>' : ks[i])), d + 1, o);
      }
    }
    function walkWin(w, name) {
      var ks; try { ks = Object.keys(w); } catch (e) { out.notes.push(name + ' data could not be read'); return; }
      for (var i = 0; i < ks.length; i++) {
        if (PROBE_SKIP[ks[i]]) continue;
        var v; try { v = w[ks[i]]; } catch (e) { continue; }
        if (typeof v !== 'function') walk(v, name + '.' + ks[i], 0, null);
      }
      try { if (w.jQuery && w.jQuery.cache) walk(w.jQuery.cache, name + '.jQuery.cache', 0, null); } catch (e) {}
    }
    walkWin(window, 'window');
    for (var g = 0; g < window.frames.length; g++) { try { walkWin(window.frames[g], 'frame' + g); } catch (e) {} }
    for (var k in found) out.data.push(found[k]);
    try {
      var st = window.localStorage;
      for (var s = 0; s < st.length; s++) {
        if (st.key(s) === OV_KEY) continue;   // the Find box's own words
        var t2 = hit(st.getItem(st.key(s))); if (t2) out.notes.push('browser storage "' + safe(st.key(s)) + '" contains ' + t2);
      }
    } catch (e) {}
    try {
      var seenL = {};
      performance.getEntriesByType('resource').forEach(function (r) {
        var u = r.name.split('?')[0].split('#')[0];
        if (/\.(png|gif|jpe?g|svg|css|woff2?|ttf|ico)$/i.test(u)) return;
        var a = document.createElement('a'); a.href = u;
        var key = a.host !== location.host ? 'another site: ' + a.hostname :
          a.pathname.split('/').filter(Boolean).slice(-1).map(function (seg) { return /^[a-z_][a-z_.-]{0,39}$/.test(seg) ? seg : '<name>'; }).join('/');
        if (seenL[key]) return;
        seenL[key] = 1; out.loads.push(r.initiatorType + ' ' + key);
      });
    } catch (e) {}

    // the answer in plain words, then the details
    var L = ['Find in CORES: ' + searched.join(', ')], n = function (x, w) { return x + ' ' + w + (x === 1 ? '' : 's'); };
    var onPage = out.dom.filter(function (h) { return !h.row; }), inRows = out.dom.filter(function (h) { return h.row; });
    if (onPage.length) {
      L.push('', 'On the page:');
      onPage.forEach(function (h) {
        L.push('- "' + h.found + '" in ' + (h.tag === 'option' ? 'a menu choice' + (h.selected ? ' (selected)' : '') :
          h.via === 'text' ? 'the text of a ' + h.tag : 'the ' + h.via.replace('attribute ', '') + ' of a ' + h.tag) +
          (h.visible ? '' : ', hidden') + ', ' + n(h.count, 'time') + (h.where === 'this window' ? '' : ', in ' + h.where) + '\n    at ' + h.path);
      });
    }
    if (inRows.length) {
      L.push('', 'In rows of a list (one patient per row?):');
      inRows.forEach(function (h) {
        L.push('- "' + h.found + '" in ' + n(h.count, 'row') + ' of ' + h.rowsInList + ' (' + h.row + ')' + (h.where === 'this window' ? '' : ', in ' + h.where) +
          '\n    each row has: ' + (h.rowAttributes.join(', ') || 'no attributes') + '\n    at ' + h.path);
      });
    }
    if (out.data.length) {
      L.push('', "In the page's data:");
      out.data.forEach(function (h) {
        L.push('- "' + h.found.join('", "') + '" at ' + h.path + (h.inList ? ' (a list, ' + h.count + ' match' + (h.count === 1 ? '' : 'es') + ')' : '') +
          '\n    fields beside it: ' + (h.fieldsBeside.join(', ') || '(none)'));
      });
    }
    var none = searched.filter(function (w) {
      return !out.dom.some(function (h) { return h.found.split(', ').indexOf(w) >= 0; }) && !out.data.some(function (h) { return h.found.indexOf(w) >= 0; });
    });
    if (none.length) L.push('', 'Not found anywhere: ' + none.join(', ') + '. Try a shorter piece of the word, spelled as CORES shows it.');
    if (out.menuChoiceValues) L.push('', out.menuChoiceValues + ' menu choice(s) found have a number as their value; it was also looked for in the data, as an id.');
    if (out.notes.length) L.push('', 'Notes: ' + out.notes.join('; '));
    L.push('', 'Searched ' + document.getElementsByTagName('*').length + ' page elements and ' + objs + ' data objects. Names that do not look like ' +
      'a programmer\'s field name show as <name>, and no values are included.');
    var text = L.join('\n');
    var forClaude = text + '\n\n---- details ----\n' + JSON.stringify(out, null, 1);
    window.coresProbe = { result: out, text: text, forClaude: forClaude };
    if (!opt.quiet) {
      console.log(forClaude);
      copyText(forClaude).then(function (ok) { console.log(ok ? 'Copied for Claude: paste it into the chat.' : 'Could not copy: select the text above and copy it.'); });
    }
    return { text: text };
  }
  window.probeCores = probeCores;

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
      ovStart('direct mode, report ' + reportId, 'Popup blocked');
      ovLog('window.open was blocked. Allow popups for this site and try again.', 'err');
      ovStatus('Popup blocked', 'err');
      return;
    }
    ovStart('direct mode, report ' + reportId, 'Report ' + reportId + ' opened, waiting…');
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
