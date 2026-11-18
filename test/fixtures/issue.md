---
id: bk-7f3k2
title: SSO-Login bricht nach Token-Refresh ab
state: blocked
blocked_by: [bk-a91c0]
paused_from: in_progress
parent: bk-x2c8d
depends_on: [bk-3m9qa]
rank: 3000
creator: spw
assignee: claude-1
projects: [web/auth]
sprints: [2026-w47]
repos: [webapp@feat/sso, infra@4e1f9c2]
attachments:
  - {name: trace, file: trace.json}
  - {name: figma, url: https://www.figma.com/file/abc123/sso-flow}
created: 2026-11-18T10:04:00Z
props:
  estimate_h: 4
  github_issue: acme/webapp#123
---
Nach dem Refresh des Access-Tokens landet der User wieder auf `/login`.

## Akzeptanzkriterien
- [ ] Refresh hält die Session
