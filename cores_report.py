"""Render parsed CORES data (from cores_parse.py) as a filterable, sortable, printable HTML table.

Usage:
  python cores_report.py "CORES report 281 2026-09-16 0715.html" [out.html]   # parse + render in one step
  python cores_report.py data.json [out.html]                                   # render from saved JSON

Each patient is a two-row block: Location / Patient | Summary | Vitals · Vent · I&O · Lines | Labs | Meds | Tasks / Sit Awareness | Notes (blank, for
handwriting), then a full-width PRN row.
Click a column header to sort; use the toolbar to filter. Hidden patients are not printed. Designed for ~1000 px
(letter landscape) and up. The toolbar's Paper switch prints portrait instead; Optimize widths picks the column widths
that fit the shown patients on the fewest pages.
The "Inspect" toggle shows the glossary name of any element on hover (names per REPORT_GLOSSARY.md).
Opening the result with #print on the end of its URL brings up the print dialog at once (cores.py uses this).
"""
import datetime
import hashlib
import html
import json
import re
import sys

# Which version of this file made a Daily Report, and for which paper (written into its <head>). cores.py re-renders a
# report made by any other version, or for other paper than its "orientation" setting, before it opens, prints or PDFs
# it, so an old report gets what was added since (the Paper switch, say) and a changed setting applies to it too.
with open(__file__, 'rb') as _fh:
    RENDERER = hashlib.sha1(_fh.read().replace(b'\r\n', b'\n')).hexdigest()[:12]


def renderer_meta(orient):
    return f'<meta name="cores-renderer" content="{RENDERER} {orient}">'


# Lab panels in fishbone order; each renders as analyte header row, current row, prior row.
LAB_PANELS = [
    ('CBC', [('WBC', 'wbc'), ('Hgb', 'hgb'), ('Hct', 'hct'), ('Plt', 'plt')]),
    ('Chem', [('Na', 'na'), ('K', 'k'), ('Cl', 'cl'), ('CO2', 'co2'), ('BUN', 'bun'), ('Cr', 'creatinine'), ('Glu', 'glucose')]),
    ('', [('Ca', 'ca'), ('Mg', 'mg'), ('Phos', 'phos'), ('Lact', 'lactate')]),
    ('Coag', [('PT', 'pt'), ('PTT', 'ptt'), ('INR', 'inr')]),
    ('LFT', [('TP', 'total_protein'), ('Alb', 'albumin'), ('TBili', 'total_bili'), ('DBili', 'direct_bili'),
             ('AST', 'ast'), ('ALT', 'alt'), ('AlkP', 'alk_phos')]),
]
# Adult reference ranges for flagging labs (inclusive). Sex-specific entries are {'M': (lo, hi), 'F': (lo, hi)}.
# Standard textbook ranges in the units CORES prints; UAB's own lab ranges may differ slightly.
LAB_RANGES = {
    'wbc': (4.0, 11.0), 'hgb': {'M': (13.5, 17.5), 'F': (12.0, 16.0)}, 'hct': {'M': (41, 53), 'F': (36, 46)}, 'plt': (150, 400),
    'na': (135, 145), 'k': (3.5, 5.1), 'cl': (98, 107), 'co2': (22, 29), 'bun': (7, 20),
    'creatinine': {'M': (0.7, 1.3), 'F': (0.6, 1.1)}, 'glucose': (70, 110),
    'ca': (8.5, 10.5), 'mg': (1.7, 2.4), 'phos': (2.5, 4.5), 'lactate': (0.5, 2.0),
    'pt': (11.0, 13.5), 'ptt': (25, 35), 'inr': (0.8, 1.2),
    'total_protein': (6.0, 8.3), 'albumin': (3.5, 5.0), 'total_bili': (0.1, 1.2), 'direct_bili': (0.0, 0.3),
    'ast': (10, 40), 'alt': (7, 56), 'alk_phos': (40, 120),
}


def lab_flag(key, value, sex=''):
    """'up' / 'down' / '' for a lab value against LAB_RANGES (sex-specific where defined)."""
    rng = LAB_RANGES.get(key)
    if isinstance(rng, dict):
        rng = rng.get((sex or '').upper()[:1]) or rng.get('M')
    v = num(value)
    if rng is None or v is None:
        return ''
    return 'up' if v > rng[1] else 'down' if v < rng[0] else ''


# Normal ranges for red-flagging vitals (inclusive). Temp is Fahrenheit as CORES prints it.
VITAL_NORMAL = {'temp': (97.0, 100.3), 'hr': (60, 100), 'rr': (12, 20), 'spo2': (92, 100), 'sbp': (90, 140), 'dbp': (60, 90), 'map': (65, 105)}
# Vent block, split into what the clinician set and what the ventilator measured
VENT_SETTINGS = [('set_rate', 'Rate'), ('vt_set', 'VT'), ('fio2', 'FiO2'), ('peep', 'PEEP'), ('psv', 'PSV'), ('ie_ratio', 'I:E')]
VENT_MEASURED = [('vt_measured', 'VT'), ('vt_spont', 'VT spont'), ('minute_volume_spont', 'MV spont'),
                 ('mean_airway_pressure', 'Paw'), ('static_compliance', 'Cstat')]
MED_SECTIONS = [('infusions', 'Infusions'), ('antibiotics', 'Antibiotics'), ('scheduled', 'Scheduled'), ('prn', 'PRN')]
SEV_CLASS = {'watcher': 'sev-watch', 'unstable': 'sev-unstable', 'stable': 'sev-stable'}
SEV_RANK = {'unstable': 0, 'watcher': 1, 'stable': 2}
# Toggleable parts of the page, grouped for the Sections menu. Names are the data-name attributes in the markup;
# entries ending in ' column' hide a whole column (header, cells and width).
SECTIONS = [
    ('Location / Patient', ['Location block', 'Severity chip', 'Isolation tag', 'Patient name', 'MRN', 'Date of birth', 'Code status',
                            'Admission', 'Admit diagnosis', 'Admit date', 'Length of stay',
                            'Allergy / Diet block', 'Allergies', 'Diet', 'TF', 'Restraints']),
    ('Summary', ['Patient summary', 'Status lines']),
    ('Vitals', ['Vitals', 'Ventilation', 'O2 delivery', 'Vent settings', 'Vent measurements', 'Blood gas',
                'I&O', 'I&O chart', 'Net I&O since admission', 'Tubes / Lines / Drains']),
    ('Labs', ['Labs', 'CBC fishbone', 'Coags fishbone', 'BMP fishbone', 'Ca/Mg/Phos fishbone', 'LFT fishbone', 'Other labs',
              'Trends', 'Glucose trend', 'Lactic acid trend']),
    ('Meds', ['Infusions', 'Antibiotics', 'Scheduled', 'PRN row']),
    ('Tasks', ['Tasks', 'Situational Awareness']),
    ('Columns', ['Patient column', 'Summary column', 'Vitals column', 'Labs column', 'Meds column', 'Sit Awareness column',
                 'Notes column']),
]
# Parts of each container: when every part is hidden the container disappears too (applied bottom-up).
COLPARTS = {
    'Admission': ['Admit diagnosis', 'Admit date', 'Length of stay'],
    'Allergy / Diet block': ['Allergies', 'Diet', 'TF', 'Restraints'],
    'Ventilation': ['O2 delivery', 'Vent settings', 'Vent measurements', 'Blood gas'],
    'I&O': ['I&O chart', 'Net I&O since admission'],
    'Trends': ['Glucose trend', 'Lactic acid trend'],
    'Labs': ['CBC fishbone', 'Coags fishbone', 'BMP fishbone', 'Ca/Mg/Phos fishbone', 'LFT fishbone', 'Other labs', 'Trends'],
    'Patient column': ['Location block', 'Severity chip', 'Isolation tag', 'Patient name', 'MRN', 'Date of birth', 'Code status',
                       'Admission', 'Allergy / Diet block'],
    'Summary column': ['Patient summary', 'Status lines'],
    'Vitals column': ['Vitals', 'Ventilation', 'I&O', 'Tubes / Lines / Drains'],
    'Labs column': ['Labs'],
    'Meds column': ['Infusions', 'Antibiotics', 'Scheduled'],
    'Sit Awareness column': ['Tasks', 'Situational Awareness'],
}
CHILDREN = {c for k, v in COLPARTS.items() if not k.endswith(' column') for c in v}

CSS = """
:root{--ink:#1c1c1c;--mute:#6b6b6b;--line:#cfcfcf;--band:#f2f2f2;--accent:#1f4e79;--watch:#b8860b;--unstable:#b00020;--stable:#2e7d32}
*{box-sizing:border-box}
body{margin:0;padding:12px 16px;font:10.5px/1.3 "Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff}
h1{font-size:16px;margin:0}
.rpt-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid var(--accent);padding-bottom:6px;margin-bottom:8px}
.rpt-head .meta{color:var(--mute);text-align:right;font-size:9.5px}
.conf{font-weight:600;color:var(--unstable);letter-spacing:.3px}
.toolbar{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;background:var(--band);border:1px solid var(--line);border-radius:4px;padding:6px 8px;margin-bottom:8px;font-size:10.5px}
.toolbar label{display:flex;align-items:center;gap:4px;color:var(--mute)}
.toolbar input[type=search]{width:220px;padding:3px 6px;border:1px solid var(--line);border-radius:3px;font:inherit}
.toolbar select{padding:2px 4px;border:1px solid var(--line);border-radius:3px;font:inherit;background:#fff}
.toolbar button{padding:3px 8px;border:1px solid var(--line);border-radius:3px;background:#fff;font:inherit;cursor:pointer}
.toolbar .count{margin-left:auto;color:var(--mute)}
.secmenu{position:relative} .secmenu summary{list-style:none;padding:3px 8px;border:1px solid var(--line);border-radius:3px;background:#fff;cursor:pointer;user-select:none}
.secmenu summary::-webkit-details-marker{display:none}
.secmenu .menu{position:fixed;left:8px;right:8px;top:60px;z-index:20;background:#fff;border:1px solid var(--line);border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,.18);padding:8px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 14px;max-height:calc(100vh - 80px);overflow:auto;max-width:1100px;margin:0 auto}
.secmenu .grp{margin-bottom:6px} .secmenu .grp-t{font-weight:700;color:var(--accent);margin-bottom:2px;border-bottom:1px solid var(--line)}
.secmenu label{display:block;color:var(--ink);white-space:nowrap;padding:1px 0} .secmenu label.sub{padding-left:14px;color:var(--mute)} .secmenu label input{margin:0 4px 0 0;vertical-align:-1px}
.secmenu .menu-foot{grid-column:1/-1;border-top:1px solid var(--line);padding-top:6px} .secmenu .menu-foot button{padding:2px 8px;border:1px solid var(--line);border-radius:3px;background:#fff;font:inherit;cursor:pointer}
table.rpt{width:100%;border-collapse:collapse;table-layout:fixed}
.rpt > thead > tr > th,.rpt > tbody > tr > td{border:1px solid var(--line);padding:4px 6px;vertical-align:top;text-align:left;overflow:hidden}
.rpt thead th{background:var(--band);font-weight:600;position:sticky;top:0;z-index:1;user-select:none;white-space:nowrap}
.rpt thead th[data-key]{cursor:pointer} .rpt thead th[data-key]:hover{background:#e6e6e6}
.rpt thead th .dir{color:var(--mute);font-size:9px;margin-left:3px}
.rpt thead th .rz{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:2}
.rpt thead th .rz:hover,.rpt thead th .rz.on{background:var(--accent);opacity:.5}
body.resizing{cursor:col-resize;user-select:none}
.rpt > tbody.blk:nth-of-type(even) > tr > td{background:#fafafa}
.rpt > tbody.blk > tr.main > td{border-bottom:0}
.rpt > tbody.blk > tr.medrow > td{border-top:1px dashed var(--line);padding:3px 6px 5px}
.rpt > tbody.blk{border-bottom:2px solid var(--accent)}
.rpt > tbody.hide{display:none}
.pthead{margin-bottom:2px;overflow:hidden} .pthead .name{margin:0;font-size:11px;line-height:1.2;display:block}
.bedchip{float:right;margin:0 0 2px 4px;min-width:36px;padding:3px 2px;border:1.5px solid var(--accent);border-radius:4px;text-align:center;line-height:1.15;color:var(--accent);font-weight:700}
.bedchip .u{display:block;font-size:9px;letter-spacing:.2px} .bedchip .rb{display:block;font-size:10px}
.pttags{margin:3px 0 0} .pttags .sev{margin-right:4px} .pttags .iso{display:inline-block;margin-top:2px}
.adm{margin-top:5px} .adm div{margin:0 0 1px}
.sev{display:inline-block;padding:1px 7px;border-radius:9px;font-weight:700;font-size:9.5px;color:#fff;background:var(--mute);margin:2px 0}
.sev-watch{background:var(--watch)} .sev-unstable{background:var(--unstable)} .sev-stable{background:var(--stable)}
.pt .name{font-size:12px;font-weight:700;display:block;margin-bottom:2px}
.kv{color:var(--mute)} .kv b{color:var(--ink);font-weight:600}
.pt .kv{display:block}
h4{font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);margin:5px 0 2px;border-bottom:1px solid var(--line);padding-bottom:1px}
h4:first-child{margin-top:0}
h4 .hdr-r{float:right;text-transform:none;letter-spacing:0;font-weight:400;color:var(--mute)} h4 .hdr-r b{color:var(--ink);font-weight:700}
p{margin:0 0 4px} ul{margin:0;padding-left:14px} li{margin:0 0 2px}
[data-name="Situational Awareness"] ul,[data-name="Tasks"] ul{padding-left:11px;line-height:1.2} [data-name="Situational Awareness"] li,[data-name="Tasks"] li{margin:0} [data-name="Situational Awareness"] h4{margin-top:4px}
.tasks li{list-style:none;margin-left:-14px} .tasks li::before{content:"\\2610  ";}
.status td{padding:0 6px 1px 0;vertical-align:top;border:0} .status td:first-child{color:var(--mute);white-space:nowrap}
.care{border-top:1px solid var(--line);margin-top:5px;padding-top:3px} .care > div{margin:0 0 3px}
.care .allergies{color:#e00000;font-weight:600}
.abn{color:#d00000}
.iso{display:block;margin-top:3px;font-size:9px;font-weight:600;color:var(--unstable);border:1px solid var(--unstable);border-radius:3px;padding:0 4px;width:max-content}
.lines{padding-left:12px;font-size:9.5px;color:var(--ink)} .lines li{margin:0} .lines .days{color:var(--mute);font-size:9px}
.vit{width:100%;font-size:10px;border-collapse:collapse} .vit td,.vit th{padding:1px 3px;text-align:center;border:0;border-bottom:1px solid var(--line)}
.vit th{font-weight:600;background:var(--band)}
.lab{width:100%;font-size:10px;border-collapse:collapse;table-layout:fixed;margin-bottom:4px}
.lab th{font-weight:600;color:var(--mute);font-size:9px;text-align:center;padding:0 1px;border:0;border-bottom:1px solid var(--line)}
.lab th.pnl{text-align:left;color:var(--accent);font-size:9.5px;width:30px;vertical-align:top;border-bottom:0}
.lab td{text-align:center;padding:1px;border:0;white-space:nowrap}
.lab td.cur{font-weight:700} .lab td.pri{color:var(--mute);font-style:italic;font-size:9px;line-height:1.1}
.fishrow{display:flex;gap:4px;align-items:center;margin:1px 0} .fish{display:block;flex:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.lft{font-size:10px;line-height:1.2;padding-left:2px} .labarr{color:#d00000;font-size:6.5px;vertical-align:2px;margin-left:1px}
.trend{margin:2px 0 3px;font-size:10px} .trend b{color:var(--mute);font-weight:600}
.gas{margin:2px 0 3px} .gas b{font-weight:600}
.iowrap{display:flex;gap:3px;align-items:flex-start;margin:2px 0 3px}
.iochart{display:block;flex:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ioside{display:flex;flex-direction:column;gap:5px;padding-top:2px;min-width:0;line-height:1.15;font-size:9px} .ioside .ionet{margin-top:auto;font-weight:700;line-height:1}
.iokey{display:flex;flex-direction:column;gap:2px;color:var(--mute)} .iokey span{white-space:nowrap} .iokey i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;vertical-align:-1px}
.io{border-collapse:collapse} .io td{padding:0 6px 0 0;text-align:right;border:0} .io td:first-child{text-align:left;color:var(--mute)} .io th{font-weight:600;text-align:right;padding:0 6px 0 0;color:var(--mute);border:0}
.medbar{display:flex;gap:0 14px;align-items:flex-start}
.medbar .medsec{min-width:130px} .medbar .medsec h4{margin-top:0}
.medsec .meds{column-width:auto} .medbar .medsec .meds{column-width:150px}
.prnline{line-height:1.35} .prnline .drug{font-weight:600} .prnline .det{color:var(--mute)} .prnline .hi .drug{color:var(--accent)} .prnline .ld{color:var(--watch);font-size:9px} .prnline .dot{color:var(--mute);font-size:8px;margin:0 3px;vertical-align:1px} .prnline .lbl{color:var(--accent);text-transform:uppercase;font-size:9.5px;letter-spacing:.3px} .prnline .lbl + .sep{color:var(--accent)}
.prnline > span[data-name]{white-space:nowrap} .prnline .sep{color:var(--mute);margin:0 3px} .prnline .lbl{white-space:nowrap}
.meds{margin:0;padding:0;list-style:none;column-width:150px;column-gap:12px}
.meds li{break-inside:avoid;margin:0;padding-left:8px;text-indent:-8px;line-height:1.2}
.meds .dot{color:var(--mute);font-size:8px;margin:0 3px;vertical-align:1px}
.medsec h4{white-space:nowrap;letter-spacing:.3px} .medsec + .medsec{margin-top:8px}
.meds .drug{font-weight:600} .meds .det{color:var(--mute)} .meds .hi .drug{color:var(--accent)} .meds .day{color:var(--mute);font-size:9px} .meds .ld{color:var(--watch);font-size:9px}
.empty{color:var(--mute);font-style:italic}
body.inspect [data-name]{cursor:crosshair}
body.inspect .insp-hl{outline:2px solid #e07a00;outline-offset:1px;background:rgba(224,122,0,.09)!important}
#insp-tip{position:fixed;z-index:99;background:#222;color:#fff;font-size:11px;padding:3px 8px;border-radius:3px;pointer-events:none;display:none;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)}
#insp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99;background:#1f4e79;color:#fff;font-size:12px;padding:6px 12px;border-radius:4px;display:none;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.foot{color:var(--mute);font-size:9px;margin-top:8px;text-align:center}
.toolbar .optmsg{color:var(--mute)}
/* off-screen copy used by Optimize widths: the print rules below, applied on screen so it can be measured */
.pm{position:absolute;left:-30000px;top:0;font-size:9px;line-height:1.22;background:#fff}
.pm .rpt thead th{position:static} .pm .rpt > thead > tr > th,.pm .rpt > tbody > tr > td{padding:3px 5px} .pm .pmw{display:flow-root}
@media screen{body{background:#e9e9e9}.page{background:#fff;padding:14px 18px;box-shadow:0 0 6px rgba(0,0,0,.15);max-width:1800px;margin:0 auto}}
@media print{
  body{padding:0;font-size:9px;line-height:1.22}
  .page{padding:0}
  .toolbar,#insp-tip,#insp-toast,.rz{display:none!important}
  .rpt thead{display:table-header-group} .rpt thead th{position:static}
  .rpt > thead > tr > th,.rpt > tbody > tr > td{padding:3px 5px}
  /* a patient never straddles a page break; a block that will not fit moves to the next page whole */
  .rpt > tbody.blk{page-break-inside:avoid;break-inside:avoid}
  .rpt > tbody.blk:nth-of-type(even) > tr > td{background:#fff}
}
"""

JS = """
(function(){
  const table=document.getElementById('rpt'), rows=[...table.querySelectorAll('tbody.blk')];
  const q=document.getElementById('q'), unit=document.getElementById('f-unit'), sev=document.getElementById('f-sev'),
        o2=document.getElementById('f-o2'), tasks=document.getElementById('f-tasks'), cnt=document.getElementById('count');
  function apply(){
    const t=q.value.trim().toLowerCase(); let n=0;
    rows.forEach(r=>{
      const d=r.dataset; let ok=true;
      if(t && !d.text.includes(t)) ok=false;
      if(unit.value && d.unit!==unit.value) ok=false;
      if(sev.value && d.sev!==sev.value) ok=false;
      if(o2.value && d.o2!==o2.value) ok=false;
      if(tasks.checked && +d.tasks===0) ok=false;
      r.classList.toggle('hide',!ok); if(ok) n++;
    });
    cnt.textContent='Showing '+n+' of '+rows.length+' patients';
  }
  [q,unit,sev,o2,tasks].forEach(el=>el.addEventListener('input',apply));
  document.getElementById('reset').addEventListener('click',()=>{q.value='';unit.value='';sev.value='';o2.value='';tasks.checked=false;apply();});
  document.getElementById('print').addEventListener('click',()=>window.print());
  // sorting
  let cur={key:'location',dir:1};
  function sortBy(key,dir){
    const numeric=['los','age','sevrank','tasks','drips'].includes(key);
    const sorted=[...rows].sort((a,b)=>{
      let x=a.dataset[key]||'', y=b.dataset[key]||'';
      if(numeric){x=+x||0;y=+y||0;return (x-y)*dir;}
      return x.localeCompare(y,undefined,{numeric:true})*dir;
    });
    sorted.forEach(r=>table.appendChild(r));
    document.querySelectorAll('th[data-key]').forEach(th=>{const s=th.querySelector('.dir'); s.textContent=(th.dataset.key===key)?(dir>0?'\\u25B2':'\\u25BC'):'';});
  }
  document.querySelectorAll('th[data-key]').forEach(th=>th.addEventListener('click',()=>{
    if(document.getElementById('inspect').checked)return;
    const key=th.dataset.key; cur.dir=(cur.key===key)?-cur.dir:1; cur.key=key; sortBy(key,cur.dir);
    document.getElementById('sort').value=key;
  }));
  document.getElementById('sort').addEventListener('change',e=>{cur={key:e.target.value,dir:1};sortBy(cur.key,1);});
  // inspect mode: hover shows the element's glossary name, click copies it
  const insp=document.getElementById('inspect'), tip=document.getElementById('insp-tip'), toast=document.getElementById('insp-toast');
  let hl=null;
  const chain=el=>{const n=[];for(let p=el;p;p=p.parentElement){if(p.dataset&&p.dataset.name)n.unshift(p.dataset.name);}return n.join(' \\u203A ');};
  insp.addEventListener('change',()=>{document.body.classList.toggle('inspect',insp.checked);if(!insp.checked){tip.style.display='none';if(hl){hl.classList.remove('insp-hl');hl=null;}}});
  document.addEventListener('mousemove',e=>{
    if(!insp.checked)return; const t=e.target.closest('[data-name]');
    if(hl&&hl!==t)hl.classList.remove('insp-hl'); hl=t;
    if(!t){tip.style.display='none';return;}
    t.classList.add('insp-hl'); tip.textContent=chain(t); tip.style.display='block';
    tip.style.left=Math.min(e.clientX+12,window.innerWidth-tip.offsetWidth-8)+'px'; tip.style.top=(e.clientY+16)+'px';
  });
  document.addEventListener('click',e=>{
    if(!insp.checked)return; const t=e.target.closest('[data-name]'); if(!t)return;
    e.preventDefault(); e.stopPropagation(); const n=chain(t);
    if(navigator.clipboard)navigator.clipboard.writeText(n).catch(()=>{});
    toast.textContent='Copied: '+n; toast.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>toast.style.display='none',2000);
  },true);
  sortBy('location',1); apply();
  // column widths (drag a header boundary) and section visibility; both persist in localStorage
  // widths are kept per paper orientation; the orientation <select> starts at the default cores_report.py baked in
  const cols=[...table.querySelectorAll('colgroup col')], ths=[...table.querySelectorAll('thead th')];
  const defaults=cols.map(c=>c.style.width), KEYS='cores-report-hidden-v1', KEYO='cores-report-orient-v1';
  const keyW=o=>o==='portrait'?'cores-report-cols-portrait-v1':'cores-report-cols-v1';
  const COLNAME=ths.map(th=>th.dataset.name.replace(' header',' column'));
  const orientSel=document.getElementById('orient'), pageSz=document.getElementById('pagesz'), optMsg=document.getElementById('opt-msg');
  let orient=orientSel.value, hidden=new Set();
  try{const s=localStorage.getItem(KEYO); if(s==='portrait'||s==='landscape')orient=s;}catch(e){}
  function loadW(o){try{const s=JSON.parse(localStorage.getItem(keyW(o))||'null'); if(s&&s.length===cols.length)return s;}catch(e){} return defaults.slice();}
  let base=loadW(orient);
  try{const s=JSON.parse(localStorage.getItem(KEYS)||'null'); if(Array.isArray(s))hidden=new Set(s);}catch(e){}
  const secStyle=document.createElement('style'); document.head.appendChild(secStyle);
  const COLPARTS=__COLPARTS__;
  function effHidden(){
    // a container whose parts are all hidden is hidden too (Allergy / Diet block -> Labs -> columns)
    const eff=new Set(hidden);
    for(let changed=true;changed;){changed=false; for(const k in COLPARTS){const parts=COLPARTS[k]; if(!eff.has(k)&&parts.length&&parts.every(p=>eff.has(p))){eff.add(k);changed=true;}}}
    return eff;
  }
  function render(){
    const rules=[], eff=effHidden();
    cols.forEach((c,i)=>{const off=eff.has(COLNAME[i]); c.style.width=off?'0':base[i];
      // keep the cell in the row (display:none would shift the other cells' column slots); collapse it instead
      if(off)rules.push('.rpt thead th:nth-child('+(i+1)+'),.rpt tr.main>td:nth-child('+(i+1)+'){width:0!important;padding:0!important;border-left:0!important;border-right:0!important;font-size:0!important;overflow:hidden}'
        +'.rpt thead th:nth-child('+(i+1)+')>*,.rpt tr.main>td:nth-child('+(i+1)+')>*{display:none!important}');});
    eff.forEach(n=>{if(!COLNAME.includes(n))rules.push('[data-name="'+n.replace(/"/g,'')+'"]{display:none!important}');});
    secStyle.textContent=rules.join(' ');
    document.querySelectorAll('[data-sec]').forEach(cb=>{cb.checked=!hidden.has(cb.dataset.sec);});
    pageSz.textContent='@page{size:letter '+orient+';margin:.3in}'; orientSel.value=orient;
  }
  function saveW(){try{localStorage.setItem(keyW(orient),JSON.stringify(base));}catch(e){}}
  function saveS(){try{localStorage.setItem(KEYS,JSON.stringify([...hidden]));}catch(e){}}
  ths.forEach((th,i)=>{
    if(i===ths.length-1)return;
    const h=document.createElement('div'); h.className='rz'; th.appendChild(h);
    h.addEventListener('click',e=>e.stopPropagation());
    h.addEventListener('mousedown',e=>{
      e.preventDefault(); e.stopPropagation();
      let j=i+1; while(j<ths.length-1&&hidden.has(COLNAME[j]))j++;
      const x0=e.clientX, w0=ths[i].getBoundingClientRect().width, w1=ths[j].getBoundingClientRect().width, tw=table.getBoundingClientRect().width;
      h.classList.add('on'); document.body.classList.add('resizing');
      function move(ev){const d=Math.max(-(w0-90),Math.min(w1-90,ev.clientX-x0)); base[i]=((w0+d)/tw*100).toFixed(2)+'%'; base[j]=((w1-d)/tw*100).toFixed(2)+'%'; render();}
      function up(){document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);h.classList.remove('on');document.body.classList.remove('resizing');saveW();optMsg.textContent='';}
      document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
    });
  });
  document.getElementById('cols').addEventListener('click',()=>{base=defaults.slice();optMsg.textContent='';render();try{localStorage.removeItem(keyW(orient));}catch(e){}});
  orientSel.addEventListener('change',()=>{orient=orientSel.value;base=loadW(orient);optMsg.textContent='';render();try{localStorage.setItem(KEYO,orient);}catch(e){}});
  // Optimize widths. An off-screen copy of the table, laid out as it prints (page width, print font and padding), is
  // measured with every column at every width from 40 px up in 5 px steps: that gives each patient's cell height as a
  // function of its column's width, and the narrowest width at which nothing is clipped. A patient block is as tall
  // as its tallest cell, blocks never split across pages and the column headers repeat on every page, so the page
  // count of any split of the width follows from those tables. A local search (moving width between pairs of
  // columns, from the current widths and from 40 random splits) then looks for the split with the fewest pages and,
  // among those, the least total height. The Notes column keeps its width (it is for handwriting); hidden columns and
  // filtered-out patients are left out. The result is laid out once more to check it, and kept only if it is better.
  const PAGE={landscape:[998.4,758.4],portrait:[758.4,998.4]};  // letter less the .3in margins, in CSS px (96 per inch)
  const STEP=5, KMIN=8, optBtn=document.getElementById('optimize');
  const tick=()=>new Promise(r=>setTimeout(r,0));
  async function optimize(){
    const [W,PH]=PAGE[orient], eff=effHidden(), n=cols.length, notes=COLNAME.indexOf('Notes column');
    const vis=COLNAME.map(c=>!eff.has(c)), idx=[...Array(n).keys()].filter(i=>vis[i]&&i!==notes);
    const fixedCols=[...Array(n).keys()].filter(i=>vis[i]&&!idx.includes(i));
    if(!idx.length){optMsg.textContent='No columns to optimize';return;}
    const pct=base.map((b,i)=>vis[i]?parseFloat(b)||0:0), pctSum=pct.reduce((a,b)=>a+b,0)||1, curPx=pct.map(x=>x/pctSum*W);
    const box=document.createElement('div'); box.className='pm'; box.style.width=W+'px';
    const hd=document.querySelector('.rpt-head').cloneNode(true), t=table.cloneNode(true);
    t.removeAttribute('id'); t.querySelectorAll('.rz,tbody.hide').forEach(x=>x.remove());
    box.appendChild(hd); box.appendChild(t); document.body.appendChild(box);
    try{
      const tcols=[...t.querySelectorAll('colgroup col')], blk=[...t.querySelectorAll('tbody.blk')], P=blk.length;
      if(!P){optMsg.textContent='No patients shown';return;}
      const wrap=blk.map(b=>[...b.querySelector('tr.main').children].map(td=>{const d=document.createElement('div');d.className='pmw';while(td.firstChild)d.appendChild(td.firstChild);td.appendChild(d);return d;}));
      const setW=px=>{tcols.forEach((c,i)=>c.style.width=px[i]+'px'); t.style.width=px.reduce((a,b)=>a+b,0)+'px';};
      const KMAX=Math.floor(W*0.8/STEP);
      const H=idx.map(()=>blk.map(()=>new Float32Array(KMAX+1))), fitK=idx.map(()=>new Int16Array(P).fill(-1));
      for(let k=KMIN;k<=KMAX;k++){
        setW(cols.map((c,i)=>idx.includes(i)?k*STEP:curPx[i]));
        idx.forEach((i,a)=>{for(let p=0;p<P;p++){const d=wrap[p][i]; H[a][p][k]=d.offsetHeight; if(fitK[a][p]<0&&d.scrollWidth<=d.clientWidth+1)fitK[a][p]=k;}});
        if(k%8===0){optMsg.textContent='Measuring… '+Math.round(100*(k-KMIN)/(KMAX-KMIN))+'%'; await tick();}
      }
      // each column gets 1 px beyond its measured width, so that rounding when printing never tips a line into wrapping
      const avail=W-fixedCols.reduce((s,i)=>s+curPx[i],0), U=Math.floor((avail-idx.length)/STEP);
      if(idx.length*KMIN>U){optMsg.textContent='The Notes column leaves no room; narrow it first';return;}
      // how much is cut off at the right edge at these widths, summed over cells (a cell that clips even at the widest
      // is not counted: it always does); squeezing one column hard costs more than trimming several a little
      const clipped=g=>{let c=0;for(let a=0;a<idx.length;a++)for(let p=0;p<P;p++)if(fitK[a][p]>g[a])c+=fitK[a][p]-g[a];return c;};
      const realClips=()=>{let c=0;idx.forEach((i,a)=>{for(let p=0;p<P;p++){const d=wrap[p][i];if(fitK[a][p]>=0&&d.scrollWidth>d.clientWidth+1)c++;}});return c;};
      // what the model leaves out (PRN row, borders, padding, the Notes column) is calibrated on the current layout
      setW(curPx);
      const headH=hd.getBoundingClientRect().height+8, theadH=t.tHead.getBoundingClientRect().height;
      const nowH=blk.map(b=>b.getBoundingClientRect().height), clipsBefore=realClips();
      const fixedH=wrap.map(w=>Math.max(0,...fixedCols.map(i=>w[i].offsetHeight)));
      const extra=blk.map((b,p)=>nowH[p]-Math.max(fixedH[p],...idx.map(i=>wrap[p][i].offsetHeight)));
      // pages as the browser fills them; 6 px kept spare so that a block that only just fits is not relied on
      const PAGEH=PH-6, pages=hs=>{let pg=1,y=headH+theadH,start=y;for(const h of hs){if(y+h>PAGEH&&y>start){pg++;y=start=theadH;}y+=h;while(y>PAGEH){pg++;y=theadH+(y-PAGEH);}}return pg;};
      const heights=g=>blk.map((b,p)=>{let m=fixedH[p];for(let a=0;a<idx.length;a++){const v=H[a][p][Math.min(g[a],KMAX)];if(v>m)m=v;}return m+extra[p];});
      // least cut off first, then fewest pages, then least total height
      const cost=g=>{const hs=heights(g);return clipped(g)*1e9+pages(hs)*1e7+hs.reduce((a,b)=>a+b,0);};
      const fix=g=>{  // bring a split to exactly U steps, none narrower than KMIN
        let d=U-g.reduce((a,b)=>a+b,0);
        for(let a=0;d!==0;a=(a+1)%g.length){if(d>0){g[a]++;d--;}else if(g[a]>KMIN){g[a]--;d++;}}
        return g;
      };
      const search=g=>{
        let c=cost(g);
        for(let better=true;better;){
          better=false; let bestC=c,best=null;
          for(let a=0;a<g.length;a++)for(let b=0;b<g.length;b++)if(a!==b)for(const k of [1,2,4,8,16,32]){
            if(g[a]-k<KMIN)break;
            g[a]-=k;g[b]+=k; const v=cost(g); if(v<bestC-1e-6){bestC=v;best=[a,b,k];} g[a]+=k;g[b]-=k;
          }
          if(best){g[best[0]]-=best[2];g[best[1]]+=best[2];c=bestC;better=true;}
        }
        return [c,g];
      };
      optMsg.textContent='Searching…'; await tick();
      let [bestC,bestG]=search(fix(idx.map(i=>Math.max(KMIN,Math.floor(curPx[i]/STEP))))), seed=12345;
      const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647, free=U-idx.length*KMIN;
      for(let s=0;s<40;s++){
        const w=idx.map(()=>-Math.log(rnd()+1e-9)), ws=w.reduce((a,b)=>a+b,0);
        const [c,g]=search(fix(w.map(x=>KMIN+Math.floor(free*x/ws))));
        if(c<bestC){bestC=c;bestG=g;}
      }
      const px=curPx.slice(); idx.forEach((i,a)=>px[i]=bestG[a]*STEP+1);
      const big=idx.reduce((m,i)=>px[i]>px[m]?i:m,idx[0]); px[big]+=avail-idx.reduce((s,i)=>s+px[i],0);
      // check against a real layout of the new widths
      const before=pages(nowH), totBefore=nowH.reduce((a,b)=>a+b,0);
      setW(px); const newH=blk.map(b=>b.getBoundingClientRect().height), after=pages(newH), totAfter=newH.reduce((a,b)=>a+b,0), clipsAfter=realClips();
      const cutBefore=clipped(idx.map(i=>curPx[i]/STEP)), cutAfter=clipped(bestG);
      const pl=x=>'~'+x+' page'+(x>1?'s':''), cl=x=>x?'; '+x+' cell'+(x>1?'s':'')+' still cut off at the right edge (hide a section to make room)':'';
      if(!(cutAfter<cutBefore-0.5||(cutAfter<cutBefore+0.5&&(after<before||(after===before&&totAfter<totBefore*0.995))))){optMsg.textContent='Already as tight as it gets: '+pl(before)+' '+orient+cl(clipsBefore);return;}
      cols.forEach((c,i)=>{if(vis[i])base[i]=(px[i]/W*100).toFixed(3)+'%';});
      render(); saveW();
      optMsg.textContent='Optimized for '+orient+': '+pl(before)+' \\u2192 '+pl(after)+', '+Math.abs(Math.round(100*(1-totAfter/totBefore)))+(totAfter<=totBefore?'% shorter':'% taller')
        +(clipsBefore>clipsAfter?', '+(clipsBefore-clipsAfter)+' fewer cells cut off':'')+cl(clipsAfter);
    }finally{box.remove();}
  }
  optBtn.addEventListener('click',async()=>{optBtn.disabled=true;try{await optimize();}catch(err){optMsg.textContent='Optimize failed: '+err.message;}finally{optBtn.disabled=false;}});
  document.querySelectorAll('[data-sec]').forEach(cb=>cb.addEventListener('change',()=>{if(cb.checked)hidden.delete(cb.dataset.sec);else hidden.add(cb.dataset.sec);render();saveS();}));
  document.getElementById('sec-all').addEventListener('click',()=>{hidden.clear();render();saveS();});
  document.addEventListener('click',e=>{const m=document.getElementById('secmenu'); if(m.open&&!m.contains(e.target))m.open=false;});
  document.getElementById('secmenu').addEventListener('toggle',e=>{const m=e.target; if(m.open){const b=m.querySelector('summary').getBoundingClientRect(); m.querySelector('.menu').style.top=Math.round(b.bottom+4)+'px';}});
  render();
  // `cores print`: a URL ending in #print opens the print dialog as soon as the page is ready; #print-close also
  // closes the window after printing (Edge/Chrome --kiosk-printing then sends it straight to the default printer)
  const h=(location.hash||'').replace(/^#/,''), qp=new URLSearchParams(location.search).get('print');  // not `q`: that is the search box above
  const auto=(h==='print'||h==='print-close')?h:(qp==='1'?'print':'');
  window.__coresAutoPrint=auto;
  if(auto){
    try{history.replaceState(null,'',location.pathname);}catch(e){}  // so a reload or a restored tab does not print again
    if(auto==='print-close')window.addEventListener('afterprint',()=>setTimeout(()=>window.close(),300));
    const go=()=>setTimeout(()=>window.print(),400);
    if(document.readyState==='complete')go(); else window.addEventListener('load',go);
  }
})();
"""


def e(s):
    return html.escape(str(s if s is not None else ''))


def sev_chip(sev):
    if not sev:
        return ''
    return f'<span class="sev {SEV_CLASS.get(sev.lower(), "")}" data-name="Severity chip">{e(sev)}</span>'


def flag(kind, value):
    """Wrap a vital value; red if outside VITAL_NORMAL[kind]."""
    if value in ('', None):
        return ''
    try:
        lo, hi = VITAL_NORMAL[kind]
        abn = not (lo <= float(value) <= hi)
    except (ValueError, KeyError):
        abn = False
    return f'<span class="{"abn" if abn else ""}">{e(value)}</span>'


def render_vitals(r):
    v = r['vitals']
    last = lambda k: v.get(k, {}).get('last', '')
    # BP: prefer the arterial line when present, else cuff
    art = last('art_bp')
    if art and art != '/':
        sbp, _, dbp = art.partition('/')
        mapv, src = last('map_invasive') or last('map_noninvasive'), 'arterial line'
    else:
        sbp, dbp = last('sbp'), last('dbp')
        mapv, src = last('map_noninvasive') or last('map_invasive'), 'cuff'
    bp = ''
    if sbp or dbp or mapv:
        bp = f'{flag("sbp", sbp)}/{flag("dbp", dbp)}' if (sbp or dbp) else ''
        bp += f' ({flag("map", mapv)})' if mapv else ''
    cells = [('T', 'Temperature', flag('temp', last('temp'))), ('HR', 'Heart rate', flag('hr', last('hr'))),
             ('RR', 'Respiratory rate', flag('rr', last('rr'))), ('SpO2', 'SpO2', flag('spo2', last('spo2'))),
             ('BP', 'Blood pressure', bp), ('GCS', 'GCS', e(last('gcs')) if last('gcs') else '')]
    cells = [c for c in cells if c[2]]           # only the vitals CORES actually reported
    if not cells:
        return ''
    head = ''.join(f'<th{" title=" + chr(34) + src + chr(34) if k == "BP" else ""}>{k}</th>' for k, _, _ in cells)
    vals = ''.join(f'<td data-name="{n}"><b>{c}</b></td>' for _, n, c in cells)
    return f'<div data-name="Vitals"><table class="vit"><tr>{head}</tr><tr>{vals}</tr></table></div>'


def render_ventilation(r):
    out = ''
    if r.get('o2_delivery'):
        out += f'<div class="gas" data-name="O2 delivery"><b>O2</b> {e(r["o2_delivery"])}</div>'
    if r.get('vent'):
        v = r['vent']
        known = {'mode'} | {k for k, _ in VENT_SETTINGS} | {k for k, _ in VENT_MEASURED}
        settings = ([e(v['mode'])] if v.get('mode') else []) + [f'{lbl} {e(v[k])}' for k, lbl in VENT_SETTINGS if v.get(k)]
        measured = [f'{lbl} {e(v[k])}' for k, lbl in VENT_MEASURED if v.get(k)] + [f'{e(k)} {e(val)}' for k, val in v.items() if k not in known]
        if settings:
            out += f'<div class="gas" data-name="Vent settings"><b>Set</b> {" · ".join(settings)}</div>'
        if measured:
            out += f'<div class="gas" data-name="Vent measurements"><b>Measured</b> {" · ".join(measured)}</div>'
    for g in r.get('gases') or []:
        vals = ' '.join(f'<b>{e(k)}</b> {e(v)}' for k, v in g['values'].items())
        out += f'<div class="gas" data-name="Blood gas"><b>{e(g["type"])}</b> <span class="kv">({e(g["time"])})</span> {vals}</div>'
    return (f'<div data-name="Ventilation"><h4>Ventilation</h4>{out}</div>') if out else ''


def num(s):
    try:
        return float(str(s).replace(',', ''))
    except (TypeError, ValueError):
        return None


def vbar(x, y0, y1, w, fill, round_end=True, extra=''):
    """Vertical bar of width w centred on x, from baseline y0 to tip y1; square at the baseline, 4px-rounded at
    the data end unless round_end is False (used where a second segment continues the bar)."""
    if y0 == y1:
        return ''
    h = abs(y1 - y0)
    rad = min(4, w / 2, h) if round_end else 0
    xl, xr = x - w / 2, x + w / 2
    if y1 < y0:  # up
        path = f'M{xl},{y0} V{y1 + rad} a{rad},{rad} 0 0 1 {rad},-{rad} H{xr - rad} a{rad},{rad} 0 0 1 {rad},{rad} V{y0} Z'
    else:        # down
        path = f'M{xl},{y0} V{y1 - rad} a{rad},{rad} 0 0 0 {rad},{rad} H{xr - rad} a{rad},{rad} 0 0 0 {rad},-{rad} V{y0} Z'
    return f'<path d="{path}" fill="{fill}"{extra}/>'


def io_day_labels(cols, report_date):
    """Replace CORES's 'Tdy' / 'Yst' with the report date and the day before, in the same M/D form CORES uses
    for the third column (e.g. 9/15, 9/14). Other labels pass through unchanged."""
    m = re.match(r'(\d{2})/(\d{2})/(\d{2})', report_date or '')
    if not m:
        return cols
    today = datetime.date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2)))
    fmt = lambda d: f'{d.month}/{d.day}'
    sub = {'tdy': fmt(today), 'today': fmt(today), 'yst': fmt(today - datetime.timedelta(days=1)), 'yesterday': fmt(today - datetime.timedelta(days=1))}
    return [sub.get(c.strip().lower(), c) for c in cols]


def io_chart(io, report_date='', min_height=0):
    """Mirror columns per day, drawn at fixed pixel size so its text matches the report (10px): intake (blue)
    rises from a baseline, output (red) hangs below it with urine solid at the baseline and other output
    continuing as a wash, connected. Intake / output values sit at the bar tips, the day's net underneath."""
    cols = io_day_labels(io['columns'], report_date)
    rows = io['rows']
    get = lambda k, i: num(rows[k][i]) if k in rows and i < len(rows[k]) else None
    days = []
    for i, c in enumerate(cols):
        i_, o_, u_, n_ = get('Intake', i), get('Output', i), get('Urine', i), get('Net', i)
        if i_ is None and o_ is None:
            continue
        days.append((c, i_ or 0, o_ or 0, u_, n_))
    if not days:
        return ''
    peak = max(max(i_, o_) for _, i_, o_, _, _ in days) or 1
    FS, BW, SLOT, MAXH, G = 10, 10, 30, 24, 20      # G = left gutter for the 'Net:' label
    natural = 22 + MAXH + 1 + MAXH + 10 + 12 + 3
    if min_height > natural:                     # stretch the bar zones so the legend column beside it fits
        MAXH += (min_height - natural) / 2
    y_day, base = 9, 22 + MAXH + 1              # day-label baseline; zero line (value labels sit between)
    y_net = base + MAXH + 10 + 12
    W, H = G + SLOT * len(days), round(y_net + 3)
    px = lambda v: MAXH * v / peak
    txt = lambda x, y, s, **kw: '<text x="%s" y="%s" text-anchor="middle" font-size="%s" font-weight="%s" fill="%s">%s</text>' % (
        x, y, FS, kw.get('weight', 400), kw.get('fill', '#6b6b6b'), e(s))
    svg = [f'<svg class="iochart" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Intake and output by day">']
    for k, (c, i_, o_, u_, n_) in enumerate(days):
        x = G + SLOT * (k + 0.5)
        tip = f'{c}: in {i_:g} · out {o_:g}' + (f' (urine {u_:g})' if u_ is not None else '') + (f' · net {n_:+g}' if n_ is not None else '')
        svg.append(f'<g data-name="{e(c)} I&amp;O"><title>{e(tip)}</title>')
        svg.append(txt(x, y_day, c))
        if i_ > 0:
            top = base - px(i_)
            svg.append(vbar(x, base, top, BW, '#2a78d6'))
            svg.append(txt(x, top - 2, f'{i_:g}', fill='#1c1c1c'))
        if o_ > 0:
            bot = base + px(o_)
            if u_ is None or u_ >= o_:
                svg.append(vbar(x, base, bot, BW, '#e34948'))
            elif u_ <= 0:
                svg.append(vbar(x, base, bot, BW, '#e34948', extra=' fill-opacity=".3"'))
            else:
                yu = base + px(u_)
                svg.append(vbar(x, base, yu, BW, '#e34948', round_end=False))
                svg.append(vbar(x, yu, bot, BW, '#e34948', extra=' fill-opacity=".3"'))
            svg.append(txt(x, bot + FS, f'{o_:g}', fill='#1c1c1c'))
        if n_ is not None:
            svg.append(txt(x, y_net, f'{n_:+g}', weight=700, fill='#1c1c1c').replace('font-size="10"', 'font-size="9.5"'))
        svg.append('</g>')
    svg.append(f'<line x1="{G}" y1="{base}" x2="{W}" y2="{base}" stroke="#bdbdbd" stroke-width="1"/>')
    svg.append(f'<text x="{G - 3}" y="{y_net}" text-anchor="end" font-size="9.5" font-weight="700" fill="#1c1c1c" data-name="Net row label">Net:</text>')
    svg.append('</svg>')
    return ''.join(svg)


def render_io(r, report_date=''):
    io = r.get('io')
    cum = r.get('net_io_since_admission')
    if not io and not cum:
        return ''
    cum_html = f'<span class="hdr-r" data-name="Net I&amp;O since admission">Cumulative net <b>{e(cum)}</b></span>' if cum else ''
    out = f'<div data-name="I&amp;O"><h4>I &amp; O{cum_html}</h4>'
    chart = io_chart(io, report_date) if io else ''
    if chart:
        out += (f'<div class="iowrap"><div data-name="I&amp;O chart">{chart}</div><div class="ioside"><div class="iokey"><span><i style="background:#2a78d6"></i>Intake</span>'
                '<span><i style="background:#e34948"></i>Urine</span><span><i style="background:#e34948;opacity:.3"></i>Other out</span></div></div></div>')
    return out + '</div>'


def render_tld(r):
    tld = r.get('tld') or []
    if not tld:
        return ''
    lis = ''.join(f'<li data-name="TLD item">{("<span class=days>d" + e(x["days"]) + "</span> ") if x.get("days") is not None else ""}{e(x["description"])}</li>' for x in tld)
    return f'<div data-name="Tubes / Lines / Drains"><h4>Tubes / Lines / Drains</h4><ul class="lines">{lis}</ul></div>'


def render_trends(r):
    names = {'glucose_trend': 'Glucose trend', 'lactate_trend': 'Lactic acid trend'}
    trends = [(k, r.get(k)) for k in names if r.get(k)]
    if not trends:
        return ''
    out = ''.join(f'<div class="trend" data-name="{names[k]}"><b>{names[k].split()[0]}</b> {e(" → ".join(v))}</div>' for k, v in trends)
    return f'<div data-name="Trends">{out}</div>'


LINE = '#9a9a9a'


def _t(x, y, s, anchor='middle', weight=700, fill='#1c1c1c'):
    """SVG text; s is already-escaped text or markup (values come through disp())."""
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="10" font-weight="{weight}" fill="{fill}">{s}</text>'


ARROW = {'up': '&#9650;', 'down': '&#9660;'}


def lab_disp(labs, sex):
    """Returns disp(key) -> escaped current value plus a small red arrow when outside the reference range."""
    def disp(k):
        v = (labs.get(k) or {}).get('current', '') or ''
        f = lab_flag(k, v, sex)
        return e(v) + (f'<tspan class="lab-{f}" font-size="6.5" fill="#d00000" dy="-1">{ARROW[f]}</tspan>' if f else '')
    return disp


def fish_x(cur, disp, top, left, right, bottom, name, labels):
    """An X: left value < top/bottom values > right value (CBC: WBC > Hgb/Hct < Plt; LFT: ALT > Bili/AlkP < AST)."""
    W, H, cx, cy, ax, ay = 108, 36, 54, 18, 24, 15
    g = [f'<line x1="{cx - ax}" y1="{cy - ay}" x2="{cx + ax}" y2="{cy + ay}" stroke="{LINE}"/>',
         f'<line x1="{cx - ax}" y1="{cy + ay}" x2="{cx + ax}" y2="{cy - ay}" stroke="{LINE}"/>',
         _t(cx - ax - 3, cy + 4, disp(left), 'end'), _t(cx + ax + 3, cy + 4, disp(right), 'start'),
         _t(cx, cy - 5, disp(top)), _t(cx, cy + 13, disp(bottom))]
    tip = f"{name} — " + ' · '.join(f'{l} {cur(k)}' for l, k in zip(labels, (top, left, right, bottom)))
    return f'<svg class="fish" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="{e(name)} fishbone"><title>{e(tip)}</title>{"".join(g)}</svg>'


def fish_cbc(cur, disp):
    """Horizontal spine with forked ends: WBC left, Platelets right, Hgb above the spine, Hct below."""
    W, H, cy, a, b, arm = 110, 30, 15, 40, 72, 10
    g = [f'<line x1="{a}" y1="{cy}" x2="{b}" y2="{cy}" stroke="{LINE}"/>']
    for x, d in ((a, -1), (b, 1)):
        g += [f'<line x1="{x}" y1="{cy}" x2="{x + d * arm}" y2="{cy - 12}" stroke="{LINE}"/>',
              f'<line x1="{x}" y1="{cy}" x2="{x + d * arm}" y2="{cy + 12}" stroke="{LINE}"/>']
    g += [_t(a - arm - 2, cy + 4, disp('wbc'), 'end'), _t(b + arm + 2, cy + 4, disp('plt'), 'start'),
          _t((a + b) / 2, cy - 3, disp('hgb')), _t((a + b) / 2, cy + 11, disp('hct'))]
    tip = f"CBC — WBC {cur('wbc')} · Hgb {cur('hgb')} · Hct {cur('hct')} · Plt {cur('plt')}"
    return f'<svg class="fish" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="CBC fishbone"><title>{e(tip)}</title>{"".join(g)}</svg>'


def fish_lft(cur, disp):
    return fish_x(cur, disp, 'total_bili', 'alt', 'ast', 'alk_phos', 'LFT', ('TBili', 'ALT', 'AST', 'AlkP'))


def fish_bmp(cur, disp):
    """Na | Cl | BUN over K | CO2 | Cr, with Glu after a chevron."""
    cw, rh, W, H = 23, 13, 0, 30
    x0, ymid = 1, 15
    g = []
    for i, (top, bot) in enumerate((('na', 'k'), ('cl', 'co2'), ('bun', 'creatinine'))):
        x = x0 + i * cw
        g += [_t(x + cw / 2, ymid - 3, disp(top)), _t(x + cw / 2, ymid + 11, disp(bot))]
        if i:
            g.append(f'<line x1="{x}" y1="{ymid - rh}" x2="{x}" y2="{ymid + rh}" stroke="{LINE}"/>')
    xe = x0 + 3 * cw
    g.append(f'<line x1="{x0}" y1="{ymid}" x2="{xe}" y2="{ymid}" stroke="{LINE}"/>')
    g += [f'<line x1="{xe}" y1="{ymid}" x2="{xe + 9}" y2="{ymid - rh}" stroke="{LINE}"/>',
          f'<line x1="{xe}" y1="{ymid}" x2="{xe + 9}" y2="{ymid + rh}" stroke="{LINE}"/>',
          _t(xe + 10, ymid + 4, disp('glucose'), 'start')]
    W = xe + 10 + 21
    tip = (f"BMP — Na {cur('na')} · K {cur('k')} · Cl {cur('cl')} · CO2 {cur('co2')} · BUN {cur('bun')} · "
           f"Cr {cur('creatinine')} · Glu {cur('glucose')}")
    return f'<svg class="fish" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="BMP fishbone"><title>{e(tip)}</title>{"".join(g)}</svg>'


def fish_coag(cur, disp):
    """Inverted Y: PT left of the stem, PTT right, INR below between the arms."""
    W, H, jx, jy = 60, 36, 30, 15
    g = [f'<line x1="{jx}" y1="2" x2="{jx}" y2="{jy}" stroke="{LINE}"/>',
         f'<line x1="{jx}" y1="{jy}" x2="{jx - 16}" y2="{H - 2}" stroke="{LINE}"/>',
         f'<line x1="{jx}" y1="{jy}" x2="{jx + 16}" y2="{H - 2}" stroke="{LINE}"/>',
         _t(jx - 3, jy - 2, disp('pt'), 'end'), _t(jx + 3, jy - 2, disp('ptt'), 'start'), _t(jx, H - 4, disp('inr'))]
    tip = f"Coags — PT {cur('pt')} · PTT {cur('ptt')} · INR {cur('inr')}"
    return f'<svg class="fish" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="Coags fishbone"><title>{e(tip)}</title>{"".join(g)}</svg>'


def fish_renal(cur, disp):
    """Bracket with three ticks: Ca, Mg, Phos top to bottom."""
    W, H, bx = 50, 42, 6
    ys = (8, 21, 34)
    g = [f'<line x1="{bx}" y1="{ys[0]}" x2="{bx}" y2="{ys[-1]}" stroke="{LINE}"/>']
    for y, k in zip(ys, ('ca', 'mg', 'phos')):
        g += [f'<line x1="{bx}" y1="{y}" x2="{bx + 6}" y2="{y}" stroke="{LINE}"/>', _t(bx + 9, y + 4, disp(k), 'start')]
    tip = f"Renal — Ca {cur('ca')} · Mg {cur('mg')} · Phos {cur('phos')}"
    return f'<svg class="fish" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="Ca/Mg/Phos fishbone"><title>{e(tip)}</title>{"".join(g)}</svg>'


def lab_arrow(f):
    return f'<span class="labarr lab-{f}">{ARROW[f]}</span>' if f else ''


def render_labs(r):
    """Today's labs as fishbones: CBC + coags, BMP + Ca/Mg/Phos, LFT X + the remaining values (TP, Alb, DBili) as a small labelled list; glucose / lactate trends beneath."""
    labs = r.get('labs') or {}
    if not labs:
        return ''
    cur = lambda k: (labs.get(k) or {}).get('current', '') or ''
    disp = lab_disp(labs, r.get('sex', ''))
    has = lambda *ks: any(cur(k) for k in ks)
    rows = [
        (fish_cbc(cur, disp) if has('wbc', 'hgb', 'hct', 'plt') else '') + (fish_coag(cur, disp) if has('pt', 'ptt', 'inr') else ''),
        (fish_bmp(cur, disp) if has('na', 'k', 'cl', 'co2', 'bun', 'creatinine', 'glucose') else '') + (fish_renal(cur, disp) if has('ca', 'mg', 'phos') else ''),
    ]
    extra = [(l, k) for l, k in (('TP', 'total_protein'), ('Alb', 'albumin'), ('DBili', 'direct_bili')) if cur(k)]
    extra_html = ('<div class="lft" data-name="Other labs">' + ''.join(f'<div><span class="kv">{e(l)}</span> <b>{e(cur(k))}</b>{lab_arrow(lab_flag(k, cur(k), r.get("sex", "")))}</div>' for l, k in extra) + '</div>') if extra else ''
    rows.append((fish_lft(cur, disp) if has('total_bili', 'alt', 'ast', 'alk_phos') else '') + extra_html)
    out = '<div data-name="Labs">'
    for row in rows:
        if row:
            out += f'<div class="fishrow">{row}</div>'
    return out + render_trends(r) + '</div>'


FREQ_RE = re.compile(r'\b((?:\d+ times )?Daily\b.*|Nightly\b.*|BID\b.*|TID\b.*|QID(?:ACHS)?\b.*|Every \d+ (?:hr|min|days?)\b.*|Once\b.*|'
                     r'Mon/Wed/Fri\b.*|Weekly\b.*|Monthly\b.*|PRN\b.*|Q\d+H?\b.*)$')


def split_dose(s):
    """'1.5 gm = 1 vial(s) IV Piggyback Every 12 hr' -> ('1.5 gm = 1 vial(s) IV Piggyback', 'Every 12 hr').
    The route stays with the dose; frequency is everything from the first frequency word on."""
    m = FREQ_RE.search(s)
    if not m or m.start() == 0:
        return s.strip(), ''
    return s[:m.start()].strip(), m.group(1).strip()


def dose_html(d):
    dose, freq = split_dose(d)
    return e(dose) + (f'<span class="dot">·</span>{e(freq)}' if freq else '')


def merge_doses(items):
    """Collapse entries with the same drug name into one line: 'magnesium sulfate 2 gm, 4 gm'.
    Returns [{drug, doses: [(dose_frequency, last_dose)], days_on, highlighted}] in first-seen order.
    Identical dose strings collapse to one (keeping a last-dose tag if either had one). Doses are sorted by their
    leading number when every dose starts with one (25 mcg, 50 mcg, 100 mcg), else left in source order.
    days_on is kept only if every merged entry agrees; highlighted if any entry is."""
    out, by_drug = [], {}
    for it in items:
        key = it['drug'].strip().lower()
        m = by_drug.get(key)
        if m is None:
            m = by_drug[key] = {'drug': it['drug'], 'doses': [], 'days_on': it.get('days_on'), 'highlighted': False}
            out.append(m)
        elif m['days_on'] != it.get('days_on'):
            m['days_on'] = None
        dose, ld = it['dose_frequency'].strip(), it.get('last_dose') or ''
        dup = next((i for i, (d, _) in enumerate(m['doses']) if d == dose), None)
        if dup is None:
            m['doses'].append((dose, ld))
        elif ld and not m['doses'][dup][1]:
            m['doses'][dup] = (dose, ld)
        m['highlighted'] = m['highlighted'] or bool(it.get('highlighted'))
    for m in out:
        nums = [re.match(r'\s*([\d,]*\.?\d+)', d) for d, _ in m['doses']]
        if len(m['doses']) > 1 and all(nums):
            m['doses'].sort(key=lambda dl: float(re.match(r'\s*([\d,]*\.?\d+)', dl[0]).group(1).replace(',', '')))
    return out


def render_prn_line(r):
    """PRN meds as one flowing line: 'PRN (n) | med | med | med', each med kept unbroken."""
    items = (r.get('meds') or {}).get('prn') or []
    if not items:
        return ''
    items = merge_doses(items)
    meds = []
    for it in items:
        doses = ', '.join(dose_html(d) + (f' <span class="ld">@ {e(ld)}</span>' if ld else '') for d, ld in it['doses'])
        meds.append(f'<span class="{"hi" if it.get("highlighted") else ""}" data-name="Med entry"><span class="drug">{e(it["drug"])}</span>'
                    f'<span class="dot">·</span><span class="det">{doses}</span></span>')
    sep = ' <span class="sep">|</span> '
    return f'<div class="prnline" data-name="PRN"><b class="lbl">PRN&nbsp;({len(items)})</b>{sep}{sep.join(meds)}</div>'


def render_meds(r, keys, bar=False):
    """Med sections for the given keys. bar=True: side by side in a full-width row, width proportional to item
    count, each list flowing into as many 150 px columns as fit. bar=False: stacked in a column."""
    meds = r.get('meds') or {}
    secs = ''
    for key, title in [(k, t) for k, t in MED_SECTIONS if k in keys] + [(k, k.title()) for k in meds if k not in dict(MED_SECTIONS) and 'other' in keys]:
        items = meds.get(key)
        if not items:
            continue
        lis, items = '', merge_doses(items)
        for it in items:
            day = f'<span class="day">d{it["days_on"]}</span> ' if it.get('days_on') is not None else ''
            doses = ', '.join(dose_html(d) + (f' <span class="ld">@ {e(ld)}</span>' if ld else '') for d, ld in it['doses'])
            lis += (f'<li class="{"hi" if it.get("highlighted") else ""}" data-name="Med entry">{day}<span class="drug">{e(it["drug"])}</span>'
                    f'<span class="dot">·</span><span class="det">{doses}</span></li>')
        secs += f'<div class="medsec" style="flex:{len(items) + 2} 1 0" data-name="{e(title)}"><h4>{e(title)} <span class="kv" style="font-weight:400">({len(items)})</span></h4><ul class="meds">{lis}</ul></div>'
    if not secs:
        return '' if bar else '<p class="empty">None listed</p>'
    return f'<div class="medbar">{secs}</div>' if bar else secs


def admit_date(report_date, los):
    """Report date 'MM/DD/YY HH:MM' minus LOS days -> 'MM/DD/YY', or '' if either is missing."""
    m = re.match(r'(\d{2})/(\d{2})/(\d{2})', report_date or '')
    if not m or los is None:
        return ''
    d = datetime.date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))) - datetime.timedelta(days=los)
    return d.strftime('%m/%d/%y')


def row_text(r):
    """All searchable text for a patient, lowercased."""
    parts = [r['location'], r['unit'], r.get('severity', ''), r['patient_name'], r['mrn'], r['dob'], r['code_status'], r['allergies'],
             r['diet'], r.get('o2_delivery', ''), r.get('admit_diagnosis', ''), r.get('isolation', ''), r.get('tube_feeds', ''),
             r.get('restraints', ''), r.get('admit_attending', ''), r.get('admit_service', ''),
             ' '.join(x['description'] for x in (r.get('tld') or [])),
             ' '.join(r['summary']['lines']), ' '.join(r['tasks']), ' '.join(r['sit_awareness']), ' '.join(r.get('notes') or []),
             ' '.join((r.get('handoff') or {}).values())]
    for items in (r.get('meds') or {}).values():
        parts += [f'{i["drug"]} {i["dose_frequency"]}' for i in items]
    return re.sub(r'\s+', ' ', ' '.join(parts)).lower()


def render_row(r, report_date=''):
    s = r['summary']
    narrative = ''.join(f'<p>{e(p)}</p>' for p in s['narrative'])
    status = ''.join(f'<tr data-name="{e(k)} line"><td>{e(k)}</td><td>{e(v)}</td></tr>' for k, v in s['status'].items())
    status = f'<table class="status" data-name="Status lines">{status}</table>' if status else ''
    adm = admit_date(report_date, r['los_days'])
    dx = re.sub(r'^\s*ADMIT:\s*', '', r.get('admit_diagnosis') or '', flags=re.I)
    admit = '<div class="adm" data-name="Admission"><h4>Admission</h4>'
    if dx:
        admit += f'<div data-name="Admit diagnosis"><b>Dx:</b> {e(dx)}</div>'
    if adm:
        admit += f'<div data-name="Admit date"><b>{e(adm)}</b></div>'
    los = f'(LOS {e(r["los_days"])} days)' if r['los_days'] is not None else '(LOS unknown)'
    admit += f'<div class="kv" data-name="Length of stay">{los}</div></div>'
    care_items = (('Allergies', r['allergies']), ('Diet', r['diet']), ('TF', r.get('tube_feeds', '')), ('Restraints', r.get('restraints', '')))
    care = ''.join(f'<div data-name="{k}"><b>{k}</b> <span class="{k.lower()}">{e(v)}</span></div>' for k, v in care_items if v)
    care = f'<div class="care" data-name="Allergy / Diet block">{care}</div>' if care else ''
    iso = f'<span class="iso" data-name="Isolation tag" title="{e(r["isolation"])}">Isolation</span>' if r.get('isolation') else ''
    handoff = ''.join(f'<div data-name="{e(k)}"><h4>{e(k)}</h4><p>{e(v)}</p></div>' for k, v in (r.get('handoff') or {}).items())
    notes = ''.join(f'<p>{e(n)}</p>' for n in r.get('notes') or [])
    tasks = ''.join(f'<li>{e(t.replace("[ ] ", "", 1))}</li>' for t in r['tasks'])
    plan = ''.join(f'<li>{e(re.sub(r"^- ?", "", p))}</li>' for p in r['sit_awareness'])
    age = re.sub(r'\D', '', r['age'])
    sev = r.get('severity', '') or ''
    data = {
        'location': r['location'], 'unit': r['unit'], 'pname': r['patient_name'], 'sev': sev.lower(),
        'sevrank': SEV_RANK.get(sev.lower(), 9), 'los': r['los_days'] or 0, 'age': age or 0, 'o2': r.get('o2_delivery', ''),
        'tasks': len(r['tasks']), 'drips': len((r.get('meds') or {}).get('infusions', [])), 'text': row_text(r),
    }
    attrs = ' '.join(f'data-{k}="{e(v)}"' for k, v in data.items())
    prn = render_prn_line(r)
    prn = f'<tr class="medrow" data-name="PRN row"><td colspan="7">{prn}</td></tr>' if prn else ''
    roombed = e(r['room']) + (f'-<span data-name="Bed">{e(r["bed"])}</span>' if r['bed'] else '')
    chip = (f'<div class="bedchip" data-name="Location block" title="{e(r["location"])}"><span class="u" data-name="Unit">{e(r["unit"])}</span>'
            + (f'<span class="rb" data-name="Room">{roombed}</span>' if r['room'] else '') + '</div>')
    tags = sev_chip(sev) + iso
    return f'''
<tbody class="blk" {attrs} data-name="Patient block">
<tr class="main">
 <td class="pt" data-name="Patient column"><div class="pthead">{chip}<span class="name" data-name="Patient name">{e(r["patient_name"])}</span></div>
   <span class="kv" data-name="MRN">MRN <b>{e(r["mrn"])}</b></span>
   <span class="kv" data-name="Date of birth">DOB <b>{e(r["dob"])}</b> (<span data-name="Age">{e(r["age"])}</span> <span data-name="Sex">{e(r["sex"])}</span>)</span>
   <span class="kv" data-name="Code status">Code <b>{e(r["code_status"]) or "—"}</b></span>
   {('<div class="pttags">' + tags + '</div>') if tags else ''}{admit}{care}</td>
 <td data-name="Summary column"><div data-name="Patient summary">{narrative or '<p class="empty">No summary</p>'}</div>{status}{('<h4>Notes</h4>' + notes) if notes else ''}</td>
 <td data-name="Vitals column">{render_vitals(r)}{render_ventilation(r)}{render_io(r, report_date)}{render_tld(r)}</td>
 <td data-name="Labs column">{render_labs(r)}</td>
 <td data-name="Meds column">{render_meds(r, ('infusions', 'antibiotics', 'scheduled', 'other'))}</td>
 <td data-name="Sit Awareness column"><div data-name="Tasks"><h4>Tasks</h4>{('<ul class="tasks">' + tasks + '</ul>') if tasks else '<p class="empty">None</p>'}</div>
     <div data-name="Situational Awareness"><h4>Situational Awareness</h4>{('<ul>' + plan + '</ul>') if plan else '<p class="empty">None</p>'}</div>{handoff}</td>
 <td class="notes" data-name="Notes column"></td>
</tr>
{prn}
</tbody>'''


def sections_menu():
    out = ''
    for group, names in SECTIONS:
        items = ''.join(f'<label class="{"sub" if n in CHILDREN else ""}"><input type="checkbox" data-sec="{e(n)}" checked> '
                        f'{e(n.replace(" column", "").replace(" row", ""))}</label>' for n in names)
        out += f'<div class="grp"><div class="grp-t">{e(group)}</div>{items}</div>'
    return out


def options(values):
    return ''.join(f'<option value="{e(v)}">{e(v)}</option>' for v in values)


def render(data, orientation='landscape'):
    """The Daily Report page. orientation is the paper it prints on until the toolbar's Paper switch is changed."""
    orient = 'portrait' if orientation == 'portrait' else 'landscape'
    h = data.get('header', {})
    recs = data['records']
    gen = datetime.datetime.now().strftime('%m/%d/%y %H:%M')
    units = sorted({r['unit'] for r in recs if r['unit']})
    sevs = sorted({r.get('severity', '') for r in recs if r.get('severity')}, key=lambda s: SEV_RANK.get(s.lower(), 9))
    o2s = sorted({r.get('o2_delivery', '') for r in recs if r.get('o2_delivery')})
    rows = ''.join(render_row(r, h.get('report_date', '')) for r in recs)
    return f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">{renderer_meta(orient)}<title>ICU Daily Report {e(h.get("service", ""))} / {e(h.get("team", ""))} — {e(h.get("report_date", ""))}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>{CSS}</style>
<style id="pagesz">@page{{size:letter {orient};margin:.3in}}</style></head>
<body><div class="page">
<div class="rpt-head" data-name="Report header"><div><h1 data-name="Source report format">{e(h.get("report_format", "ICU Daily Report"))} &nbsp;<span style="color:var(--accent)" data-name="Current service / team">{e(h.get("service", ""))} / {e(h.get("team", ""))}</span></h1>
<div class="conf">CONFIDENTIAL — contains PHI. Handle and dispose of properly.</div></div>
<div class="meta">CORES data as of <b data-name="Report date">{e(h.get("report_date", ""))}</b> for <span data-name="Printed by">{e(h.get("printed_by", ""))}</span><br>{len(recs)} patients · rendered {gen}</div></div>
<div class="toolbar" data-name="Toolbar">
 <input type="search" id="q" placeholder="Search anything (name, MRN, drug, diagnosis…)">
 <label>Unit <select id="f-unit"><option value="">All</option>{options(units)}</select></label>
 <label>Severity <select id="f-sev"><option value="">All</option>{''.join(f'<option value="{e(s.lower())}">{e(s)}</option>' for s in sevs)}</select></label>
 <label>O2 <select id="f-o2"><option value="">All</option>{options(o2s)}</select></label>
 <label><input type="checkbox" id="f-tasks"> Open tasks only</label>
 <label>Sort <select id="sort"><option value="location">Location</option><option value="pname">Name</option><option value="sevrank">Severity</option><option value="los">LOS</option><option value="age">Age</option><option value="tasks">Open tasks</option><option value="drips">Drips</option></select></label>
 <button id="reset" type="button">Reset</button>
 <button id="print" type="button">Print</button>
 <label title="Paper orientation for printing; column widths are kept separately for each">Paper <select id="orient">{''.join(f'<option value="{o}"{" selected" if o == orient else ""}>{o.title()}</option>' for o in ('landscape', 'portrait'))}</select></label>
 <button id="optimize" type="button" title="Choose the column widths that fit the shown patients on the fewest printed pages">Optimize widths</button>
 <button id="cols" type="button" title="Restore the default column widths">Reset columns</button>
 <details class="secmenu" id="secmenu"><summary title="Choose which sections are shown">Sections &#9662;</summary><div class="menu">{sections_menu()}<div class="menu-foot"><button id="sec-all" type="button">Show all</button></div></div></details>
 <label title="Hover to see an element's name, click to copy it"><input type="checkbox" id="inspect"> Inspect</label>
 <span class="optmsg" id="opt-msg"></span>
 <span class="count" id="count"></span>
</div>
<div id="insp-tip"></div><div id="insp-toast"></div>
<table class="rpt" id="rpt" data-name="Report table">
<colgroup><col style="width:12%"><col style="width:15%"><col style="width:19%"><col style="width:19%"><col style="width:14%"><col style="width:13%"><col style="width:8%"></colgroup>
<thead data-name="Column headers"><tr>
 <th data-key="location" data-name="Patient header">Location / Patient<span class="dir"></span></th>
 <th data-key="text" data-name="Summary header">Summary<span class="dir"></span></th>
 <th data-key="o2" data-name="Vitals header">Vitals · Vent · I&amp;O · Lines<span class="dir"></span></th>
 <th data-name="Labs header" style="cursor:default">Labs <span class="kv" style="font-weight:400">(today)</span></th>
 <th data-key="drips" data-name="Meds header">Meds<span class="dir"></span></th>
 <th data-key="tasks" data-name="Sit Awareness header">Tasks / Situational Awareness<span class="dir"></span></th>
 <th data-name="Notes header" style="cursor:default">Notes</th>
</tr></thead>
{rows}
</table>
<div class="foot">Generated from {e(data.get("source", ""))} · {len(recs)} patients</div>
</div>
<script>{JS.replace('__COLPARTS__', json.dumps(COLPARTS))}</script>
</body></html>'''


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    src = args[0]
    if src.lower().endswith('.json'):
        data = json.load(open(src, encoding='utf-8'))
    else:
        from cores_parse import parse_file
        data = parse_file(src)
    out = args[1] if len(args) > 1 else re.sub(r'\.(html?|json)$', '', src) + ' - Daily Report.html'
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(render(data, 'portrait' if '--portrait' in argv else 'landscape'))
    print(f'{len(data["records"])} patients -> {out}')


if __name__ == '__main__':
    main(sys.argv[1:])
