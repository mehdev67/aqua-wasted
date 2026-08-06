# Changelog

## 0.2.0

- New optional timer line under the water figure, off by default. Set `"timers": true` in `config.json` to turn it on.
- A main timer for the current turn in pale mint, plus one gradient chip per live agent showing its real model name.
- Two tracks: Claude subagents read from the per agent transcripts, and external CLI runs (Codex, Kimi, Kilo, Qwen) read from the process list.
- Forecasts come from the median of your own past runs, seeded from transcripts already on disk. They are marked as estimates, never shown before three samples exist, and turn into "drar över" instead of counting down to a false zero.
- Falls back from truecolor gradients to 256 colors to plain magenta depending on the terminal.
- The statusline no longer dies with a node stack trace when the pipe closes early.
- The session transcript is now read once per render instead of once per feature.

## 0.1.1

- Redesigned the lifetime card: a thirst meter, bottle, shower, and bathtub comparisons, and color.
- Cleaner install and uninstall output with a clear summary and a green check.
- New `aqua-wasted tips` command with sustainable vibecoding habits and real sources.
- README now carries the awareness story and links to the research and water organizations.

## 0.1.0

- First release. A zero dependency Claude Code statusline that turns token usage into wasted cooling water.
- npx installer that safely patches settings.json with a backup, and chains an existing statusLine instead of replacing it.
- Three scariness tiers grounded in UC Riverside research.
- Lifetime card across all sessions.
- Ships as both an npm package and a Claude Code plugin.
