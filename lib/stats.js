'use strict';

// Rolling duration history, used to turn "how long has this run" into "roughly
// how much is left". Claude Code never estimates completion, so the only honest
// forecast is the median of what this machine has actually seen before.

const fs = require('fs');
const path = require('path');

const WINDOW = 20;          // keep the last N durations per key
const MIN_SAMPLES = 3;      // below this we show no forecast at all
const MAX_SANE_SECONDS = 7200; // an abandoned transcript can read as 45 hours

// Seeding the Claude history walks every subagent transcript on disk. Doing that
// in one render would risk Claude Code killing a slow statusline, so it runs a
// few files at a time and remembers where it stopped.
const SEED_FILE_BUDGET = 12;
const SEED_MS_BUDGET = 40;

function statePath(dir) {
  return path.join(dir, 'durations.json');
}

function load(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    if (raw && raw.version === 1) {
      raw.samples = raw.samples || {};
      raw.seenPids = raw.seenPids || {};
      return raw;
    }
  } catch (e) {
    // a missing or corrupt file just means we start over
  }
  return { version: 1, samples: {}, seenPids: {}, seedQueue: null, seeded: false };
}

// tmp plus rename, so two sessions rendering at once can never leave a half file
function save(dir, state) {
  try {
    const tmp = statePath(dir) + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, statePath(dir));
  } catch (e) {
    // the statusline must never fail because history could not be written
  }
}

function median(list) {
  if (!list.length) return null;
  const s = list.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function record(state, key, seconds) {
  if (!(seconds > 0) || seconds > MAX_SANE_SECONDS) return false;
  const list = state.samples[key] || (state.samples[key] = []);
  list.push(Math.round(seconds));
  if (list.length > WINDOW) list.splice(0, list.length - WINDOW);
  return true;
}

function forecast(state, key) {
  const list = state.samples[key];
  if (!list || list.length < MIN_SAMPLES) return null;
  return median(list);
}

// ---------------------------------------------------------------------------
// Seeding from the subagent transcripts already on disk.

function buildSeedQueue(projectsDir) {
  const out = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch (e) {
    return out;
  }
  for (const proj of projects) {
    let sessions = [];
    try {
      sessions = fs.readdirSync(path.join(projectsDir, proj), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      const dir = path.join(projectsDir, proj, s.name, 'subagents');
      let files = [];
      try {
        files = fs.readdirSync(dir);
      } catch (e) {
        continue;
      }
      for (const f of files) {
        if (f.startsWith('agent-') && f.endsWith('.jsonl')) out.push(path.join(dir, f));
      }
    }
  }
  return out;
}

// Advance the seed by a bounded amount. Returns true when state changed.
function seedStep(state, projectsDir, readAgentFile) {
  if (state.seeded) return false;
  if (!state.seedQueue) {
    state.seedQueue = buildSeedQueue(projectsDir);
    return true;
  }
  const startedAt = Date.now();
  let done = 0;
  while (state.seedQueue.length && done < SEED_FILE_BUDGET) {
    const p = state.seedQueue.pop();
    done++;
    const info = readAgentFile(p);
    // A finished transcript stops being written, so its mtime is its end time.
    if (info && info.startMs && info.mtimeMs && info.model) {
      record(state, claudeKey(info.agentType, info.model), (info.mtimeMs - info.startMs) / 1000);
    }
    if (Date.now() - startedAt > SEED_MS_BUDGET) break;
  }
  if (!state.seedQueue.length) {
    state.seeded = true;
    state.seedQueue = null;
  }
  return done > 0 || state.seeded;
}

// ---------------------------------------------------------------------------
// External CLI runs have no transcript, so we learn their durations by noticing
// a pid appear and later disappear.

function observePids(state, live, nowMs) {
  let changed = false;
  const alive = new Set(live.map((p) => String(p.pid)));

  for (const p of live) {
    const id = String(p.pid);
    if (!state.seenPids[id]) {
      state.seenPids[id] = { key: p.key, start: nowMs - p.elapsed * 1000 };
      changed = true;
    }
  }
  for (const id of Object.keys(state.seenPids)) {
    if (alive.has(id)) continue;
    const seen = state.seenPids[id];
    delete state.seenPids[id];
    changed = true;
    if (seen && seen.key && seen.start) record(state, seen.key, (nowMs - seen.start) / 1000);
  }
  return changed;
}

function claudeKey(agentType, model) {
  return 'claude:' + (agentType || 'agent') + ':' + (model || 'unknown');
}

function cliKey(tool, model) {
  return 'cli:' + tool + ':' + (model || 'default');
}

module.exports = {
  WINDOW,
  MIN_SAMPLES,
  MAX_SANE_SECONDS,
  load,
  save,
  median,
  record,
  forecast,
  seedStep,
  buildSeedQueue,
  observePids,
  claudeKey,
  cliKey,
};
