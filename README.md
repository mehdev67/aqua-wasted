# aqua-wasted 💧

Every token your AI burns runs in a data center that drinks fresh water to stay cool. **aqua-wasted** puts that hidden cost right in your Claude Code statusline, so you watch it climb while you work.

```
⬆ /build │ Opus 4.7 │ myproject  💧 Aqua wasted 2 130 ml (≈ 4 bottles)
```

It is a fun, slightly guilty little awareness tool. The number is real enough to make you think, and grounded in published research (sources below).

## Install

One command, zero dependencies. Claude Code already ships Node, so this just works.

```bash
npx aqua-wasted install
```

That drops a tiny script into `~/.claude/aqua-wasted/` and wires your `~/.claude/settings.json`. Then run `/statusline` in Claude Code or start a new session.

Already have a statusline? aqua-wasted detects it and runs it first, then appends the water segment after it. Your line is kept, not replaced.

Want it scarier or quieter:

```bash
npx aqua-wasted install --spicy          # bigger numbers, still under the studied maximum
npx aqua-wasted install --conservative   # honest figures for modern efficient models
npx aqua-wasted install --unit=dl         # ml is the default, dl and L also work
npx aqua-wasted install --no-bottles      # drop the bottle count
```

## Uninstall

```bash
npx aqua-wasted uninstall
```

This restores the statusline you had before, or removes ours if there was none. Your settings are backed up to `settings.json.bak-<timestamp>` on every install, just in case.

## The lifetime water report

See the total water across every session you have ever run:

```bash
npx aqua-wasted card --unit=L
```

```
  💧  aqua-wasted  lifetime water report
  ──────────────────────────────────────────────
  thirst meter   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  (parched)

  sessions       3,830
  tokens burned  9,035,044,404
  water wasted   230,476 L

  🍶 460,953 bottles    🚿 3,293 showers    🛁 922 bathtubs
  ──────────────────────────────────────────────
  Fresh water is finite and AI is thirsty.
```

## How the number works

Token usage is summed straight from your Claude Code session transcript, so it reflects everything the session has actually generated and read. Generating tokens costs far more water than reading context, so output and input tokens are weighted separately. Three tiers ship in the box:

| Tier | output token | input token | basis |
|------|--------------|-------------|-------|
| conservative | 0.01 ml | 0.002 ml | modern, efficient 2025 models |
| headline (default) | 0.03 ml | 0.0075 ml | maps 1:1 to the UC Riverside figures |
| spicy | 0.1 ml | 0.025 ml | GPT 4 era, hot region, still below the studied maximum |

Edit `~/.claude/aqua-wasted/config.json` any time to change tier, unit, label, emoji, or color.

## True comparisons you can quote

- A 100 word AI email pours out about a bottle of water (519 ml), straight from the UC Riverside and Washington Post reporting.
- Roughly 16,500 generated tokens drink one 500 ml bottle.
- One million tokens is about 30 liters, two full kitchen sinks.
- A heavy coding week of around 2.5 million tokens is about 75 liters, one full shower.
- Training GPT 3 once evaporated 700,000 liters of clean freshwater, before anyone typed a single prompt.

## Why this exists

AI feels weightless. You type, it answers, nothing visibly leaves the room. But every answer runs in a data center that pulls fresh water through cooling towers, and freshwater is one of the few resources we cannot manufacture more of. The cost is real, it is just invisible. aqua-wasted makes it visible, right where you already look a hundred times a day.

The goal is not guilt. It is awareness, and a small nudge toward what you could call sustainable vibecoding: getting the same work done while drinking a little less of the planet.

## Sustainable vibecoding

A few habits genuinely cut the water your AI use burns:

- Reuse one session so caching works, instead of restarting often.
- Pick a smaller model for small or routine tasks.
- Avoid regenerating the same output again and again.
- Batch related questions together rather than one by one.
- Close idle sessions so nothing keeps running for nothing.

Print these any time:

```bash
npx aqua-wasted tips
```

We did not invent the science here, and we point you at the people who did rather than rephrasing them. Worth your time:

- Making AI Less Thirsty, UC Riverside. https://arxiv.org/abs/2304.03271
- water.org, on the global water crisis. https://water.org
- UN Water. https://www.unwater.org

## Honest disclaimer

These water figures are rough, illustrative estimates. Actual water use per token varies enormously by model, data center location, cooling technology, electricity grid, and season, easily by ten times or more, and includes both the on site cooling water and the water used to generate the electricity. They are meant to raise awareness of a real but hard to pin down cost, not to be a precise measurement.

Primary sources:

- Li, Yang, Islam, Ren. "Making AI Less Thirsty." UC Riverside, 2023, peer reviewed in Communications of the ACM, 2025. https://arxiv.org/abs/2304.03271
- Washington Post, "AI is exhausting the power grid," September 2024.
- Epoch AI, "How much energy does ChatGPT use?", 2025.

## Use as a Claude Code plugin

Prefer the plugin browser:

```
/plugin marketplace add mehdev67/aqua-wasted
/plugin install aqua-wasted@aqua-wasted
```

Then run the bundled command to wire it up:

```
/aqua-wasted
```

## License

MIT. Use it, fork it, make the planet a tiny bit more visible.
