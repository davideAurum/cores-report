"""Recover the report HTML that CORES POSTs to its PDF-printing proxy, from an Edge/Chrome HAR export.

Why: for reports whose config has pdf_ind=1 (e.g. the Anesthesia ICU report), CORES renders the report
in the browser, then immediately submits the rendered HTML as a form field named "html" to the PDF proxy
and navigates to the returned PDF. Saving that page gives you the PDF (the .php download), not the HTML.
The HTML is still visible in DevTools' network log, and a HAR export contains it.

How to capture:
  1. In Edge, press F12, open the Network tab, tick "Preserve log".
  2. Open / print the Anesthesia report as usual (the .php PDF will download).
  3. In the Network tab, right-click any request -> "Save all as HAR with content" -> e.g. anes.har
  4. python har_extract.py anes.har            -> writes one .html per captured report POST

Usage: python har_extract.py capture.har [out_prefix]
"""
import json
import re
import sys
from urllib.parse import unquote_plus


def html_from_entry(entry):
    """Return the 'html' form field of a POST entry, or None."""
    req = entry.get('request', {})
    if req.get('method', '').upper() != 'POST':
        return None
    pd = req.get('postData') or {}
    for p in pd.get('params') or []:
        if p.get('name') == 'html' and p.get('value'):
            return unquote_plus(p['value'])
    text = pd.get('text') or ''
    m = re.search(r'(?:^|&)html=([^&]*)', text)
    if m:
        return unquote_plus(m.group(1))
    return None


def entries_from(path):
    """HAR file -> its entries; any other text (copied cURL / fetch / request payload) -> one synthetic entry."""
    raw = open(path, encoding='utf-8-sig', errors='replace').read()
    try:
        return json.loads(raw).get('log', {}).get('entries', [])
    except ValueError:
        raw = raw.replace('^', '')  # "Copy as cURL (cmd)" escapes the body with ^; URL-encoded data never contains a real ^
        m = re.search(r'html=([^&\'"\s\\]+)', raw)
        text = 'html=' + m.group(1) if m else ''
        return [{'request': {'method': 'POST', 'url': path, 'postData': {'text': text}}}]


def main(argv):
    if not argv:
        sys.exit(__doc__)
    prefix = argv[1] if len(argv) > 1 else re.sub(r'\.(har|txt)$', '', argv[0], flags=re.I)
    n = 0
    for entry in entries_from(argv[0]):
        html = html_from_entry(entry)
        if not html or 'column_name=' not in html:
            continue
        n += 1
        title = re.search(r'<td[^>]*>\s*(UAB Core Work Mgr[^<]*)</td>', html)
        name = re.sub(r'[^\w\- ]+', '', title.group(1)).strip() if title else f'report{n}'
        out = f'{prefix} - {name}.html' if n == 1 else f'{prefix} - {name} ({n}).html'
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write(html)
        rows = len(re.findall(r'class="row_template[ "]', html))
        print(f'{entry["request"]["url"][:80]}\n  -> {out}  ({len(html):,} chars, {rows} patient rows)')
    if not n:
        print('No report POST found. Make sure "Preserve log" was on before the report opened, and that the HAR was saved "with content".')


if __name__ == '__main__':
    main(sys.argv[1:])
