# Codex Instructions

Read `CLAUDE.md` fully before modifying the repository.

`CLAUDE.md` is the primary AI development guide for this project.
Follow all architectural rules, invariants, testing requirements,
documentation conventions, and Git conventions defined there.

Also read the relevant sections of:
- `ARCHITECTURE.md`
- `crush-depth-game-logic-v0.1.md`
- `crush-depth-acceptance-criteria-v0.1.md`

before implementing game-engine, feed, gateway, ledger, or simulation changes.

When project state, architecture, decisions, acceptance criteria, or completed milestones change,
update the relevant existing documentation, including `CLAUDE.md` where appropriate.

Before considering implementation complete:
1. Run `npm test`.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. Review `git diff`.
5. Do not commit or push unless explicitly requested.