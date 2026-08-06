'use strict';

// Finds external AI CLI runs (Codex, Kimi, Kilo, Qwen) in the process list.
// These are not Claude Code subagents and never appear in any transcript, but
// they do carry their model on the command line:
//
//   node /opt/homebrew/bin/codex exec ... -c model="gpt-5.5" -C /some/dir
//
// so the process list is both the liveness signal and the model source.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOLS = ['codex', 'kimi', 'kilo', 'qwen'];

// Measured on this machine: a ps sweep costs about 44 ms, which is the whole cost
// of the timer feature. The statusline redraws many times a second, so the sweep
// is shared through a short lived cache instead. External runs last minutes, so
// two seconds of staleness is invisible, and when nothing is running at all we
// can afford to look far less often.
const CACHE_TTL_BUSY_MS = 2000;
const CACHE_TTL_IDLE_MS = 6000;

// Long lived helpers that are not tasks. The Codex MCP server in particular sits
// running for the whole session and would otherwise show as a task that never ends.
const NOT_A_TASK = ['mcp-server', 'mcp', '--version', 'login', 'logout'];

// macOS ps has no etimes keyword, so elapsed comes back as [[dd-]hh:]mm:ss.
function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  if (!m) return 0;
  const d = Number(m[1] || 0);
  const h = Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const sec = Number(m[4] || 0);
  return d * 86400 + h * 3600 + min * 60 + sec;
}

function basename(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function extractModel(tool, args) {
  let m = /-c\s+model="([^"]+)"/.exec(args) || /-c\s+model=([^\s]+)/.exec(args);
  if (m) return m[1];
  m = /--model[= ]([^\s]+)/.exec(args);
  if (m) return m[1];
  m = /\s-m\s+([^\s]+)/.exec(args);
  if (m) return m[1];
  return '';
}

function runPs() {
  try {
    const res = spawnSync('ps', ['-axo', 'pid=,etime=,args='], {
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 8 * 1024 * 1024,
    });
    return res && res.stdout ? res.stdout : '';
  } catch (e) {
    return '';
  }
}

function collect(psOutput) {
  const text = psOutput === undefined ? runPs() : psOutput;
  if (!text) return [];

  const byKey = new Map();

  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const elapsed = parseEtime(m[2]);
    const args = m[3];
    if (pid === process.pid) continue;

    // Find the token that is one of our tools, so "node /path/to/codex exec"
    // and the bare binary both resolve to the same tool.
    const tokens = args.split(/\s+/);
    let idx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (TOOLS.indexOf(basename(tokens[i])) !== -1) {
        idx = i;
        break;
      }
    }
    if (idx === -1) continue;

    const tool = basename(tokens[idx]);
    const rest = tokens.slice(idx + 1);
    const sub = rest[0] || '';
    if (NOT_A_TASK.indexOf(sub) !== -1) continue;
    if (!rest.length) continue; // a bare interactive shell, not a task run

    const restStr = rest.join(' ');
    const model = extractModel(tool, ' ' + restStr);

    // Every run shows up twice, as a node wrapper and as the native binary.
    // The arguments after the binary name are identical, so they collapse here.
    const key = tool + '|' + restStr.slice(0, 200);
    const prev = byKey.get(key);
    if (prev) {
      if (elapsed > prev.elapsed) prev.elapsed = elapsed;
      continue;
    }
    byKey.set(key, { pid: pid, tool: tool, model: model, elapsed: elapsed });
  }

  return Array.from(byKey.values()).sort((a, b) => b.elapsed - a.elapsed);
}

// Same as collect(), but shares one ps sweep across every render and every
// concurrent session. Elapsed times are re-derived from the cache age so a reused
// snapshot still counts up instead of freezing.
function collectCached(dir, nowMs) {
  const now = nowMs || Date.now();
  const file = path.join(dir, 'ps-cache.json');

  let cache = null;
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    cache = null;
  }

  if (cache && cache.at && Array.isArray(cache.runs)) {
    const ttl = cache.runs.length ? CACHE_TTL_BUSY_MS : CACHE_TTL_IDLE_MS;
    const age = now - cache.at;
    if (age >= 0 && age < ttl) {
      return cache.runs.map((r) => Object.assign({}, r, { elapsed: r.elapsed + age / 1000 }));
    }
  }

  const runs = collect();
  try {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ at: now, runs: runs }), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    // an uncacheable sweep is still a usable sweep
  }
  return runs;
}

module.exports = {
  collect,
  collectCached,
  parseEtime,
  extractModel,
  TOOLS,
  NOT_A_TASK,
  CACHE_TTL_BUSY_MS,
  CACHE_TTL_IDLE_MS,
};
