# backe 🍑

> [!NOTE]
> **Early release (0.x).** Formats and commands may still change; the on-disk
> format is versioned (spec §2.15.3).

**A git-based backlog for 🧑🏻‍🦰 humans and 🤖 agents.** Issues live as plain Markdown files
in their own Git repository. Every change is a signed commit, attributable to
exactly one identity — human or agent. Several agents can work the same backlog in
parallel without merge-conflict hell, and no issue can be claimed by two of them at
once.

## Why

Issues belong where code and agents already work: in files, in Git, editable by
hand, readable by machines, distributed with a plain `git push`. An agent that is
told "work through sprint X" should be able to figure out on its own which issue
comes next, who owns it, and where the matching repository lives on disk.

Tools in this space exist — git-bug, Backlog.md and beads among them. backe sets
itself apart through the **combination** of:

- **a separate backlog repo** — the backlog is its own Git repository, not a folder
  inside your code repo; backe knows several backlogs and an active one, much like
  `kubectl` contexts;
- **context resolution** — backlog, user, project, sprint and repo are resolved from
  flags, env, project config files and the current directory, so `backe next`
  does the right thing wherever you (or your agent) stand;
- **signatures** — every write is an SSH-signed Git commit, verified against a trust
  anchor and the user registry as it stood at the parent commit;
- **claim semantics for multi-agent work** — claiming an issue is a synchronous
  write with exactly one winner per issue across all syncing clients.

## Design in a nutshell

- **One entity, one file.** Markdown with YAML frontmatter for issues, users,
  projects, sprints, repos and comments; JSONC for configuration.
- **Minimal diffs.** Canonical serialization, no `updated` field, no counters —
  two agents changing different fields of the same issue don't collide.
- **Random IDs** like `bk-7f3k2` instead of sequential numbers, so offline creation
  never clashes. Short prefixes work like Git short hashes.
- **Local-first writes, background sync.** Each command is one operation recorded
  as intent; on sync, local operations are _replayed_ against the remote state with
  full validation instead of rebased as text.
- **Token-frugal output.** Compact JSON, `--fields`, stable exit codes, comments
  only on request — "what's my next issue?" must not cost thousands of tokens.
- **Two doors, one service layer.** A CLI for humans and scripts, an MCP server
  for agents.

An issue on disk:

```markdown
---
id: bk-7f3k2
title: SSO login breaks after token refresh
state: in_progress
creator: spw
assignee: claude-1
projects: [web/auth]
sprints: [2026-w47]
repos: [webapp@feat/sso]
created: 2026-11-18T10:04:00Z
---
After the access token refresh the user lands on `/login` again.
```

## Install

```sh
npm install -g backe
backe doctor            # checks the requirements below
```

Requirements: Node.js ≥ 26, Git ≥ 2.38 with SSH signing support, `ssh-keygen`.
Optional: `git-lfs` (large attachments) and `gh` (`repo check --remote`).

backe is not on npm yet; the first release is pending. Until then, build from
source (see [Development](#development)).

## Quickstart

You need an SSH key (the default is `~/.ssh/id_ed25519.pub`; pass `--key` for
another one) and an empty Git remote for the backlog. `backe init` signs the
trust anchor with your key and pushes it.

```sh
backe config set user alice     # your handle (or BACKE_USER=alice, or --as alice per call)
backe init acme-backlog --name acme --prefix bk --remote git@github.com:acme/backlog.git
cd acme-backlog

backe project create web -t "Web"
backe project create web/auth -t "Authentication"
backe sprint create 2026-w47 -t "Week 47"

ID=$(backe new -t "SSO login breaks after token refresh" -p web/auth -s 2026-w47)
backe ls
backe show "$ID"
backe issue move "$ID" review --reason "PR is up"   # short form: backe mv
backe sync                                          # normally happens in the background
backe verify                                        # signatures and rights since the anchor
```

An agent asks for work and owns it in one step:

```sh
backe next --sprint 2026-w47 --claim
```

Claiming is synchronous with the remote: exactly one client wins each issue.

## For agents: MCP

`backe mcp` starts an MCP server over stdio. It is a thin adapter over the same
services as the CLI, and every tool returns the JSON of the matching
`--format json` command. It needs a resolvable identity (handle and key) and a
backlog, exactly like the CLI; otherwise it exits with code 2 and an explanation
on stderr.

Client entry (the generic `mcpServers` format):

```json
{
  "mcpServers": {
    "backe": { "command": "backe", "args": ["mcp"] }
  }
}
```

With Claude Code: `claude mcp add backe -- backe mcp`. Pass `--as <handle>` or
`-B <backlog>` after `mcp` to pin identity or backlog; `--allow-delete`
additionally registers `issue_delete`. The tool list (`issue_list`,
`issue_claim`, `issue_next`, `sync_now`, …) is in §2.19 of
[`docs/proposals/backe.md`](docs/proposals/backe.md).

## The name

**back-e** is the Germanized, personified short form of "backlog" — the way German
turns a name into a nickname by clipping it and adding an _-e_. Say it like
_back-eh_. As a bonus, _Backe_ is German for "cheek", and _backe!_ means "bake!" 🥐

## Where it comes from

I built backe because I needed it. My daily work is orchestrating coding agents
and myself on the same codebases, and I wanted one system in which humans and
agents coordinate through issues — signed, versioned, offline-capable, without a
server in the middle. Nothing I found fit, so I made my own tool, which is about
the oldest reason there is to start an 🔓⛓️‍💥 open-source project.

backe is 👾 **entirely vibe-coded**: AI agents write every line of code and test.
The technical direction is human — the spec, the architecture, the milestone cuts,
the reviews and every decision come from a long-time engineer (that's me).
It is also a working experiment in how far that combination carries.

## Status

| Milestone | Scope                                                                  | State       |
| --------- | ---------------------------------------------------------------------- | ----------- |
| M1        | scaffold, `core`, `store` — entities, formats, canonical serialization | done        |
| M2        | operations, state model, dependency graph (`ops`)                      | done        |
| M3        | configs and context resolution                                         | done        |
| M4        | Git layer, signed write path, verify, quarantine                       | done        |
| M5a       | services and CLI core — issues, comments, projects, output formats     | done        |
| M5b       | attachments, repo checks, hand-edit commits, batch, doctor, config     | done        |
| M6        | sync, replay, claim                                                    | done        |
| M7        | MCP server                                                             | done        |
| M8        | release                                                                | in progress |

## For contributors (and curious humans)

- **The spec is binding:** [`docs/proposals/backe.md`](docs/proposals/backe.md).
  When this README and the spec disagree, the spec wins.
- **Implementation plans** per milestone live in
  [`docs/superpowers/plans/`](docs/superpowers/plans/); the overall plan is
  `2026-11-18-backe-gesamtplan.md`.
- **Layers:** `core` → `store` → `context` / `git` → `ops` → `services` →
  `cli` / `mcp`. Dependencies point downward only.
- **Done means green:** `mise run check` (lint, build, tests with coverage gates)
  passes on Linux and macOS.
- **Language:** spec, plans and commit messages are written in German.

## Development

Requirements: Node.js ≥ 26, pnpm, Git with SSH signing support, `ssh-keygen`.
[mise](https://mise.jdx.dev) installs the pinned Node and pnpm versions.

```sh
git clone https://github.com/spearwolf/backe.git
cd backe
mise install
pnpm install
mise run check          # lint + build + test
```

Single steps: `pnpm run lint`, `pnpm run build`, `pnpm run test`,
`pnpm run gen:schemas` (regenerates the JSON Schemas in `schemas/`).

## Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
[release-please](https://github.com/googleapis/release-please) turns them into a
release PR with the changelog; merging it tags the release, and the workflow
publishes to npm with provenance (trusted publishing, no long-lived token).

## License

[MIT](LICENSE) © 2026 Wolfger Schramm
