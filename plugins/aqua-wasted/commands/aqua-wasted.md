---
description: Install or manage the aqua-wasted water statusline
---

You are wiring up the **aqua-wasted** statusline, which turns the user's Claude Code token usage into the cooling water their AI session burns.

Steps:

1. Run `npx aqua-wasted install` in the user's shell. If they passed an argument (`$ARGUMENTS`), forward it, for example `npx aqua-wasted install --spicy` or `npx aqua-wasted card --unit=L`.
2. If the installer reports that an existing statusLine was found and chained, tell the user their old statusline is preserved and ours appends after it.
3. Tell the user to run `/statusline` or start a new session to see it.
4. Mention they can change the scariness tier, unit, label, or color in `~/.claude/aqua-wasted/config.json`, or rerun with `--conservative`, `--spicy`, `--unit=dl`, or `--no-bottles`.

Do not edit `~/.claude/settings.json` by hand. The installer does it safely with a backup.
