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

  // kind: none for a neutral message, 'ok' (done), 'warn' (a problem worked around), 'err' or false (failed)
  function log(msg, kind) {
    var k = kind === false ? 'err' : kind || 'info';
    console.log('%cCORES capture: ' + msg, k === 'err' ? 'color:#b00020;font-weight:bold' : k === 'warn' ? 'color:#9a6400;font-weight:bold' :
      k === 'ok' ? 'color:#1e7b34;font-weight:bold' : '');
    ovLog(msg, k);
  }

  // ---- the CORES Capture HUD: a small box in the patient list (bottom right) that follows the capture from arming to
  // delivery, mirroring the console messages, and holds Find in CORES. Drag it by its title bar, resize it from any
  // edge or corner, collapse it with –, hide it with ×; its place, size and collapsed state are remembered in this
  // browser. It only ever shows the script's own messages, never report or patient text.
  // Messages are neutral (gray-black) unless they say how something went: green done, yellow a problem worked around,
  // red failed. A step under way shows as a spinner line at the bottom; a capture ends in one verdict line: SUCCESS
  // (green), CAPTURED WITH PROBLEMS (yellow) or FAILED (red).
  var OV_KEY = 'cores-capture-overlay';
  var ov = null;
  var OV_C = { info: '#1b1b1b', ok: '#1e7b34', warn: '#9a6400', err: '#b00020', mute: '#7a8794' };
  var OV_BG = { ok: '#e3f4e6', warn: '#fff3d6', err: '#fde4e7' };
  var SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  function ovPrefs(save) {
    try {
      if (save) { localStorage.setItem(OV_KEY, JSON.stringify(save)); return save; }
      return JSON.parse(localStorage.getItem(OV_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }
  function ovSave(k, v) { var p = ovPrefs(); p[k] = v; ovPrefs(p); }
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
    var FONT = 'Segoe UI,Arial,sans-serif', MONO = 'Consolas,Menlo,monospace';
    var root = ovEl('div', 'position:fixed;z-index:2147483646;display:flex;flex-direction:column;box-sizing:border-box;' +
      'background:#fff;color:#1b1b1b;font:12px/1.4 ' + FONT + ';border:1px solid #1f4e79;border-radius:7px;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.32);overflow:hidden;user-select:none;min-width:280px;min-height:96px');
    root.id = 'cores-capture-overlay';
    root.style.width = (prefs.w || 380) + 'px';
    root.style.height = (prefs.h || 320) + 'px';

    // title bar: name, Find, collapse, hide
    var head = ovEl('div', 'flex:none;display:flex;align-items:center;gap:6px;background:#1f4e79;color:#fff;padding:5px 6px 5px 10px;cursor:move');
    var title = ovEl('span', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:.2px', 'CORES Capture HUD');
    var btnCss = 'flex:none;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:rgba(255,255,255,.14);' +
      'color:#fff;font:bold 13px/22px ' + FONT + ';cursor:pointer;display:flex;align-items:center;justify-content:center';
    var findBtn = ovEl('button', btnCss); findBtn.title = 'Find in CORES: where CORES keeps a word, with no patient data';
    findBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
    var fold = ovEl('button', btnCss); fold.title = 'collapse / expand';
    var shut = ovEl('button', btnCss, '×'); shut.title = 'hide (it comes back on the next capture)';
    head.appendChild(title); head.appendChild(findBtn); head.appendChild(fold); head.appendChild(shut);

    // status bar: spinner or result mark, the current step, the clock; then counts
    var bar = ovEl('div', 'flex:none;display:flex;align-items:center;gap:7px;padding:5px 9px;border-bottom:1px solid #e3e8ee;background:#f7f9fb');
    var mark = ovEl('span', 'flex:none;width:14px;text-align:center;font:bold 13px/1 ' + MONO + ';color:' + OV_C.mute, '○');
    var status = ovEl('span', 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600', 'Idle');
    var clock = ovEl('span', 'flex:none;font-variant-numeric:tabular-nums;color:' + OV_C.mute, '');
    bar.appendChild(mark); bar.appendChild(status); bar.appendChild(clock);
    var stats = ovEl('div', 'flex:none;display:flex;gap:12px;padding:3px 9px;color:#5b6773;font-size:11px;border-bottom:1px solid #eef1f4');
    var modeEl = ovEl('span'), rowsEl = ovEl('span'), reloadEl = ovEl('span'), traceEl = ovEl('span', 'margin-left:auto;color:#b00020;font-weight:600');
    stats.appendChild(modeEl); stats.appendChild(rowsEl); stats.appendChild(reloadEl); stats.appendChild(traceEl);

    // Find bar (shown by the magnifying glass)
    var findBar = ovEl('div', 'flex:none;display:none;gap:4px;padding:6px 8px;border-bottom:1px solid #e3e8ee;background:#eef4fa');
    var fin = ovEl('input', 'flex:1;min-width:0;font:12px ' + FONT + ';padding:3px 6px;border:1px solid #9aa8b6;border-radius:4px;user-select:text');
    fin.placeholder = 'words to find, comma between (pulm, interv)'; fin.value = prefs.find || '';
    var fgo = ovEl('button', 'flex:none;font:600 12px ' + FONT + ';padding:3px 12px;border:1px solid #1f4e79;border-radius:4px;background:#1f4e79;color:#fff;cursor:pointer', 'Find');
    var fdesc = ovEl('button', 'flex:none;font:600 12px ' + FONT + ';padding:3px 10px;border:1px solid #1f4e79;border-radius:4px;background:#fff;color:#1f4e79;cursor:pointer', 'Describe');
    fdesc.title = 'The layout of the CORES patient records: which fields are filled, and what kind of thing each holds. No values.';
    var fcols = ovEl('button', 'flex:none;font:600 12px ' + FONT + ';padding:3px 10px;border:1px solid #1f4e79;border-radius:4px;background:#fff;color:#1f4e79;cursor:pointer', 'Columns');
    fcols.title = 'With CORES\'s column picker open: every column name it offers. (Or type the XPath of its list first.)';
    var fmap = ovEl('button', 'flex:none;font:600 12px ' + FONT + ';padding:3px 10px;border:1px solid #1f4e79;border-radius:4px;background:#fff;color:#1f4e79;cursor:pointer', 'Map');
    fmap.title = 'The whole shape of CORES\'s patient data, the values shared by 3+ patients, and the list\'s columns. Patient identifiers are redacted; nothing unique to a patient is shown.';
    var ftrace = ovEl('button', 'flex:none;font:600 12px ' + FONT + ';padding:3px 10px;border:1px solid #1f4e79;border-radius:4px;background:#fff;color:#1f4e79;cursor:pointer', 'Trace');
    ftrace.title = 'What loads CORES\'s patient records: press it BEFORE opening the report (in a fresh CORES session), open the report as usual, then press it again to stop. It only watches; names, counts and timings, no patient data.';
    findBar.style.flexWrap = 'wrap'; fin.style.flex = '1 1 110px';
    findBar.appendChild(fin); findBar.appendChild(fgo); findBar.appendChild(fdesc); findBar.appendChild(fcols); findBar.appendChild(fmap); findBar.appendChild(ftrace);

    // the console: the script's messages, Find results, and the live spinner line at the bottom
    var list = ovEl('div', 'flex:1;min-height:0;overflow-y:auto;padding:5px 9px 7px;font:11px/1.45 ' + MONO + ';user-select:text;cursor:text');
    var body = ovEl('div', 'flex:1;min-height:0;display:flex;flex-direction:column');
    body.appendChild(stats); body.appendChild(findBar); body.appendChild(list);
    root.appendChild(head); root.appendChild(bar); root.appendChild(body);
    document.body.appendChild(root);

    ov = { root: root, head: head, mark: mark, status: status, clock: clock, list: list, live: null, find: findBar, input: fin,
           rows: rowsEl, reloads: reloadEl, mode: modeEl, trace: traceEl, traceBtn: ftrace, started: 0, tick: null, spin: null, spinKind: '', frame: 0,
           collapsed: !!prefs.collapsed, warns: 0, errs: 0, helpOpen: prefs.helpOpen === true };

    function place(x, y) {   // keep the title bar on screen
      var w = root.offsetWidth, h = head.offsetHeight;
      x = Math.max(0, Math.min(x, window.innerWidth - w));
      y = Math.max(0, Math.min(y, window.innerHeight - h));
      root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto';
      return { x: x, y: y };
    }
    function setCollapsed(c) {
      ov.collapsed = c;
      body.style.display = c ? 'none' : 'flex';
      root.style.height = c ? 'auto' : (ovPrefs().h || 320) + 'px';
      fold.textContent = c ? '+' : '–';
      if (ov.grips) ov.grips();
    }
    function showFind(on) {
      findBar.style.display = on ? 'flex' : 'none';
      findBtn.style.background = on ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.14)';
      ovSave('findOpen', on);
      if (on) { if (ov.collapsed) setCollapsed(false); fin.focus(); fin.select(); }
    }
    setCollapsed(ov.collapsed);
    ov.expand = function () { if (ov.collapsed) { setCollapsed(false); ovSave('collapsed', false); } root.style.display = 'flex'; };
    showFind(!!prefs.findOpen);
    if (typeof prefs.x === 'number') place(prefs.x, prefs.y);
    else { root.style.right = '16px'; root.style.bottom = '16px'; }

    fold.onclick = function (e) { e.stopPropagation(); setCollapsed(!ov.collapsed); ovSave('collapsed', ov.collapsed); };
    shut.onclick = function (e) { e.stopPropagation(); root.style.display = 'none'; };
    findBtn.onclick = function (e) { e.stopPropagation(); showFind(findBar.style.display === 'none'); };
    head.ondblclick = function (e) { if (e.target === head || e.target === title) fold.onclick(e); };
    // Find runs a moment after it is asked for, so the "searching" line shows first; anything that goes wrong is shown
    // in red here (and in the Console) instead of nothing happening
    var finding = false;
    function runFind() {
      if (finding) return;
      var words = fin.value.split(/[,;\n]+/).map(function (w) { return w.trim(); }).filter(Boolean);
      ovSave('find', fin.value);
      if (!words.length) { ovLog('Find: type one or more words first, with a comma between them.', 'warn'); return; }
      finding = true;
      ovLog('Searching: ' + fin.value.trim());
      setTimeout(function () {
        try { probeCores.apply(null, words.concat([{ hud: true }])); }
        catch (e) {
          console.error('CORES capture: Find failed', e);
          ovLog('Find failed: ' + (e && (e.name + ': ' + e.message) || e) + '. Copy this line for Claude.', 'err');
        }
        finding = false;
      }, 30);
    }
    // caught on the way down (capture phase), so a page that swallows clicks or keys before they arrive cannot stop them
    window.addEventListener('click', function (e) { if (e.target === fgo) { e.stopPropagation(); runFind(); } }, true);
    // Map: the whole shape of the patient data
    window.addEventListener('click', function (e) {
      if (e.target !== fmap) return;
      e.stopPropagation();
      ovLog('Mapping: CORES\'s patient data');
      setTimeout(function () {
        try { mapCores({ hud: true }); }
        catch (err) { console.error('CORES capture: Map failed', err); ovLog('Map failed: ' + (err && (err.name + ': ' + err.message) || err) + '. Copy this line for Claude.', 'err'); }
      }, 30);
    }, true);
    // Columns: the column picker's column names (or the list at an XPath typed in the box)
    window.addEventListener('click', function (e) {
      if (e.target !== fcols) return;
      e.stopPropagation();
      var xp = /^\//.test(fin.value.trim()) ? fin.value.trim() : '';
      ovLog('Listing: the column picker\'s columns' + (xp ? ' (at the XPath typed)' : ''));
      setTimeout(function () {
        try { listCoresColumns(xp, { hud: true }); }
        catch (err) { console.error('CORES capture: Columns failed', err); ovLog('Columns failed: ' + (err && (err.name + ': ' + err.message) || err) + '. Copy this line for Claude.', 'err'); }
      }, 30);
    }, true);
    // Describe: the CORES patient records, or the data path typed in the box (window.something)
    window.addEventListener('click', function (e) {
      if (e.target !== fdesc) return;
      e.stopPropagation();
      var pth = /^window\./.test(fin.value.trim()) ? fin.value.trim() : '';
      ovLog('Describing: ' + (pth || 'the CORES patient records'));
      setTimeout(function () {
        try { describeCores(pth, { hud: true }); }
        catch (err) { console.error('CORES capture: Describe failed', err); ovLog('Describe failed: ' + (err && (err.name + ': ' + err.message) || err) + '. Copy this line for Claude.', 'err'); }
      }, 30);
    }, true);
    // Trace: arm it, or stop it and show what it saw
    window.addEventListener('click', function (e) {
      if (e.target !== ftrace) return;
      e.stopPropagation();
      setTimeout(function () {
        try { traceCores({ hud: true }); }
        catch (err) { console.error('CORES capture: Trace failed', err); ovLog('Trace failed: ' + (err && (err.name + ': ' + err.message) || err) + '. Copy this line for Claude.', 'err'); }
      }, 30);
    }, true);
    trButton();   // a Trace armed before the HUD was rebuilt shows as armed
    window.addEventListener('keydown', function (e) {
      if (e.target !== fin) return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); runFind(); }
      if (e.key === 'Escape') showFind(false);
    }, true);

    // moving and resizing use pointer capture: once pressed, every move goes to the HUD until the button is let go,
    // even over CORES's frames (which otherwise swallow the moves and leave a drag stuck); text selection is off meanwhile
    function drag(el, e, move, up) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      var html = document.documentElement, us = html.style.userSelect;
      html.style.userSelect = 'none';
      function mv(ev) { if (ev.pointerId === e.pointerId) { ev.preventDefault(); move(ev); } }
      function done(ev) {
        if (ev.pointerId !== e.pointerId) return;
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done);
        try { el.releasePointerCapture(e.pointerId); } catch (x) {}
        html.style.userSelect = us;
        up();
      }
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
    }
    // moving: drag the title bar (not its buttons)
    head.style.touchAction = 'none';
    head.addEventListener('pointerdown', function (e) {
      if (e.target !== head && e.target !== title) return;
      var r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, last = null;
      drag(head, e, function (ev) { last = place(ev.clientX - dx, ev.clientY - dy); }, function () { if (last) { ovSave('x', last.x); ovSave('y', last.y); } });
    });
    // resizing: an invisible 10 px strip along each edge and a square at each corner, above the HUD's contents, with the
    // matching cursor; the bottom-right corner also shows a grip
    var GRIP = 10, CORNER = 16, grips = {};
    var spots = {
      n: 'top:0;left:' + CORNER + 'px;right:' + CORNER + 'px;height:' + GRIP + 'px', s: 'bottom:0;left:' + CORNER + 'px;right:' + CORNER + 'px;height:' + GRIP + 'px',
      w: 'left:0;top:' + CORNER + 'px;bottom:' + CORNER + 'px;width:' + GRIP + 'px', e: 'right:0;top:' + CORNER + 'px;bottom:' + CORNER + 'px;width:' + GRIP + 'px',
      nw: 'top:0;left:0;width:' + CORNER + 'px;height:' + CORNER + 'px', ne: 'top:0;right:0;width:' + CORNER + 'px;height:' + CORNER + 'px',
      sw: 'bottom:0;left:0;width:' + CORNER + 'px;height:' + CORNER + 'px', se: 'bottom:0;right:0;width:' + CORNER + 'px;height:' + CORNER + 'px'
    };
    Object.keys(spots).forEach(function (sd) {
      var g = ovEl('div', 'position:absolute;z-index:3;touch-action:none;cursor:' + sd + '-resize;' + spots[sd]);
      if (sd === 'se') g.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;opacity:.55"><path d="M15 6 6 15M15 10 10 15M15 14 14 15" stroke="#1f4e79" stroke-width="1.6" stroke-linecap="round"/></svg>';
      g.title = 'drag to resize';
      g.addEventListener('pointerdown', function (e) {
        var r = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
        place(r.left, r.top);
        drag(g, e, function (ev) {
          var dx = ev.clientX - x0, dy = ev.clientY - y0, w = r.width, h = r.height;
          if (sd.indexOf('e') >= 0) w = r.width + dx;
          if (sd.indexOf('w') >= 0) w = r.width - dx;
          if (sd.indexOf('s') >= 0) h = r.height + dy;
          if (sd.indexOf('n') >= 0) h = r.height - dy;
          w = Math.max(280, Math.min(w, window.innerWidth)); h = Math.max(140, Math.min(h, window.innerHeight));
          root.style.width = w + 'px';
          if (!ov.collapsed) root.style.height = h + 'px';
          place(sd.indexOf('w') >= 0 ? r.right - w : r.left, sd.indexOf('n') >= 0 && !ov.collapsed ? r.bottom - h : r.top);
        }, function () {
          ovSave('w', root.offsetWidth); if (!ov.collapsed) ovSave('h', root.offsetHeight);
          ovSave('x', parseFloat(root.style.left)); ovSave('y', parseFloat(root.style.top));
        });
      });
      grips[sd] = g; root.appendChild(g);
    });
    // collapsed, only the width can change
    ov.grips = function () { for (var sd in grips) grips[sd].style.display = ov.collapsed && sd !== 'e' && sd !== 'w' ? 'none' : ''; };
    ov.grips();
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
  // the spinner, in the status bar and on the live line, while a step is under way
  function ovSpin(on) {
    if (!ov) return;
    if (on && !ov.spin) ov.spin = setInterval(function () {
      ov.frame = (ov.frame + 1) % SPIN.length;
      var ch = SPIN.charAt(ov.frame);
      ov.mark.textContent = ch;
      if (ov.live) ov.live.spin.textContent = ch + ' ';
    }, 80);
    if (!on && ov.spin) { clearInterval(ov.spin); ov.spin = null; }
  }
  // a new capture: show the HUD again, start the clock, reset the tallies
  function ovStart(mode, text, help) {
    try {
      ovBuild();
      ov.root.style.display = 'flex';
      ov.mode.textContent = mode;
      ov.rows.textContent = ''; ov.reloads.textContent = '';
      ov.warns = 0; ov.errs = 0;
      if (ov.list.childNodes.length) ovLog('──── new capture ────', 'mute');
      ov.list.scrollTop = ov.list.scrollHeight;
      ov.started = Date.now();
      clearInterval(ov.tick); ov.tick = setInterval(ovClock, 1000); ovClock();
      ovStatus(text, 'busy', false, help);
    } catch (e) {}
  }
  // the current step. busy (or warn while still working): spinner, and the same text on the live line at the bottom of
  // the console; ok / err (or final): a mark instead, the clock stops. help: what the user needs to do during this step,
  // under a "What to do" link on the live line that opens it (open or closed is remembered)
  function ovStatus(text, kind, final, help) {
    if (!ov) return;
    var working = !final && (kind === 'busy' || kind === 'warn');
    ov.status.textContent = text; ov.status.title = text;
    ov.status.style.color = kind === 'busy' ? OV_C.info : OV_C[kind] || OV_C.info;
    ov.mark.style.color = kind === 'busy' ? '#1f4e79' : OV_C[kind] || OV_C.mute;
    if (working) {
      if (!ov.live) {
        var lv = ov.live = ovEl('div', 'padding:2px 0');
        var top = ovEl('div', 'white-space:pre-wrap;word-break:break-word');
        lv.spin = ovEl('span', 'font-weight:bold', SPIN.charAt(ov.frame) + ' ');
        lv.text = document.createTextNode('');
        lv.more = ovEl('a', 'display:none;margin-left:8px;color:#1f4e79;font:600 11px Segoe UI,Arial,sans-serif;cursor:pointer;' +
          'text-decoration:underline;white-space:nowrap', '');
        lv.help = ovEl('div', 'display:none;margin:3px 0 2px 14px;padding:4px 8px;border-left:3px solid #1f4e79;background:#eef4fa;' +
          'color:#1b1b1b;font:12px/1.45 Segoe UI,Arial,sans-serif;white-space:pre-wrap;word-break:break-word;border-radius:0 4px 4px 0');
        lv.more.onclick = function () { ov.helpOpen = !ov.helpOpen; ovSave('helpOpen', ov.helpOpen); ovHelp(); };
        top.appendChild(lv.spin); top.appendChild(lv.text); top.appendChild(lv.more);
        lv.appendChild(top); lv.appendChild(lv.help);
        ov.list.appendChild(lv);
      }
      ov.live.style.color = kind === 'warn' ? OV_C.warn : '#1f4e79';
      ov.live.text.nodeValue = text;
      ov.live.help.textContent = help || '';
      ovHelp();
      ov.list.scrollTop = ov.list.scrollHeight;
      ovSpin(true);
    } else {
      ovSpin(false);
      if (ov.live) { ov.live.remove(); ov.live = null; }
      ov.mark.textContent = kind === 'ok' ? '✔' : kind === 'err' ? '✖' : kind === 'warn' ? '!' : '○';
      clearInterval(ov.tick); ov.tick = null; ovClock();
    }
  }
  function ovHelp() {   // the live line's "What to do": shown only when the step has instructions
    var lv = ov && ov.live; if (!lv) return;
    var has = !!lv.help.textContent, open = has && !!ov.helpOpen;   // closed until opened
    lv.more.style.display = has ? '' : 'none';
    lv.more.textContent = open ? 'What to do \u25be' : 'What to do \u25b8';
    lv.help.style.display = open ? '' : 'none';
  }
  // the capture's outcome: one coloured verdict line, and the status bar to match
  function ovVerdict(kind, text) {
    if (!ov) return;
    var head = kind === 'ok' ? '✔ SUCCESS' : kind === 'warn' ? '⚠ CAPTURED WITH PROBLEMS' : '✖ FAILED';
    ovStatus(head.slice(2) + ' - ' + text, kind, true);
    var line = ovEl('div', 'margin:5px 0 3px;padding:4px 7px;border-radius:4px;white-space:pre-wrap;word-break:break-word;' +
      'font:600 12px/1.4 Segoe UI,Arial,sans-serif;color:' + OV_C[kind] + ';background:' + OV_BG[kind] + ';border-left:4px solid ' + OV_C[kind]);
    line.textContent = head + ': ' + text;
    ovAppend(line);
    ov.list.scrollTop = ov.list.scrollHeight;   // always in view
    try { trAfterCapture(); } catch (e) {}   // a Trace armed for this capture stops by itself now
  }
  function ovStat(which, text) { if (ov && ov[which] && ov[which].textContent !== text) ov[which].textContent = text; }
  // add a line to the console, above the live spinner line, keeping the view at the bottom if it was there
  function ovAppend(el) {
    var atEnd = ov.list.scrollHeight - ov.list.scrollTop - ov.list.clientHeight < 12;
    if (ov.live) ov.list.insertBefore(el, ov.live); else ov.list.appendChild(el);
    while (ov.list.childNodes.length > 400) ov.list.removeChild(ov.list.firstChild);
    if (atEnd) ov.list.scrollTop = ov.list.scrollHeight;
  }
  // kind: info (neutral), ok (green), warn (yellow), err (red), mute (gray)
  function ovLog(msg, kind) {
    if (!ov) return;
    try {
      kind = kind || 'info';
      if (kind === 'warn') ov.warns++;
      if (kind === 'err') ov.errs++;
      var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var icon = kind === 'ok' ? '✔ ' : kind === 'warn' ? '⚠ ' : kind === 'err' ? '✖ ' : '';
      var line = ovEl('div', 'padding:1px 0;white-space:pre-wrap;word-break:break-word;color:' + (OV_C[kind] || OV_C.info) +
        (kind === 'err' || kind === 'ok' ? ';font-weight:600' : ''));
      line.appendChild(ovEl('span', 'color:' + OV_C.mute + ';font-weight:normal', pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' '));
      line.appendChild(document.createTextNode(icon + msg));
      ovAppend(line);
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
      try { devtoolsCopy(text); log(done + ' (DevTools copy)', 'ok'); return Promise.resolve(true); } catch (e) { why.push('DevTools copy(): ' + (e && e.message || e)); }
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
    return p.then(function (via) { log(done + ' (via ' + via + ')', 'ok'); return true; }, function (e) {
      why.push('clipboard API: ' + (e && e.message || e));
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
        if (!ok) why.push('execCommand copy refused');
      } catch (e2) { why.push('execCommand: ' + (e2 && e2.message || e2)); }
      if (ok) { log(done, 'ok'); return true; }
      if (attempt < 4) {   // the report window has the focus: close it, so this window gets it back, and try again
        try { if (popup && !popup.closed) (popup.__realClose || popup.close).call(popup); } catch (e) {}
        try { window.focus(); } catch (e) {}
        return new Promise(function (res) { setTimeout(function () { res(copyText(text, name, attempt + 1, null)); }, 2000); });
      }
      showBanner('CORES capture "' + name + '" is ready.', [['Copy to clipboard', function (el) {
        navigator.clipboard.writeText(text).then(function () { el.textContent = 'Copied'; log(done, 'ok'); },
          function (e3) { el.textContent = 'Copy failed: ' + e3.message; });
      }]]);
      log('could not copy automatically (' + why.join('; ') + '). Click "Copy to clipboard" in the banner at the top of the ' +
        'patient list (one click; that always works).', 'warn');
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
      .then(function () { log('saved ' + name + ' into the folder "' + dir.name + '"', 'ok'); showBanner('CORES capture: saved ' + name + ' into "' + dir.name + '".'); return true; });
  }
  function saveToFolder(text, name) {
    if (!window.showDirectoryPicker) {
      log('this browser has no folder picker (File System Access API); the folder option is ignored', 'warn');
      return Promise.resolve(false);
    }
    var failed = function (el) { return function (e) { el.textContent = 'Failed: ' + e.message; log('folder save failed: ' + e.message, 'warn'); }; };
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
    }).catch(function (e) { log('folder save failed: ' + e.message, 'warn'); return false; });
  }

  // ---- deliver the captured HTML every way that is switched on
  // ---- each patient's rounding team, from the patient list this script runs in. CORES keeps one record per patient on
  // the list in window.global_constant_row_info (its service, team and sub-team, the way its Services / Teams / Sub-teams
  // menus name them, with the MRN, FIN and encounter that tie it to the report's patients). The report CORES prints
  // does not carry them, so they travel in the capture, in a comment after its name: <!-- CORES teams {...} -->.
  // ---- each patient's clinical data, as CORES holds it for its patient list once the list's columns have loaded (and a
  // report has been opened): results (vitals, labs, vent and O2 ...) with their times, medication orders, pending
  // results, code status, handoff fields. The capture carries it, so cores_parse can read it straight instead of from
  // the printed report; <!-- CORES data {...} --> just before the capture's closing </html>. Only the fields below are
  // kept, so the capture grows by about a megabyte, not by everything the page holds.
  function patientRows() {   // global_constant_row_info: this window, its parent, the top window or its opener
    var cands = [function () { return window; }, function () { return window.parent; }, function () { return window.top; }, function () { return window.opener; }];
    for (var c = 0; c < cands.length; c++) {
      var rows = null; try { rows = cands[c]().global_constant_row_info; } catch (e) { rows = null; }
      if (rows && typeof rows === 'object' && typeof rows.length === 'number' && rows.length) return rows;
    }
    return null;
  }
  function plain(o, keys) {   // the listed fields of an object (or all its plain ones), each a string, number, flag or null
    var out = {}; if (!o || typeof o !== 'object') return out;
    (keys || Object.keys(o)).forEach(function (k) {
      var v; try { v = o[k]; } catch (e) { return; }
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    });
    return out;
  }
  function list(x) { return Array.isArray(x) ? x : []; }
  var RESULT_KEYS = ['event_display', 'result_val', 'result_status', 'event_end_dt_tm', 'abnormal_ind', 'critical_ind'];
  var SET_KEYS = ['col_seq', 'event_set', 'since_dt_tm', 'last_label', 'last_value', 'last_units', 'last_date', 'last_event_class', 'count', 'abnormal_ind', 'critical_ind'];
  var MED_KEYS = ['class', 'order_status', 'active_ind', 'discontinued_ind', 'suspended_ind', 'name', 'ordered_as_mnemonic', 'order_mnemonic',
    'order_details', 'strdose', 'strdoseunit', 'voldose', 'voldoseunit', 'freetextdose', 'route', 'rate', 'rateunit', 'freetextrate', 'freq',
    'dose_string', 'rate_string', 'abx', 'abx_day', 'abx_date', 'current_start_date', 'orig_order_date', 'last_dose_date',
    'current_iv_med_name', 'current_iv_med_rate', 'current_iv_med_rate_unit', 'current_iv_vol_rate', 'current_iv_vol_rate_unit'];
  var PER_SET = 120;   // the newest entries kept per result column and patient (heart rate since admission runs to thousands)
  function clinicalFromCores() {
    var rows = patientRows(); if (!rows) return null;
    var pts = [], nResults = 0, nMeds = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; if (!r || typeof r !== 'object') continue;
      var p = plain(r, ['mrn', 'fin', 'encntr_id', 'person_id', 'one_liner', 'status', 'unit', 'room', 'bed', 'admit_dt_tm', 'service', 'team', 'sub_team']);
      try {
        var rl = r.result_list || {};
        p.result_sets = list(rl.list).map(function (s) { return plain(s, SET_KEYS); });
        p.results = list(rl.col).map(function (s) {
          var all = list(s && s.list), keep = all.length > PER_SET ? all.slice(-PER_SET) : all;
          nResults += keep.length;
          return { event_set: plain(s, ['event_set']).event_set || '', since_dt_tm: plain(s, ['since_dt_tm']).since_dt_tm || '', total: all.length,
                   fields: RESULT_KEYS, rows: keep.map(function (e) { var o = plain(e, RESULT_KEYS); return RESULT_KEYS.map(function (k) { return k in o ? o[k] : null; }); }) };
        });
      } catch (e) {}
      try {
        p.meds = [];
        list((r.med_list || {}).col).forEach(function (c) { list(c && c.list).forEach(function (m) { p.meds.push(plain(m, MED_KEYS)); }); });
        nMeds += p.meds.length;
      } catch (e) {}
      try { p.pending = list((r.pending_results || {}).list).map(function (x) { return plain(x); }); } catch (e) {}
      try { p.code_status = list(r.code_status).map(function (x) { return plain(x, ['order_disp', 'order_as', 'order_detail', 'order_date', 'dnar']); }); } catch (e) {}
      try { p.custom_fields = list(r.custom_fields).map(function (x) { return plain(x, ['type', 'value']); }); } catch (e) {}
      try {
        p.handoff = list(r.handoff_fields).map(function (h) {
          var o = plain(h, ['element_label', 'element_name', 'element_type', 'value', 'updt_dt_tm']);
          o.values = list(h && h.values).map(function (v) { return typeof v === 'object' ? plain(v) : v; });
          o.tasks = list(h && h.tasks).map(function (t) { return plain(t); });
          return o;
        });
      } catch (e) {}
      pts.push(p);
    }
    return pts.length ? { version: 2, captured: new Date().toISOString(), patients: pts, counts: { patients: pts.length, results: nResults, meds: nMeds } } : null;
  }
  window.coresClinical = clinicalFromCores;
  function teamsFromCores() {
    // in this window, or its parent, the top window or the one that opened it (the script may run in a frame)
    var rows = null, cands = [function () { return window; }, function () { return window.parent; }, function () { return window.top; }, function () { return window.opener; }];
    for (var c = 0; c < cands.length && !(rows && rows.length); c++) { try { rows = cands[c]().global_constant_row_info; } catch (e) { rows = null; } }
    if (!rows || typeof rows !== 'object' || typeof rows.length !== 'number' || !rows.length) return null;
    var pts = [], count = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; if (!r || typeof r !== 'object') continue;
      var g = function (k) { try { var v = r[k]; return v === undefined || v === null ? '' : String(v).trim(); } catch (e) { return ''; } };
      var sub = g('sub_team'); if (/^none$/i.test(sub)) sub = '';
      // the label CORES's Teams menu shows: "Service - Team" (Pulmonary - Consult), with a real sub-team after it
      var label = [g('service'), g('team')].filter(Boolean).join(' - ') + (sub ? ' - ' + sub : '');
      pts.push({ mrn: g('mrn'), fin: g('fin'), encntr_id: g('encntr_id'), person_id: g('person_id'),
                 service: g('service'), team: g('team'), sub_team: sub, label: label });
      if (label) count[label] = (count[label] || 0) + 1;
    }
    return pts.length ? { teams: count, patients: pts } : null;
  }
  function deliver(html, name, opts) {
    opts = opts || {};
    html = String(html).replace(/\r\n/g, '\n');   // so the clipboard, download and folder copies are byte-identical
    var text = '<!-- CORES capture ' + name + ' -->\n';   // the name travels with the text (used by cores --clipboard)
    if (opts.teams) text += '<!-- CORES teams ' + JSON.stringify(opts.teams).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/--/g, '-\\u002d') + ' -->\n';
    if (opts.clinical) {
      var dataComment = '<!-- CORES data ' + (opts.clinicalText || JSON.stringify(opts.clinical)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/--/g, '-\\u002d') + ' -->\n';
      html = /<\/html>\s*$/i.test(html) ? html.replace(/<\/html>\s*$/i, function () { return dataComment + '</html>'; }) : html + '\n' + dataComment;
    }
    text += html;
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
        log('download started: ' + name, 'ok');
      } catch (e) { log('download failed: ' + e.message, 'warn'); }
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
      log('captured (' + how + '): ' + html.length.toLocaleString() + ' chars, ' + rows + ' patient rows -> ' + name, rows ? 'ok' : 'warn');
      ovStat('rows', rows + ' patient row' + (rows === 1 ? '' : 's'));
      if (rows === 0) {
        log('no rendered patient rows in it: CORES did not render the report. The capture is delivered anyway, marked in its name.', 'warn');
        name = name.replace(/\.html$/, ' UNRENDERED.html');
      }
      ovStatus('Delivering ' + rows + ' patient rows (clipboard' + (opts.download !== false ? ', download' : '') + (opts.folder ? ', folder' : '') + ')\u2026', 'busy');
      var o = {}; for (var k in opts) o[k] = opts[k]; o.popup = popup;   // the report window is still open and focused now
      try { o.teams = teamsFromCores(); } catch (e) { o.teams = null; }
      if (o.teams) log('teams from the CORES patient list: ' + Object.keys(o.teams.teams).map(function (t) { return t + ' (' + o.teams.teams[t] + ')'; }).join(', '), 'ok');
      else log('no team data found in this CORES window: each patient\'s Team is left for you to type');
      if (opts.data !== false) {
        try { o.clinical = clinicalFromCores(); } catch (e) { o.clinical = null; log('could not read CORES\'s clinical data (' + (e && e.message || e) + '); the report alone is captured', 'warn'); }
        if (o.clinical) {
          o.clinicalText = JSON.stringify(o.clinical);
          var kb = Math.round(o.clinicalText.length / 1024);
          log('clinical data from the CORES patient list: ' + o.clinical.counts.patients + ' patients, ' + o.clinical.counts.results.toLocaleString() +
            ' results, ' + o.clinical.counts.meds + ' medication orders (' + kb.toLocaleString() + ' KB, carried in the capture)', 'ok');
        }
      }
      // the verdict once every delivery has settled: green when all went through, yellow when the capture is in hand
      // but something needs a hand (a click on the banner, an unrendered report, a reload, a warning above), red when
      // the delivery itself broke
      var settle = function (results) {
        var held = (results || []).some(function (r) { return r === false; });
        if (rows === 0) ovVerdict('warn', 'captured, but CORES had not rendered the report (0 patient rows). Try again.');
        else if (held) ovVerdict('warn', rows + ' patient rows captured, but not every delivery went through: see the yellow lines (a banner at the top may need a click).');
        else if (ov && ov.warns) ovVerdict('warn', rows + ' patient rows captured and delivered, after the problems in yellow above. On your PC run   cores generate');
        else ovVerdict('ok', rows + ' patient rows captured and delivered. On your PC run   cores generate');
      };
      var closed = false, closeWin = function () { if (closed) return; closed = true; try { (popup.__realClose || popup.close).call(popup); } catch (e) {} };
      try { deliver(html, name, o).then(function (r) { settle(r); setTimeout(closeWin, 500); }, function (e) { ovLog('delivery failed: ' + (e && e.message || e), 'err'); ovVerdict('err', 'the report was captured but could not be delivered. It is kept in window.coresCaptured.'); setTimeout(closeWin, 500); }); }
      catch (e) { console.error('CORES capture: delivery failed', e); ovLog('delivery failed: ' + (e && e.message || e), 'err'); ovVerdict('err', 'the report was captured but could not be delivered. It is kept in window.coresCaptured.'); }
      setTimeout(closeWin, 20000);   // closed after the delivery, or after 20 s whatever happens
      return name;
    }

    function fail(msg) {
      if (done) return;
      stop();
      console.error('CORES capture: ' + msg + ' The report window is left open so you can look at it.');
      ovLog(msg + ' The report window is left open so you can look at it.', 'err');
      ovVerdict('err', 'nothing captured. Press F5 in the CORES patient list window, open your list again, then paste the script again.');
      console.log('CORES capture: nothing captured. Press F5 in the CORES patient list window, open your list again, then paste the script again.');
    }

    // CORES's own advice for "Can't Load Patient List" is to close the report window and reload it: press OK, then its
    // Reload button (or reload the window); the hooks are put back on the new document by the timer below
    function recover(w, d, text) {
      if (reloads >= retries) return false;
      reloads++;
      log('CORES says "' + text + '" - pressing OK and Reload (attempt ' + reloads + ' of ' + retries + ')', 'warn');
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
          ovVerdict('err', 'the report window closed before anything was captured. Open the report again.');
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
    ovStart('armed mode', 'Waiting for you to open the report in CORES',
      'Open the report from CORES as you normally do (its own report / print button). It is captured as soon as it has ' +
      'rendered, and the report window closes by itself.\n\nIf nothing more happens here after you open it, CORES opened ' +
      'it another way: run   captureCores(281)   in the Console instead (the script then opens the report itself).');
    ovStat('rows', '');
    log('armed: the next report window CORES opens will be captured');
    return 'armed…';
  }

  // ---- Find in CORES (probeCores): where CORES keeps a word (a team name, a label) or an id, on the page, in its
  // frames and in its JavaScript data, WITHOUT reporting patient data: only the words searched for, element tags and
  // classes, the NAMES of the fields beside a match (never their values), counts, and the file names (no folders) of
  // what the page has loaded (other sites by name only). Any name that does not look like a programmer's
  // identifier (it could be a patient's name or number used as a key or an id) shows as <name>. Used by the Find box in the status box, or in the
  // Console:  probeCores('pulm')   probeCores('pulm', 'interv')   probeCores(1234)  (a number is matched as a whole id).
  var PROBE_SKIP = { location: 1, navigator: 1, history: 1, performance: 1, screen: 1, clientInformation: 1, document: 1,
    localStorage: 1, sessionStorage: 1, coresCaptured: 1, coresProbe: 1, coresDescribe: 1, captureCores: 1, probeCores: 1,
    describeCores: 1, coresColumns: 1, listCoresColumns: 1, coresMap: 1, mapCores: 1, coresClinical: 1, __coresRealOpen: 1,
    coresTrace: 1, traceCores: 1, __coresTraceStop: 1 };
  function probeCopy(t) {   // the clipboard, by the API when the page has the focus, else by a hidden text box
    return new Promise(function (res) {
      function old() { try { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); res(!!ok); } catch (e) { res(false); } }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { res(true); }, old); return; } } catch (e) {}
      old();
    });
  }
  function probeCores() {
    var args = [].slice.call(arguments), opt = {};
    if (args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object') opt = args.pop();    var terms = [], ids = [];
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
      // on and inside list rows (one per patient, often) an id is never shown and a class only when more than one element
      // has it (one on a single row could be a name); elsewhere both are shown when they look like a programmer's name
      var d = el.tagName.toLowerCase(), doc = el.ownerDocument, inRow = !!up(el, ['TR', 'LI']);
      if (el.id && !inRow) d += '#' + safe(el.id);
      if (typeof el.className === 'string' && el.className.trim())
        d += el.className.trim().split(/\s+/).filter(function (c) { try { return !inRow || doc.getElementsByClassName(c).length > 1; } catch (e) { return false; } })
          .slice(0, 3).map(function (c) { return '.' + safe(c); }).join('');
      return d;
    }
    function path(el) { var q = []; while (el && el.nodeType === 1 && q.length < 7) { q.unshift(desc(el)); el = el.parentElement; } return q.join(' > '); }
    function up(el, tags) { while (el && el.nodeType === 1) { if (tags.indexOf(el.tagName) >= 0) return el; el = el.parentElement; } return null; }
    // a heading row: one with a th, a cell spanning columns, fewer cells than the row after it, or a heading-like class
    // a row's kind: its first class (t4m_rnd_pt_list_row), whatever else it has (even / odd, selected, a state)
    function kind(r) { return ((typeof r.className === 'string' ? r.className : '').trim().split(/\s+/)[0] || '') + '|' + r.children.length; }
    function looksHead(r, ref) {
      if (!r || r.nodeType !== 1) return false;
      if (ref && ref.nodeType === 1 && kind(r).split('|')[0] && kind(r).split('|')[0] === kind(ref).split('|')[0]) return false;   // the same kind of row as the one it would head
      var cls = typeof r.className === 'string' ? r.className : '';
      return !!(r.querySelector('th') || [].some.call(r.children, function (c) { return c.colSpan > 1; }) ||
        (ref && r.children.length < ref.children.length) || /group|header|heading|section/i.test(cls));
    }
    function headingInfo(row) {
      var next = row.nextElementSibling, x;
      if (row.tagName === 'TR' && looksHead(row, next) && next && !looksHead(next, row)) {   // the match is a heading over a group
        var over = 0; for (x = next; x && !looksHead(x, row.nextElementSibling); x = x.nextElementSibling) over++;
        return { heading: over + ' row' + (over === 1 ? '' : 's') };
      }
      for (var k = 0, y = row.previousElementSibling; y && k < 500; y = y.previousElementSibling, k++)
        if (looksHead(y, row)) { var w = hit(y.textContent || ''); return { under: desc(y) + (w ? ', the nearest one says "' + w + '"' : '') }; }
      return {};
    }
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
          rowAttributes: row ? [].map.call(row.attributes, function (x) { return safe(x.name); }).slice(0, 15) : [],
          heading: '', under: '' });
        if (row) { var hi = headingInfo(row); domKeys[key].heading = hi.heading || ''; domKeys[key].under = hi.under || ''; }
      }
    }
    try { scanDoc(document, 'this window'); } catch (e) { out.notes.push('the page could not be read in full (' + (e && e.name) + ')'); }
    for (var f = 0; f < window.frames.length; f++) {
      try { scanDoc(window.frames[f].document, 'frame ' + f); } catch (e) { out.notes.push('frame ' + f + ' could not be read (another site)'); }
    }
    out.menuChoiceValues = optionIds.length;
    ids = ids.concat(optionIds.filter(function (v) { return ids.indexOf(v) < 0; }));

    // 2. the page's JavaScript data
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null, objs = 0, found = {};
    var records = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    // a big object (over 25 keys) is shown by its keys only when it is one of a list of objects that share them: a record
    // with field names, like each patient's row data. Otherwise it may be a lookup table keyed by patient, and its keys
    // stay hidden
    function isRecord(o, ks, sibs) {
      if (!sibs || !records) return false;
      for (var j = 0, seenSib = 0; j < sibs.length && seenSib < 3; j++) {
        var x = sibs[j]; if (x === o || !x || typeof x !== 'object') continue;
        seenSib++;
        var shared = 0; try { for (var q = 0; q < ks.length; q++) if (Object.prototype.hasOwnProperty.call(x, ks[q])) shared++; } catch (e) { continue; }
        if (shared >= ks.length * 0.8) return true;
      }
      return false;
    }
    function walk(o, pth, d, parent, sibs) {
      if (o === null || o === undefined || d > 7 || objs > 60000) return;
      var ty = typeof o;
      if (ty === 'string' || ty === 'number') {
        var t = hit(o); if (!t) return;
        var key = pth.replace(/\[\d+\]/g, '[i]');
        if (!found[key]) found[key] = { path: safePath(key), found: [], count: 0, inList: /\[\d+\]/.test(pth), fieldsBeside: [] };
        t.split(', ').forEach(function (w) { if (found[key].found.indexOf(w) < 0) found[key].found.push(w); });
        found[key].count++;
        if (parent && !found[key].fieldsBeside.length) try {
          var pk = Object.keys(parent), rec = records && records.has(parent);
          found[key].fieldsBeside = pk.length > 25 && !rec ? ['(a table of ' + pk.length + ' entries)'] : pk.slice(0, 250).map(safe);
          if (rec) found[key].record = pk.length + ' fields, the same in the other entries of its list';
        } catch (e) {}
        return;
      }
      if (ty !== 'object') return;
      try { if (o.nodeType || o.window === o) return; } catch (e) { return; }   // a window of another site, or a closed one
      try { if (seen) { if (seen.has(o)) return; seen.add(o); } } catch (e) { return; }
      objs++;
      var ks; try { ks = Object.keys(o); } catch (e) { return; }
      var arr = Array.isArray(o), rec = !arr && ks.length > 25 && isRecord(o, ks, sibs);
      if (rec) records.add(o);
      for (var i = 0; i < ks.length && i < 3000; i++) {
        var v; try { v = o[ks[i]]; } catch (e) { continue; }
        walk(v, pth + (arr ? '[' + ks[i] + ']' : '.' + (ks.length > 25 && !rec ? '<name>' : ks[i])), d + 1, o, arr ? o : null);
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
    try { walkWin(window, 'window'); } catch (e) { out.notes.push('the page\'s data could not be read in full (' + (e && e.name) + ')'); }
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

    // the answer in plain words: a verdict per word, where it is, and what that suggests; then the details for Claude
    var L = [], n = function (x, w) { return x + ' ' + w + (x === 1 ? '' : 's'); };
    var places = function (w) {
      var c = 0;
      out.dom.forEach(function (h) { if (h.found.split(', ').indexOf(w) >= 0) c += h.count; });
      out.data.forEach(function (h) { if (h.found.indexOf(w) >= 0) c += h.count; });
      return c;
    };
    var verdicts = searched.map(function (w) { var c = places(w); return { w: w, c: c }; });
    var onPage = out.dom.filter(function (h) { return !h.row; }), inRows = out.dom.filter(function (h) { return h.row; });
    var sections = [];
    if (onPage.length) sections.push(['ON THE PAGE', onPage.map(function (h) {
      var what = h.tag === 'option' ? 'a menu choice' + (h.selected ? ', selected' : '') :
        h.via === 'text' ? 'text in a ' + h.tag : 'the ' + h.via.replace('attribute ', '') + ' of a ' + h.tag;
      return '• "' + h.found + '": ' + what + (h.visible ? '' : ' (hidden)') + ', ' + n(h.count, 'time') +
        (h.where === 'this window' ? '' : ', in ' + h.where) + '\n    ' + h.path;
    })]);
    if (inRows.length) sections.push(['IN LIST ROWS', inRows.map(function (h) {
      var s = '• "' + h.found + '" in ' + n(h.count, 'row') + ' of ' + h.rowsInList + ' (' + h.row + ')' + (h.where === 'this window' ? '' : ', in ' + h.where);
      if (h.heading) s += '\n    these are HEADING rows, each over ' + h.heading + ' (a group per heading)';
      else if (h.under) s += '\n    the rows sit under heading rows (' + h.under + ')';
      return s + '\n    each row has: ' + (h.rowAttributes.join(', ') || 'no attributes') + '\n    ' + h.path;
    })]);
    var fieldsSeen = {};
    if (out.data.length) sections.push(["IN THE PAGE'S DATA", out.data.map(function (h) {
      var fl = h.fieldsBeside.join(', '), first = fieldsSeen[fl];
      if (!first && h.fieldsBeside.length > 6) fieldsSeen[fl] = h.path;
      return '• "' + h.found.join('", "') + '" at ' + h.path + (h.inList ? '  (a list: ' + h.count + ' match' + (h.count === 1 ? '' : 'es') + ')' : '') +
        (h.record ? '\n    it is one field of a record (' + h.record + ')' : '') +
        '\n    fields beside it: ' + (first ? 'the same as at ' + first : fl || '(none)');
    })]);
    // what this suggests about finding each patient's team (the reason Find was written)
    var hints = [], PT = /person|patient|pid|mrn|encntr|encounter|pt_?id|name/i;
    if (out.data.some(function (h) { return h.inList && h.fieldsBeside.some(function (f) { return PT.test(f); }); }))
      hints.push("The page's data has a list of patient-like records with a matching field: each patient's team can probably be read from it.");
    if (inRows.some(function (h) { return h.heading; })) hints.push('Rows are grouped under heading rows with these words: patients are probably listed under a heading per team.');
    else if (inRows.some(function (h) { return h.rowsInList > 1; })) hints.push('These words are in list rows: if each row is a patient, the rows show each patient\'s team.');
    if (!inRows.length && !hints.length && onPage.some(function (h) { return h.tag === 'option' || h.selected; }))
      hints.push('Only a menu has these words: this page may not show each patient\'s team. Try the window or panel that lists the patients.');
    if (!out.dom.length && !out.data.length) hints.push('Nothing matched. Use a shorter piece of the word, spelled as CORES shows it, and run Find in the window that shows it.');

    var head = 'Find in CORES: ' + searched.join(', ');
    L.push(head);
    verdicts.forEach(function (v) { L.push((v.c ? '✔ "' + v.w + '": found, ' + n(v.c, 'place') : '✖ "' + v.w + '": not found')); });
    sections.forEach(function (s) { L.push('', s[0]); s[1].forEach(function (x) { L.push(x); }); });
    if (hints.length) { L.push('', 'WHAT THIS SUGGESTS'); hints.forEach(function (x) { L.push('→ ' + x); }); }
    if (out.menuChoiceValues) L.push('', out.menuChoiceValues + ' matching menu choice(s) have a number as their value; it was also looked for in the data, as an id.');
    if (out.notes.length) L.push('', 'Notes: ' + out.notes.join('; '));
    L.push('', 'Searched ' + document.getElementsByTagName('*').length + ' page elements and ' + objs + ' data objects. Names that do not look ' +
      'like a programmer\'s field name show as <name>; no values are included.');
    var text = L.join('\n');
    var details; try { details = JSON.stringify(out, null, 1); } catch (e) { details = '(the details could not be written out: ' + (e && e.name) + ')'; }
    var forClaude = text + '\n\n---- details ----\n' + details;
    window.coresProbe = { result: out, text: text, forClaude: forClaude };
    console.log(forClaude);
    if (opt.hud && ov) {
      showResult(L, forClaude, 'Find');
    } else {
      probeCopy(forClaude).then(function (ok) { console.log(ok ? 'Copied for Claude: paste it into the chat.' : 'Could not copy: select the text above and copy it.'); });
    }
    return { text: text };
  }
  window.probeCores = probeCores;
  // ---- Describe (describeCores): the LAYOUT of CORES's patient records, never their contents. For each field of the
  // records in window.global_constant_row_info (or another list or object, given its path): in how many records it is
  // empty, text, a number, a yes/no flag, a list (how many entries, and the fields its entries have) or an object (its
  // fields); text holding JSON is opened and described the same way, and text holding HTML is called HTML. No value is
  // ever shown: only field names that look like a programmer's (else <name>), kinds and counts. Then a guess at which
  // fields could hold each part of the Daily Report, by their names. HUD: the Describe button; Console: describeCores()
  // or describeCores('window.some.path').
  function describeCores(path, opt) {
    opt = opt || {};
    path = String(path || 'window.global_constant_row_info').trim();
    function safe(x) { x = String(x); return /^[A-Za-z_$][\w$-]{0,29}$/.test(x) && !/\d{3,}/.test(x) && /[a-z]/.test(x) && !/^[A-Z][a-z]+$/.test(x) ? x : '<name>'; }
    var parts = path.replace(/^window\.?/, '').split('.').filter(Boolean), where = 'this window', checked = [];
    function at(w) { var t = w; for (var i = 0; i < parts.length; i++) { try { t = t == null ? undefined : t[parts[i]]; } catch (e) { return undefined; } } return t; }
    // the windows to look in: this one, then (for the CORES records) its parent, the top window, the one that opened it,
    // and every readable frame of each: the Console may have run the script in a frame or another CORES window
    function wins() {
      var out = [], seenW = [];
      function add(w, name) {
        try { if (!w || seenW.indexOf(w) >= 0) return; w.document; } catch (e) { return; }   // another site: unreadable
        seenW.push(w); out.push([w, name]);
        try { for (var f = 0; f < w.frames.length; f++) add(w.frames[f], name + ' > frame ' + f); } catch (e) {}
      }
      add(window, 'this window');
      try { add(window.parent, 'the parent window'); } catch (e) {}
      try { add(window.top, 'the top window'); } catch (e) {}
      try { add(window.opener, 'the window that opened this one'); } catch (e) {}
      return out;
    }
    var target = at(window), fallback = /^global_constant_row_info$/.test(parts.join('.'));
    if ((!target || typeof target !== 'object') && fallback) {
      var ws = wins();
      for (var wi = 0; wi < ws.length && !(target && typeof target === 'object'); wi++) { checked.push(ws[wi][1]); target = at(ws[wi][0]); where = ws[wi][1]; }
      // not under that name anywhere: a list in the page's data whose entries look like CORES's patient records
      for (var wj = 0; wj < ws.length && !(target && typeof target === 'object'); wj++) {
        var w = ws[wj][0], ks = []; try { ks = Object.keys(w); } catch (e) {}
        for (var q = 0; q < ks.length; q++) {
          var v; try { v = w[ks[q]]; } catch (e) { continue; }
          try { if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'person_id' in v[0] && 'encntr_id' in v[0]) { target = v; where = ws[wj][1] + ', under the name ' + safe(ks[q]); break; } } catch (e) {}
        }
      }
    }
    var L = ['Describe: ' + (parts.map(safe).join('.') || 'window')];
    if (!target || typeof target !== 'object') {
      L.push('✖ nothing to describe there' + (fallback ? ': no CORES patient records found' : ''));
      if (fallback) {
        L.push('   looked in: ' + (checked.join(', ') || 'this window') + '; and for any list of patient records in their data');
        var pg = String(location.pathname.split('/').filter(Boolean).pop() || '');
        L.push('   this window: "' + (/^[A-Za-z_][\w.-]{0,40}$/.test(pg) && !/\d{3,}/.test(pg) ? pg : '<name>') + '", ' + window.frames.length + ' frame(s)' +
          (window !== window.top ? ', inside another window (a frame)' : ''));
        L.push('   Check that the Console\'s context menu (top left of the Console) says "top", that the script was pasted in the CORES patient list window, and that the list has loaded.');
      }
      return finish(L);
    }
    if (where !== 'this window') L.push('✔ found in ' + where);
    // the records: a list's entries; an object with many keys is a lookup table (keyed by patient, perhaps), so its
    // entries are described and its keys never shown; a smaller object is one record
    var keyed = !Array.isArray(target) && Object.keys(target).length > 25;
    var recs = (Array.isArray(target) ? target : keyed ? Object.keys(target).map(function (k) { return target[k]; }) : [target])
      .filter(function (r) { return r && typeof r === 'object'; });
    L.push('✔ ' + recs.length + ' record' + (recs.length === 1 ? '' : 's') + (Array.isArray(target) ? ' in the list' : keyed ? ', the entries of a table (its keys are not shown)' : ''));
    // a field name is shown only when it is shared: in at least half of the records it comes from (when there are 3 or
    // more), so a key that is a patient's name or number, different in each, never appears; and it must look like a
    // programmer's name (safe)
    function shown(key, n, of) { return of >= 3 && n < of / 2 ? null : safe(key); }
    // what kind of thing a value is (no value is kept)
    function kindOf(v) {
      if (v === null || v === undefined || v === '') return 'empty';
      if (typeof v === 'number') return 'number';
      if (typeof v === 'boolean') return 'flag';
      if (typeof v === 'string') {
        var t = v.trim();
        if (!t) return 'empty';
        if (/^[\[{]/.test(t)) { try { JSON.parse(t); return 'JSON text'; } catch (e) {} }
        if (/^<\w/.test(t) || /<\/\w+>/.test(t)) return 'HTML text';
        if (/^\d+(\.\d+)?$/.test(t)) return 'digits';
        return 'text';
      }
      if (Array.isArray(v)) return v.length ? 'list' : 'empty list';
      if (typeof v === 'object') return Object.keys(v).length ? 'object' : 'empty object';
      return typeof v;
    }
    function open(v) { if (typeof v === 'string') { try { return JSON.parse(v.trim()); } catch (e) { return null; } } return v; }
    // the layout of a set of values found under one field: kinds with counts; for lists and objects, their fields (one
    // more level, and one beyond that for lists of objects)
    function layout(vals, depth) {
      var kinds = {}, sizes = [], sub = {}, nObj = 0, tables = 0, tableKeys = 0;
      vals.forEach(function (v) {
        var k = kindOf(v); kinds[k] = (kinds[k] || 0) + 1;
        if (depth > 1 || (k !== 'list' && k !== 'object' && k !== 'JSON text')) return;
        var o = open(v);
        var items = Array.isArray(o) ? o : [o];
        if (Array.isArray(o)) sizes.push(o.length);
        items.forEach(function (it) {
          if (!it || typeof it !== 'object' || Array.isArray(it)) return;
          nObj++;
          var ks = Object.keys(it);
          if (ks.length > 60) { tables++; tableKeys = Math.max(tableKeys, ks.length); return; }   // a table: keys not shown
          ks.forEach(function (key) { (sub[key] = sub[key] || []).push(it[key]); });
        });
      });
      var s = Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; }).map(function (k) { return k + ' ' + kinds[k]; }).join(', ');
      if (sizes.length) s += '; ' + Math.min.apply(null, sizes) + '–' + Math.max.apply(null, sizes) + ' entries';
      var subs = Object.keys(sub), hidden = 0, parts = [];
      subs.forEach(function (key) {
        var nm = shown(key, sub[key].length, nObj);
        if (!nm || nm === '<name>') { hidden++; return; }
        parts.push(nm + ' (' + layout(sub[key], depth + 1).split('\n')[0].replace(/ \d+(?=,|;|$)/g, '') + ')');
      });
      if (parts.length > 40) parts = parts.slice(0, 40).concat(['… ' + (parts.length - 40) + ' more']);
      if (hidden) parts.push(hidden + ' name' + (hidden === 1 ? '' : 's') + ' not shown (not shared, or not a programmer\'s name)');
      if (tables) parts.push(tables + ' table' + (tables === 1 ? '' : 's') + ' of up to ' + tableKeys + ' keys (not shown)');
      if (parts.length) s += '\n        ' + (sizes.length ? 'its entries have' : 'with') + ' fields: ' + parts.join(', ');
      return s;
    }
    var fields = {};
    recs.forEach(function (r) { try { Object.keys(r).forEach(function (k) { (fields[k] = fields[k] || []).push(r[k]); }); } catch (e) {} });
    var names = Object.keys(fields), filled = [], blank = [], unshared = 0;
    names.forEach(function (k) {
      var nm = shown(k, fields[k].length, recs.length);
      if (!nm || nm === '<name>') { unshared++; return; }   // never listed, not even as <name>
      (fields[k].every(function (v) { return /^empty/.test(kindOf(v)); }) ? blank : filled).push(k);
    });
    L.push('', 'FIELDS WITH SOMETHING IN THEM (' + filled.length + ')  [kind and in how many records]');
    filled.forEach(function (k) { L.push('• ' + safe(k) + ': ' + layout(fields[k], 0)); });
    if (blank.length) L.push('', 'EMPTY IN EVERY RECORD (' + blank.length + '): ' + blank.map(safe).join(', '));
    if (unshared) L.push('', unshared + ' more field name' + (unshared === 1 ? '' : 's') + ' not shown: not shared by most records, or not a programmer\'s name.');
    // which fields could hold each part of the Daily Report, by name
    var PARTS = [['Vitals', /vital|\bvs\b|temp|pulse|heart|resp|spo2|bp_|blood_?press|weight/i], ['Ventilation / O2', /vent|o2|oxygen|fio2|peep|airway/i],
      ['Intake / output', /\bio\b|i_?o_|intake|output|urine|drain|fluid/i], ['Labs', /lab|result|chem|cbc|bmp/i],
      ['Meds', /med|drug|infus|drip|antibio|prn|sched/i], ['Lines / tubes / drains', /(^|_)lines?($|_)|cath|tube|drain|tld/i],
      ['Patient summary / one-liner', /summary|one_?liner|handoff|narrative|course|hpi/i], ['Tasks / to-do', /task|todo|action/i],
      ['Situational awareness / plan', /plan|aware|sit_|contingenc/i], ['Diagnosis / problems', /diag|problem|dx/i],
      ['Allergies / diet', /allerg|diet|feed/i], ['Code status / isolation', /code_?status|isolat|precaution/i], ['Notes', /note|document/i]];
    L.push('', 'DAILY REPORT PARTS, BY FIELD NAME (a guess: check the kinds above)');
    PARTS.forEach(function (pt) {
      var hits = filled.filter(function (k) { return pt[1].test(k); });
      L.push((hits.length ? '✔ ' : '✖ ') + pt[0] + ': ' + (hits.length ? hits.map(safe).join(', ') : 'no filled field named like it'));
    });
    L.push('', 'No values are included: only field names that look like a programmer\'s (else <name>), kinds and counts.');
    return finish(L);

    function finish(lines) {
      var text = lines.join('\n');
      window.coresDescribe = { text: text };
      if (opt.hud && ov) showResult(lines, text, 'Describe');
      else { console.log(text); probeCopy(text).then(function (ok) { console.log(ok ? 'Copied for Claude: paste it into the chat.' : 'Could not copy: select the text above and copy it.'); }); }
      return { text: text };
    }
  }
  // a Find or Describe answer in the HUD's console: the first line as a title, verdict lines coloured, section titles
  // bold, a Copy for Claude button; scrolled into view, the HUD opened if it was collapsed, lit up for a moment
  function showResult(lines, forClaude, what) {
    var box = ovEl('div', 'margin:5px 0;padding:5px 7px;border:1px solid #c9d6e3;border-radius:5px;background:#f6f9fc;color:#1b1b1b;white-space:pre-wrap;word-break:break-word');
    lines.forEach(function (line, i) {
      box.appendChild(ovEl('div', i === 0 ? 'font:600 12px Segoe UI,Arial,sans-serif;color:#1f4e79;margin-bottom:2px' :
        /^✔/.test(line) ? 'color:' + OV_C.ok + ';font-weight:600' : /^✖/.test(line) ? 'color:' + OV_C.warn + ';font-weight:600' :
        /^[A-Z][A-Z' \/,()\-]+(\(|\[|$)/.test(line) ? 'color:#1f4e79;font-weight:700;margin-top:3px' : '', line || ' '));
    });
    var cb = ovEl('button', 'margin-top:5px;font:600 11px Segoe UI,Arial,sans-serif;padding:2px 10px;border:1px solid #1f4e79;border-radius:4px;background:#fff;color:#1f4e79;cursor:pointer', 'Copy for Claude');
    cb.onclick = function () { probeCopy(forClaude).then(function (ok) { cb.textContent = ok ? 'Copied for Claude ✔ - paste it into the chat' : 'Could not copy: select the text and copy it'; }); };
    box.appendChild(cb);
    ovAppend(box);
    ov.expand();
    ov.list.scrollTop += box.getBoundingClientRect().top - ov.list.getBoundingClientRect().top - 4;
    box.style.transition = 'background-color 1.2s'; box.style.backgroundColor = '#fff3b0';
    setTimeout(function () { box.style.backgroundColor = '#f6f9fc'; }, 60);
  }
  window.describeCores = describeCores;
  // ---- Columns (listCoresColumns): the column names CORES's column picker offers, for choosing which columns to show
  // on the patient list. With the picker open, its list(s) are found by the "Microbiolgy Results" column (CORES's own
  // spelling), else by an XPath typed in the box (starting with /); every <select> in the same dialog is listed, with
  // its options in order and the chosen ones marked. Only that dialog's menus are read: column names, no patient data.
  function listCoresColumns(xpath, opt) {
    opt = opt || {};
    var L = ['Columns: the CORES column picker'], anchor = null;
    xpath = String(xpath || '').trim();
    if (/^\//.test(xpath)) {
      try { anchor = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) { anchor = null; }
      if (!anchor) L.push('✖ nothing at that XPath; looking for the picker by its Microbiolgy Results column instead');
    }
    if (!anchor || anchor.tagName !== 'SELECT') {
      var sels = document.getElementsByTagName('select');
      for (var i = 0; i < sels.length && !(anchor && anchor.tagName === 'SELECT'); i++)
        for (var j = 0; j < sels[i].options.length; j++) if (/microbiolo?gy\s+results/i.test(sels[i].options[j].text)) { anchor = sels[i]; break; }
    }
    if (!anchor || anchor.tagName !== 'SELECT') {
      L.push('✖ no column picker found: open CORES\'s column picker (so its lists are on the screen), then press Columns again');
      return done(L);
    }
    // the dialog the list sits in: the nearest ancestor holding more than one menu, else a few levels up
    var box = anchor.parentElement, up = 0;
    while (box && box.parentElement && box.getElementsByTagName('select').length < 2 && up < 8) { box = box.parentElement; up++; }
    var lists = box ? [].slice.call(box.getElementsByTagName('select')) : [anchor];
    if (lists.indexOf(anchor) < 0) lists = [anchor];
    var total = 0;
    lists.forEach(function (sel, n) {
      var opts = [].slice.call(sel.options), chosen = opts.filter(function (o) { return o.selected; }).length;
      var label = (sel.getAttribute('title') || sel.getAttribute('name') || sel.getAttribute('aria-label') || '').replace(/\d{3,}/g, '#');
      L.push('', 'LIST ' + (n + 1) + ' (' + opts.length + ' column' + (opts.length === 1 ? '' : 's') + (label ? ', "' + label + '"' : '') +
        (chosen ? ', ' + chosen + ' highlighted' : '') + (sel === anchor ? ', the one with Microbiolgy Results' : '') + ')');
      opts.forEach(function (o) {
        var t = (o.text || '').replace(/\s+/g, ' ').trim().replace(/\d{3,}/g, '#');
        if (t) { L.push((o.selected ? '▸ ' : '  ') + t + (o.disabled ? '  (disabled)' : '')); total++; }
      });
    });
    L.splice(1, 0, '✔ ' + total + ' column name' + (total === 1 ? '' : 's') + ' in ' + lists.length + ' list' + (lists.length === 1 ? '' : 's') +
      ' (▸ = highlighted in the picker)');
    return done(L);

    function done(lines) {
      var text = lines.join('\n');
      window.coresColumns = { text: text };
      if (opt.hud && ov) showResult(lines, text, 'Columns');
      else { console.log(text); probeCopy(text).then(function (ok) { console.log(ok ? 'Copied for Claude: paste it into the chat.' : 'Could not copy: select the text above and copy it.'); }); }
      return { text: text };
    }
  }
  window.listCoresColumns = listCoresColumns;
  // ---- the identifier redaction Map and Trace share. From CORES's patient records (and any more names given): every
  // patient's name and each part of it, MRN, FIN, IDs, birth date, and the staff names in contacts and edits. The
  // function it returns masks them in a text, with long numbers, dates in any form, ages and bare room / bed numbers,
  // and says whether the text held any (hit): a text that did is dropped by its caller, not shown masked.
  function coresScrubber(rows, moreNames) {
    var ids = {}, words = {};
    function addWords(s) { String(s || '').split(/[^A-Za-z']+/).forEach(function (w) { if (w.length >= 2) words[w.toLowerCase()] = 1; }); }
    function addId(s) { s = String(s == null ? '' : s).trim(); if (s.length >= 3) ids[s.toLowerCase()] = 1; }
    for (var i = 0; rows && i < rows.length; i++) {
      var r = rows[i]; if (!r || typeof r !== 'object') continue;
      try {
        ['patient_name', 'patient_name_last', 'adt_attending', 'pcp'].forEach(function (k) { addWords(r[k]); });
        ['mrn', 'fin', 'mrn_mrn', 'person_id', 'encntr_id', 'birth_date', 'acuity_data_patient_id'].forEach(function (k) { addId(r[k]); });
        list(r.roles).forEach(function (x) { addWords(x && x.assign_name); addWords(x && x.assign_username); });
        list(r.handoff_fields).forEach(function (x) { addWords(x && x.updt_prsnl_name); addWords(x && x.updt_name); });
      } catch (e) {}
    }
    list(moreNames).forEach(addWords);
    var idList = Object.keys(ids);
    return function scrubbed(s) {   // s with every identifier masked, and whether it held one
      var hit = false, t = String(s);
      t = t.replace(/[A-Za-z']+/g, function (w) { if (words[w.toLowerCase()]) { hit = true; return '[name]'; } return w; });
      var low = t.toLowerCase();
      idList.forEach(function (x) { if (low.indexOf(x) >= 0) { hit = true; t = t.split(new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join('[id]'); low = t.toLowerCase(); } });
      t = t.replace(/\d{5,}/g, function () { hit = true; return '#'; })
        .replace(/\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/g, function () { hit = true; return '[date]'; })   // a date in any form: dropped
        .replace(/\b\d{1,2}[-\s.\/]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?([-\s.,\/]*\d{2,4})?\b/gi, function () { hit = true; return '[date]'; })   // 06-NOV-2026, 6 Nov
        .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b([,\s]+\d{2,4})?/gi, function () { hit = true; return '[date]'; })   // Nov 6, 2026
        .replace(/\b\d{1,3}\s*(years?|yrs?|y\/?o|months?|mos?|weeks?|wks?|days?)\b/gi, function () { hit = true; return '[age]'; });   // 61 Years: an age, dropped
      if (/^[A-Za-z]{0,3}\d{2,5}[A-Za-z]?$/.test(String(s).trim())) hit = true;   // a bare room or bed number (S625, 4012B): dropped
      return { text: t, hit: hit };
    };
  }
  // ---- Map (mapCores): the whole shape of CORES's patient data in one pass, for working out what holds what. For
  // every field path in the patient records (lists as [i]): what kind of thing it holds, in how many patients, and how
  // long its lists run; and the values SHARED by at least 3 different patients (column and result names, units,
  // statuses, routes ...), which describe the page, not a patient. A value unique to one or two patients (a name, a
  // number, a sentence of free text) is never shown. On top of that, every identifier the page itself holds (each
  // patient's name and every part of it, MRN, FIN, IDs, birth date, and the staff names in contacts and edits) is
  // redacted wherever it turns up, a shared value holding one is dropped, and long numbers and dates are masked.
  // Then the CORES columns on the list (their type, label and whether they load later) and the page's top-level data.
  // HUD: the Map button; Console: mapCores().
  function mapCores(opt) {
    opt = opt || {};
    function safe(x) { x = String(x); return /^[A-Za-z_$][\w$-]{0,29}$/.test(x) && !/\d{3,}/.test(x) && /[a-z]/.test(x) && !/^[A-Z][a-z]+$/.test(x) ? x : '<name>'; }
    var rows = patientRows(), L = ['Map: CORES\'s patient data'];
    if (!rows) {
      L.push('✖ no CORES patient records in this window, its parent, the top window or its opener. They appear once a report has been opened from the patient list: open one, then press Map again.');
      return done(L);
    }
    // 1. the identifiers to redact, from the page itself
    var scrubbed = coresScrubber(rows);
    // 2. every path in the records: kinds, patients, list lengths, and the values with the patients they occur in
    var paths = {}, nodes = 0;
    function kindOf(v) {
      if (v === null || v === undefined || v === '') return 'empty';
      if (typeof v === 'number') return 'number'; if (typeof v === 'boolean') return 'flag';
      if (typeof v === 'string') { var t = v.trim(); return !t ? 'empty' : /^\d+(\.\d+)?$/.test(t) ? 'digits' : /^<\w/.test(t) || /<\/\w+>/.test(t) ? 'HTML' : t.length > 80 ? 'long text' : 'text'; }
      if (Array.isArray(v)) return 'list'; return 'object';
    }
    function walk(v, pth, p, d) {
      if (nodes++ > 400000 || d > 9) return;
      var P = paths[pth] || (paths[pth] = { kinds: {}, pts: {}, sizes: [Infinity, 0], vals: {} });
      var k = kindOf(v); P.kinds[k] = (P.kinds[k] || 0) + 1; P.pts[p] = 1;
      if (k === 'list') { P.sizes[0] = Math.min(P.sizes[0], v.length); P.sizes[1] = Math.max(P.sizes[1], v.length); for (var j = 0; j < v.length && j < 2000; j++) walk(v[j], pth + '[i]', p, d + 1); return; }
      if (k === 'object') {
        var ks; try { ks = Object.keys(v); } catch (e) { return; }
        if (ks.length > 200) return;
        ks.forEach(function (key) { if (/^(oRowObject|oDomElmt|_oTable|_oRow|oPtData|oSelectedPts)$/.test(key)) return; var x; try { x = v[key]; } catch (e) { return; } walk(x, pth + '.' + key, p, d + 1); });
        return;
      }
      if (k === 'text' && /[A-Za-z]/.test(v) && v.length <= 60 && v.split(/\s+/).length <= 8) {
        var vs = P.vals[v] || (P.vals[v] = {}); vs[p] = 1;
      }
    }
    for (var q = 0; q < rows.length; q++) { var rec = rows[q]; if (!rec || typeof rec !== 'object') continue;
      Object.keys(rec).forEach(function (key) { if (/^(oRowObject|sElmtId|rendered)$/.test(key)) return; var x; try { x = rec[key]; } catch (e) { return; } walk(x, key, q, 0); }); }
    var nPts = rows.length, names = Object.keys(paths).sort();
    // a field name is shown when most patients that have its parent share it (the Describe rule); else <name>
    function shownPath(pth) { return pth.split('.').map(function (seg) { var m = seg.match(/^(.*?)((?:\[i\])*)$/); return safe(m[1]) + m[2]; }).join('.'); }
    L.push('✔ ' + nPts + ' patients; ' + names.length + ' field paths. [kind count | in how many patients | list lengths]  then the values shared by 3+ patients, with in how many');
    L.push('', 'PATIENT DATA');
    var shownCount = 0;
    names.forEach(function (pth) {
      var P = paths[pth], npt = Object.keys(P.pts).length, kinds = Object.keys(P.kinds);
      if (npt < Math.min(3, nPts)) return;   // a field only one or two patients have: it may be keyed by them
      var allEmpty = kinds.every(function (k) { return k === 'empty'; });
      if (allEmpty) return;
      var line = '• ' + shownPath(pth) + ': ' + kinds.sort(function (a, b) { return P.kinds[b] - P.kinds[a]; }).map(function (k) { return k + ' ' + P.kinds[k]; }).join(', ') +
        ' | ' + npt + ' pt' + (P.sizes[1] ? ' | ' + P.sizes[0] + '–' + P.sizes[1] + ' entries' : '');
      var shared = Object.keys(P.vals).map(function (v) { return [v, Object.keys(P.vals[v]).length]; })
        .filter(function (x) { return x[1] >= 3; }).map(function (x) { var s = scrubbed(x[0]); return s.hit ? null : [s.text, x[1]]; }).filter(Boolean)
        .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
      if (shared.length) line += '\n      ' + shared.slice(0, 40).map(function (x) { return '"' + x[0] + '" ' + x[1]; }).join(', ') + (shared.length > 40 ? ', … ' + (shared.length - 40) + ' more' : '');
      L.push(line); shownCount++;
    });
    var empties = names.filter(function (pth) { return Object.keys(paths[pth].kinds).every(function (k) { return k === 'empty'; }); });
    if (empties.length) L.push('', 'EMPTY FOR EVERY PATIENT (' + empties.length + '): ' + empties.slice(0, 80).map(shownPath).join(', ') + (empties.length > 80 ? ', …' : ''));
    // the page's own top-level data: what a blank window of this browser does not have
    var builtins = {};
    try { var fr = document.createElement('iframe'); fr.style.display = 'none'; document.body.appendChild(fr);
      Object.keys(fr.contentWindow).forEach(function (k) { builtins[k] = 1; }); fr.remove(); } catch (e) {}
    var own = []; try { own = Object.keys(window).filter(function (k) { return !builtins[k] && !/^(cores|probeCores|describeCores|listCoresColumns|mapCores|traceCores|captureCores|__cores)/.test(k); }); } catch (e) {}
    // 3. the columns on the list: CORES's column objects, wherever the page keeps them
    var cols = {}, seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null, budget = 60000;
    function findCols(o, d) {
      if (!o || typeof o !== 'object' || d > 6 || budget-- < 0) return;
      try { if (o.nodeType || o.window === o) return; } catch (e) { return; }
      try { if (seen) { if (seen.has(o)) return; seen.add(o); } } catch (e) { return; }
      var t; try { t = o.col_type; } catch (e) { t = undefined; }
      if (typeof t === 'string' && 'col_label' in o) {
        var key = [t, o.col_option, o.col_label].join('|');
        if (!cols[key]) cols[key] = { type: t, option: o.col_option || '', label: o.col_label || '', cls: o.col_class || '', asynch: o.is_asynch, loaded: o.col_async_data_loaded, error: o.col_async_data_error, seq: o.col_seq };
        return;
      }
      var ks; try { ks = Object.keys(o); } catch (e) { return; }
      for (var j = 0; j < ks.length && j < 3000; j++) { if (/^(global_constant_row_info|coresCaptured|coresProbe|coresDescribe|coresColumns|coresMap)$/.test(ks[j])) continue; var x; try { x = o[ks[j]]; } catch (e) { continue; } findCols(x, d + 1); }
    }
    own.forEach(function (k) { if (k === 'global_constant_row_info') return; var v; try { v = window[k]; } catch (e) { return; } try { findCols(v, 1); } catch (e) {} });
    var colList = Object.keys(cols).map(function (k) { return cols[k]; }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    L.push('', 'COLUMNS ON THE LIST (' + colList.length + ')  [type | option | label | loads later? | loaded?]');
    colList.forEach(function (c) {
      var lab = scrubbed(String(c.label)), opt2 = scrubbed(String(c.option)), typ = scrubbed(String(c.type));
      L.push('• ' + (typ.hit ? '<hidden>' : typ.text) + ' | ' + (opt2.hit ? '<hidden>' : opt2.text || '-') + ' | ' + (lab.hit ? '<hidden>' : lab.text || '-') + ' | ' +
        (c.asynch ? 'yes' : 'no') + ' | ' + (c.loaded === undefined ? '?' : c.loaded ? 'yes' : 'no') + (c.error ? ' | error' : ''));
    });
    // 4. the page's top-level data, by name and kind
    var tops = []; try { own.forEach(function (k) {
      var v; try { v = window[k]; } catch (e) { return; }
      if (v && typeof v === 'object' && !v.nodeType && v.window !== v) { var n = 0; try { n = Array.isArray(v) ? v.length : Object.keys(v).length; } catch (e) {} tops.push(safe(k) + (Array.isArray(v) ? ' (list of ' + n + ')' : ' (' + n + ' keys)')); }
    }); } catch (e) {}
    L.push('', 'TOP-LEVEL DATA ON THE PAGE: ' + (tops.join(', ') || '(none)'));
    L.push('', 'Shown: ' + shownCount + ' paths. Values shown are only those shared by 3+ patients, with every patient and staff name, MRN, FIN, ID, birth date, long number, date, age and room number dropped; free text and anything unique to a patient is never shown.');
    return done(L);

    function done(lines) {
      var text = lines.join('\n');
      window.coresMap = { text: text };
      if (opt.hud && ov) showResult(lines, text, 'Map');
      else { console.log(text); probeCopy(text).then(function (ok) { console.log(ok ? 'Copied for Claude: paste it into the chat.' : 'Could not copy: select the text above and copy it.'); }); }
      return { text: text };
    }
  }
  window.mapCores = mapCores;

  // ---- Trace (traceCores): WHAT LOADS CORES's patient records. CORES's structured records
  // (window.global_constant_row_info) exist only after a report has been opened from the list; the Trace watches the
  // page while that happens, to show what fills them and what CORES's report button calls. Arm it BEFORE opening the
  // report (in a fresh CORES session, where the records are not there yet), open the report as usual, then stop it.
  // HUD: the Trace button (press again to stop); Console: traceCores() to arm, traceCores() or traceCores('stop') to
  // stop. It also stops by itself a moment after a capture ends, and after 15 minutes.
  //
  // Armed, it ONLY OBSERVES, and puts back everything it wrapped when it stops. It never calls CORES's functions or
  // dwh.transformativemed.com, and lets every call it watches through unchanged. With times since arming, it records:
  //   - every assignment to window.global_constant_row_info (the property becomes a getter / setter that keeps the
  //     value working; when the page declared it itself and it cannot be redefined, it is polled instead) and every
  //     in-place fill (push / unshift / splice on the list, and its length and field count, polled): how many records,
  //     the call stack as function names + script file names + line:col, which window's code did it (this page, the
  //     report window, unknown) and whether a report window was open;
  //   - XHR and fetch of this page: method, host, the address's file name, the NAMES of the query and body parameters,
  //     status, answer size, duration; and the report window's requests, read from its resource timings (the report
  //     window is never wrapped);
  //   - window.open calls and form submits: the same, with the window name and features;
  //   - clicks: the element as tag + classes; its text only for a button / menu item / option / link outside the
  //     patient rows, 60 characters at most, and never when it holds an identifier (Map's redaction); the names of
  //     the handler functions on it (inline onclick, jQuery's event data), read, never called.
  // NO PARAMETER VALUE is ever shown, with one narrow exception: a program or report identifier, i.e. a parameter whose
  // name matches /prg|program|report_id/i and whose value is a short programmer's identifier or a number of at most 4
  // digits (prg_name=univ_wa_rnd_build_report, report_id:281). Addresses show as host + file name, never folders or
  // query text; script files as file name only. Nothing unique to a patient: names, CORES vocabulary, counts, timings.
  var TR = null;                                           // the armed Trace
  var TR_ROWS = 'global_constant_row_info';
  var TR_REPORT = /univ_wa_rnd_build_report|report_id/i;   // an address that is a CORES report (as arm() tells it)
  var TR_ID_NAME = /prg|program|report_id/i;               // the parameters whose value may be shown
  var TR_MAX = 1500;                                       // events kept
  try { if (typeof window.__coresTraceStop === 'function') window.__coresTraceStop(); } catch (e) {}   // a Trace left armed by an earlier paste

  function trSafe(x) { x = String(x); return /^[A-Za-z_$][\w$-]{0,39}$/.test(x) && !/\d{3,}/.test(x) && /[a-z]/.test(x) && !/^[A-Z][a-z]+$/.test(x) ? x : '<name>'; }
  function trNow(T) { return Math.round(performance.now() - T.t0); }
  function trPush(T, e) {
    if (T.ev.length >= TR_MAX && e.type !== 'records' && e.type !== 'open') { T.dropped++; return; }
    T.ev.push(e);
  }
  function trUp(el, test) { for (var i = 0; el && el.nodeType === 1 && i < 60; el = el.parentElement, i++) { try { if (test(el)) return el; } catch (e) {} } return null; }
  function trMine(el) { return !!trUp(el, function (x) { return x.id === 'cores-capture-overlay' || x.id === 'cores-capture-banner'; }); }
  // a sloppy function called bare gets this script's window as `this`: when the wrapped function belongs to another
  // window (the parent or top one), that window is what the page meant
  function trThis(self, w) { return self === window && w !== window ? w : self; }

  // ---- addresses and parameters: names only
  function trFile(pathname) {   // the last piece of an address's path, when it looks like a file name
    var p = String(pathname || ''), segs = p.split('/').filter(Boolean), last = segs.length ? segs[segs.length - 1] : '';
    if (!last) return '/';
    try { last = decodeURIComponent(last); } catch (e) {}
    return (/^[A-Za-z_][\w.-]{0,59}$/.test(last) && !/\d{3,}/.test(last) ? last : '<name>') + (/\/$/.test(p) ? '/' : '');
  }
  function trDecode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }
  function trPairs(qs) {
    var out = [];
    String(qs || '').split('&').forEach(function (p) { if (!p) return; var i = p.indexOf('='); out.push([trDecode(i < 0 ? p : p.slice(0, i)), i < 0 ? '' : trDecode(p.slice(i + 1))]); });
    return out;
  }
  function trIdValue(v) { v = String(v == null ? '' : v).trim(); return /^\d{1,4}$/.test(v) || trSafe(v) !== '<name>' ? v : null; }
  // parameter names in order (a repeated one once, with its count); a value only under the program / report id rule,
  // also for sub-parameters packed into one value the way CORES does it (options=report_id:281 -> options{report_id:281})
  function trParams(pairs) {
    var out = [], at = {};
    pairs.forEach(function (p) {
      var nm = trSafe(p[0]), shown = nm;
      if (nm !== '<name>' && TR_ID_NAME.test(nm)) { var v = trIdValue(p[1]); if (v !== null) shown = nm + '=' + v; }
      if (shown === nm && nm !== '<name>' && p[1]) {
        var inner = [], more = 0;
        String(p[1]).split(/[,;|]/).forEach(function (piece) {
          var m = /^\s*([A-Za-z_][\w$-]*)\s*[:=]\s*(.*)$/.exec(piece), v2 = null;
          if (m && TR_ID_NAME.test(m[1]) && trSafe(m[1]) !== '<name>') v2 = trIdValue(m[2]);
          if (v2 !== null) inner.push(m[1] + ':' + v2); else if (piece.trim()) more++;
        });
        if (inner.length) shown = nm + '{' + inner.join(', ') + (more ? ', +' + more + ' more' : '') + '}';
      }
      if (at[shown] !== undefined) { out[at[shown]].n++; return; }
      at[shown] = out.length; out.push({ s: shown, n: 1 });
    });
    return out.map(function (x) { return x.s + (x.n > 1 ? ' ×' + x.n : ''); });
  }
  function trUrl(u, w) {   // host, file name, parameter names; `abs` is kept for matching only and is never shown
    var out = { host: '', file: '', params: [], report: false, abs: '', same: true };
    try {
      var s = String(u == null ? '' : u);
      if (!s || s === 'about:blank') { out.file = s ? 'about:blank' : '(no address)'; return out; }
      var base = ''; try { base = w.location.href; } catch (e) {}
      var U = new URL(s, base || undefined);
      if (U.protocol !== 'http:' && U.protocol !== 'https:') { out.file = '(a ' + U.protocol.replace(/[^a-z]/gi, '') + ' address)'; return out; }
      out.abs = U.href.split('#')[0]; out.host = U.hostname;
      try { out.same = U.host === w.location.host; } catch (e) { out.same = false; }
      out.file = trFile(U.pathname);
      out.params = trParams(trPairs(U.search.replace(/^\?/, '')));
      out.report = TR_REPORT.test(s);
    } catch (e) { out.file = '(address not readable)'; }
    return out;
  }
  function trJsonNames(j) {
    if (Array.isArray(j)) return { kind: 'JSON list', n: j.length };
    if (j && typeof j === 'object') {
      var ks = Object.keys(j);
      if (ks.length > 40) return { kind: 'JSON table', n: ks.length };
      return { kind: 'JSON', names: trParams(ks.map(function (k) { var v = j[k]; return [k, typeof v === 'string' || typeof v === 'number' ? String(v) : '']; })) };
    }
    return { kind: 'JSON value' };
  }
  function trBody(b) {   // what a request sends: its kind and its parameter NAMES
    try {
      if (b === null || b === undefined || b === '') return null;
      var tag = Object.prototype.toString.call(b);
      if (typeof b === 'string') {
        var s = b.trim();
        if (/^[\[{]/.test(s)) {
          if (s.length > 300000) return { kind: 'JSON text', n: s.length };
          try { return trJsonNames(JSON.parse(s)); } catch (e) {}
        }
        if (/^[^=&\s]{1,80}=/.test(s) && !/\s/.test(s.slice(0, 300))) return { kind: 'form', names: trParams(trPairs(s)) };
        return { kind: 'text', n: s.length };
      }
      if (tag === '[object URLSearchParams]' || tag === '[object FormData]') {
        var pairs = []; b.forEach(function (v, k) { pairs.push([k, typeof v === 'string' ? v : '']); });
        return { kind: tag === '[object FormData]' ? 'form data' : 'form', names: trParams(pairs) };
      }
      if (tag === '[object Blob]' || tag === '[object File]') return { kind: 'blob', n: b.size };
      if (tag === '[object ArrayBuffer]' || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(b))) return { kind: 'binary', n: b.byteLength };
      if (b.nodeType === 9) return { kind: 'document' };
      return { kind: 'other' };
    } catch (e) { return { kind: 'unreadable' }; }
  }
  function trWinName(n) { n = String(n == null ? '' : n); return n ? n.replace(/[^\w-]/g, '?').replace(/\d{3,}/g, '#').slice(0, 40) : ''; }
  function trFeatures(f) { f = String(f == null ? '' : f); return f.replace(/[^\w=,.\s-]/g, '').replace(/\d{5,}/g, '#').replace(/\s+/g, '').slice(0, 120); }

  // ---- whose code: the windows the Trace knows (this page, its parent and top; every window opened since arming)
  function trSeeRealms(T) {   // a window gets a new set of built-ins each time it loads a page: keep each one seen
    T.popups.forEach(function (p) {
      try {
        if (p.closedAt) return;
        var fp = p.w.Function.prototype, last = p.realms[p.realms.length - 1];
        if (!last || last.fp !== fp) p.realms.push({ fp: fp, ap: p.w.Array.prototype, op: p.w.Object.prototype });
      } catch (e) {}
    });
  }
  function trRealm(T, x, isFn) {   // 'list', 'report' or '' for a function or an object, by whose built-ins it descends from
    function chain(x, protos) { try { for (var p = Object.getPrototypeOf(x), i = 0; p && i < 6; p = Object.getPrototypeOf(p), i++) if (protos.indexOf(p) >= 0) return true; } catch (e) {} return false; }
    for (var i = 0; i < T.wins.length; i++) {
      try { var w = T.wins[i].w; if (chain(x, isFn ? [w.Function.prototype] : [w.Array.prototype, w.Object.prototype])) return { kind: 'list', W: T.wins[i] }; } catch (e) {}
    }
    for (var j = 0; j < T.popups.length; j++) {
      var p = T.popups[j];
      for (var k = 0; k < p.realms.length; k++) if (chain(x, isFn ? [p.realms[k].fp] : [p.realms[k].ap, p.realms[k].op])) return { kind: 'report', pop: p };
    }
    return null;
  }
  function trCallers(T, fn) {   // whose functions are on the way to a watched call, nearest first, as far as they can be read
    var out = [], n = 0;
    try { while (fn && n++ < 30) { var r = trRealm(T, fn, true); out.push(r ? r : { kind: '' }); fn = fn.caller; } } catch (e) {}
    return out;
  }
  function trWhose(T, url) {   // an address on a call stack: this page's (or a script only it loads), or a report window's
    var u = String(url).split('#')[0], inL = false, inR = false;
    function has(w) {
      try {
        if (String(w.location.href).split('#')[0] === u) return true;
        var sc = w.document.scripts;
        for (var i = 0; i < sc.length && i < 400; i++) if (sc[i].src && sc[i].src.split('#')[0] === u) return true;
      } catch (e) {}
      return false;
    }
    T.wins.forEach(function (W) { if (has(W.w)) inL = true; });
    T.popups.forEach(function (p) { if (!p.closedAt && has(p.w)) inR = true; });
    return inL && !inR ? 'list' : inR && !inL ? 'report' : '';
  }
  function trFnName(s) {
    s = String(s || '').replace(/^async /, '').replace(/\s*\[as [^\]]*\]/, '').replace(/[^\w$.<> ]/g, '').replace(/\d{5,}/g, '#').trim().slice(0, 60);
    return s || '(anonymous)';
  }
  // the call stack above the Trace's own wrapper: function names, script FILE names (no folders, no query), line:col
  function trFrames(T, max, tagged) {
    var raw = ''; try { raw = String(new Error().stack || ''); } catch (e) {}
    var fr = [], own = -1;
    raw.split('\n').forEach(function (ln) {
      ln = ln.trim(); var m, fn = '', loc = '';
      if (!ln || /^\w*Error\b/.test(ln)) return;
      if ((m = /^at (.*?) \((.*)\)$/.exec(ln))) { fn = m[1]; loc = m[2]; }
      else if ((m = /^at (?:async )?(.*)$/.exec(ln))) loc = m[1];
      else if ((m = /^(.*?)@(.*)$/.exec(ln))) { fn = m[1]; loc = m[2]; }
      else return;
      var lm = /^(.*):(\d+):(\d+)$/.exec(loc) || /^(.*):(\d+)$/.exec(loc);
      fr.push({ fn: fn, url: lm ? lm[1] : loc, line: lm ? lm[2] : '', col: lm && lm[3] || '' });
    });
    for (var i = 0; i < fr.length; i++) if (/coresTr[A-Z]/.test(fr[i].fn)) own = i;   // the Trace's wrapper: everything up to it is the Trace's own
    return fr.slice(own + 1, own + 1 + (max || 10)).map(function (f) {
      var url = String(f.url || ''), file = '', tag = '';
      if (!url || url === 'native' || (url === '<anonymous>' && !f.line)) file = 'built-in';
      else if (/^<anonymous>$|^VM\d+|^debugger eval/.test(url)) file = 'console';   // a script pasted into the Console, like this one
      else if (/^eval at /.test(url)) file = 'eval';
      else { try { file = trFile(new URL(url).pathname); } catch (e) { file = '<name>'; } if (tagged) tag = trWhose(T, url); }
      var text = trFnName(f.fn) + ' (' + file + (f.line ? ':' + f.line + (f.col ? ':' + f.col : '') : '') + ')';
      return { text: text, tag: tag };
    });
  }

  // ---- the patient records: what they hold (counts only), and each write to them
  function trShape(v) {
    var o = { kind: 'nothing', n: 0, fields: 0 };
    try {
      if (v === null || v === undefined) return o;
      if (typeof v !== 'object') { o.kind = typeof v; return o; }
      if (typeof v.length === 'number') { o.kind = 'list'; o.n = v.length; var first = v[0]; if (first && typeof first === 'object') o.fields = Object.keys(first).length; }
      else { o.kind = 'object'; o.n = Object.keys(v).length; }
    } catch (e) { o.kind = 'unreadable'; }
    return o;
  }
  function trReportsOpen(T) { var n = 0; T.popups.forEach(function (p) { try { if (!p.closedAt && !p.w.closed) n++; } catch (e) {} }); return n; }
  // who wrote: from the functions calling (when they can be read), the call stack's addresses, and where the list
  // itself was made
  function trWho(T, v, callerFn, frames) {
    var chain = trCallers(T, callerFn), vr = null, why = [];
    try { if (v && typeof v === 'object') vr = trRealm(T, v, false); } catch (e) {}
    var kinds = chain.map(function (c) { return c.kind; });
    var who = '', sure = false, pop = null;
    var popOf = function () { for (var i = 0; i < chain.length; i++) if (chain[i].kind === 'report') return chain[i].pop; return vr && vr.kind === 'report' ? vr.pop : null; };
    if (kinds[0] === 'report') { who = 'report'; sure = true; why.push('the function that wrote them belongs to the report window'); }
    else if (kinds.indexOf('report') >= 0) { who = 'report'; sure = true; why.push('a function of this page wrote them, called by the report window\'s code'); }
    else if (frames.some(function (f) { return f.tag === 'report'; })) { who = 'report'; sure = true; why.push('the report window\'s own script is on the call stack'); }
    else if (kinds[0] === 'list') { who = 'list'; sure = true; why.push('the function that wrote them belongs to this page, and no report window code called it'); }
    else if (frames.length && frames[0].tag === 'list') { who = 'list'; sure = true; why.push('the call came from this page\'s own script'); }
    if (vr && vr.kind === 'report') {
      why.push('the list itself was made in the report window');
      if (!who) { who = 'report'; why.push('(the writing code could not be read, so this rests on where the list was made)'); }
    } else if (vr && vr.kind === 'list') {
      why.push('the list itself was made in this page');
      if (!who) { who = 'list'; why.push('(the writing code could not be read, so this rests on where the list was made)'); }
    }
    if (who === 'report') pop = popOf();
    return { who: who || 'unknown', sure: sure, why: why, pop: pop, madeIn: vr ? vr.kind : '' };
  }
  function trWrite(T, W, st, how, v, callerFn, polled) {
    var sh = trShape(v), t = trNow(T);
    trSeeRealms(T);
    var frames = polled ? [] : trFrames(T, 12, true);
    var who = trWho(T, v, callerFn, frames);
    st.len = sh.n; st.fields = sh.fields; st.writes++;
    var sig = how + '|' + who.who + '|' + frames.map(function (f) { return f.text; }).join('<');
    var last = T.lastWrite;
    if (last && last.sig === sig && how !== 'assigned' && t - last.t2 < 1500) { last.times++; last.t2 = t; last.n = sh.n; last.fields = sh.fields; return; }
    var e = { type: 'records', t: t, t2: t, times: 1, how: how, kind: sh.kind, n: sh.n, n0: sh.n, fields: sh.fields, W: W, who: who, frames: frames,
              reportsOpen: trReportsOpen(T), during: T.inCallback || null, polled: !!polled, sig: sig };
    T.lastWrite = e; trPush(T, e);
    if (Array.isArray(v)) trWatchList(T, W, st, v);
  }
  // in-place fills: push / unshift / splice on the list itself, wrapped on that one list (hidden from loops and JSON)
  function trWatchList(T, W, st, arr) {
    if (st.listHooks && st.listHooks.arr === arr) return;
    trUnwatchList(st);
    var hooks = st.listHooks = { arr: arr, fns: {} };
    ['push', 'unshift', 'splice'].forEach(function (m) {
      try {
        if (Object.prototype.hasOwnProperty.call(arr, m)) return;   // the page's own: left alone
        var real = arr[m]; if (typeof real !== 'function') return;
        var wrapped = function coresTrList() {
          var before = this.length, r = real.apply(this, arguments);
          if (T.on && this === arr) { try { if (arr.length !== before) { var c = null; try { c = wrapped.caller; } catch (e) {} trWrite(T, W, st, m, arr, c, false); } } catch (e) {} }
          return r;
        };
        Object.defineProperty(arr, m, { configurable: true, enumerable: false, writable: true, value: wrapped });
        hooks.fns[m] = wrapped;
      } catch (e) {}
    });
  }
  function trUnwatchList(st) {
    var h = st.listHooks; st.listHooks = null; if (!h) return;
    Object.keys(h.fns).forEach(function (m) { try { var d = Object.getOwnPropertyDescriptor(h.arr, m); if (d && d.value === h.fns[m]) delete h.arr[m]; } catch (e) {} });
  }
  function trHookRecords(T, W) {
    var w = W.w, st = W.st = { val: undefined, mode: 'poll', had: false, setter: null, assigned: false, len: 0, fields: 0, writes: 0, listHooks: null, start: null };
    var d = null; try { d = Object.getOwnPropertyDescriptor(w, TR_ROWS) || null; } catch (e) {}
    st.had = !!d;
    try { st.val = w[TR_ROWS]; } catch (e) {}
    st.start = trShape(st.val); st.len = st.start.n; st.fields = st.start.fields;
    if (!d || (d.configurable && 'value' in d)) {
      try {
        st.setter = function coresTrSet(v) {
          st.val = v; st.assigned = true;
          if (T.on) { var c = null; try { c = coresTrSet.caller; } catch (e) {} try { trWrite(T, W, st, 'assigned', v, c, false); } catch (e) {} }
        };
        Object.defineProperty(w, TR_ROWS, { configurable: true, enumerable: d ? !!d.enumerable : true, get: function coresTrGet() { return st.val; }, set: st.setter });
        st.mode = 'hook';
      } catch (e) { st.mode = 'poll'; st.setter = null; }
    }
    if (Array.isArray(st.val)) trWatchList(T, W, st, st.val);
    T.undo.push(function () {
      trUnwatchList(st);
      if (st.mode !== 'hook') return;
      var cur = null; try { cur = Object.getOwnPropertyDescriptor(w, TR_ROWS); } catch (e) {}
      if (!cur || cur.set !== st.setter) return;   // the page replaced the property meanwhile: left as it is
      if (!st.had && !st.assigned) { try { delete w[TR_ROWS]; } catch (e) {} return; }   // it was not there, and still is not
      Object.defineProperty(w, TR_ROWS, { configurable: true, enumerable: d ? !!d.enumerable : true, writable: d ? d.writable !== false : true, value: st.val });
    });
  }

  // ---- this page's requests: XHR and fetch, let through unchanged
  function trXhrSize(x, r) {
    var rt = ''; try { rt = x.responseType || ''; } catch (e) {}
    try {
      if (rt === '' || rt === 'text') { r.size = (x.responseText || '').length; r.unit = 'chars'; }
      else if (rt === 'arraybuffer' && x.response) { r.size = x.response.byteLength; r.unit = 'bytes'; }
      else if (rt === 'blob' && x.response) { r.size = x.response.size; r.unit = 'bytes'; }
      else if (r.u.same) { var cl = x.getResponseHeader('Content-Length'); if (cl && /^\d+$/.test(cl)) { r.size = +cl; r.unit = 'bytes'; } }
    } catch (e) {}
  }
  function trMethod(m) { m = String(m || 'GET').toUpperCase(); return /^[A-Z]{1,10}$/.test(m) ? m : '?'; }
  function trHookXhr(T, W) {
    var w = W.w, XP = null; try { XP = w.XMLHttpRequest && w.XMLHttpRequest.prototype; } catch (e) {}
    if (!XP || typeof XP.open !== 'function' || typeof XP.send !== 'function') return;
    var realOpen = XP.open, realSend = XP.send;
    var myOpen = function coresTrXhrOpen(method, url) {
      if (T.on) try {
        var x = this, m = T.meta.get(x);
        if (!m) {
          m = { rec: null }; T.meta.set(x, m);
          // added here, before the page's own handlers as a rule, so "while the answer was being handled" starts in time
          x.addEventListener('readystatechange', function coresTrXhrState() {
            var r = m.rec; if (!T.on || !r || x.readyState !== 4 || r.tResp !== undefined) return;
            r.tResp = trNow(T); T.inCallback = r;
            setTimeout(function () { if (T.inCallback === r) T.inCallback = null; }, 0);   // the answer's own task is over
          });
          x.addEventListener('loadend', function coresTrXhrEnd() {
            var r = m.rec; if (!r || r.done) return;
            r.done = true;
            if (!T.on) return;
            try { r.tEnd = trNow(T); if (r.tResp === undefined) r.tResp = r.tEnd; r.ms = r.t === undefined ? null : r.tEnd - r.t; r.status = x.status; trXhrSize(x, r); } catch (e) {}
          });
        }
        m.rec = { type: 'request', api: 'XHR', W: W, method: trMethod(method), u: trUrl(url, w) };
      } catch (e) {}
      return realOpen.apply(this, arguments);
    };
    var mySend = function coresTrXhrSend(body) {
      if (T.on) try {
        var m = T.meta.get(this), r = m && m.rec;
        if (r && r.t === undefined) { r.t = trNow(T); r.body = trBody(body); r.frames = trFrames(T, 5, false); trPush(T, r); }
      } catch (e) {}
      return realSend.apply(this, arguments);
    };
    XP.open = myOpen; XP.send = mySend;
    T.undo.push(function () { if (XP.open === myOpen) XP.open = realOpen; if (XP.send === mySend) XP.send = realSend; });
  }
  function trHookFetch(T, W) {
    var w = W.w, real = null; try { real = w.fetch; } catch (e) {}
    if (typeof real !== 'function') return;
    var mine = function coresTrFetch(input, init) {
      var p = real.apply(trThis(this, w), arguments);
      if (T.on) try {
        var isReq = input && typeof input === 'object' && typeof input.url === 'string';
        var r = { type: 'request', api: 'fetch', W: W, method: trMethod((init && init.method) || (isReq && input.method) || 'GET'), u: trUrl(isReq ? input.url : input, w),
                  t: trNow(T), body: trBody(init && init.body), frames: trFrames(T, 5, false) };
        trPush(T, r);
        p.then(function (res) {
          if (!T.on) return;
          try { r.tResp = r.tEnd = trNow(T); r.ms = r.tEnd - r.t; r.status = res.status; var cl = res.headers.get('content-length'); if (cl && /^\d+$/.test(cl)) { r.size = +cl; r.unit = 'bytes'; } } catch (e) {}
        }, function () { if (T.on) { r.failed = true; r.tResp = r.tEnd = trNow(T); r.ms = r.tEnd - r.t; } });
      } catch (e) {}
      return p;
    };
    w.fetch = mine;
    T.undo.push(function () { try { if (w.fetch === mine) w.fetch = real; } catch (e) {} });
  }

  // ---- window.open and form submits
  function trLastClick(T, t) { for (var i = T.ev.length - 1; i >= 0; i--) { var e = T.ev[i]; if (e.type === 'click') return t - e.t <= 5000 ? e : null; } return null; }
  function trHookOpen(T, W) {
    var w = W.w, real = null; try { real = w.open; } catch (e) {}
    if (typeof real !== 'function') return;
    function make(inner) {
      var f = function coresTrOpen(url, name, features) {
        var t = T.on ? trNow(T) : 0;   // when it was called: opening a window can take a while
        var pop = inner.apply(trThis(this, w), arguments);
        if (T.on) try {
          var c = null; try { c = f.caller; } catch (e) {}
          var u = trUrl(url, w), p = null;
          if (pop) {
            for (var i = 0; i < T.popups.length; i++) if (T.popups[i].w === pop) p = T.popups[i];
            if (!p) { p = { w: pop, n: T.popups.length + 1, t: t, u: u, report: u.report, href: u.abs, closedAt: 0, realms: [], seen: {} }; T.popups.push(p); }
            else { p.u = u; p.href = u.abs; if (u.report) p.report = true; }
          }
          trSeeRealms(T);
          trPush(T, { type: 'open', t: t, W: W, u: u, name: trWinName(name), features: trFeatures(features), blocked: !pop, opened: p,
                      frames: trFrames(T, 10, true), callers: trCallers(T, c).map(function (x) { return x.kind; }), click: trLastClick(T, t) });
        } catch (e) {}
        return pop;
      };
      return f;
    }
    var mine = make(real), mineReal = null, savedReal = null;
    w.open = mine;
    // captureCores() keeps the page's own window.open in __coresRealOpen and calls it from its wrapper: watched too, so
    // a capture armed (or armed again) while the Trace runs does not slip past it
    try { if (w === window && typeof w.__coresRealOpen === 'function') { savedReal = w.__coresRealOpen; mineReal = make(savedReal); w.__coresRealOpen = mineReal; } } catch (e) {}
    T.undo.push(function () {
      try { if (w.open === mine) w.open = real; } catch (e) {}
      try { if (mineReal && w.__coresRealOpen === mineReal) w.__coresRealOpen = savedReal; else if (w.__coresRealOpen === mine) w.__coresRealOpen = real; } catch (e) {}
    });
  }
  function trForm(T, W, form, how) {
    var pairs = [], els = form.elements || [];
    for (var i = 0; i < els.length && i < 200; i++) { var nm = els[i].name; if (nm) pairs.push([nm, typeof els[i].value === 'string' && els[i].value.length <= 60 ? els[i].value : '']); }
    trPush(T, { type: 'form', t: trNow(T), W: W, how: how, method: trMethod(form.getAttribute('method') || 'GET'), u: trUrl(form.getAttribute('action') || W.w.location.href, W.w),
                target: trWinName(form.getAttribute('target')), names: trParams(pairs).slice(0, 40), frames: how === 'submit()' ? trFrames(T, 8, true) : [] });
  }
  function trHookForms(T, W) {
    var w = W.w, FP = null; try { FP = w.HTMLFormElement.prototype; } catch (e) {}
    if (FP && typeof FP.submit === 'function') {
      var real = FP.submit, mine = function coresTrSubmit() { if (T.on) { try { trForm(T, W, this, 'submit()'); } catch (e) {} } return real.apply(this, arguments); };
      FP.submit = mine;
      T.undo.push(function () { if (FP.submit === mine) FP.submit = real; });
    }
    var onSubmit = function coresTrSubmitEvent(e) { if (T.on) { try { if (e.target && e.target.tagName === 'FORM' && !trMine(e.target)) trForm(T, W, e.target, 'submit event'); } catch (x) {} } };
    try { w.addEventListener('submit', onSubmit, true); T.undo.push(function () { w.removeEventListener('submit', onSubmit, true); }); } catch (e) {}
  }

  // ---- clicks: what was clicked, as tag + classes; the handlers on it, by name
  var TR_ACT_CLASS = /(^|[-_])(btn|button|menu-?item|menu_item)($|[-_])/i;
  var TR_PT_ROW = /pt_list|pt_row|patient/i;
  var TR_KEYWORD = /^(if|for|while|switch|catch|function|return|typeof|new|else|do|try|var|let|const|void|delete|in|of|with|this|super|await|async|yield|throw|case)$/;
  function trInRow(el) {   // on or inside a list row (any tr / li), or anything of the patient list
    return !!trUp(el, function (x) { return x.tagName === 'TR' || x.tagName === 'LI' || TR_PT_ROW.test(typeof x.className === 'string' ? x.className : '') || TR_PT_ROW.test(x.id || ''); });
  }
  function trInPatientList(el) { return !!trUp(el, function (x) { return TR_PT_ROW.test(typeof x.className === 'string' ? x.className : '') || TR_PT_ROW.test(x.id || ''); }); }
  function trDesc(el) {   // Find's rule: no id on or inside a list row, and a class there only when more than one element has it
    var d = el.tagName.toLowerCase(), doc = el.ownerDocument, inRow = trInRow(el);
    try { if (el.id && !inRow && trSafe(el.id) !== '<name>') d += '#' + el.id; } catch (e) {}
    try {
      var cn = typeof el.className === 'string' ? el.className.trim() : '';
      if (cn) d += cn.split(/\s+/).filter(function (c) { try { return trSafe(c) !== '<name>' && (!inRow || doc.getElementsByClassName(c).length > 1); } catch (e) { return false; } })
        .slice(0, 3).map(function (c) { return '.' + c; }).join('');
    } catch (e) {}
    try { var role = el.getAttribute('role'); if (role && /^[a-z]{2,20}$/.test(role)) d += '[role=' + role + ']'; } catch (e) {}
    return d;
  }
  function trPath(el) { var q = []; for (var x = el; x && x.nodeType === 1 && x.tagName !== 'BODY' && x.tagName !== 'HTML' && q.length < 4; x = x.parentElement) q.unshift(trDesc(x)); return q.join(' > '); }
  function trActionable(el) {   // the button, menu item, option or link a click landed on or in
    return trUp(el, function (x) {
      var tag = x.tagName, role = (x.getAttribute('role') || '').toLowerCase();
      return tag === 'BUTTON' || tag === 'A' || tag === 'OPTION' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(x.type)) ||
        /^(button|menuitem|menuitemcheckbox|menuitemradio|option|link)$/.test(role) ||
        (typeof x.className === 'string' && x.className.split(/\s+/).some(function (c) { return TR_ACT_CLASS.test(c); }));
    });
  }
  function trCallNames(code) {   // the names of the functions a piece of code calls (never their arguments)
    var out = [], m, re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,4})\s*\(/g, src = String(code).slice(0, 20000);
    while ((m = re.exec(src)) && out.length < 8) {
      if (TR_KEYWORD.test(m[1])) continue;
      var nm = m[1].split('.').map(function (seg) { return seg.length <= 40 && !/\d{3,}/.test(seg) ? seg : '<name>'; }).join('.');
      if (out.indexOf(nm) < 0) out.push(nm);
    }
    return out;
  }
  function trJqEvents(w, node) {   // jQuery's stored handlers for a node, READ from where jQuery keeps them (jQuery is not called)
    try {
      var jq = w.jQuery;
      if (jq && jq.expando && jq.cache) {   // jQuery 1.x: node[jQuery.expando] is an id into jQuery.cache
        var id = node[jq.expando], c = id && jq.cache[id];
        if (c && c.events) return c.events;
      }
      var ks = Object.getOwnPropertyNames(node);   // jQuery 2.x / 3.x: its data hangs on the node as jQuery<digits>
      for (var i = 0; i < ks.length; i++) if (/^jQuery\d+/.test(ks[i])) { var v = node[ks[i]]; if (v && typeof v === 'object' && v.events) return v.events; }
    } catch (e) {}
    return null;
  }
  function trHandlers(W, el) {
    var out = [];
    function info(fn, how) {
      var nm = ''; try { nm = String(fn.name || ''); } catch (e) {}
      var calls = []; try { var s = Function.prototype.toString.call(fn); if (!/\[native code\]/.test(s)) calls = trCallNames(s.slice(s.indexOf('{') + 1)); } catch (e) {}
      out.push(how + ' ' + (nm && /^[A-Za-z_$][\w$]{0,59}$/.test(nm) && !/\d{3,}/.test(nm) ? nm : '(anonymous)') + (calls.length ? ' → ' + calls.join(', ') : ''));
    }
    for (var x = el, depth = 0; x && depth < 25 && out.length < 8; x = x.parentNode, depth++) {
      var where = depth && x.nodeType === 1 ? ' on ' + trDesc(x) : depth ? ' on the document' : '';
      try {
        if (x.nodeType === 1 && depth < 4) {
          var a = x.getAttribute('onclick');
          if (a) out.push('onclick' + where + ' → ' + (trCallNames(a).join(', ') || '(code)'));
          else if (typeof x.onclick === 'function') info(x.onclick, 'onclick' + where);
        }
      } catch (e) {}
      try {
        var evs = trJqEvents(W.w, x);
        if (evs) ['click', 'mousedown', 'mouseup'].forEach(function (type) {
          list(evs[type]).forEach(function (h) {
            if (!h || typeof h.handler !== 'function' || out.length >= 8) return;
            if (depth === 0 && !h.selector) info(h.handler, 'jQuery ' + type);
            else if (h.selector) { var hit = null; try { hit = el.closest(h.selector); } catch (e) {} if (hit && (x.nodeType !== 1 || x.contains(hit))) info(h.handler, 'jQuery ' + type + ' (delegated' + where + ')'); }
          });
        });
      } catch (e) {}
    }
    return out;
  }
  function trHookClicks(T, W) {
    var w = W.w;
    var onClick = function coresTrClick(e) {
      if (!T.on) return;
      try {
        var el = e.target; if (!el || el.nodeType !== 1 || trMine(el)) return;
        var act = trActionable(el), rec = { type: 'click', t: trNow(T), W: W, path: trPath(el), act: act && act !== el ? trDesc(act) : '', raw: null, long: 0, inList: trInPatientList(el), handlers: trHandlers(W, act || el) };
        if (act && !rec.inList) {   // the text is kept as it is until the result is written, where it is redacted or dropped
          var tx = String((act.tagName === 'INPUT' ? act.value : act.textContent) || '').replace(/\s+/g, ' ').trim();
          if (tx && tx.length <= 60) rec.raw = tx; else rec.long = tx.length;
        }
        trPush(T, rec);
      } catch (x) {}
    };
    try { w.addEventListener('click', onClick, true); T.undo.push(function () { w.removeEventListener('click', onClick, true); }); } catch (e) {}
  }

  // ---- every 40 ms: the records when they cannot be hooked, in-place changes that no wrapped call announced, and the
  // windows opened since arming (gone to another page, closed; their requests, read from their resource timings)
  function trPoll(T) {
    var t = trNow(T);
    T.wins.forEach(function (W) {
      var st = W.st; if (!st) return;
      try {
        if (st.mode === 'hook') { var d = Object.getOwnPropertyDescriptor(W.w, TR_ROWS); if (!d || d.set !== st.setter) { st.mode = 'poll'; T.notes.push('the page redefined ' + TR_ROWS + ' itself while the Trace was armed; it was polled from then on'); } }
        if (st.mode === 'poll') { var cur; try { cur = W.w[TR_ROWS]; } catch (e) { return; } if (cur !== st.val) { st.val = cur; trWrite(T, W, st, 'changed', cur, null, true); return; } }
        var sh = trShape(st.val);
        if (sh.kind === 'list' && sh.n !== st.len) trWrite(T, W, st, 'resized', st.val, null, true);
        else if (sh.kind === 'list' && sh.fields !== st.fields) { trPush(T, { type: 'fields', t: t, W: W, from: st.fields, to: sh.fields, n: sh.n }); st.fields = sh.fields; }
      } catch (e) {}
    });
    T.polls++;
    T.popups.forEach(function (p) {
      try {
        if (p.closedAt) return;
        if (p.w.closed) { p.closedAt = t || 1; trPush(T, { type: 'closed', t: t, pop: p }); return; }
        var href = ''; try { href = String(p.w.location.href).split('#')[0]; } catch (e) { href = '(another site)'; }
        if (href !== p.href && href !== 'about:blank') {
          var u = href === '(another site)' ? { host: '', file: '(another site)', params: [], report: false, abs: '' } : trUrl(href, p.w);
          if (p.href) trPush(T, { type: 'moved', t: t, pop: p, u: u });
          p.href = href; if (u.report) p.report = true;
        }
        trSeeRealms(T);
        var es = p.w.performance.getEntriesByType('resource'), origin = p.w.performance.timeOrigin;
        for (var i = 0; i < es.length; i++) {
          var en = es[i]; if (en.initiatorType !== 'xmlhttprequest' && en.initiatorType !== 'fetch') continue;
          var key = origin + '|' + en.startTime + '|' + en.name; if (p.seen[key]) continue;
          p.seen[key] = 1;
          var r = { type: 'request', api: en.initiatorType === 'fetch' ? 'fetch' : 'XHR', pop: p, method: '', u: trUrl(en.name, p.w), t: Math.round(origin + en.startTime - T.epoch), ms: Math.round(en.duration), timed: true };
          r.tResp = r.tEnd = r.t + r.ms;
          if (en.responseStatus) r.status = en.responseStatus;
          if (en.decodedBodySize) { r.size = en.decodedBodySize; r.unit = 'bytes'; }
          trPush(T, r);
        }
      } catch (e) {}
    });
    if (T.polls % 12 === 0) trButton();
  }
  function trButton() {   // the HUD's Trace button and the note beside the counts
    try {
      if (!ov) return;
      var on = !!TR;
      ov.traceBtn.textContent = on ? 'Stop trace' : 'Trace';
      ov.traceBtn.style.background = on ? '#b00020' : '#fff'; ov.traceBtn.style.color = on ? '#fff' : '#1f4e79'; ov.traceBtn.style.borderColor = on ? '#b00020' : '#1f4e79';
      ovStat('trace', on ? '● trace ' + Math.floor(trNow(TR) / 1000) + ' s, ' + TR.ev.length + ' seen' : '');
    } catch (e) {}
  }

  // ---- arming and stopping
  function trArm(opt) {
    var T = { on: true, t0: performance.now(), epoch: 0, ev: [], wins: [], popups: [], undo: [], notes: [], dropped: 0, polls: 0, inCallback: null, lastWrite: null,
              hud: !!opt.hud, meta: new WeakMap(), timer: null, killer: null, after: null, auto: '' };
    T.epoch = (performance.timeOrigin || Date.now() - performance.now()) + T.t0;
    T.wins.push({ w: window, label: 'this page', st: null });
    [['the parent page', function () { return window.parent; }], ['the top page', function () { return window.top; }]].forEach(function (c) {
      try { var w = c[1](); if (w && !T.wins.some(function (W) { return W.w === w; }) && w.document) T.wins.push({ w: w, label: c[0], st: null }); } catch (e) {}
    });
    T.wins.forEach(function (W) {
      [trHookRecords, trHookXhr, trHookFetch, trHookOpen, trHookForms, trHookClicks].forEach(function (hook) {
        try { hook(T, W); } catch (e) { T.notes.push('one of the Trace\'s watchers could not be set on ' + W.label + ' (' + (e && e.name) + ')'); }
      });
    });
    T.timer = setInterval(function () { try { trPoll(T); } catch (e) {} }, 40);
    T.killer = setTimeout(function () { if (TR === T) { T.auto = 'by itself after 15 minutes'; trStop({ hud: T.hud }); } }, 15 * 60000);
    TR = T;
    window.__coresTraceStop = function () { if (TR === T) trStop({ quiet: true }); };
    return T;
  }
  function trStop(opt) {
    var T = TR; opt = opt || {};
    if (!T) return null;
    try { trPoll(T); } catch (e) {}   // a last look
    T.tEnd = trNow(T);
    T.on = false; TR = null;
    clearInterval(T.timer); clearTimeout(T.killer); clearTimeout(T.after);
    for (var i = T.undo.length - 1; i >= 0; i--) { try { T.undo[i](); } catch (e) { T.notes.push('one of the Trace\'s watchers could not be taken off (' + (e && e.name) + ')'); } }
    try { delete window.__coresTraceStop; } catch (e) {}
    trButton();
    return T;
  }
  // a capture has ended (its verdict is up): the Trace has what it came for, and stops a moment later
  function trAfterCapture() {
    var T = TR; if (!T || T.after) return;
    T.after = setTimeout(function () { if (TR === T) { T.auto = 'by itself, after the capture ended'; traceCores('stop', { hud: true }); } }, 2500);
  }

  // ---- the result: a timeline, as text. Everything shown is a name, a count or a time
  function trListNames() {   // names as CORES writes them in its list (LAST, FIRST), for redacting when the records are not there
    var out = [];
    try {
      var cells = document.querySelectorAll('table.rnd_tbl_pt_list td, table.rnd_tbl_pt_list a, table.rnd_tbl_pt_list span, table.rnd_tbl_pt_list div');
      for (var i = 0; i < cells.length && i < 6000; i++) {
        if (cells[i].children.length) continue;
        var t = (cells[i].textContent || '').trim();
        if (t.length <= 60 && /^[A-Za-z][A-Za-z' -]*,\s*[A-Za-z][A-Za-z' .-]*$/.test(t)) out.push(t);
      }
    } catch (e) {}
    return out;
  }
  function trSec(ms) { return ('       ' + (ms / 1000).toFixed(2)).slice(-7); }
  function trTag(e) { return e.pop ? '[' + (e.pop.report ? 'R' : 'W') + e.pop.n + ']' : e.W && e.W.label !== 'this page' ? '[L, ' + e.W.label + ']' : '[L]'; }
  function trPopName(p) { return p ? (p.report ? 'the report window' : 'a window opened from this page') + ' [' + (p.report ? 'R' : 'W') + p.n + ']' : 'a report window'; }
  function trAddr(u) { return (u.host ? u.host + ' ' : '') + u.file + (u.params.length ? ' ?' + u.params.join(', ') : ''); }
  function trReqText(r) {
    var s = r.api + (r.method ? ' ' + r.method : '') + ' ' + trAddr(r.u);
    if (r.body) s += '  body: ' + r.body.kind + (r.body.names ? ' ' + r.body.names.join(', ') : '') + (r.body.n !== undefined ? ' (' + r.body.n.toLocaleString() + ')' : '');
    return s;
  }
  function trReqEnd(r) {
    if (r.failed) return '→ failed' + (r.ms != null ? ', ' + r.ms + ' ms' : '');
    if (r.tEnd === undefined) return '→ no answer by the end of the Trace';
    return '→ ' + (r.status === undefined ? 'status not known' : r.status === 0 ? 'no status (blocked, stopped, or another site)' : r.status) +
      (r.size != null ? ', ' + r.size.toLocaleString() + ' ' + r.unit : '') + (r.ms != null ? ', ' + r.ms + ' ms' : '');
  }
  function trStackText(frames) {
    return frames.map(function (f) { return f.text + (f.tag === 'report' ? ' [report window]' : f.tag === 'list' ? ' [this page]' : ''); }).join(' ← ');
  }
  function trClickText(c, scrub) {
    var s = c.path + (c.act ? ' (in ' + c.act + ')' : '');
    if (c.raw !== null) {
      var r = scrub(c.raw);
      // dropped when it holds an identifier the page knows, or has the shape CORES writes a name in (LAST, FIRST)
      s += r.hit || /[A-Za-z][A-Za-z' -]*,\s*[A-Z]/.test(c.raw) ? ' "<hidden: it may name a patient>"' : ' "' + r.text + '"';
    } else if (c.inList) s += ' (in the patient list: text not read)';
    return s;
  }
  function trTimeline(T, scrub) {
    var evs = T.ev.slice().sort(function (a, b) { return a.t - b.t; }), L = [], no = 0;
    evs.forEach(function (e) { if (e.type === 'request') e.no = ++no; });
    var st0 = T.wins[0].st, start = st0 ? st0.start : { kind: 'nothing', n: 0 };
    L.push(trSec(0) + '  armed. Records then: ' + (start.kind === 'list' ? start.n + ' already there' : 'none') +
      (st0 && st0.mode === 'poll' ? ' (the page declares the variable itself, so it is watched by polling: no call stacks)' : ''));
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], at = trSec(e.t) + '  ';
      if (e.type === 'click') {
        L.push(at + 'click    ' + trTag(e) + ' ' + trClickText(e, scrub));
        if (e.handlers.length) L.push('             handlers: ' + e.handlers.join('; '));
      } else if (e.type === 'open') {
        L.push(at + 'open     ' + trTag(e) + ' window.open ' + trAddr(e.u) + (e.name ? '  name "' + e.name + '"' : '') + (e.features ? '  features "' + e.features + '"' : '') +
          (e.blocked ? '  → BLOCKED (no window)' : '  → ' + trPopName(e.opened)));
        if (e.frames.length) L.push('             called from: ' + trStackText(e.frames));
      } else if (e.type === 'form') {
        L.push(at + 'form     ' + trTag(e) + ' ' + e.how + ' ' + e.method + ' ' + trAddr(e.u) + (e.target ? '  target "' + e.target + '"' : '') + (e.names.length ? '  fields: ' + e.names.join(', ') : ''));
        if (e.frames.length) L.push('             called from: ' + trStackText(e.frames));
      } else if (e.type === 'request') {
        // a run of the same request (same window, method, address and parameter names) is one line
        var same = [e];
        while (i + 1 < evs.length && evs[i + 1].type === 'request' && trTag(evs[i + 1]) === trTag(e) && trReqText(evs[i + 1]) === trReqText(e)) same.push(evs[++i]);
        if (same.length === 1) {
          L.push(at + 'request  ' + trTag(e) + ' #' + e.no + ' ' + trReqText(e) + '  ' + trReqEnd(e));
          if (e.frames && e.frames.length) L.push('             sent from: ' + trStackText(e.frames));
        } else {
          var sizes = same.map(function (r) { return r.size; }).filter(function (x) { return x != null; }), lastR = same[same.length - 1];
          L.push(at + 'request  ' + trTag(e) + ' #' + e.no + '–#' + lastR.no + ' ' + trReqText(e) + '  ×' + same.length + ' until ' + trSec(lastR.t).trim() + ' s' +
            (sizes.length ? ', answers ' + Math.min.apply(null, sizes).toLocaleString() + '–' + Math.max.apply(null, sizes).toLocaleString() + ' ' + (e.unit || 'bytes') : ''));
          if (e.frames && e.frames.length) L.push('             first sent from: ' + trStackText(e.frames));
        }
      } else if (e.type === 'records') {
        var w = e.who, by = w.who === 'report' ? 'BY ' + trPopName(w.pop).toUpperCase() : w.who === 'list' ? 'BY THIS PAGE' : 'BY: NOT KNOWN';
        var how = e.how === 'assigned' ? 'assigned' : e.how === 'changed' ? 'changed (seen by polling)' : e.how === 'resized' ? 'changed in place (seen by polling)' : 'filled in place with ' + e.how + '()';
        L.push(at + 'RECORDS  ' + trTag(e) + ' ' + how + (e.times > 1 ? ' ×' + e.times + ' until ' + trSec(e.t2).trim() + ' s' : '') + ': ' +
          (e.kind === 'list' ? e.n + ' record' + (e.n === 1 ? '' : 's') + (e.fields ? ', ' + e.fields + ' fields each' : '') : e.kind === 'nothing' ? 'emptied (no value)' : 'a value that is not a list (' + e.kind + ')') + '. ' + by +
          (w.why.length ? ' (' + w.why.join('; ') + ')' : '') + '. Report windows open: ' + e.reportsOpen + '.' +
          (e.during ? ' While the answer to request #' + e.during.no + ' was being handled.' : ''));
        if (e.frames.length) L.push('             call stack: ' + trStackText(e.frames));
      } else if (e.type === 'fields') {
        L.push(at + 'records  ' + trTag(e) + ' now ' + e.to + ' fields each (were ' + e.from + '): filled further in place');
      } else if (e.type === 'moved') {
        L.push(at + 'window   ' + trTag(e) + ' went to ' + trAddr(e.u));
      } else if (e.type === 'closed') {
        L.push(at + 'window   ' + trTag(e) + ' closed');
      }
    }
    L.push(trSec(T.tEnd) + '  stopped' + (T.auto ? ' ' + T.auto : '') + '. Records now: ' + (function () { var s = trShape(st0 ? st0.val : undefined); return s.kind === 'list' ? s.n : 'none'; })());
    return { lines: L, evs: evs, start: start };
  }
  function trReport(T) {
    var rows = null; try { rows = patientRows(); } catch (e) {}
    var scrub = coresScrubber(rows, trListNames());
    var tl = trTimeline(T, scrub);
    var L = ['Trace: what loads CORES\'s patient records'];
    L.push('', 'TIMELINE (seconds since arming; [L] this page, [R1] a report window it opened; requests are numbered)');
    tl.lines.forEach(function (x) { L.push(x); });
    var notes = T.notes.slice();
    if (T.dropped) notes.push(T.dropped + ' more clicks / requests were seen but not kept (over ' + TR_MAX + ')');
    if (T.popups.length) notes.push('the report window\'s requests come from its resource timings: no method, and no body parameter names');
    notes.push('shown: names of functions, files, parameters and elements, CORES vocabulary, counts and timings; no parameter values except program / report ids');
    L.push('', 'NOTES', notes.map(function (x) { return '• ' + x; }).join('\n'));
    return { lines: L, text: L.join('\n'), verdict: { who: 'unknown', records: 0 }, timeline: tl };
  }
  function traceCores(cmd, opt) {
    if (cmd && typeof cmd === 'object') { opt = cmd; cmd = ''; }
    opt = opt || {}; cmd = String(cmd || '').toLowerCase();
    if (cmd === 'status') return TR ? 'armed, ' + TR.ev.length + ' seen' : 'not armed';
    if (!TR && cmd !== 'stop') {
      try { ovBuild(); ov.root.style.display = 'flex'; } catch (e) {}
      var T0 = trArm(opt), st = T0.wins[0].st;
      trButton();
      ovLog('Trace armed: it only watches. Now open the report in CORES as you normally do; when the report is there, press Stop trace' +
        (st && st.start.kind === 'list' && st.start.n ? '. NOTE: the patient records are already on this page (' + st.start.n + '), so what filled them will not show: press F5 in CORES, paste the script and arm the Trace before opening a report.' : '.'),
        st && st.start.kind === 'list' && st.start.n ? 'warn' : 'info');
      console.log('CORES capture: Trace armed. Open the report as usual, then run traceCores() again (or press Stop trace).');
      return 'tracing…';
    }
    if (!TR) { ovLog('Trace: not armed. Press Trace first, then open the report.', 'warn'); return 'not armed'; }
    var T = trStop(opt);
    if (opt.quiet) return 'stopped';
    var rep = trReport(T);
    window.coresTrace = { text: rep.text, verdict: rep.verdict };
    console.log(rep.text);
    ovLog('Trace stopped' + (T.auto ? ' ' + T.auto : '') + ': ' + T.ev.length + ' things seen in ' + (T.tEnd / 1000).toFixed(1) + ' s. The timeline is in the Console (window.coresTrace.text).');
    return { text: rep.text };
  }
  window.traceCores = traceCores;

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
      ovStart('direct mode, report ' + reportId, 'Opening the report\u2026');
      ovLog('window.open was blocked.', 'err');
      ovVerdict('err', 'the popup was blocked. Allow popups for this site and try again.');
      return;
    }
    ovStart('direct mode, report ' + reportId, 'Report ' + reportId + ' opened, waiting for it to render\u2026',
      'The script opened report ' + reportId + ' in a popup window. Leave it open: it is captured as soon as it has rendered, ' +
      'and closes by itself.\n\nIf CORES says it cannot load the patient list, the script presses OK and Reload for you, ' +
      'up to ' + (opts.retries === undefined ? 2 : opts.retries) + ' times.');
    watchReport(popup, opts, String(reportId));
    log('opened report ' + reportId + ' in a popup; waiting for it to render…');
    return 'capturing…';
  };
  // helpers, also usable on their own:  captureCores.chooseFolder()  shows the folder button;  captureCores.deliver(html, name, opts)
  window.captureCores.chooseFolder = function () {
    if (!window.showDirectoryPicker) { log('this browser has no folder picker', 'warn'); return; }
    showBanner('Choose the folder for CORES captures:', [['Choose folder…', function (el) {
      pickFolder().then(function (d) { el.textContent = 'Saving into "' + d.name + '"'; log('captures will be saved into "' + d.name + '"'); },
        function (e) { el.textContent = 'Failed: ' + e.message; });
    }]]);
  };
  window.captureCores.deliver = deliver;
})();
