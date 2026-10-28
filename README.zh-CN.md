# codex-auto

[English](README.md)

用多个 ChatGPT 账号运行 `codex exec`：某个账号额度用完时，自动切换到下一个。

## 初衷

让 Claude Code 之类的 agent 调用 Codex 时，一旦账号额度用完，agent 会浪费很多轮对话去读报错、重试，或者让你重新登录。codex-auto 把这些处理从对话里拿掉：

- 一条命令，按顺序尝试各个账号；
- 额度错误在脚本内部静默处理；
- agent 只看到最终回复，看不到冗长的运行日志。

## 原理

- Codex 的登录凭证按 `CODEX_HOME` 保存，codex-auto 给每个账号各建一个 `CODEX_HOME`。
- `run` 使用第一个不在冷却期的账号。遇到额度错误就记录冷却时间（解析「try again in ...」，解析不到则按 1 小时），然后换下一个账号重试。
- 重试时会在提示词前加一段说明：上次任务被中断，请先看 `git status`/`git diff`，保留已完成的部分，只做没做完的。
- 与额度（或登录）无关的错误会直接停止，不会因为一个真正的 bug 把所有账号都试一遍。

| 结果 | 输出 | 退出码 |
|---|---|---|
| 成功 | 只有 Codex 的最终回复 | 0 |
| 账号全部用完 | 一行 `CODEX_AUTO_EXHAUSTED ...`，含最早恢复时间 | 75 |
| 其他失败 | `CODEX_AUTO_FAILED`、日志末 15 行、日志路径 | Codex 的退出码 |

完整日志写在 `<数据目录>/logs/`。

## 环境要求

Node.js 18+，以及已安装的 [Codex CLI](https://github.com/openai/codex)（`codex` 在 `PATH` 中）。

## 安装与登录

```bash
git clone https://github.com/Mingyang-Sheep/codex-auto-repo.git
cd codex-auto-repo

node codex-auto.mjs login a        # 打开浏览器，登录账号 A
node codex-auto.mjs login b        # 账号 B
node codex-auto.mjs status         # 显示各账号邮箱与状态
```

账号按名称排序（`a` 先于 `b`），请按优先级命名。

**两次登录打开的都是同一个浏览器、同一个账号？** Codex 会打开系统默认浏览器。第二个账号请用设备码登录，把终端里的网址复制到登录了该账号的浏览器中打开：

```powershell
# PowerShell
$env:CODEX_HOME = "$HOME\.codex-auto\accounts\b"; codex login --device-auth; Remove-Item Env:CODEX_HOME
```
```bash
# bash / zsh
CODEX_HOME=~/.codex-auto/accounts/b codex login --device-auth
```

之后确认 `status` 显示的是两个不同的邮箱。

## 使用

```bash
node codex-auto.mjs run -- "重构 utils.py 并运行测试"
node codex-auto.mjs run -s workspace-write -C ./myproject -- "修复失败的测试"
cat prompt.txt | node codex-auto.mjs run          # 长提示词用标准输入
```

脚本自带的选项：`--prefer <name>`（优先使用该账号，例如把两个任务并行分给不同账号）、`--effort medium|high|xhigh`、`--max`（等同 `xhigh`）。推理强度不会低于 `medium`。其余 `--` 之前的参数原样传给 `codex exec`。除非你自己传了，否则会自动加上 `--skip-git-repo-check`。

其他命令：`status`（账号与冷却状态）、`reset [name]`（清除冷却）、`login <name>`。

## 让 agent 使用

把 [`CLAUDE-snippet.md`](CLAUDE-snippet.md) 的内容粘贴到 `CLAUDE.md` / `AGENTS.md`（改好路径）。它会要求 agent 一律通过 codex-auto 调用 Codex、不要读日志，并在退出码 75 时停止调用。

## 配置

| 环境变量 | 含义 | 默认值 |
|---|---|---|
| `CODEX_AUTO_DIR` | 账号、状态、日志的存放目录 | `~/.codex-auto` |
| `CODEX_AUTO_MODEL` | 所有调用使用的模型（不设则用 Codex 默认） | 未设置 |
| `CODEX_AUTO_EFFORT` | 默认推理强度 | `medium` |
| `CODEX_AUTO_ACCOUNTS` | 显式指定账号，`name=path;name=path` | `<目录>/accounts` 下所有文件夹 |

## 局限

- 会话不会在账号之间转移；新账号只能凭工作区当前状态和上面那段说明继续，建议在 git 仓库中使用。
- 额度判断依赖匹配 Codex 的报错文字。如果以后版本改了措辞，会显示为 `CODEX_AUTO_FAILED`；欢迎带着日志提 issue，或自行修改脚本里的 `QUOTA_RE`。
- 为了能在任何目录使用，默认开启了 `--skip-git-repo-check`；想恢复 Codex 的这道检查，请自行管理参数。

## 安全与条款

- `accounts/*/auth.json` 等同于密码。默认存放在本仓库之外，切勿提交或同步；`.gitignore` 已将其排除。
- 请使用你自己的账号并遵守 OpenAI 的使用条款，不要用它大规模绕过限制。
- 非官方项目，与 OpenAI、Anthropic 无关。

## 许可证

MIT
