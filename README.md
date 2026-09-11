<p align="center">
  <strong>oh-my-tau</strong><br>
  <em>A fork of Oh My Pi that lets a model keep the coding agent it was trained on.</em>
</p>

<p align="center">
  Fork of <a href="https://github.com/can1357/oh-my-pi">Oh My Pi</a> by <a href="https://github.com/can1357">@can1357</a>,
  itself a fork of <a href="https://github.com/badlogic/pi-mono">Pi</a> by <a href="https://github.com/mariozechner">@mariozechner</a>.
</p>

> **Disclaimer:** an AI assistant writes and maintains this document. It is presented as-is.

τ = 2π. Oh My Pi went past Pi, and this goes past Oh My Pi. Everything upstream ships is here; read the
[upstream README](https://github.com/can1357/oh-my-pi#readme) for the agent itself, its providers, tools and configuration.
This page covers only what the fork adds.

## What the fork adds

Frontier models are post-trained against a specific coding agent. Claude Opus 5 and Fable 5.1 learned Claude Code.
GPT-6 Astra and GPT-5.6 Sol learned Codex. Each one has a house style: its own tool names, its own schemas, its own
system prompt. Run those models under a different agent and you are asking them to work in a house they do not know.

This fork lets them keep the house. Under a *harness profile*, omp presents the vendor's surface instead of its own:

| | Claude Code profile | Codex profile |
|---|---|---|
| Models | `claude-opus-5`, `claude-fable-5-1` | `gpt-6-astra`, `gpt-5.6-sol` |
| Tool names | `Read`, `Edit`, `Bash`, `Agent`, `AskUserQuestion`, `WebSearch` | `exec` with its grammar, namespaced `functions` / `collaboration` groups |
| System prompt | the real Claude Code prompt | the real Codex prompt |
| Prompt cache | two breakpoints at 1h, matching the client | unchanged |

Tools with no vendor counterpart are **bridged, not hidden**. `SendMessage`, `ListAgents`, `TaskOutput` and `TaskStop`
map onto omp's `hub`; `spawn_agent` and `wait_agent` map onto `task`. The call executes as the real omp tool and is
recorded under the omp name, so approval policy, renderers, session state and subagent accounting all keep working.
The agent still sees omp's full tool layer. Nothing is taken away to make the costume fit.

Every other model is untouched. The profile is chosen by model lineage, so a Haiku or Gemini session behaves exactly
as it does upstream.

## Install

```sh
git clone https://github.com/AshishKumar4/oh-my-pi.git
cd oh-my-pi
./scripts/install-harness.sh
```

The repository is still named `oh-my-pi` while the rename to `oh-my-tau` is pending; use the URL above until it moves.

The script builds the binary, installs it beside any existing `omp` (backing that one up first), and records the
vendor prompts. It needs `bun`, `cargo`, `git` and `python3`. It records a Claude Code capture if `claude` is on
your PATH, and a Codex capture if `codex` is.

Split the phases with `--build-only` or `--record-only`. Re-run it after upgrading Claude Code or Codex: captures are
keyed by client version, and an older one keeps serving until you refresh it.

## Why the prompts are recorded and not shipped

The vendor system prompts are proprietary text. Committing them would redistribute someone else's copyrighted work,
so this repository contains none of it. The test fixtures store structure only, never prose.

Instead the script records the prompt locally from the client you already license. It starts a loopback recording
gateway, points a real `claude` or `codex` session at it once, and stores what that client sent under
`~/.omp/cache/harness/<profile>/`. Your captures never leave your machine.

Recording binds to loopback only. A capture becomes the system prompt of later sessions, so anything that could reach
the gateway could author them.

## Configuration

| Setting | Effect |
|---|---|
| `OMP_HARNESS_CACHE_DIR` | where captures are read from; point it elsewhere to park them |
| `providers.cacheRetention` | `short` restores 5-minute prompt caching under the profile |
| `skills.ignoredSkills` | drop skills you never use from the prompt |
| `tools.xdevDocs: catalog` | stop inlining `xd://` device docs |

To turn impersonation off without uninstalling, move `~/.omp/cache/harness` aside. Tool renaming and cache framing
follow the profile; the vendor prompt needs a capture.

## Known gaps

- **`Bash.timeout` is in seconds, not milliseconds.** The real Claude Code field is milliseconds. Keeping omp's unit
  is deliberate: a resumed session carries seconds-valued history that a schema description cannot retrain, and a
  silent 1000x-short deadline is worse than one documented divergence.
- **`hub` and `eval` stay visible** under a profile, though no vendor ships them. That is the design: the agent keeps
  omp's full capability rather than a reduced impersonation.
- **The Codex profile has no live inference turn yet.** Its prompt, tool surface and wire shape are verified against
  a real capture at unit and gateway level, but no completion has come back from a profiled Codex request.
- Beta headers diverge from the captured client in both directions. Recorded in the golden fixtures, not fixed.

## Staying current

The fork tracks upstream by merge, not rebase, so `main` here is upstream `main` plus the harness work. Upstream
releases do not reach a from-source install, so re-run the install script to pick up a newer merge.

## Credits and licence

All of the agent is upstream work by [@can1357](https://github.com/can1357) and, before that,
[@mariozechner](https://github.com/mariozechner). The fork adds one feature on top. Licence is unchanged from
upstream; see [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
