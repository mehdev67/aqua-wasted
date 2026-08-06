'use strict';

// Plain node asserts, no framework. Run with: node test/run.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = require('../lib/collect-cli');
const render = require('../lib/render');
const stats = require('../lib/stats');
const claude = require('../lib/collect-claude');
const timers = require('../lib/timers');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-test-'));
}

console.log('\ncollect-cli');

test('parsar etime i alla former', () => {
  assert.strictEqual(cli.parseEtime('00:54'), 54);
  assert.strictEqual(cli.parseEtime('06:07'), 367);
  assert.strictEqual(cli.parseEtime('1:02:03'), 3723);
  assert.strictEqual(cli.parseEtime('18-14:31:49'), 18 * 86400 + 14 * 3600 + 31 * 60 + 49);
  assert.strictEqual(cli.parseEtime('skräp'), 0);
});

test('plockar modell ur codex, kimi och qwen argv', () => {
  assert.strictEqual(cli.extractModel('codex', ' exec -c model="gpt-5.5" -C /x'), 'gpt-5.5');
  assert.strictEqual(cli.extractModel('kimi', ' -m kimi-code/k3 -w /x'), 'kimi-code/k3');
  assert.strictEqual(cli.extractModel('qwen', ' --model qwen3-max -p hej'), 'qwen3-max');
  assert.strictEqual(cli.extractModel('codex', ' exec -p hej'), '');
});

// The exact shape seen on this machine on 2026-08-06, including the duplicate
// wrapper process and the long lived MCP servers that must not count as tasks.
const PS_REAL = [
  '63405       00:54 node /opt/homebrew/bin/codex exec -s danger-full-access -c model="gpt-5.5" -C /Users/mehdi/projects/x Du ar en adversariell granskare',
  '63433       00:54 /opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex exec -s danger-full-access -c model="gpt-5.5" -C /Users/mehdi/projects/x Du ar en adversariell granskare',
  '60367       06:07 node /opt/homebrew/bin/codex mcp-server',
  '60369       06:07 /opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex mcp-server',
  '62622       02:39 node /opt/homebrew/bin/codex mcp-server',
  '70001       01:12 /Users/mehdi/.local/bin/kimi -m kimi-code/k3 -w /Users/mehdi/projects/y --quiet -p granska',
  '70500       00:03 grep -i codex',
].join('\n');

test('slår ihop wrapper och binär till en körning', () => {
  const runs = cli.collect(PS_REAL);
  const codex = runs.filter((r) => r.tool === 'codex');
  assert.strictEqual(codex.length, 1, 'codex ska bli en körning, blev ' + codex.length);
  assert.strictEqual(codex[0].model, 'gpt-5.5');
  assert.strictEqual(codex[0].elapsed, 54);
});

test('utesluter mcp-server som aldrig är en task', () => {
  const runs = cli.collect(PS_REAL);
  assert.ok(!runs.some((r) => r.elapsed === 367), 'mcp-server läckte in som task');
});

test('hittar kimi och dess modell', () => {
  const runs = cli.collect(PS_REAL);
  const kimi = runs.find((r) => r.tool === 'kimi');
  assert.ok(kimi, 'kimi saknas');
  assert.strictEqual(kimi.model, 'kimi-code/k3');
});

test('tom processlista ger inga körningar', () => {
  assert.deepStrictEqual(cli.collect(''), []);
});

test('cachen delar ett ps-svep men låter tiden gå vidare', () => {
  const d = tmpdir();
  const t0 = 1000000;
  fs.writeFileSync(
    path.join(d, 'ps-cache.json'),
    JSON.stringify({ at: t0, runs: [{ pid: 1, tool: 'codex', model: 'gpt-5.5', elapsed: 10 }] })
  );
  const fresh = cli.collectCached(d, t0 + 1000);
  assert.strictEqual(fresh.length, 1);
  assert.strictEqual(fresh[0].elapsed, 11, 'en återanvänd cache ska räkna upp, inte frysa');
  // Past the busy TTL the cache is dropped and a real sweep happens instead.
  const stale = cli.collectCached(d, t0 + cli.CACHE_TTL_BUSY_MS + 1);
  assert.ok(!stale.some((r) => r.pid === 1 && r.elapsed === 10), 'gammal cache ska inte överleva');
});

test('en trasig cache ger ett riktigt svep i stället för krasch', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'ps-cache.json'), 'inte json');
  assert.ok(Array.isArray(cli.collectCached(d, Date.now())));
});

console.log('\nrender');

test('modellnamn blir läsbara', () => {
  assert.strictEqual(render.claudeModelName('claude-opus-5'), 'Opus 5');
  assert.strictEqual(render.claudeModelName('claude-sonnet-5'), 'Sonnet 5');
  assert.strictEqual(render.claudeModelName('claude-opus-4-8'), 'Opus 4.8');
  assert.strictEqual(render.claudeModelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(render.claudeModelName('claude-opus-5[1m]'), 'Opus 5 1M');
  assert.strictEqual(render.claudeModelName(''), '…');
});

test('externa modellnamn blir läsbara', () => {
  assert.strictEqual(render.cliModelName('codex', 'gpt-5.5'), '5.5');
  assert.strictEqual(render.cliModelName('codex', 'gpt-5.4-mini'), '5.4 Mini');
  assert.strictEqual(render.cliModelName('kimi', 'kimi-code/k3'), 'K3');
  assert.strictEqual(render.cliModelName('kimi', 'kimi-code/k2.7'), 'K2.7');
  assert.strictEqual(render.cliModelName('codex', ''), 'codex');
});

test('tidsformat', () => {
  assert.strictEqual(render.fmtElapsed(54), '54s');
  assert.strictEqual(render.fmtElapsed(134), '2m14s');
  assert.strictEqual(render.fmtElapsed(542), '9m02s');
  assert.strictEqual(render.fmtElapsed(3860), '1h04m');
});

test('prognosen ljuger aldrig om noll', () => {
  assert.strictEqual(render.forecastText(100, null, true), '');
  assert.strictEqual(render.forecastText(100, 220, true), '~2m kvar');
  assert.strictEqual(render.forecastText(100, 220, false), '~2m');
  assert.strictEqual(render.forecastText(600, 460, false), 'drar över');
  assert.strictEqual(render.forecastText(460, 460, false), 'drar över');
});

test('gradient färgar varje tecken i truecolor', () => {
  const out = render.gradient('ab', '#000000', '#ffffff', 'truecolor');
  assert.ok(out.indexOf('\x1b[38;2;0;0;0m') === 0, 'första tecknet ska vara startfärgen');
  assert.ok(out.indexOf('\x1b[38;2;255;255;255m') > 0, 'sista tecknet ska vara slutfärgen');
});

test('faller tillbaka utan truecolor', () => {
  assert.strictEqual(render.colorMode({ COLORTERM: 'truecolor', TERM: 'xterm' }), 'truecolor');
  assert.strictEqual(render.colorMode({ TERM: 'xterm-256color' }), '256');
  assert.strictEqual(render.colorMode({ TERM: 'vt100' }), 'basic');
  assert.ok(render.gradient('ab', '#000000', '#ffffff', 'basic').indexOf('\x1b[35m') === 0);
  assert.strictEqual(render.gradient('ab', '#000000', '#ffffff', 'none'), 'ab');
});

test('raden renderar båda spåren och spillet', () => {
  const line = render.renderLine(
    {
      main: { elapsed: 258, active: true, median: 378 },
      chips: [
        { track: 'claude', label: 'Explore · Sonnet 5', elapsed: 134, median: 260 },
        { track: 'claude', label: 'general · Opus 5', elapsed: 542, median: 460 },
        { track: 'cli', label: 'codex · 5.5', elapsed: 54, median: null },
        { track: 'cli', label: 'kimi · K3', elapsed: 12, median: null },
      ],
    },
    { colorMode: 'none', maxChips: 3 }
  );
  assert.ok(line.indexOf('⏱ 4m18s ~2m kvar') !== -1, line);
  assert.ok(line.indexOf('◆ Explore · Sonnet 5  2m14s ~2m') !== -1, line);
  assert.ok(line.indexOf('◆ general · Opus 5  9m02s drar över') !== -1, line);
  assert.ok(line.indexOf('◇ codex · 5.5  54s') !== -1, line);
  assert.ok(line.indexOf('+1') !== -1, 'spillet ska visas');
  assert.ok(line.indexOf('kimi') === -1, 'fjärde chippet ska inte ritas');
});

console.log('\nstats');

test('ingen prognos under tre mätningar', () => {
  const s = { version: 1, samples: {}, seenPids: {} };
  stats.record(s, 'k', 10);
  stats.record(s, 'k', 20);
  assert.strictEqual(stats.forecast(s, 'k'), null);
  stats.record(s, 'k', 30);
  assert.strictEqual(stats.forecast(s, 'k'), 20);
});

test('kastar orimliga mätningar', () => {
  const s = { version: 1, samples: {}, seenPids: {} };
  assert.strictEqual(stats.record(s, 'k', 163237), false, '45 timmar ska kastas');
  assert.strictEqual(stats.record(s, 'k', -5), false);
  assert.strictEqual(stats.record(s, 'k', 0), false);
  assert.ok(!s.samples.k, 'inget ska ha sparats');
});

test('rullande fönster håller sig till 20', () => {
  const s = { version: 1, samples: {}, seenPids: {} };
  for (let i = 0; i < 30; i++) stats.record(s, 'k', i + 1);
  assert.strictEqual(s.samples.k.length, 20);
  assert.strictEqual(s.samples.k[0], 11, 'de äldsta ska ha fallit av');
});

test('pid som försvinner blir en mätning', () => {
  const s = { version: 1, samples: {}, seenPids: {} };
  const now = 1000000;
  stats.observePids(s, [{ pid: 1, key: 'cli:codex:gpt-5.5', elapsed: 10 }], now);
  assert.ok(s.seenPids['1'], 'pid ska ha registrerats');
  stats.observePids(s, [], now + 50000);
  assert.ok(!s.seenPids['1'], 'pid ska ha städats bort');
  assert.deepStrictEqual(s.samples['cli:codex:gpt-5.5'], [60]);
});

test('sparar och läser tillbaka utan att krascha på skräp', () => {
  const d = tmpdir();
  const s = stats.load(d);
  stats.record(s, 'k', 42);
  stats.save(d, s);
  assert.deepStrictEqual(stats.load(d).samples.k, [42]);
  fs.writeFileSync(path.join(d, 'durations.json'), 'inte json alls');
  assert.deepStrictEqual(stats.load(d).samples, {}, 'trasig fil ska ge en ren start');
});

console.log('\ncollect-claude');

function writeTranscript(dir, lines) {
  const p = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
  return p;
}

test('räknar tokens och hittar turstart', () => {
  const d = tmpdir();
  const p = writeTranscript(d, [
    { type: 'user', timestamp: '2026-08-06T10:00:00.000Z', message: { role: 'user', content: 'hej' } },
    {
      type: 'assistant',
      timestamp: '2026-08-06T10:00:10.000Z',
      message: { role: 'assistant', model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 50 }, content: [] },
    },
  ]);
  const s = claude.scanTranscript(p);
  assert.strictEqual(s.totals.input, 100);
  assert.strictEqual(s.totals.output, 50);
  assert.strictEqual(s.turnStartMs, Date.parse('2026-08-06T10:00:00.000Z'));
  assert.strictEqual(s.pendingTools, 0);
});

test('ett verktyg utan svar räknas som pågående', () => {
  const d = tmpdir();
  const p = writeTranscript(d, [
    { type: 'user', timestamp: '2026-08-06T10:00:00.000Z', message: { role: 'user', content: 'hej' } },
    {
      type: 'assistant',
      timestamp: '2026-08-06T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
    },
  ]);
  const s = claude.scanTranscript(p);
  assert.strictEqual(s.pendingTools, 1);
  assert.strictEqual(s.pendingAgents, 0);
});

test('Agent utan svar räknas som levande subagent', () => {
  const d = tmpdir();
  const p = writeTranscript(d, [
    { type: 'user', timestamp: '2026-08-06T10:00:00.000Z', message: { role: 'user', content: 'hej' } },
    {
      type: 'assistant',
      timestamp: '2026-08-06T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: {} }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-08-06T10:00:06.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a2', name: 'Agent', input: {} }] },
    },
    {
      type: 'user',
      timestamp: '2026-08-06T10:01:00.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1' }] },
    },
  ]);
  const s = claude.scanTranscript(p);
  assert.strictEqual(s.pendingAgents, 1, 'en av två agenter ska vara kvar');
});

test('en avbruten tur lämnar ingen evig timer', () => {
  const d = tmpdir();
  const p = writeTranscript(d, [
    { type: 'user', timestamp: '2026-08-06T10:00:00.000Z', message: { role: 'user', content: 'hej' } },
    {
      type: 'assistant',
      timestamp: '2026-08-06T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
    },
    { type: 'user', timestamp: '2026-08-06T10:05:00.000Z', message: { role: 'user', content: 'glöm det' } },
  ]);
  const s = claude.scanTranscript(p);
  assert.strictEqual(s.pendingTools, 0, 'nytt användarvarv ska nolla det som hänger');
  assert.strictEqual(s.turnStartMs, Date.parse('2026-08-06T10:05:00.000Z'));
});

test('sidokedjor räknas inte in i huvudsessionen', () => {
  const d = tmpdir();
  const p = writeTranscript(d, [
    { type: 'user', timestamp: '2026-08-06T10:00:00.000Z', message: { role: 'user', content: 'hej' } },
    {
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-08-06T10:00:05.000Z',
      message: { role: 'assistant', usage: { output_tokens: 999 }, content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] },
    },
  ]);
  const s = claude.scanTranscript(p);
  assert.strictEqual(s.pendingTools, 0);
  assert.strictEqual(s.totals.output, 0, 'subagentens tokens hör inte hemma här');
});

test('saknat transkript ger tomt läge i stället för krasch', () => {
  const s = claude.scanTranscript('/finns/inte/alls.jsonl');
  assert.strictEqual(s.totals.output, 0);
  assert.strictEqual(s.pendingAgents, 0);
});

test('läser start, typ och modell ur en subagentfil', () => {
  const d = tmpdir();
  const p = path.join(d, 'agent-abc.jsonl');
  const bigAttachment = { isSidechain: true, attachment: { type: 'skill_listing', content: 'x'.repeat(9000) } };
  fs.writeFileSync(
    p,
    [
      JSON.stringify({ isSidechain: true, agentId: 'abc', type: 'user', timestamp: '2026-08-06T08:55:24.917Z' }),
      JSON.stringify(bigAttachment),
      JSON.stringify({
        isSidechain: true,
        attributionAgent: 'general-purpose',
        type: 'assistant',
        timestamp: '2026-08-06T09:00:46.280Z',
        message: { role: 'assistant', model: 'claude-opus-4-8' },
      }),
    ].join('\n')
  );
  const info = claude.readAgentFile(p);
  assert.strictEqual(info.startMs, Date.parse('2026-08-06T08:55:24.917Z'));
  assert.strictEqual(info.agentType, 'general-purpose', 'typen ligger sist och måste läsas från svansen');
  assert.strictEqual(info.model, 'claude-opus-4-8');
});

test('struntar i syntetiska modeller', () => {
  const d = tmpdir();
  const p = path.join(d, 'agent-err.jsonl');
  fs.writeFileSync(
    p,
    [
      JSON.stringify({ type: 'user', timestamp: '2026-08-06T08:52:29.807Z' }),
      JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' }, isApiErrorMessage: true }),
    ].join('\n')
  );
  assert.strictEqual(claude.readAgentFile(p).model, '');
});

test('hittar subagentkatalogen ur transkriptvägen', () => {
  assert.strictEqual(
    claude.subagentsDir('/Users/x/.claude/projects/-proj/abc-123.jsonl'),
    '/Users/x/.claude/projects/-proj/abc-123/subagents'
  );
});

console.log('\ntimers');

test('avstängd som standard ger ingen rad alls', () => {
  const out = timers.renderTimers({}, { timers: false }, tmpdir(), timers.scan({}));
  assert.strictEqual(out, '');
});

test('inline-läget lägger inte till en ny rad', () => {
  const d = tmpdir();
  const scanned = { totals: {}, turnStartMs: Date.now() - 60000, lastActivityMs: Date.now(), pendingTools: 1, pendingAgents: 0 };
  const out = timers.renderTimers({ transcript_path: '' }, { timers: true, timersLayout: 'inline' }, d, scanned);
  assert.ok(out.indexOf('\n') === -1, 'inline får aldrig bryta rad');
  assert.ok(out.indexOf('⏱') !== -1);
});

test('en trasig konfiguration tystar timern i stället för att krascha', () => {
  const out = timers.renderTimers(null, { timers: true }, '/finns/inte', null);
  assert.strictEqual(out, '');
});

console.log('\n' + passed + ' tester ok' + (process.exitCode ? ', med fel ovan' : '') + '\n');
