'use strict';

// Ties the two collectors and the history together into the one line that gets
// printed under the water figure.
//
// Everything here is wrapped so that a broken timer can never take the statusline
// down with it. A missing line is annoying, a crashed statusline is worse.

const os = require('os');
const path = require('path');

const stats = require('./stats');
const claude = require('./collect-claude');
const cli = require('./collect-cli');
const render = require('./render');

const DEFAULTS = {
  timers: false,
  timersLayout: 'line', // line | inline
  timersMaxChips: 3,
};

function projectsDir(transcriptPath) {
  if (transcriptPath) {
    const up = path.dirname(path.dirname(transcriptPath));
    if (path.basename(up) === 'projects') return up;
  }
  return path.join(os.homedir(), '.claude', 'projects');
}

function scan(payload) {
  try {
    return claude.scanTranscript(payload && payload.transcript_path);
  } catch (e) {
    return {
      totals: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
      turnStartMs: 0,
      lastActivityMs: 0,
      pendingTools: 0,
      pendingAgents: 0,
    };
  }
}

function build(payload, cfg, dir, scanned, nowMs) {
  const now = nowMs || Date.now();
  const transcriptPath = (payload && payload.transcript_path) || '';
  const state = stats.load(dir);
  let dirty = false;

  // Fill the Claude history from transcripts already on disk, a few per render.
  try {
    dirty = stats.seedStep(state, projectsDir(transcriptPath), claude.readAgentFile) || dirty;
  } catch (e) {
    // seeding is best effort, a forecast that arrives late is fine
  }

  // External CLI runs, and the pid bookkeeping that teaches us their durations.
  let cliRuns = [];
  try {
    cliRuns = cli.collectCached(dir, now).map((r) => {
      r.key = stats.cliKey(r.tool, r.model);
      return r;
    });
    dirty = stats.observePids(state, cliRuns, now) || dirty;
  } catch (e) {
    cliRuns = [];
  }

  // Live Claude subagents. The transcript says how many, the files say which.
  let agents = [];
  try {
    agents = claude.runningAgents(transcriptPath, scanned.pendingAgents);
  } catch (e) {
    agents = [];
  }

  const active = scanned.pendingTools > 0 ||
    (scanned.turnStartMs > 0 && scanned.turnStartMs >= scanned.lastActivityMs);

  // Record a finished turn once, so the main timer eventually gets a forecast too.
  const turnKey = 'turn:' + ((payload && payload.model && payload.model.id) || 'unknown');
  if (!active && scanned.turnStartMs && state.lastTurnStart !== scanned.turnStartMs) {
    state.lastTurnStart = scanned.turnStartMs;
    if (scanned.lastActivityMs > scanned.turnStartMs) {
      dirty = stats.record(state, turnKey, (scanned.lastActivityMs - scanned.turnStartMs) / 1000) || dirty;
    }
  }

  const chips = [];
  for (const a of agents) {
    chips.push({
      track: 'claude',
      label: render.agentTypeName(a.agentType) + ' · ' + render.claudeModelName(a.model),
      elapsed: (now - a.startMs) / 1000,
      median: stats.forecast(state, stats.claudeKey(a.agentType, a.model)),
    });
  }
  for (const r of cliRuns) {
    chips.push({
      track: 'cli',
      label: r.tool + ' · ' + render.cliModelName(r.tool, r.model),
      elapsed: r.elapsed,
      median: stats.forecast(state, r.key),
    });
  }
  chips.sort((a, b) => b.elapsed - a.elapsed);

  let main = null;
  if (scanned.turnStartMs) {
    const end = active ? now : scanned.lastActivityMs;
    main = {
      elapsed: (end - scanned.turnStartMs) / 1000,
      active: active,
      median: stats.forecast(state, turnKey),
    };
  }

  if (dirty) stats.save(dir, state);

  return { main: main, chips: chips };
}

function renderTimers(payload, cfg, dir, scanned) {
  const conf = Object.assign({}, DEFAULTS, cfg || {});
  if (!conf.timers) return '';
  try {
    const model = build(payload, conf, dir, scanned);
    if (!model.main && !model.chips.length) return '';
    const line = render.renderLine(model, { maxChips: conf.timersMaxChips });
    if (!line) return '';
    return conf.timersLayout === 'inline' ? '  ' + line : '\n' + line;
  } catch (e) {
    return '';
  }
}

module.exports = { DEFAULTS, scan, build, renderTimers, projectsDir };
