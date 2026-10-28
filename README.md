# codex-auto

[中文](README.zh-CN.md)

Run `codex exec` across several ChatGPT accounts. When one hits its usage limit, the next one takes over automatically.

## Why

When an agent such as Claude Code delegates work to Codex and the account runs out of quota, the agent wastes turns reading errors, retrying, or asking you to log in again. codex-auto moves that handling out of the conversation:

- one command, accounts are tried in order;
- quota errors are handled silently inside the script;
- the agent only sees the final answer, never the streaming log.

## How it works

- Codex keeps its credentials per `CODEX_HOME`. codex-auto keeps one `CODEX_HOME` per account.
- `run` uses the first account that is not cooling down. On a quota error it records a cooldown (parsed from "try again in ...", otherwise 1 hour) and retries on the next account.
- The retry prompt tells Codex that an earlier attempt was cut off, to check `git status`/`git diff`, keep finished work, and do only what is missing.
- Errors that are not about quota (or login) stop immediately, so a real bug does not burn every account.

| Result | Output | Exit code |
|---|---|---|
| success | Codex's final message only | 0 |
| all accounts out | one line `CODEX_AUTO_EXHAUSTED ...` with the earliest recovery time | 75 |
| other failure | `CODEX_AUTO_FAILED`, last 15 log lines, log path | Codex's code |

Full logs are written to `<data dir>/logs/`.

## Requirements

Node.js 18+ and the [Codex CLI](https://github.com/openai/codex) (`codex` on your `PATH`).

## Setup

```bash
git clone <this repo> && cd codex-auto

node codex-auto.mjs login a        # opens the browser, sign in with account A
node codex-auto.mjs login b        # account B
node codex-auto.mjs status         # shows each account's email and state
```

Accounts are ordered by name (`a` before `b`), so name them by priority.

**Both logins opened the same browser/account?** Codex opens your default browser. For the second account use device login and open the printed URL in whichever browser holds that account:

```powershell
# PowerShell
$env:CODEX_HOME = "$HOME\.codex-auto\accounts\b"; codex login --device-auth; Remove-Item Env:CODEX_HOME
```
```bash
# bash / zsh
CODEX_HOME=~/.codex-auto/accounts/b codex login --device-auth
```

Then confirm `status` shows two different emails.

## Use

```bash
node codex-auto.mjs run -- "refactor utils.py and run the tests"
node codex-auto.mjs run -s workspace-write -C ./myproject -- "fix the failing test"
cat prompt.txt | node codex-auto.mjs run          # long prompts via stdin
```

Everything before `--` is passed to `codex exec`. `--skip-git-repo-check` is added unless you pass it yourself.

Other commands: `status` (accounts and cooldowns), `reset [name]` (clear cooldowns), `login <name>`.

## Use it from an agent

Paste [`CLAUDE-snippet.md`](CLAUDE-snippet.md) into your `CLAUDE.md` / `AGENTS.md` (adjust the path). It tells the agent to always go through codex-auto, not to read logs, and to stop on exit code 75.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `CODEX_AUTO_DIR` | where accounts, state and logs live | `~/.codex-auto` |
| `CODEX_AUTO_ACCOUNTS` | explicit accounts, `name=path;name=path` | every folder in `<dir>/accounts` |

## Limitations

- A session is not transferred between accounts; the next account restarts from the workspace state plus the note above. Work in a git repository for best results.
- Quota detection matches Codex's error text. If a future Codex version words it differently, the failure shows up as `CODEX_AUTO_FAILED`; open an issue with the log and adjust `QUOTA_RE` in the script.
- `--skip-git-repo-check` is on by default so it works anywhere; pass your own options if you want Codex's safety check back.

## Security and terms

- `accounts/*/auth.json` is as sensitive as a password. It lives outside this repository by default; never commit or sync it. `.gitignore` already excludes it.
- Use accounts you own and follow OpenAI's terms of use. This is not a tool for circumventing limits at scale.
- Unofficial; not affiliated with OpenAI or Anthropic.

## License

MIT
