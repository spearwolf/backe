# backe 🍑

> [!WARNING]
> **Experimental — work in progress.** backe is not usable yet. The data model,
> file formats, signatures, verification and the signed write path exist and are
> tested; the CLI is still an empty shell, and sync, claim and the MCP server are
> not built. Formats, commands and everything else may change without notice.

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

Planned usage (**not implemented yet**):

```sh
backe init --name acme --prefix bk
backe new -t "SSO login breaks after token refresh" -p web/auth -s 2026-w47
backe next --sprint 2026-w47 --claim      # an agent asks for work — and owns it
backe issue move bk-7f3k2 review --reason "PR is up"
```

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

| Milestone | Scope                                                                  | State   |
| --------- | ---------------------------------------------------------------------- | ------- |
| M1        | scaffold, `core`, `store` — entities, formats, canonical serialization | done    |
| M2        | operations, state model, dependency graph (`ops`)                      | done    |
| M3        | configs and context resolution                                         | done    |
| M4        | Git layer, signed write path, verify, quarantine                       | done    |
| M5        | services and CLI                                                       | next    |
| M6        | sync, replay, claim                                                    | planned |
| M7        | MCP server                                                             | planned |
| M8        | release                                                                | planned |

## For agents (and curious humans)

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

## License

[MIT](LICENSE) © 2026 Wolfger Schramm
