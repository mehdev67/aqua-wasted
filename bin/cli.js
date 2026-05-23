#!/usr/bin/env node
'use strict';

// aqua-wasted CLI: install | uninstall | status | card | help
// Safely wires the statusline into Claude Code and renders a shareable card.

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../statusline.js');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const INSTALL_DIR = path.join(CLAUDE_DIR, 'aqua-wasted');
const RUNTIME = path.join(INSTALL_DIR, 'statusline.js');
const CONFIG = path.join(INSTALL_DIR, 'config.json');
const PKG_RUNTIME = path.join(__dirname, '..', 'statusline.js');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// --- color helpers ----------------------------------------------------------

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
function paint(s, codes) {
  return useColor ? codes + s + C.reset : s;
}
function thirstLabel(frac) {
  if (frac < 0.3) return 'a sip';
  if (frac < 0.55) return 'thirsty';
  if (frac < 0.8) return 'very thirsty';
  return 'parched';
}

// --- small helpers ----------------------------------------------------------

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return undefined; // signals a parse failure to the caller
  }
}

function atomicWrite(file, contents) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

function ourCommand() {
  return 'node "' + RUNTIME + '"';
}

function isOurCommand(cmd) {
  return typeof cmd === 'string' && cmd.indexOf('aqua-wasted') !== -1;
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spicy') flags.tier = 'spicy';
    else if (a === '--conservative') flags.tier = 'conservative';
    else if (a === '--headline') flags.tier = 'headline';
    else if (a === '--no-bottles') flags.bottles = false;
    else if (a === '--no-color') flags.color = false;
    else if (a === '--no-chain') flags.noChain = true;
    else if (a.startsWith('--tier=')) flags.tier = a.slice(7);
    else if (a.startsWith('--unit=')) flags.unit = a.slice(7);
    else if (a.startsWith('--label=')) flags.label = a.slice(8);
    else if (a.startsWith('--locale=')) flags.locale = a.slice(9);
    else if (a.startsWith('--color=')) flags.color = a.slice(8);
  }
  return flags;
}

// --- commands ---------------------------------------------------------------

function install(argv) {
  const flags = parseFlags(argv);

  const settings = readJson(SETTINGS, {});
  if (settings === undefined) {
    console.error('aqua-wasted: could not parse ' + SETTINGS + '. It may contain comments or be invalid JSON.');
    console.error('Nothing was changed. Add this block manually instead:');
    console.error('  "statusLine": { "type": "command", "command": ' + JSON.stringify(ourCommand()) + ' }');
    process.exit(1);
  }

  // Detect an existing statusLine so we can chain rather than clobber it.
  let chain = null;
  const existing = settings.statusLine;
  if (existing && existing.type === 'command' && existing.command && !isOurCommand(existing.command)) {
    if (!flags.noChain) {
      chain = existing.command;
      console.log('Found an existing statusLine. aqua-wasted will run it first and append after it.');
    } else {
      console.log('Found an existing statusLine. Replacing it (--no-chain).');
    }
  } else if (existing && existing.type !== 'command' && !isOurCommand(JSON.stringify(existing))) {
    console.log('Found a non command statusLine. Leaving it and adding ours on top.');
  }

  // Write runtime + config into a stable location, independent of the npx cache.
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.copyFileSync(PKG_RUNTIME, RUNTIME);

  const cfg = Object.assign({}, core.DEFAULT_CONFIG, {
    tier: flags.tier || core.DEFAULT_CONFIG.tier,
    unit: flags.unit || core.DEFAULT_CONFIG.unit,
    bottles: flags.bottles === false ? false : core.DEFAULT_CONFIG.bottles,
    color: flags.color === false ? false : flags.color || core.DEFAULT_CONFIG.color,
    label: flags.label || core.DEFAULT_CONFIG.label,
    locale: flags.locale || core.DEFAULT_CONFIG.locale,
    chain: chain,
  });
  if (!core.TIERS[cfg.tier]) {
    console.error('aqua-wasted: unknown tier "' + cfg.tier + '". Use conservative, headline, or spicy.');
    process.exit(1);
  }
  atomicWrite(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

  // Back up settings, then patch only the statusLine key.
  if (fs.existsSync(SETTINGS)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(SETTINGS, SETTINGS + '.bak-' + stamp);
  } else {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  settings.statusLine = { type: 'command', command: ourCommand(), padding: 0 };
  atomicWrite(SETTINGS, JSON.stringify(settings, null, 2) + '\n');

  console.log('');
  console.log('  ' + core.renderSegment({ output: 9000, input: 60000, cacheCreation: 0, cacheRead: 0 }, cfg));
  console.log('');
  console.log(paint('  ✓ aqua-wasted installed', C.green + C.bold));
  console.log('    tier     ' + cfg.tier);
  console.log('    unit     ' + cfg.unit);
  console.log('    chained  ' + (chain ? 'yes, your existing statusline is kept' : 'no'));
  console.log('    config   ' + CONFIG);
  console.log('');
  console.log(paint('  Run /statusline or start a new session to see it.', C.dim));
  console.log(paint('  💧 Every token sips cooling water. Run aqua-wasted tips for greener habits.', C.cyan));
}

function uninstall() {
  const settings = readJson(SETTINGS, {});
  if (settings === undefined) {
    console.error('aqua-wasted: could not parse ' + SETTINGS + '. Remove the statusLine block manually.');
    process.exit(1);
  }
  const cfg = readJson(CONFIG, {}) || {};
  const sl = settings.statusLine;
  if (sl && sl.command && isOurCommand(sl.command)) {
    if (cfg.chain) {
      settings.statusLine = { type: 'command', command: cfg.chain };
      console.log('Restored your previous statusLine.');
    } else {
      delete settings.statusLine;
      console.log('Removed the aqua-wasted statusLine.');
    }
    atomicWrite(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  } else {
    console.log('No aqua-wasted statusLine found in settings. Nothing changed.');
  }
  try {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  } catch (e) {
    // leave it; not fatal
  }
  console.log(paint('✓ Done. Your settings backups (.bak-*) were kept.', C.green));
}

function status() {
  const cfg = readJson(CONFIG, undefined);
  const settings = readJson(SETTINGS, {});
  const installed =
    settings && settings.statusLine && isOurCommand(settings.statusLine.command || '');
  console.log('aqua-wasted status');
  console.log('  installed: ' + (installed ? 'yes' : 'no'));
  if (cfg) {
    console.log('  tier:      ' + cfg.tier);
    console.log('  unit:      ' + cfg.unit);
    console.log('  bottles:   ' + cfg.bottles);
    console.log('  chained:   ' + (cfg.chain ? 'yes' : 'no'));
  }
  console.log('  config:    ' + CONFIG);
}

// Walk ~/.claude/projects for every transcript and sum lifetime tokens.
function lifetimeTotals() {
  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let files = 0;
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        files++;
        const t = core.sumTokensFromTranscript(full);
        totals.input += t.input;
        totals.cacheCreation += t.cacheCreation;
        totals.cacheRead += t.cacheRead;
        totals.output += t.output;
      }
    }
  }
  walk(PROJECTS_DIR);
  return { totals: totals, files: files };
}

function card(argv) {
  const flags = parseFlags(argv);
  const saved = readJson(CONFIG, {}) || {};
  const cfg = Object.assign({}, core.DEFAULT_CONFIG, saved, {
    tier: flags.tier || saved.tier || core.DEFAULT_CONFIG.tier,
    unit: flags.unit || 'auto',
  });
  const res = lifetimeTotals();
  const ml = core.computeWaterMl(res.totals, cfg.tier);
  const liters = ml / 1000;
  const bottles = Math.round(ml / core.BOTTLE_ML);
  const showers = Math.round(liters / 70); // a typical shower is roughly 70 liters
  const bathtubs = Math.round(liters / 250); // a full bathtub is roughly 250 liters
  const tokens =
    res.totals.input + res.totals.cacheCreation + res.totals.cacheRead + res.totals.output;
  const nf = (n) => core.formatNumber(n, 0, cfg.locale);

  // A rough thirst gauge on a log scale: one liter is empty, a million is full.
  const frac = Math.max(0, Math.min(1, Math.log10(Math.max(liters, 1)) / 6));
  const width = 24;
  const filled = Math.round(frac * width);
  const meter = '▓'.repeat(filled) + '░'.repeat(width - filled);
  const rule = '  ' + '─'.repeat(46);

  console.log('');
  console.log('  ' + paint('💧  aqua-wasted', C.bold + C.cyan) + paint('  lifetime water report', C.dim));
  console.log(rule);
  console.log('  thirst meter   ' + paint(meter, C.blue) + '  ' + paint('(' + thirstLabel(frac) + ')', C.dim));
  console.log('');
  console.log('  sessions       ' + paint(nf(res.files), C.bold));
  console.log('  tokens burned  ' + paint(nf(tokens), C.bold));
  console.log('  water wasted   ' + paint(core.formatWater(ml, cfg.unit, cfg.locale), C.bold + C.cyan));
  console.log('');
  console.log('  🍶 ' + nf(bottles) + ' bottles    🚿 ' + nf(showers) + ' showers    🛁 ' + nf(bathtubs) + ' bathtubs');
  console.log(rule);
  console.log('  ' + paint('Fresh water is finite and AI is thirsty.', C.cyan));
  console.log('  Reuse one session, pick smaller models for small jobs,');
  console.log('  and let idle sessions rest. Run ' + paint('aqua-wasted tips', C.green) + ' for more.');
  console.log('  ' + paint('arxiv.org/abs/2304.03271 · water.org', C.dim));
  console.log('  ' + paint(cfg.tier + ' tier, a rough estimate. github.com/mehdev67/aqua-wasted', C.dim));
  console.log('');
}

function tips() {
  console.log('');
  console.log('  ' + paint('💧 Sustainable vibecoding', C.bold + C.cyan));
  console.log('  A few habits that cut the cooling water your AI use burns:');
  console.log('');
  console.log('    ' + paint('•', C.cyan) + ' Reuse one session so caching works, instead of restarting often');
  console.log('    ' + paint('•', C.cyan) + ' Pick a smaller model for small or routine tasks');
  console.log('    ' + paint('•', C.cyan) + ' Avoid regenerating the same output again and again');
  console.log('    ' + paint('•', C.cyan) + ' Batch related questions together rather than one by one');
  console.log('    ' + paint('•', C.cyan) + ' Close idle sessions so nothing keeps running for nothing');
  console.log('');
  console.log('  Every token is a sip of cooling water. Real sources worth reading:');
  console.log('    ' + paint('Making AI Less Thirsty', C.green) + '   arxiv.org/abs/2304.03271');
  console.log('    ' + paint('water.org', C.green) + '  ·  ' + paint('unwater.org', C.green));
  console.log('');
}

function help() {
  console.log('aqua-wasted: turn your Claude Code token usage into water wasted.');
  console.log('');
  console.log('Usage:');
  console.log('  npx aqua-wasted install [--spicy|--conservative] [--unit=ml|dl|L|auto] [--no-bottles] [--no-chain]');
  console.log('  npx aqua-wasted uninstall');
  console.log('  npx aqua-wasted status');
  console.log('  npx aqua-wasted card [--unit=L]');
  console.log('  npx aqua-wasted tips');
  console.log('');
  console.log('Install drops the statusline into ~/.claude/aqua-wasted/ and wires settings.json.');
  console.log('If you already have a statusLine, it is chained, not replaced.');
}

// --- dispatch ---------------------------------------------------------------

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'install':
    install(rest);
    break;
  case 'uninstall':
  case 'remove':
    uninstall();
    break;
  case 'status':
    status();
    break;
  case 'card':
    card(rest);
    break;
  case 'tips':
    tips();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    help();
    break;
  default:
    console.error('aqua-wasted: unknown command "' + cmd + '"');
    help();
    process.exit(1);
}
