#!/usr/bin/env node
/* ==========================================================================
   webmcp-mcp-server.mjs

   Lets an MCP client (Claude Code, Claude Desktop, ...) operate the WebMCP
   wallet while browsers ship navigator.modelContext only behind flags.

   It serves this folder on http://127.0.0.1:8765, opens webmcp_wallet.html
   in a Chrome window you can watch, and forwards MCP tool calls over stdio to
   the page's window.webmcpWallet bridge. Requests that would sign a qBESU
   transaction still wait for you to press Approve in that window.

   No dependencies: Node 22+ (global fetch and WebSocket) and Google Chrome.

   Environment:
     WALLET_PORT   static server port (default 8765)
     CDP_PORT      Chrome remote debugging port (default 9333)
     CHROME_PATH   Chrome binary (default: the usual macOS / Linux locations)
     HEADLESS=1    run Chrome without a window (automated tests only; nobody
                   can approve signing requests)
   ========================================================================== */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WALLET_PORT = Number(process.env.WALLET_PORT || 8765);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const HEADLESS = process.env.HEADLESS === '1';
const PAGE_URL = `http://127.0.0.1:${WALLET_PORT}/webmcp_wallet.html`;

// stdout carries the MCP protocol, so anything for humans goes to stderr
const log = (...args) => console.error('[artid-wallet]', ...args);

/* ---------------- static server for the wallet ---------------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

function serve() {
  return new Promise(done => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = normalize(join(ROOT, path === '/' ? '/webmcp_wallet.html' : path));
      if (!file.startsWith(ROOT + sep) || !TYPES[extname(file).toLowerCase()]) {
        res.writeHead(404).end();
        return;
      }
      readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()], 'Cache-Control': 'no-store' }).end(data);
      });
    });
    server.on('error', error => {
      // something already serves the port - assume it is this folder
      if (error.code === 'EADDRINUSE') { log(`port ${WALLET_PORT} in use, using the existing server`); done(); }
      else throw error;
    });
    server.listen(WALLET_PORT, '127.0.0.1', done);
  });
}

/* ---------------- Chrome ---------------- */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

let chrome;

async function walletTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  return targets.find(t => t.type === 'page' && t.url.includes('webmcp_wallet')) || null;
}

/* Reuse a wallet window that is already open on the debugging port (another
   client may have started it); otherwise open one. */
async function openWallet() {
  try {
    const existing = await walletTarget();
    if (existing) { log('reusing the open wallet window'); return existing.webSocketDebuggerUrl; }
    const opened = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${PAGE_URL}`, { method: 'PUT' })).json();
    return opened.webSocketDebuggerUrl;
  } catch {
    return launchChrome();
  }
}

async function launchChrome() {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'artid-wallet-'))}`,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=440,920',
    HEADLESS ? '--headless=new' : `--app=${PAGE_URL}`
  ];
  if (HEADLESS) args.push(PAGE_URL);
  chrome = spawn(chromePath(), args, { stdio: 'ignore' });
  // closing the window is fine: the next tool call opens a new one
  chrome.on('exit', () => { log('Chrome closed.'); chrome = null; ready = null; });
  for (let i = 0; i < 60; i++) {
    try {
      const page = await walletTarget();
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Chrome did not open the wallet page.');
}

/* ---------------- page connection ---------------- */

let ws;
let nextId = 0;
const waiting = new Map();

function connect(url) {
  return new Promise((done, fail) => {
    ws = new WebSocket(url);
    ws.onopen = done;
    ws.onerror = fail;
    ws.onclose = () => { ready = null; };
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      }
    };
  });
}

function cdp(method, params) {
  return new Promise(done => {
    const id = ++nextId;
    waiting.set(id, done);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.error) throw new Error(reply.error.message);
  if (reply.result.exceptionDetails) {
    throw new Error(reply.result.exceptionDetails.exception?.description || 'Page script error');
  }
  return reply.result.result.value;
}

/* The browser starts in the background, so the MCP handshake is answered at
   once rather than after Chrome and the wallet have loaded. */
let ready = null;
let serving = null;

function browser() {
  if (!ready) {
    ready = (async () => {
      serving = serving || serve();
      await serving;
      await connect(await openWallet());
      await walletReady();
      log(`wallet open at ${PAGE_URL}${HEADLESS ? ' (headless)' : ''}`);
    })();
    ready.catch(error => { log('could not open the wallet:', error.message); ready = null; });
  }
  return ready;
}

// the page may still be loading, or the person may have reloaded it
async function walletReady() {
  for (let i = 0; i < 80; i++) {
    if (await evaluate('Boolean(window.webmcpWallet)').catch(() => false)) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('The wallet page did not load its WebMCP tools.');
}

/* ---------------- MCP over stdio ---------------- */

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'notifications/initialized') browser().catch(() => {});
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'artid-webmcp-wallet', version: '1.0.0' },
        instructions: 'Operates the ArtID WebMCP Wallet open in a Chrome window. The wallet runs in four steps: log_in, select_role, the wallet page, the registry. Call get_wallet_state when unsure. A tool can only be used on the page named in brackets at the start of its description; every result lists the tools available next. Signing requests wait for the person to approve them in the window.'
      });
    } else if (method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      await browser();
      await walletReady();
      const tools = await evaluate('window.webmcpWallet.listAllTools()');
      reply(id, { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    } else if (method === 'tools/call') {
      await browser();
      await walletReady();
      log('call', params.name);
      const result = await evaluate(`window.webmcpWallet.callTool(${JSON.stringify(params.name)}, ${JSON.stringify(params.arguments || {})})`);
      reply(id, result);
    } else {
      fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (error) {
    fail(id, -32603, error.message);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try { handle(JSON.parse(line)); } catch { fail(null, -32700, 'Parse error'); }
    }
  }
});
process.stdin.on('end', () => { chrome?.kill(); process.exit(0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { chrome?.kill(); process.exit(0); });
