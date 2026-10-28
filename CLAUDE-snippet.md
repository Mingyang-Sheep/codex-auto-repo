## Delegating to Codex

Always call Codex through codex-auto, never `codex` directly:

    node /path/to/codex-auto.mjs run [codex exec options] -- "prompt"

(For long prompts, pipe them on stdin instead of using `--`.)

- It switches ChatGPT accounts by itself when one runs out of quota. Do nothing about quota yourself.
- It prints only Codex's final message. Do not read its log files unless the output starts with `CODEX_AUTO_FAILED`.
- Exit code 75 / output starting with `CODEX_AUTO_EXHAUSTED` means every account is out. Stop delegating to Codex, tell the user the recovery time shown, and do not retry or poll.
- Put the whole task in one prompt (files, goal, acceptance check) rather than many tiny calls.
