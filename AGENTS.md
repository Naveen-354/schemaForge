# SchemaForge: guide for agents working on this repo

Read this before changing anything. The full product specification is in [prompt.txt](prompt.txt); section numbers below (§N) refer to it. For how the product behaves from a user's point of view, including the end-to-end workflow, read [projectbase.md](projectbase.md). Keep it accurate when you change user-visible behavior.

## Project goal

> **Give me one visual workspace where I can understand databases, work with SQL, and delegate database/software-engineering tasks to multiple AI agents while seeing exactly what those agents are doing.**

SchemaForge is a **personal, local-first** database engineering workspace. It combines a database IDE, a SQL workspace, schema visualization, and a multi-agent control center. It is not a SaaS product and not a chat app with a database attached.

The core model is task- and event-oriented, never "user → chatbot → answer":

```
Workspace → Project → Database → Task → Agent → Tools → Events → Artifacts → Result
```

Chat is only one interface onto tasks. Every agent action is a tool call that passes a permission check, emits events, and may require user approval. Agents hand work to each other through artifacts and task dependencies, not long conversations.

Design priorities (§35, §53): simplicity, low cost, local development, loose coupling, deterministic code before AI calls, explicit handling of destructive operations, and secrets that never reach a model.

## Current state

The first vertical slice from §52 is complete and runnable.

- **Done**: sign-in (email and password accounts, server-side sessions, optional Google and GitHub), workspaces, projects, PostgreSQL + SQLite connections, schema explorer, ER diagram, SQL workspace, NL questions via the assistant, agents, tasks with dependencies, tools, permissions, approvals, artifacts, project knowledge, live event stream, agent dashboard, command palette, global search, usage tracking.
- **Providers**: Anthropic (default `claude-opus-5`), OpenAI-compatible, and an offline deterministic `heuristic` provider. The Anthropic path has **never been run against the live API** because no key was available during development.
- **Tests**: 38 server tests pass: 12 for sign-in in `server/src/__tests__/auth.test.ts` and 10 for Google and GitHub, against simulated providers, in `server/src/__tests__/oauth.test.ts`. There are no web tests and no PostgreSQL adapter tests.

## Run and verify

Requires Node.js 22.5+ (uses built-in `node:sqlite`). Developed on Node 25, Windows.

```bash
npm install
npm test
```

```bash
npm run build
npm start
```

The app serves on http://127.0.0.1:4310. `npm run dev` runs the API on 4310 and Vite on 5173 with a proxy.

Before finishing any change, run all three checks and keep them green:

```bash
npm test
```

```bash
npx tsc --noEmit -p server
```

```bash
npx tsc --noEmit -p web
```

The first start seeds `./data` with a sample SQLite investment database, six agents, knowledge entries and saved queries. Delete `./data` to reset. Deleting it also deletes `data/master.key`, which makes stored secrets unrecoverable.

## Architecture map

| Area | Location | Notes |
|---|---|---|
| Shared domain types | [shared/src/index.ts](shared/src/index.ts) | Single source of truth for server and web types |
| HTTP app | [server/src/app.ts](server/src/app.ts) | `createApp()` wires CORS allowlist, auth middleware and routes; tests call it with `app.request()` |
| Auth | [server/src/auth.ts](server/src/auth.ts), [routes/auth.ts](server/src/routes/auth.ts) | scrypt passwords, hashed session tokens in the `sessions` table, login throttling, `requireAuth`. Google and GitHub identities live in `user_identities`; credentials come from env vars or Settings. Accounts are only linked by connecting while signed in, never merged by email. |
| Account CLI | [server/src/scripts/user.ts](server/src/scripts/user.ts) | `npm run user -- list` and `reset-password` |
| App database | [server/src/store/db.ts](server/src/store/db.ts), [repos.ts](server/src/store/repos.ts) | `node:sqlite`, schema created at startup |
| Events | [server/src/events.ts](server/src/events.ts) | `bus.emitEvent` persists and streams; `bus.notify` tells clients to refetch |
| DB adapters | [server/src/dbs/](server/src/dbs/) | `DbAdapter` interface; `manager.ts` owns connections, history, snapshots |
| SQL analysis | [server/src/sql/](server/src/sql/) | Risk classifier, DDL generator, deterministic schema lint |
| AI providers | [server/src/ai/providers/](server/src/ai/providers/) | `AiProvider` interface; provider code stays isolated here |
| Agent tools | [server/src/agents/tools.ts](server/src/agents/tools.ts) | Each tool declares `risk`, `assess()`, `execute()` |
| Permissions | [server/src/agents/permissions.ts](server/src/agents/permissions.ts) | Workspace → project → agent → task layers, strictest wins |
| Context building | [server/src/agents/context.ts](server/src/agents/context.ts) | Selective context: selected table, SQL, upstream artifacts, relevant knowledge |
| Agent runtime | [server/src/agents/runtime.ts](server/src/agents/runtime.ts) | Scheduler, tool loop, approvals, pause/stop/retry, restart recovery |
| HTTP + SSE | [server/src/routes/](server/src/routes/) | REST under `/api`, event stream at `/api/events/stream` |
| Seed data | [server/src/seed.ts](server/src/seed.ts) | Sample database, agents, knowledge |
| Web state | [web/src/store.ts](web/src/store.ts) | Zustand store, tabs, SSE subscription |
| Web views | [web/src/views/](web/src/views/), [web/src/components/](web/src/components/) | One view per tab kind |

## Rules for working on this codebase

1. **Keep the app runnable** after every change (§52). Run the three checks above.
2. **Never send secrets to a model.** Passwords and API keys are encrypted in [server/src/secrets.ts](server/src/secrets.ts). Pass errors through `redactSecrets` before they reach events or model context.
3. **Every agent action goes through a tool.** New tools must declare a `risk` and implement `assess()` so the permission layer and approval prompts work. Never execute SQL or shell commands from the runtime directly.
4. **Never bypass `resolveDecision`.** Destructive operations must stay explicit (§18).
5. **Emit events for anything a user should see** (§20, §45). Use `bus.emitEvent` for history and `bus.notify` for UI refresh.
6. **Prefer deterministic code over AI calls** (§43). The schema lint and SQL classifier are examples.
7. **Keep provider-specific code inside `server/src/ai/providers/`** (§32).
8. **Zustand selectors must not build arrays or objects inline.** Select raw state with `useShallow`, then derive with `useMemo`. Inline `.filter()` inside a selector caused a "getSnapshot should be cached" infinite-loop warning in `AgentView` and `TaskView`.
9. **Add a test** in `server/src/__tests__/` for runtime, permission, or SQL-classification changes. The heuristic provider makes agent runs deterministic for tests.
10. **Every `/api` route requires a session.** `requireAuth` in [server/src/auth.ts](server/src/auth.ts) guards them all. Only add a path to `PUBLIC_PATHS` if it exposes no data. Never widen the CORS allowlist to arbitrary origins.
11. **Keep documentation short.** Update this file when you fix a bug, finish a TODO, or discover a new issue.

## Known bugs

Severity reflects impact on a single local user. "Verified" means it was reproduced; "code review" means it was found by reading the code.

### Critical

None open. The CORS bug where any website could call the local API was fixed together with sign-in: the API now requires a session and only allows the origins in `config.allowedOrigins`. Both are covered by tests.

### High

- [ ] **Anthropic tool loop drops thinking blocks.** [server/src/ai/providers/anthropic.ts](server/src/ai/providers/anthropic.ts) converts only text and tool_use blocks, so assistant turns are replayed without their thinking blocks. `claude-opus-5` has thinking on by default, and tool-use continuations must pass thinking blocks back unchanged, so the second step of an agent run will likely fail. The `ContentPart` type in [server/src/ai/types.ts](server/src/ai/types.ts) needs a provider-opaque block that is echoed back verbatim. *Code review; untested because no API key was available.*
- [ ] **Anthropic provider is untested end to end.** The server-side refusal fallback (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`), refusal handling, prompt caching and cost estimation have never run against the real API. Test with a key before relying on it.

### Medium

- [ ] **OAuth is untested against the real providers.** Google and GitHub sign-in in [server/src/routes/auth.ts](server/src/routes/auth.ts) are covered end to end against simulated providers in `server/src/__tests__/oauth.test.ts`, but never against real Google or GitHub. Test with real client credentials before relying on them. *Code review.*
- [ ] **No per-user data scoping.** Every account sees every workspace. Registration therefore closes after the first account unless `SCHEMAFORGE_ALLOW_REGISTRATION=true`. Add ownership or roles before opening registration. *By design for now.*
- [ ] **Login throttling is in memory.** Counters reset when the server restarts. *Code review.*
- [ ] **Approvals do not store the tool input.** `requestApproval` in [server/src/agents/runtime.ts](server/src/agents/runtime.ts) saves `input: {}`, so the audit trail keeps only the summary and detail text. *Verified.*
- [ ] **SQLite queries block the server.** [server/src/dbs/sqlite.ts](server/src/dbs/sqlite.ts) uses the synchronous `node:sqlite` API with no timeout. A long query freezes the whole server, including the event stream. Move execution to a worker thread. *Code review.*
- [ ] **SQLite `INSERT … RETURNING` returns no rows.** Non-SELECT statements go through `stmt.run()`, so `RETURNING` output is discarded. *Verified.*
- [ ] **Heuristic intent detection is regex-based and brittle.** "Why is the transactions query slow?" without selected SQL produces a generic SELECT instead of a performance analysis. See `decide()` in [server/src/ai/providers/heuristic.ts](server/src/ai/providers/heuristic.ts). *Verified.*
- [ ] **No event retention.** The `events` and `run_messages` tables grow without bound. *Verified.*

### Low

- [ ] **Pause is coarse.** Pause and stop are checked between steps only. The heuristic provider ignores the abort signal. *Code review.*
- [ ] **Restart recovery cannot resume.** In-flight tasks are marked FAILED on startup and must be retried manually. *Code review.*
- [ ] **Transient provider errors retry once** with a fixed 2.5 second delay. *Code review.*
- [ ] **Dashboard cost tile is misleading.** It sums only the events loaded in the browser, not `/api/overview` usage totals. See [web/src/views/Dashboard.tsx](web/src/views/Dashboard.tsx). *Code review.*
- [ ] **Blocking browser dialogs.** Risky-SQL confirmation and saving queries use `window.confirm` and `window.prompt`. Replace with in-app modals. *Code review.*
- [ ] **Inconsistent API access.** [web/src/views/ProjectView.tsx](web/src/views/ProjectView.tsx) calls policy endpoints with raw `fetch` instead of the `api` client. *Code review.*
- [ ] **Single 1 MB web bundle.** Split the diagram and editor into lazy chunks. *Verified by the Vite build output.*
- [ ] **No `.gitattributes`.** Git warns about LF to CRLF conversion on Windows. *Verified.*
- [ ] **No key backup or rotation.** Losing `data/master.key` makes every stored password and API key unrecoverable. *Code review.*

## TODO: gaps against the specification

Fix the Critical and High bugs before starting these.

- [ ] **Git write tools** (§27): create branch, commit, and review changes, each gated by approval. Show agent-created changes in the agent workspace. Never push, merge or publish without explicit permission.
- [ ] **Side-by-side agent views** (§21, §36): the layout supports one active center tab. Add split panes so several agent workspaces are visible at once.
- [ ] **Permission UIs** (§17): workspace-level policy and task-level permission overrides exist in the API but have no UI. Agent `capabilities` (tool allow-list) also has no editor.
- [ ] **User-preference memory** (§25): the `user` knowledge scope exists in types but is not surfaced or used in context building.
- [ ] **Account settings**: change password, set a password on a Google- or GitHub-only account, list and revoke active sessions, and delete an account from the UI. Connecting and disconnecting Google or GitHub already works in Settings; only the CLI can reset a password.
- [ ] **Streaming agent output**: show model text as it arrives instead of per step.
- [ ] **Cost views** (§43): usage per agent, task, model and day. Data already exists in the `runs` table.
- [ ] **Tests**: PostgreSQL adapter tests gated on an env var, web tests for the store and key views, and an Anthropic provider test with a mocked client.
- [ ] **Diagram image export** (§7): current export writes Mermaid text plus positions, not PNG or SVG.
- [ ] **Error recovery actions** (§41): add "change connection" directly from a failed task, and resume from the last successful step where safe (§42).

## Upcoming features

Build these as extensions, not changes to the core (§46).

1. **Goal orchestrator** (§49): a planner that turns a goal like "Improve the customer database design" into a task graph across research, database, architecture, performance, security, review, migration and testing agents, with the user approving the plan.
2. **MCP tool integration** (§33): wrap MCP server tools as `ToolDefinition`s so they inherit permissions, approvals and events.
3. **External agents** (§51): run CLI or remote coding agents (for example Claude Code or Codex) behind the same task and event model.
4. **Local and remote execution split** (§34): move filesystem, terminal, git and local database access into an execution service so the control layer can be hosted.
5. **Code-to-database mapping** (§28): index entities, repositories and queries in the project source to answer "where is this table used" and "what breaks if this column changes".
6. **Migration management and schema diff** (§46): versioned migrations, apply and rollback with approval, and diffs between snapshots or connections.
7. **Better knowledge retrieval** (§24): embeddings or full-text search over knowledge, artifacts and project docs, replacing keyword overlap.
8. **More engines** (§5): MySQL first, through the `DbAdapter` interface.
9. **Schema health reports and quality scoring** (§46): build on the deterministic lint.
10. **Authentication for a hosted control layer** (§35): only needed once the server is reachable beyond localhost.

## Environment notes

- The shell is Git Bash on Windows. `python3` is not installed, so use Node for scripts.
- In the in-app browser, simulated typing does not reach the CodeMirror editor. Insert text with `document.execCommand('insertText', false, text)` after focusing `.cm-content`.
- A local PostgreSQL 17 was available during development. Point new connections at a disposable database, never a production one.
