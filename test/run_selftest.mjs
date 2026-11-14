// Runs the HUD self-test (test/selftest.html) without a window: starts test/serve.py, opens the page in headless
// Edge (or Chrome), waits for its verdict, prints it, stops both. Needs Node 22+ and Python. Invented patients only.
//
//     node test/run_selftest.mjs                 every test
//     node test/run_selftest.mjs trace_opener    one test (or several, comma between)
//     node test/run_selftest.mjs --show ...      with a visible browser window, left open at the end
//     node test/run_selftest.mjs --capture FILE  no tests: capture the fake report (invented patients) into FILE, with its
//                                                CORES teams / data / log comments, for trying `cores generate FILE`
//
// Exit code 0 = PASS, 1 = FAIL, 2 = the test could not be run (or did not finish in 5 minutes).
// (Edge's --dump-dom prints nothing on this PC, so the page is driven over the DevTools protocol instead.)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const show = args.includes('--show');
const capAt = args.indexOf('--capture'), captureTo = capAt >= 0 ? args[capAt + 1] : '';
if (capAt >= 0 && !captureTo) { console.error('--capture needs a file name'); process.exit(2); }
const only = args.filter((a, i) => !a.startsWith('--') && (capAt < 0 || i !== capAt + 1)).join(',');
const port = 8700 + Math.floor(Math.random() * 200);
const LIMIT = 300000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer from the browser (' + what + ')')), ms))]);

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = process.env.SELFTEST_BROWSER || browsers.find(existsSync);
if (!browser) { console.error('no Edge or Chrome found; set SELFTEST_BROWSER to its path'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'cores-selftest-'));
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [join(here, 'serve.py'), String(port)], { stdio: 'ignore' });
const edge = spawn(browser, [...(show ? [] : ['--headless=new']), '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-popup-blocking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

let code = 2, ws = null, seq = 0;
const waiting = new Map();
const send = (method, params = {}, sessionId) => within(new Promise((res, rej) => {
  const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId }));
}), 15000, method);

// the browser hands its work to other processes, so killing the one started here is not enough: it is asked to
// close, and whatever still runs from this run's own profile folder is stopped by that folder's name
async function cleanup() {
  try { server.kill(); } catch (e) {}
  if (show) return;
  try { if (ws && ws.readyState === 1) await send('Browser.close'); } catch (e) {}
  await sleep(500);
  try { edge.kill(); } catch (e) {}
  if (process.platform === 'win32') {
    const tag = profile.split('\\').pop().replace(/[^\w-]/g, '');
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + tag + "') -and $_.Name -ne 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
        { stdio: 'ignore', timeout: 30000 });
    } catch (e) {}
  }
  for (let i = 0; i < 20; i++) { try { rmSync(profile, { recursive: true, force: true }); if (!existsSync(profile)) break; } catch (e) {} await sleep(250); }
}

try {
  // the browser writes the port it listens on into its profile folder
  let wsUrl = '';
  for (let i = 0; i < 150 && !wsUrl; i++) {
    await sleep(100);
    try { const [p, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); if (p && path) wsUrl = 'ws://127.0.0.1:' + p + path; } catch (e) {}
  }
  if (!wsUrl) throw new Error('the browser did not start its DevTools port');
  for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/selftest.html')).ok) break; } catch (e) {} await sleep(100); }

  ws = new WebSocket(wsUrl);
  await within(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to the browser')); }), 15000, 'connecting');
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } };

  const url = 'http://127.0.0.1:' + port + '/selftest.html' + (captureTo ? '?capture=1' : only ? '?only=' + encodeURIComponent(only) : '');
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const t0 = Date.now();
  let done = null;
  while (!done && Date.now() - t0 < LIMIT) {
    await sleep(300);
    const r = await send('Runtime.evaluate', { expression: 'window.selftestDone ? JSON.stringify(window.selftestDone) : ""', returnByValue: true }, sessionId);
    if (r.result && r.result.value) done = JSON.parse(r.result.value);
  }
  if (!done) {
    const r = await send('Runtime.evaluate', { expression: 'document.getElementById("out") ? document.getElementById("out").textContent : document.title', returnByValue: true }, sessionId);
    console.log(r.result && r.result.value || '');
    throw new Error('the self-test did not finish in ' + LIMIT / 60000 + ' minutes');
  }
  if (captureTo && done.ok && done.capture) {
    writeFileSync(captureTo, done.text);
    console.log('fake capture (invented patients) written to ' + captureTo + ': ' + done.text.length + ' chars, ' + (done.text.match(/id="row_template_\d+"/g) || []).length + ' patient rows');
  } else console.log(done.text);
  console.log('(' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  code = done.ok ? 0 : 1;
} catch (e) {
  console.error('self-test could not be run: ' + (e && e.message || e));
  code = 2;
}
await cleanup();
process.exit(code);
