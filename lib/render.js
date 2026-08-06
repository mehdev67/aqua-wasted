'use strict';

// Painting the timer line. The main timer sits in a pale mint white so it reads
// as calm and separate. Live agents get a violet gradient, and the two tracks are
// told apart by shape as well as by hue, so the line still works in a terminal
// that cannot do gradients at all.

const SUBAGENT_FROM = '#7C3AED';
const SUBAGENT_TO = '#C4B5FD';
const CLI_FROM = '#7C3AED';
const CLI_TO = '#F0ABFC';
const MAIN_COLOR = '#D8F5E3';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function colorMode(env) {
  const e = env || process.env;
  if (/truecolor|24bit/i.test(e.COLORTERM || '')) return 'truecolor';
  if (/256/.test(e.TERM || '')) return '256';
  if (e.NO_COLOR) return 'none';
  return 'basic';
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function to256(r, g, b) {
  const q = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function fg(r, g, b, mode) {
  if (mode === 'truecolor') return '\x1b[38;2;' + r + ';' + g + ';' + b + 'm';
  if (mode === '256') return '\x1b[38;5;' + to256(r, g, b) + 'm';
  return '';
}

function solid(text, hex, mode) {
  if (mode === 'none') return text;
  if (mode === 'basic') return '\x1b[32m' + text + RESET;
  const [r, g, b] = hexToRgb(hex);
  return fg(r, g, b, mode) + text + RESET;
}

// Interpolates per character. Whitespace keeps the previous colour so the escape
// count stays sane and the ramp still reads as continuous.
function gradient(text, fromHex, toHex, mode) {
  if (mode === 'none') return text;
  if (mode === 'basic') return '\x1b[35m' + text + RESET;
  const a = hexToRgb(fromHex);
  const b = hexToRgb(toHex);
  const n = Math.max(1, text.length - 1);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const t = i / n;
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    out += fg(r, g, bl, mode) + text[i];
  }
  return out + RESET;
}

// ---------------------------------------------------------------------------
// Names and durations

function claudeModelName(id) {
  if (!id) return '…';
  let s = String(id).replace(/^claude-/, '');
  const oneM = /\[1m\]/i.test(s);
  s = s.replace(/\[1m\]/i, '');
  s = s.replace(/-\d{8}$/, ''); // drop the training date suffix
  const parts = s.split('-').filter(Boolean);
  const family = parts.shift() || '';
  const version = parts.join('.');
  let out = family.charAt(0).toUpperCase() + family.slice(1);
  if (version) out += ' ' + version;
  if (oneM) out += ' 1M';
  return out;
}

function cliModelName(tool, model) {
  if (!model) return tool;
  let s = String(model);
  s = s.replace(/^gpt-/, '');
  s = s.replace(/^kimi-code\//, '');
  s = s.replace(/^k(\d)/, 'K$1');
  s = s.replace(/-mini$/, ' Mini').replace(/-nano$/, ' Nano');
  return s;
}

function agentTypeName(t) {
  if (!t) return 'agent';
  const s = String(t).replace(/-purpose$/, '');
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}

function fmtElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + 's';
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + 'm' + String(r).padStart(2, '0') + 's';
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + 'h' + String(m).padStart(2, '0') + 'm';
}

function fmtRemaining(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return Math.max(5, Math.ceil(s / 5) * 5) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round((s / 3600) * 10) / 10 + 'h';
}

// The forecast is a median, never a promise, so it is always marked with a tilde
// and it never counts down to a lying zero.
function forecastText(elapsed, median, withWord) {
  if (median == null) return '';
  const left = median - elapsed;
  if (left <= 0) return 'drar över';
  return '~' + fmtRemaining(left) + (withWord ? ' kvar' : '');
}

// ---------------------------------------------------------------------------

function renderLine(model, opts) {
  const mode = opts && opts.colorMode ? opts.colorMode : colorMode();
  const maxChips = (opts && opts.maxChips) || 3;
  const parts = [];

  if (model.main) {
    const body = '⏱ ' + fmtElapsed(model.main.elapsed);
    const fc = model.main.active ? forecastText(model.main.elapsed, model.main.median, true) : '';
    const text = fc ? body + ' ' + fc : body;
    parts.push(model.main.active ? solid(text, MAIN_COLOR, mode) : DIM + text + RESET);
  }

  const chips = model.chips || [];
  for (const chip of chips.slice(0, maxChips)) {
    const shape = chip.track === 'cli' ? '◇' : '◆';
    const fc = forecastText(chip.elapsed, chip.median, false);
    let text = shape + ' ' + chip.label + '  ' + fmtElapsed(chip.elapsed);
    if (fc) text += ' ' + fc;
    parts.push(
      chip.track === 'cli'
        ? gradient(text, CLI_FROM, CLI_TO, mode)
        : gradient(text, SUBAGENT_FROM, SUBAGENT_TO, mode)
    );
  }

  const overflow = chips.length - maxChips;
  if (overflow > 0) parts.push(DIM + '+' + overflow + RESET);

  return parts.join('    ');
}

module.exports = {
  colorMode,
  gradient,
  solid,
  claudeModelName,
  cliModelName,
  agentTypeName,
  fmtElapsed,
  fmtRemaining,
  forecastText,
  renderLine,
  SUBAGENT_FROM,
  SUBAGENT_TO,
  CLI_FROM,
  CLI_TO,
  MAIN_COLOR,
};
