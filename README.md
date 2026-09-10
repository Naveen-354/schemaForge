# SchemaForge

A personal, local-first **database engineering workspace**: database IDE + AI coding environment + multi-agent control center in one window.

- Connect PostgreSQL or SQLite databases, explore schemas, draw relationship diagrams
- Write and run SQL with schema-aware autocomplete, EXPLAIN, history, saved queries
- Delegate work to AI agents as **tasks**; watch every tool call live; approve risky actions
- Agents communicate through **artifacts** (SQL, migrations, analyses, reports) and task dependencies
- Deterministic tools do the boring work (schema lint, SQL risk classification) so models are used only where they add value

## Quick start

Requirements: Node.js 22.5+ (uses the built-in `node:sqlite`, no native builds). Node 25 is what it was built with.

```bash
npm install
npm run build        # builds the web UI
npm start            # http://127.0.0.1:4310
```

For development with hot reload (API on 4310, Vite on 5173 with proxy):

```bash
npm run dev
```

First start seeds a workspace with a sample SQLite database (`data/sample-investment.db`), six agents, some project knowledge and saved queries. Everything lives in `./data` (override with `SCHEMAFORGE_DATA_DIR`).

## AI providers

Agents work without any API key using the **built-in heuristic provider**, a deterministic agent that inspects schemas, runs quality checks, generates simple SQL/migrations and drives the same tool + approval pipeline. Add a model provider in **Settings** (or via env) and switch agents to it in their configuration:

| Provider | Configure | Default model |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` or Settings → API key | `claude-opus-5` (server-side refusal fallbacks on by default; turn off in Settings) |
| OpenAI-compatible (OpenAI, Ollama, LM Studio, OpenRouter…) | Settings → base URL / key / model, or `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | `gpt-4.1` |
| Heuristic (offline) | nothing | `heuristic-v1` |

API keys and database passwords are encrypted at rest (AES-256-GCM with `data/master.key`, or `SCHEMAFORGE_MASTER_KEY`) and are never included in model context.

## How it fits together

```
Workspace → Project → Database connection → Task → Agent → Tools → Events → Artifacts → Result
```

- **Task**: the unit of work. Chat questions are tasks too (kind `chat`), so everything is auditable.
- **Agent**: name, role, instructions, provider/model, permissions, status (`IDLE, QUEUED, RUNNING, WAITING_FOR_APPROVAL, PAUSED, COMPLETED, FAILED, STOPPED, CANCELLED`).
- **Tools** (`server/src/agents/tools.ts`): schema metadata, SQL execution, EXPLAIN, artifacts, knowledge, files, git, shell. Tools are independent of agents; agents request them and the runtime enforces permissions.
- **Permissions**: SQL is classified as `safe / write / ddl / destructive`; each class and each tool resolves to `allow / ask / deny` across workspace → project → agent → task layers (most restrictive wins). `ask` creates an **approval** the user resolves in the UI; the decision becomes part of the execution history.
- **Events**: every status change, tool call, tool result, approval, SQL execution, artifact and AI usage record is persisted and streamed to the UI over SSE.
- **Artifacts** are first-class and reusable: a downstream task (`dependsOn`) receives upstream results and artifacts in its context.
- **Knowledge**: project conventions/decisions/rules, retrieved selectively by keyword relevance; agent-scoped memory is kept separate.
- **Runs** record model, tokens, estimated cost and latency per task.

## Layout

```
shared/   domain types shared by server and web
server/   Hono API + agent runtime (TypeScript, node:sqlite for app state, pg for PostgreSQL)
  src/dbs       database adapters (postgres, sqlite) + connection manager
  src/sql       SQL risk classifier, DDL generator, deterministic schema lint
  src/ai        provider abstraction: anthropic, openai-compatible, heuristic
  src/agents    tools, permissions, context builder, runtime (scheduler, approvals, pause/stop/retry)
  src/routes    REST + SSE
web/      React + Vite UI (CodeMirror SQL editor, React Flow diagram, command palette)
```

## Keyboard

`Ctrl+K` palette/search · `Ctrl+Shift+N` new SQL tab · `Ctrl+Enter` run statement · `Ctrl+Shift+Enter` run all · `Ctrl+J/B/I` toggle panels · `Ctrl+W` close tab

## Tests

```bash
npm test
```

Covers SQL classification, schema lint, the SQLite adapter, and the agent runtime end to end (tool loop, approvals, denial, dependencies, cancellation) using the offline provider.

## Extending

- New database engine: implement `DbAdapter` in `server/src/dbs/` and register it in `manager.ts`.
- New tool: add a `ToolDefinition` to `server/src/agents/tools.ts` (name, JSON schema, risk, `assess`, `execute`). MCP-style tools can be wrapped the same way.
- New model provider: implement `AiProvider` in `server/src/ai/providers/` and register it in `index.ts`.
- External/CLI agents can be integrated as a provider that drives the same `complete()` contract or as tools that hand off work.
