## Delegating to Codex (two ChatGPT accounts)

Always call Codex through codex-auto, never `codex` directly:

    node /path/to/codex-auto.mjs run [options] -- "prompt"      (long prompts: pipe on stdin instead of `--`)

**Accounts** — codex-auto owns the account juggling. It tries accounts in order (a, then b) and silently moves on when one hits its usage limit. Do nothing about quota yourself, and do not poll `status`.
- Independent sub-tasks that can run at the same time: start them in parallel, one with `--prefer a`, the other with `--prefer b`, in separate files/directories so they do not collide.
- A single task: pass no account flag.

**Model and strength** — the strongest available Codex model is used by default; never pass `-m` with a smaller model. Reasoning effort never goes below medium.
- Normal tasks: no flag (medium).
- Complex work (multi-file refactor, hard debugging, architecture, review/audit): `--effort high`.
- Very large or critical tasks: `--max` (highest).

**How to delegate well**
- Plan and review yourself; hand Codex self-contained, well-specified chunks. Put everything in one prompt (goal, files, constraints, how to verify). Avoid many tiny calls.
- Codex calls can take minutes: run them in the background and wait for completion instead of polling.
- Verify the result yourself (git diff, run the tests) before reporting it as done.

**Output handling** (saves tokens)
- You only get Codex's final message. Do not read log files unless the output starts with `CODEX_AUTO_FAILED`.
- Exit code 75 / `CODEX_AUTO_EXHAUSTED` means both accounts are out: tell the user the recovery time shown, finish the work yourself or wait. Never retry in a loop.
