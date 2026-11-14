// Runs the HUD self-test (test/selftest.html) without a window: starts test/serve.py, opens the page in headless
// Edge (or Chrome), waits for its verdict, prints it, stops both. Needs Node 22+ and Python. Invented patients only.
//
//     node test/run_selftest.mjs                 every test
//     node test/run_selftest.mjs trace_opener    one test (or several, comma between)
//     node test/run_selftest.mjs --show ...      with a visible browser window, left open at the end
//
// Exit code 0 = PASS, 1 = FAIL, 2 = the test could not be run.
// (Edge's --dump-dom prints nothing on this PC, so the page is driven over the DevTools protocol instead.)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const show = args.includes('--show');
const only = args.filter(a => !a.startsWith('--')).join(',');
const port = 8700 + Math.floor(Math.random() * 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = process.env.SELFTEST_BROWSER || browsers.find(existsSync);
if (!browser) { console.error('no Edge or Chrome found; set SELFTEST_BROWSER to its path'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'cores-selftest-'));
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [join(here, 'serve.py'), String(port)], { stdio: 'ignore' });
const edge = spawn(browser, [...(show ? [] : ['--headless=new']), '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-popup-blocking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

let code = 2;
function cleanup() {
  try { server.kill(); } catch (e) {}
  if (!show) {
    try { edge.kill(); } catch (e) {}
    for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch (e) {} }
  }
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

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to the browser')); });
  let seq = 0; const waiting = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

  const url = 'http://127.0.0.1:' + port + '/selftest.html' + (only ? '?only=' + encodeURIComponent(only) : '');
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const t0 = Date.now();
  let done = null;
  while (!done && Date.now() - t0 < 240000) {
    await sleep(300);
    const r = await send('Runtime.evaluate', { expression: 'window.selftestDone ? JSON.stringify(window.selftestDone) : ""', returnByValue: true }, sessionId);
    if (r.result && r.result.value) done = JSON.parse(r.result.value);
  }
  if (!done) {
    const r = await send('Runtime.evaluate', { expression: 'document.getElementById("out") ? document.getElementById("out").textContent : document.title', returnByValue: true }, sessionId);
    console.log(r.result && r.result.value || '');
    throw new Error('the self-test did not finish in 4 minutes');
  }
  console.log(done.text);
  code = done.ok ? 0 : 1;
  ws.close();
} catch (e) {
  console.error('self-test could not be run: ' + (e && e.message || e));
  code = 2;
}
cleanup();
process.exit(code);
