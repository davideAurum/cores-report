"""Make an annotatable copy of a captured CORES report page.

Usage:  python annotate_source.py "CORES report 281 2026-09-15 1957.html"
Writes: "CORES report 281 2026-09-15 1957 - annotate.html"  (open it in a browser)

In the copy:
  - hovering any part of the report outlines it and shows what the PARSER currently calls it
    (column › section › label › lab slot), so you can see how the source maps to parsed fields;
  - clicking a part asks you for YOUR name for it; the pair is added to the panel at the top right;
  - "Copy list" copies all your annotations as text you can paste back to Claude.
Annotations are also kept in the browser's localStorage for this file, so they survive a reload.
"""
import re
import sys

SLOT_JS = """{
 'fishbone_cbc_value_middle_left':'WBC','fishbone_cbc_value_top_center':'Hgb','fishbone_cbc_value_bottom_center':'Hct','fishbone_cbc_value_middle_right':'Plt',
 'fishbone_chem7_value_top_left':'Na','fishbone_chem7_value_top_center':'Cl','fishbone_chem7_value_top_right':'BUN','fishbone_chem7_value_bottom_left':'K',
 'fishbone_chem7_value_bottom_center':'CO2','fishbone_chem7_value_bottom_right':'Cr','fishbone_chem7_value_middle_right':'Glucose',
 'fishbone_chem2_value_top':'Ca','fishbone_chem2_value_bottom':'Mg','fishbone_chem3_value_top':'Ca','fishbone_chem3_value_middle':'Mg','fishbone_chem3_value_bottom':'Phos',
 'fishbone_coag_value_top_left':'PT','fishbone_coag_value_top_right':'PTT','fishbone_coag_value_bottom_center':'INR',
 'fishbone_hepatic_value_top_left':'Total protein','fishbone_hepatic_value_top_right':'Albumin','fishbone_hepatic_value_middle_left':'Total bili',
 'fishbone_hepatic_value_middle_right':'Direct bili','fishbone_hepatic_value_bottom_left':'AST','fishbone_hepatic_value_bottom_right':'ALT','fishbone_hepatic_value_bottom_center':'Alk phos'}"""

OVERLAY = r"""
<style>
.ann-hl{outline:2px solid #e07a00!important;outline-offset:1px;background:rgba(224,122,0,.12)!important}
.ann-done{outline:2px dashed #2e7d32!important;outline-offset:1px}
#ann-tip{position:fixed;z-index:2147483647;background:#222;color:#fff;font:12px/1.35 Segoe UI,Arial,sans-serif;padding:4px 8px;border-radius:3px;pointer-events:none;display:none;max-width:520px;box-shadow:0 2px 6px rgba(0,0,0,.4)}
#ann-tip b{color:#ffd27a}
#ann-panel{position:fixed;top:8px;right:8px;z-index:2147483646;width:360px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #999;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.3);font:12px/1.4 Segoe UI,Arial,sans-serif;color:#111}
#ann-panel h3{margin:0;padding:8px 10px;background:#1f4e79;color:#fff;font-size:13px;border-radius:6px 6px 0 0;cursor:move}
#ann-panel .body{padding:8px 10px}
#ann-panel button{font:inherit;padding:3px 8px;margin:0 4px 6px 0;cursor:pointer}
#ann-panel ol{margin:6px 0 0;padding-left:18px}
#ann-panel li{margin:0 0 4px}
#ann-panel li span.p{color:#666}
#ann-panel li a{color:#b00020;text-decoration:none;margin-left:6px;cursor:pointer}
#ann-panel .hint{color:#555;margin-bottom:6px}
#ann-ask{position:fixed;z-index:2147483647;display:none;width:360px;background:#fffbe6;border:1px solid #e07a00;border-radius:6px;padding:8px 10px;font:12px/1.4 Segoe UI,Arial,sans-serif;color:#111;box-shadow:0 4px 14px rgba(0,0,0,.3)}
#ann-ask #ann-ask-info{margin-bottom:6px;color:#333} #ann-ask b{color:#1f4e79}
#ann-ask input{width:100%;box-sizing:border-box;font:13px Segoe UI,Arial,sans-serif;padding:4px 6px;margin-bottom:6px}
#ann-ask button{font:inherit;padding:3px 10px;margin-right:6px;cursor:pointer}
</style>
<div id="ann-tip"></div>
<div id="ann-ask"><div id="ann-ask-info"></div><input id="ann-ask-in" placeholder="Your name for this part, then Enter"><div><button id="ann-ask-save">Save</button><button id="ann-ask-cancel">Cancel</button></div></div>
<div id="ann-panel"><h3>Annotate: hover to see parser name, click to name it</h3><div class="body">
<div class="hint">Names are saved in this browser. "Copy list" copies them as text for Claude.</div>
<button id="ann-copy">Copy list</button><button id="ann-clear">Clear all</button><span id="ann-count"></span>
<textarea id="ann-out" style="display:none;width:100%;height:120px;font:11px monospace;margin-top:6px"></textarea>
<ol id="ann-list"></ol></div></div>
<script>
(function(){
  var SLOT = __SLOT__;
  var KEY = 'cores-annotations:' + location.pathname.split('/').pop();
  var tip = document.getElementById('ann-tip'), list = document.getElementById('ann-list'), count = document.getElementById('ann-count');
  function store(v){ try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }   // storage is unavailable in some viewers
  var ann = []; try { ann = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
  var hl = null;

  function textOf(el){ return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function labelBefore(el){
    // walk backwards through previous siblings (stopping at <br>) looking for "Label:" text or a <b>Label:</b>
    for (var n = el.previousSibling; n; n = n.previousSibling) {
      if (n.nodeType === 1 && n.tagName === 'BR') break;
      var t = n.nodeType === 3 ? n.nodeValue : (n.nodeType === 1 ? n.textContent : '');
      t = (t || '').replace(/\s+/g, ' ').trim();
      var m = t.match(/([A-Za-z][A-Za-z0-9 ()\/&.-]{0,30}):\s*$/);
      if (m) return m[1];
      if (t) break;
    }
    return '';
  }
  function parserName(el){
    var parts = [];
    var td = el.closest('td[column_name]');
    parts.push(td ? 'Column "' + td.getAttribute('column_name') + '"' : (el.closest('table.page_header_template') ? 'Page header' : (el.closest('td[colspan="9"]') ? 'Meds row' : 'outside patient row')));
    var sec = el.closest('[section_name], .section[title], span[title]');
    if (sec) parts.push('Section "' + (sec.getAttribute('section_name') || sec.getAttribute('title')) + '"');
    var u = null;
    if (el.closest('td[colspan="9"]')) {           // meds row: nearest preceding <u><b>Label:</b></u>
      var us = el.closest('td').querySelectorAll('u');
      for (var i = 0; i < us.length; i++) if (us[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) u = us[i];
      if (u) parts.push('Meds section "' + textOf(u).replace(/:$/, '') + '"');
    }
    var fb = el.closest('[class*="fishbone_"][class*="_value_"]');
    if (fb) { var cls = fb.className.split(' ').filter(function(c){ return SLOT[c]; })[0]; if (cls) parts.push('Lab slot ' + SLOT[cls] + (el.tagName === 'I' ? ' (prior)' : el.tagName === 'B' ? ' (current)' : '')); }
    var io = el.closest('.report_io_table'); if (io) { var row = el.closest('tr'); parts.push('I&O table' + (row ? ' row "' + textOf(row.querySelector('td')) + '"' : '')); }
    var lab = labelBefore(el) || (el.parentElement && el.parentElement !== td ? labelBefore(el.parentElement) : '');
    if (lab) parts.push('Label "' + lab + '"');
    var fld = el.closest('.t4m_report_field, [field]'); if (fld) parts.push(fld.getAttribute('field') ? 'field=' + fld.getAttribute('field') : 'value field');
    return parts.join(' › ');
  }
  function pathOf(el){
    var p = [], n = el;
    while (n && n !== document.body) { var s = n.tagName.toLowerCase(); if (n.className && typeof n.className === 'string') s += '.' + n.className.trim().split(/\s+/).join('.'); if (n.getAttribute('column_name')) s += '[column_name="' + n.getAttribute('column_name') + '"]'; p.unshift(s); n = n.parentElement; if (p.length > 6) break; }
    return p.join(' > ');
  }
  function render(){
    list.innerHTML = ann.map(function(a, i){ return '<li><b>' + a.name + '</b><br><span class="p">' + a.parser + '</span><br><span class="p">e.g. "' + a.sample + '"</span><a data-i="' + i + '">remove</a></li>'; }).join('');
    count.textContent = ann.length + ' named';
    store(ann);
  }
  document.addEventListener('mousemove', function(e){
    var t = e.target; if (!t || t.closest('#ann-panel')) { tip.style.display = 'none'; return; }
    if (hl && hl !== t) hl.classList.remove('ann-hl'); hl = t; t.classList.add('ann-hl');
    tip.innerHTML = '<b>' + parserName(t) + '</b><br>' + pathOf(t) + '<br>' + textOf(t).slice(0, 90);
    tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 540) + 'px'; tip.style.top = (e.clientY + 18) + 'px';
  });
  // in-page name box (browser prompt() dialogs are blocked in some viewers)
  var ask = document.getElementById('ann-ask'), askIn = document.getElementById('ann-ask-in'), askInfo = document.getElementById('ann-ask-info'), pending = null;
  function closeAsk(){ ask.style.display = 'none'; pending = null; }
  function saveAsk(){
    var name = askIn.value.trim(); if (!name || !pending) { closeAsk(); return; }
    ann.push({ name: name, parser: parserName(pending), path: pathOf(pending), sample: textOf(pending).slice(0, 80) });
    pending.classList.add('ann-done'); render(); closeAsk();
  }
  document.getElementById('ann-ask-save').onclick = saveAsk;
  document.getElementById('ann-ask-cancel').onclick = closeAsk;
  askIn.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); saveAsk(); } if (e.key === 'Escape') closeAsk(); });
  document.addEventListener('click', function(e){
    var t = e.target; if (!t || t.closest('#ann-panel') || t.closest('#ann-ask')) return;
    e.preventDefault(); e.stopPropagation();
    pending = t; tip.style.display = 'none';
    askInfo.innerHTML = '<b>' + parserName(t) + '</b><br>' + textOf(t).slice(0, 100);
    ask.style.display = 'block';
    ask.style.left = Math.min(e.clientX + 10, window.innerWidth - 380) + 'px'; ask.style.top = Math.min(e.clientY + 10, window.innerHeight - 140) + 'px';
    askIn.value = ''; askIn.focus();
  }, true);
  list.addEventListener('click', function(e){ var a = e.target.closest('a[data-i]'); if (!a) return; ann.splice(+a.dataset.i, 1); render(); });
  document.getElementById('ann-clear').onclick = function(){ ann = []; render(); };
  document.getElementById('ann-copy').onclick = function(){
    var txt = ann.map(function(a, i){ return (i + 1) + '. "' + a.name + '"  =  ' + a.parser + '\n   path: ' + a.path + '\n   e.g.: ' + a.sample; }).join('\n');
    var out = document.getElementById('ann-out'); out.value = txt; out.style.display = 'block'; out.select();
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function(){ count.textContent = ann.length + ' named — copied to clipboard'; }, function(){ count.textContent = ann.length + ' named — select the text below and copy'; });
  };
  // draggable panel
  var panel = document.getElementById('ann-panel'), drag = null;
  panel.querySelector('h3').addEventListener('mousedown', function(e){ drag = [e.clientX - panel.offsetLeft, e.clientY - panel.offsetTop]; e.preventDefault(); });
  document.addEventListener('mouseup', function(){ drag = null; });
  document.addEventListener('mousemove', function(e){ if (drag) { panel.style.left = (e.clientX - drag[0]) + 'px'; panel.style.top = (e.clientY - drag[1]) + 'px'; panel.style.right = 'auto'; } });
  render();
})();
</script>
"""


def main(path):
    html = open(path, encoding='utf-8', errors='replace').read()
    html = re.sub(r'<meta[^>]+charset=[^>]+>', '<meta charset="utf-8">', html, count=1, flags=re.I)
    html = re.sub(r'<body([^>]*)class="t4m_report', r'<body\1class="t4m_report ann-mode', html, count=1)  # no-op marker
    overlay = OVERLAY.replace('__SLOT__', SLOT_JS)
    out = re.sub(r'\.html?$', '', path, flags=re.I) + ' - annotate.html'
    if '</body>' in html:
        html = html.replace('</body>', overlay + '</body>', 1)
    else:
        html += overlay
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print(out)
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
