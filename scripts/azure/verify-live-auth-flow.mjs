import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'https://app.verifymyinterview.co.za';
const outputDir = process.argv[3] || path.resolve('output', 'playwright');
const timeoutMs = Number(process.argv[4] || 15000);

function browserCandidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find Edge or Chrome.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function launchBrowser(browserPath, profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ];
  const child = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stderr.on('data', (chunk) => {
    text += chunk.toString();
  });
  child.stdout.on('data', (chunk) => {
    text += chunk.toString();
  });
  return { child, getOutput: () => text };
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP command failed'));
      else resolve(message.result);
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params || {});
    }
  });

  return {
    ready: () => new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    }),
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(listener);
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result?.value;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const authConfig = await fetch(`${url.replace(/\/+$/, '')}/auth/config`).then((res) => res.json());
  const browserPath = findBrowser();
  const profileDir = path.join(outputDir, 'auth-flow-profile');
  const { child, getOutput } = launchBrowser(browserPath, profileDir);

  try {
    const browserWs = await waitFor(() => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(getOutput());
      return match?.[1] || null;
    }, timeoutMs, 'DevTools websocket');
    const browserEndpoint = new URL(browserWs);
    const newTabUrl = `http://${browserEndpoint.host}/json/new?${encodeURIComponent(url)}`;
    const tab = await fetch(newTabUrl, { method: 'PUT' }).then((res) => res.json());
    const client = cdpClient(tab.webSocketDebuggerUrl);
    await client.ready();

    const logs = [];
    const requests = [];
    const navigations = [];
    client.on('Runtime.consoleAPICalled', (params) => {
      logs.push({
        type: params.type,
        text: (params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
      });
    });
    client.on('Runtime.exceptionThrown', (params) => {
      logs.push({ type: 'exception', text: params.exceptionDetails?.text || 'exception' });
    });
    client.on('Network.requestWillBeSent', (params) => {
      const requestUrl = params.request?.url || '';
      if (/login\.microsoftonline\.com|ciamlogin\.com|b2clogin\.com|\/auth\/config/.test(requestUrl)) {
        requests.push({ url: requestUrl, type: params.type, method: params.request?.method });
      }
    });
    client.on('Page.frameNavigated', (params) => {
      if (params.frame?.url) navigations.push(params.frame.url);
    });

    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Page.navigate', { url });
    await waitFor(async () => {
      const state = await evaluate(client, 'document.readyState');
      return state === 'complete';
    }, timeoutMs, 'page load');
    await sleep(1500);

    const before = await evaluate(client, `(() => ({
      href: location.href,
      buttons: [...document.querySelectorAll('button')].map((button) => button.textContent.trim()).filter(Boolean),
      authDebug: sessionStorage.getItem('vmi.auth.debug.v1'),
      authError: sessionStorage.getItem('vmi.auth.error.v1'),
      authConfig: window.__vmiAuthProbe || null
    }))()`);

    const clickResult = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('button')].find((item) => /sign\\s*in/i.test(item.textContent || ''));
      if (!button) return { clicked: false, reason: 'sign-in button not found', buttons: [...document.querySelectorAll('button')].map((item) => item.textContent.trim()) };
      button.click();
      return { clicked: true, buttonText: button.textContent.trim() };
    })()`);

    await sleep(timeoutMs);
    const after = await evaluate(client, `(() => ({
      href: location.href,
      bodyText: document.body.innerText.slice(0, 1000),
      pendingPkce: sessionStorage.getItem('vmi.auth.pkce.v1'),
      storedToken: sessionStorage.getItem('vmi.auth.token.v1'),
      authDebug: sessionStorage.getItem('vmi.auth.debug.v1'),
      authError: sessionStorage.getItem('vmi.auth.error.v1')
    }))()`);

    const report = {
      checkedAt: new Date().toISOString(),
      url,
      authConfig,
      expectedAuthorize: `${authConfig.authority}/oauth2/v2.0/authorize`,
      before,
      clickResult,
      after,
      microsoftRequests: requests,
      navigations,
      console: logs,
    };
    const reportPath = path.join(outputDir, 'live-auth-flow.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const sawAuthorize = requests.some((entry) => entry.url.includes('/oauth2/v2.0/authorize'));
    const leftApp = after.href.startsWith(authConfig.authority) || /login\.microsoftonline\.com|ciamlogin\.com|b2clogin\.com/.test(after.href);
    console.log(`Auth flow report: ${reportPath}`);
    console.log(`Click fired: ${clickResult.clicked ? 'YES' : 'NO'}`);
    console.log(`Microsoft authorize requested: ${sawAuthorize ? 'YES' : 'NO'}`);
    console.log(`Current URL after click: ${after.href}`);
    if (!clickResult.clicked) process.exitCode = 2;
    else if (!sawAuthorize && !leftApp) process.exitCode = 3;
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
