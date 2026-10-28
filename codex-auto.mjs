#!/usr/bin/env node
// codex-auto: run `codex exec` across several ChatGPT accounts, switching automatically
// when one hits its usage limit. See README.md.
//
//   node codex-auto.mjs login <name>                 sign in one account
//   node codex-auto.mjs run [codex exec opts] -- "prompt"
//   node codex-auto.mjs status | reset [name]
//
// Output is deliberately tiny (saves the calling agent's tokens):
//   success          -> Codex's final message only, exit 0
//   all accounts out -> one line "CODEX_AUTO_EXHAUSTED ...", exit 75
//   other failure    -> last 15 log lines + log path, Codex's exit code

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.env.CODEX_AUTO_DIR || path.join(os.homedir(), '.codex-auto');
const STATE = path.join(ROOT, 'state.json');
const LOGS = path.join(ROOT, 'logs');
const ACCOUNT_ROOT = path.join(ROOT, 'accounts');
const EXIT_EXHAUSTED = 75;
process.noDeprecation = true; // silence Node's shell-arg warning (args are quoted by us); saves caller tokens

fs.mkdirSync(LOGS, { recursive: true });
fs.mkdirSync(ACCOUNT_ROOT, { recursive: true });

// ---------- accounts & state ----------
// Accounts default to every folder under ~/.codex-auto/accounts/ (sorted by name = priority).
// Override with CODEX_AUTO_ACCOUNTS="a=C:\path\a;b=C:\path\b".
function accounts() {
  const env = process.env.CODEX_AUTO_ACCOUNTS;
  if (env) {
    return env.split(';').filter(Boolean).map((s) => {
      const [name, ...rest] = s.split('=');
      return { name: name.trim(), home: rest.join('=').trim() };
    });
  }
  return fs
    .readdirSync(ACCOUNT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, home: path.join(ACCOUNT_ROOT, d.name) }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
};
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

// ---------- helpers ----------
const QUOTA_RE = /usage limit|rate.?limit|quota|limit (?:has been )?reached|hit your .*limit|too many requests|\b429\b|insufficient[_ ]quota|exceeded .*(?:limit|quota)|upgrade to (?:pro|plus)|try again (?:in|at|later)/i;
const AUTH_RE = /not logged in|please (?:log ?in|sign in)|run `?codex login|\b401\b|unauthorized|token (?:has )?expired|refresh token|invalid_grant/i;

function parseCooldownMs(text) {
  // "try again in 3 hours 20 minutes", "in 2h 5m", "in 4 days", "in 35 min"
  const m = text.match(/(?:try again|retry|resets?)\s+in\s+([^\n.]{1,60})/i);
  if (m) {
    let ms = 0;
    for (const [, n, u] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/gi)) {
      const v = parseFloat(n);
      const k = u[0].toLowerCase();
      ms += v * (k === 'd' ? 864e5 : k === 'h' ? 36e5 : k === 'm' ? 6e4 : 1e3);
    }
    if (ms > 0) return Math.ceil(ms) + 30e3;
  }
  return 60 * 6e4; // unknown reset time: probe again in an hour
}

const hhmm = (t) => new Date(t).toLocaleString('sv-SE').slice(5, 16); // "MM-DD HH:mm" local time

function quote(a) { // only needed on Windows where codex is a .cmd shim and we use a shell
  return /[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function spawnCodex(args, env, stdinText) {
  const win = process.platform === 'win32';
  return spawn(win ? 'codex' : 'codex', win ? args.map(quote) : args, {
    env, shell: win, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ---------- commands ----------
async function cmdLogin(name) {
  if (!name) return die('usage: login <name>   (e.g. login a)');
  const home = path.join(ACCOUNT_ROOT, name);
  fs.mkdirSync(home, { recursive: true });
  const win = process.platform === 'win32';
  const p = spawn('codex', ['login'], { env: { ...process.env, CODEX_HOME: home }, shell: win, stdio: 'inherit' });
  p.on('exit', (c) => process.exit(c ?? 1));
}

function whoami(home) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    const part = (j.tokens?.id_token || '').split('.')[1];
    const email = part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).email : '';
    return email || j.tokens?.account_id || '?';
  } catch { return 'not logged in'; }
}

function cmdStatus() {
  const st = readState();
  const now = Date.now();
  for (const a of accounts()) {
    const until = st[a.name]?.until || 0;
    const ok = fs.existsSync(path.join(a.home, 'auth.json'));
    const flag = until > now ? `cooling until ${hhmm(until)} (${st[a.name].reason})` : 'available';
    console.log(`${a.name} <${whoami(a.home)}>: ${flag}${ok ? '' : '  [no auth.json - run login]'}  ${a.home}`);
  }
}

function cmdReset(name) {
  const st = readState();
  if (name) delete st[name]; else for (const k of Object.keys(st)) delete st[k];
  writeState(st);
  console.log('ok');
}

async function cmdRun(argv) {
  const dd = argv.indexOf('--');
  const opts = dd >= 0 ? argv.slice(0, dd) : argv;

  // wrapper-level options (stripped before reaching codex)
  const pull = (flag) => { const i = opts.indexOf(flag); if (i < 0) return null; const v = opts[i + 1]; opts.splice(i, 2); return v; };
  const prefer = pull('--prefer'); // start with this account (falls back to the others)
  let effort = String(pull('--effort') || process.env.CODEX_AUTO_EFFORT || 'medium').toLowerCase();
  const mx = opts.indexOf('--max'); if (mx >= 0) { opts.splice(mx, 1); effort = 'xhigh'; }
  if (!['medium', 'high', 'xhigh'].includes(effort)) effort = 'medium'; // never below medium
  const modelFlag = !opts.includes('-m') && !opts.includes('--model') && process.env.CODEX_AUTO_MODEL
    ? ['-m', process.env.CODEX_AUTO_MODEL] : [];
  let prompt = dd >= 0 ? argv.slice(dd + 1).join(' ') : '';
  if (!prompt && !process.stdin.isTTY) prompt = fs.readFileSync(0, 'utf8');
  if (!prompt.trim()) return die('no prompt: use  run [options] -- "prompt"  or pipe it on stdin');

  const accts = accounts();
  if (prefer) accts.sort((x, y) => (y.name === prefer) - (x.name === prefer));
  if (!accts.length) return die('no accounts yet: run  login a  and  login b  first');

  const st = readState();
  let interrupted = false;
  const tried = [];
  const failures = [];

  for (const a of accts) {
    const now = Date.now();
    if ((st[a.name]?.until || 0) > now) continue; // still cooling down, skip without spending anything

    const outFile = path.join(os.tmpdir(), `codex-auto-${process.pid}-${a.name}.txt`);
    const logFile = path.join(LOGS, `${new Date().toISOString().replace(/[:.]/g, '-')}-${a.name}.log`);
    const logStream = fs.createWriteStream(logFile);
    let tail = '';

    const finalPrompt = interrupted
      ? 'NOTE: a previous attempt at this task was cut off midway by an account quota limit. ' +
        'The workspace may already contain partial changes. First check `git status` / `git diff` ' +
        '(or the files named below), keep finished work, and continue only what is missing. ' +
        'Do not redo completed parts.\n\n---\n' + prompt
      : prompt;

    const skip = opts.includes('--skip-git-repo-check') ? [] : ['--skip-git-repo-check'];
    const args = ['exec', ...skip, ...modelFlag, '-c', `model_reasoning_effort=${effort}`, ...opts, '-o', outFile, '-'];
    const child = spawnCodex(args, { ...process.env, CODEX_HOME: a.home });
    const feed = (b) => { logStream.write(b); tail = (tail + b.toString()).slice(-200000); };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.stdin.end(finalPrompt);

    const code = await new Promise((res) => {
      child.on('error', (e) => { feed(`spawn error: ${e.message}\n`); res(127); });
      child.on('close', (c) => res(c ?? 1));
    });
    logStream.end();
    tried.push(a.name);

    if (code === 0) {
      let msg = '';
      try { msg = fs.readFileSync(outFile, 'utf8').trim(); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      if (tried.length > 1) process.stderr.write(`[codex-auto] switched to account "${a.name}"\n`);
      console.log(msg || `(codex finished with no final message; log: ${logFile})`);
      return process.exit(0);
    }
    try { fs.unlinkSync(outFile); } catch {}

    if (QUOTA_RE.test(tail)) {
      const until = Date.now() + parseCooldownMs(tail);
      st[a.name] = { until, reason: 'quota' };
      writeState(st);
      interrupted = true;
      failures.push(`${a.name}: quota, back ~${hhmm(until)}`);
      continue; // silently try next account
    }
    if (AUTH_RE.test(tail)) {
      st[a.name] = { until: Date.now() + 10 * 6e4, reason: 'auth' };
      writeState(st);
      failures.push(`${a.name}: login problem (run: login ${a.name})`);
      continue;
    }
    // Real failure unrelated to quota: do NOT burn the other account on it.
    const lines = tail.trim().split('\n').slice(-15).join('\n');
    console.log(`CODEX_AUTO_FAILED account=${a.name} exit=${code}\n${lines}\nlog: ${logFile}`);
    return process.exit(code);
  }

  const soonest = accts
    .map((a) => ({ n: a.name, u: st[a.name]?.until || 0 }))
    .filter((x) => x.u > Date.now())
    .sort((x, y) => x.u - y.u)[0];
  console.log(
    'CODEX_AUTO_EXHAUSTED: no Codex account is available. ' +
      (failures.length ? failures.join('; ') + '. ' : '') +
      (soonest ? `Earliest recovery: ${soonest.n} at ${hhmm(soonest.u)}. ` : '') +
      'Stop delegating to Codex and tell the user; do not retry in a loop.',
  );
  process.exit(EXIT_EXHAUSTED);
}

function die(m) { console.error(m); process.exit(2); }

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'login') cmdLogin(rest[0]);
else if (cmd === 'status' || cmd === 'accounts') cmdStatus();
else if (cmd === 'reset') cmdReset(rest[0]);
else if (cmd === 'run') cmdRun(rest);
else die('usage: codex-auto.mjs <login <name> | run [opts] -- "prompt" | status | reset [name]>');
