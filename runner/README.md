# wd-bid-runner

Version-controlled copy of the Williams Diversified automated bid runner prompt.

- **Live source of truth:** `~/.claude/scheduled-tasks/wd-bid-runner/SKILL.md` on the machine that runs the scheduled task. That is the file the runner actually executes; this repo copy is for backup, review, and sharing.
- **Secret redacted:** every `X-Runner-Secret` value is replaced with the placeholder `<X-RUNNER-SECRET>`. Before running the prompt, substitute the real runner secret (kept in the password manager, never committed here).

To update this copy after editing the live file, re-copy it and re-apply the placeholder substitution.
