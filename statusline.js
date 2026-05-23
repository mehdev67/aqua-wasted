#!/usr/bin/env node
'use strict';

// aqua-wasted: a Claude Code statusline that turns your token usage into the
// cooling water your AI session burns, to make an invisible cost visible.
//
// This file is BOTH the runtime (Claude Code runs it as the statusLine command)
// and a small library the CLI reuses. It has zero dependencies on purpose so it
// can be copied to ~/.claude/aqua-wasted/ and run standalone forever.
//
// Water model (see README for sources and the honest disclaimer):
//   Based on Li et al. "Making AI Less Thirsty" (UC Riverside) and the
//   Washington Post 2024 reporting. Generating tokens costs far more water than
//   reading context, so output and input tokens are weighted separately.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ml of cooling water attributed per token, by scariness tier.
const TIERS = {
  conservative: { output: 0.01, input: 0.002 },  // modern, efficient 2025 models
  headline: { output: 0.03, input: 0.0075 },      // maps 1:1 to the UC Riverside table
  spicy: { output: 0.1, input: 0.025 },           // GPT 4 era, hot region, still under the studied max
};

const BOTTLE_ML = 500; // a standard water bottle, for relatable framing

const DEFAULT_CONFIG = {
  tier: 'headline',
  unit: 'ml',          // auto | ml | dl | L
  bottles: true,
  emoji: '\u{1F4A7}',  // droplet
  label: 'Aqua wasted',
  color: 'cyan',       // cyan | blue | red | yellow | green | magenta | false
  locale: 'en-US',
  chain: null,         // an existing statusLine command to run first, then append ours
};

function loadConfig(dir) {
  try {
    const p = path.join(dir, 'config.json');
    if (fs.existsSync(p)) {
      return Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  } catch (e) {
    // fall through to defaults
  }
  return Object.assign({}, DEFAULT_CONFIG);
}

// Sum every token recorded in a session transcript (the cumulative figure that
// makes the number climb dramatically). Shape matches Claude Code JSONL lines.
function sumTokensFromTranscript(transcriptPath) {
  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return totals;
  let text = '';
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (e) {
    return totals;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      continue;
    }
    const u = obj && obj.message && obj.message.usage;
    if (!u) continue;
    totals.input += u.input_tokens || 0;
    totals.cacheCreation += u.cache_creation_input_tokens || 0;
    totals.cacheRead += u.cache_read_input_tokens || 0;
    totals.output += u.output_tokens || 0;
  }
  return totals;
}

// Fallback when the transcript is missing: use the live context window numbers
// Claude Code now passes on stdin.
function tokensFromPayload(payload) {
  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  const cu = payload && payload.context_window && payload.context_window.current_usage;
  if (cu) {
    totals.input = cu.input_tokens || 0;
    totals.cacheCreation = cu.cache_creation_input_tokens || 0;
    totals.cacheRead = cu.cache_read_input_tokens || 0;
    totals.output = cu.output_tokens || 0;
  }
  return totals;
}

function computeWaterMl(totals, tierName) {
  const tier = TIERS[tierName] || TIERS.headline;
  const inputSide = totals.input + totals.cacheCreation + totals.cacheRead;
  return totals.output * tier.output + inputSide * tier.input;
}

function formatNumber(n, decimals, locale) {
  const v = Number(n.toFixed(decimals));
  try {
    return v.toLocaleString(locale || 'en-US');
  } catch (e) {
    return String(v);
  }
}

function formatWater(ml, unit, locale) {
  if (unit === 'ml') return formatNumber(Math.round(ml), 0, locale) + ' ml';
  if (unit === 'dl') return formatNumber(ml / 100, 1, locale) + ' dl';
  if (unit === 'L') return formatNumber(ml / 1000, 2, locale) + ' L';
  // auto
  if (ml < 1000) return formatNumber(Math.round(ml), 0, locale) + ' ml';
  const liters = ml / 1000;
  return liters < 10
    ? formatNumber(liters, 2, locale) + ' L'
    : formatNumber(liters, 1, locale) + ' L';
}

const ANSI = { cyan: '36', blue: '34', red: '31', yellow: '33', green: '32', magenta: '35' };

function colorize(text, color) {
  if (!color || !ANSI[color]) return text;
  return '\x1b[' + ANSI[color] + 'm' + text + '\x1b[0m';
}

function renderSegment(totals, cfg) {
  const ml = computeWaterMl(totals, cfg.tier);
  const bottles = Math.round(ml / BOTTLE_ML);
  const bottleWord = bottles === 1 ? 'bottle' : 'bottles';
  const bottleNote =
    cfg.bottles && bottles >= 1
      ? ' (≈ ' + formatNumber(bottles, 0, cfg.locale) + ' ' + bottleWord + ')'
      : '';
  const text = cfg.emoji + ' ' + cfg.label + ' ' + formatWater(ml, cfg.unit, cfg.locale) + bottleNote;
  return colorize(text, cfg.color);
}

// Run an existing statusLine command, passing the same stdin through, so we
// append to it rather than replacing it.
function runChain(chainCmd, stdinRaw) {
  if (!chainCmd) return '';
  try {
    const res = spawnSync(chainCmd, {
      shell: true,
      input: stdinRaw,
      encoding: 'utf8',
      timeout: 5000,
    });
    return (res.stdout || '').replace(/\s+$/, '');
  } catch (e) {
    return '';
  }
}

function main() {
  let stdinRaw = '';
  try {
    stdinRaw = fs.readFileSync(0, 'utf8');
  } catch (e) {
    stdinRaw = '';
  }
  let payload = {};
  try {
    payload = JSON.parse(stdinRaw) || {};
  } catch (e) {
    payload = {};
  }

  const cfg = loadConfig(__dirname);

  let totals = sumTokensFromTranscript(payload.transcript_path);
  const sum = totals.input + totals.cacheCreation + totals.cacheRead + totals.output;
  if (sum === 0) totals = tokensFromPayload(payload);

  const base = runChain(cfg.chain, stdinRaw);
  const segment = renderSegment(totals, cfg);
  process.stdout.write(base ? base + '  ' + segment : segment);
}

module.exports = {
  TIERS,
  BOTTLE_ML,
  DEFAULT_CONFIG,
  loadConfig,
  sumTokensFromTranscript,
  tokensFromPayload,
  computeWaterMl,
  formatWater,
  formatNumber,
  renderSegment,
};

if (require.main === module) main();
