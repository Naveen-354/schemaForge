# SchemaForge: project base

This document explains what SchemaForge is, the problem it solves, how it works, and how to use it from first launch to a finished multi-agent workflow. For contributor rules, known bugs and the roadmap, see [AGENTS.md](AGENTS.md). The original product specification is [prompt.txt](prompt.txt).

---

## 1. What SchemaForge is

SchemaForge is a **personal AI database engineering workspace** that runs on your own machine. It puts four things in one window:

- A **database IDE** for exploring schemas, tables, relationships, views, functions and triggers.
- A **SQL workspace** with a schema-aware editor, query plans, history and saved queries.
- An **AI assistant** that answers questions using the real structure of your database.
- A **multi-agent control center** where you hand tasks to AI agents and watch every step they take.

The one-sentence goal:

> **One visual workspace where you understand databases, work with SQL, and delegate database and engineering tasks to multiple AI agents while seeing exactly what those agents are doing.**

It is built for one developer working locally. It is not a hosted multi-tenant product.

---

## 2. The problem it solves

Database and backend work usually spreads across disconnected tools:

- **A database client** shows the schema, but it cannot reason about it.
- **A chat AI** can reason, but it does not know your schema. You paste table definitions by hand, it guesses the rest, and it forgets everything next session.
- **Coding agents** can act, but they act invisibly. You see the final answer, not which queries ran, which files changed, or what they almost did.
- **Risky changes** such as `ALTER`, `DELETE` or a migration depend on you noticing them in time. Nothing stops an agent from running them.
- **Knowledge gets lost.** Conventions, past decisions and earlier analyses live in your head or in old chat threads.

SchemaForge addresses each of these:

| Problem | How SchemaForge handles it |
|---|---|
| AI does not know the schema | Agents read live metadata through tools. The assistant receives the table, SQL or result you have selected, not the whole database. |
| Agents act invisibly | Every step is an event: status changes, tool calls, tool outputs, SQL executed, artifacts created, approvals. You watch it live. |
| Dangerous operations slip through | Every SQL statement is classified as safe, write, schema change or destructive. Each agent has permissions for each class. Risky actions pause and wait for your approval. |
| Work is not reusable | Results are saved as artifacts, such as SQL, migrations and analyses, which other agents and later tasks can read. |
| Context is lost | Project instructions and a project knowledge base are fed to agents selectively on every task. |
| One agent at a time | Several agents run in parallel, and tasks can depend on each other to form pipelines. |
| Vendor lock-in and cost | Providers are swappable per agent. An offline built-in agent costs nothing and needs no API key. |

---

## 3. Core concepts

Everything in SchemaForge fits one hierarchy:

```
Workspace → Project → Database → Task → Agent → Tools → Events → Artifacts → Result
```

| Concept | Meaning |
|---|---|
| **Workspace** | Your overall environment. It holds projects and agents. The default one is called "Personal". |
| **Project** | One software or database system. It has databases, tasks, artifacts, knowledge, instructions, and optionally a source-code folder. |
| **Database connection** | A PostgreSQL server or SQLite file attached to a project. |
| **Task** | A concrete objective, such as "Review the customer schema for normalization problems". It has a status, priority, assigned agent, optional dependencies, and a result. |
| **Agent** | A configured AI worker with a name, role, instructions, AI provider and model, and permissions. An agent works on one task at a time. |
| **Tool** | A controlled capability an agent can request, such as describing a table or running SQL. Agents never act except through tools. |
| **Event** | A recorded fact: a tool was called, SQL ran, an approval was requested. Events form the activity timeline and audit trail. |
| **Approval** | A pause point. The agent proposes a risky action and waits for you to approve or reject it. |
| **Artifact** | A saved deliverable: SQL, a migration, an analysis, a report, code, documentation. Artifacts belong to a project and record which task and agent produced them. |
| **Knowledge** | Short, reusable project facts: conventions, decisions, business rules, known problems. Agents retrieve the relevant ones for each task. |
| **Run** | One attempt at a task. It records steps, model, tokens, estimated cost, latency and errors. A retried task has several runs. |

**Chat is a task too.** When you ask the assistant a question, SchemaForge creates a task of kind "chat". It is handled by the same agent machinery and appears in the same history, so nothing an AI does is off the record.

---

## 4. Installing and starting

### Requirements

- Node.js 22.5 or newer. SchemaForge uses Node's built-in SQLite, so nothing needs compiling.
- Optional: a PostgreSQL server you want to explore.
- Optional: an Anthropic API key, or any OpenAI-compatible endpoint including a local Ollama.

### First-time setup

```bash
npm install
```

```bash
npm run build
```

### Start the app

```bash
npm start
```

Open http://127.0.0.1:4310 in your browser.

### Development mode with hot reload

```bash
npm run dev
```

This runs the API on port 4310 and the interface on http://localhost:5173.

### Run the tests

```bash
npm test
```

### What you get on first launch

The first start creates a `data` folder and seeds it with:

- A workspace called **Personal** with two projects: **Investment Platform (sample)** and **Experiments**.
- A sample SQLite database of a mutual-fund platform: customers, fund houses, funds, folios, SIP mandates, transactions, holdings, KYC documents, an audit log, and a portfolio view.
- Six agents, described in section 7.
- Five knowledge entries about the sample project's conventions.
- Two saved queries.

The sample database has deliberate design flaws, such as a table without a primary key and unindexed foreign keys, so the analysis features have something to find.

### Your account

Every part of SchemaForge requires you to sign in, because it can read your databases and run SQL.

1. **First start.** The app shows **Create the owner account**. Enter your email and a password of at least 8 characters. This account owns the instance.
2. **Registration then closes.** Nobody else can create an account, even if they can reach the server. To allow more accounts, start the server with `SCHEMAFORGE_ALLOW_REGISTRATION=true`. Every account sees the same workspaces and data.
3. **Signing in.** You stay signed in for 7 days after your last activity. Your email and the log-out button are at the right end of the top bar. **Log out** is also in the command palette.
4. **Logging out** ends the session on the server, not just in the browser, so the old session cannot be reused.
5. **Session ended.** If your session expires while the app is open, SchemaForge returns you to the sign-in screen with a message.
6. **Forgotten password.** There is no email recovery in a local app. Reset it on the machine running the server:

   ```bash
   npm run user -- reset-password you@example.com new-password-here
   ```

   This also signs out every session of that account. `npm run user -- list` shows all accounts.

After 10 failed sign-in attempts for an email within 15 minutes, further attempts are refused for 15 minutes.

### Google and GitHub sign-in

Both are optional. Their buttons appear on the sign-in screen once the server has credentials for them. You create the credentials in your own Google or GitHub account.

1. Sign in, open **Settings**, and find **Sign-in providers**.
2. Each provider card shows the exact **callback URL** to register, with a copy button, and links to where you create the app:
   - **Google**: in Google Cloud Console, open APIs & Services, then Credentials. Choose Create credentials, then OAuth client ID, with application type **Web application**. Add the callback URL under **Authorized redirect URIs**.
   - **GitHub**: open Settings, then Developer settings, then OAuth Apps, and register a new app. Put the callback URL in **Authorization callback URL**.
3. Paste the **client ID** and **client secret** into the card and click **Save settings**. The secret is encrypted before it is stored.
4. Under **Your sign-in methods**, click **Connect** next to Google or GitHub and approve access. From then on you can sign in with it.

Things to know:

- **Use one address.** The callback URL is built from the address you opened SchemaForge at. Always open it at that same address, for example http://localhost:4310, or set `PUBLIC_URL` to fix it. With `npm run dev`, the address is http://localhost:5173.
- **Accounts are never merged by email alone.** A Google or GitHub sign-in for an email that already has an account is refused until you connect it from Settings while signed in. This stops someone else's Google account from taking over yours.
- **New accounts via Google or GitHub** follow the same rule as registration: allowed for the very first account, otherwise only when `SCHEMAFORGE_ALLOW_REGISTRATION=true`.
- **Disconnect** is under **Your sign-in methods**. SchemaForge refuses to remove your last remaining way to sign in.
- **Environment variables** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` also work and take priority over Settings.

---

## 5. The screen layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Top bar: workspace · project · search · approvals · agents · panels  │
├──────────────┬───────────────────────────────────┬───────────────────┤
│ Navigation   │ Main area (tabs)                  │ Inspector         │
│              │                                   │                   │
│ Databases    │ Dashboard, tables, diagrams, SQL, │ Assistant chat    │
│ Agents       │ agents, tasks, artifacts,         │ Context details   │
│ Tasks        │ knowledge, settings               │                   │
│ Artifacts    │                                   │                   │
│ Knowledge    │                                   │                   │
├──────────────┴───────────────────────────────────┴───────────────────┤
│ Bottom panel: Activity · SQL Results · Agent Events · Approvals ·    │
│               History                                                │
└──────────────────────────────────────────────────────────────────────┘
```

All panels can be resized by dragging their borders, and hidden or shown with keyboard shortcuts. SchemaForge remembers your open tabs and panel layout between sessions.

### Top bar

- **Workspace and project selectors** switch what everything else shows. The **+** next to the project selector creates a project.
- **Search or run a command** opens the command palette.
- **Approvals pending** appears in yellow when an agent is waiting for you. Click it to open the approvals panel.
- **Agents** shows how many agents are active and opens the agent dashboard.
- **live** shows that the real-time event stream is connected.
- Icons on the right toggle the navigation, bottom panel and inspector, and open Settings.
- Your email and the **log out** button are at the far right.

### Navigation (left)

- **Databases** lists connections with a status dot: green is connected, red is an error, grey is untested. Expand a connection to see its tables with row counts. Expand a table to see columns with key icons, foreign keys and indexes. The row of controls under a connection filters tables, refreshes the schema and opens the diagram.
- **Agents** lists agents with their current status or activity.
- **Tasks** lists tasks that are not finished yet.
- **Artifacts** and **Knowledge** list the latest items. The magnifier icon opens the full list.

### Main area (center)

Everything opens as a tab. The **Dashboard** tab is always present. The **+ SQL** button on the right of the tab bar opens a new query tab. Close tabs with the **×**, a middle click, or Ctrl+W.

### Inspector (right)

- **Assistant** is the chat interface. Above the input, chips show the context that will be sent with your question.
- **Context** shows details of whatever is selected: the database, table, SQL, agent or task.

### Bottom panel

| Tab | Shows |
|---|---|
| **Activity** | Every event in the project, filterable by type, level, agent and text. |
| **SQL Results** | The result of the last query run in the active SQL tab. |
| **Agent Events** | Events for the selected agent or task only. |
| **Approvals** | Actions waiting for your decision, with the exact SQL or command. |
| **History** | Every SQL statement executed by you or by agents, with status, duration and row count. Click a row to reopen it in the editor. |

---

## 6. Using each feature

### 6.1 Connecting a database

1. Click **+** next to **Databases** in the navigation, or **Add database** on the dashboard.
2. Choose **PostgreSQL** or **SQLite (file)**.
3. For PostgreSQL, fill in host, port, database, username and password. Optionally list schemas to include; leave it blank to include every non-system schema. Tick **Use SSL** if needed.
4. For SQLite, enter the full path to the database file.
5. Tick **Read-only** if you never want writes on this connection. A read-only connection rejects every write and schema change from both you and agents.
6. Click **Create & test**. SchemaForge tests the connection and loads the schema.

Passwords are encrypted before they are stored and are never included in anything sent to an AI model.

Clicking a connection name opens its tab:

- **Overview** shows status, counts of tables, views, foreign keys, indexes and estimated rows.
- **Tables** lists every table and view with key and index counts.
- **Routines** and **Triggers** list functions, procedures and triggers with their definitions.
- **Quality** runs the built-in schema checks described in 6.3.
- **Settings** edits the connection or deletes it.
- The toolbar has **Test**, **Refresh schema**, **Diagram**, **New query** and **Review with agent**.

Refresh the schema after you change the database structure. SchemaForge caches the schema so browsing stays fast.

### 6.2 Exploring a table

Click a table in the navigation. The table tab shows:

| Sub-tab | Contents |
|---|---|
| **Columns** | Name, type, nullability, default, primary key and foreign key badges, comments. Click a foreign key badge to jump to the referenced table. |
| **Keys & relationships** | Primary key, outgoing foreign keys, incoming references from other tables, and all constraints. |
| **Indexes** | Every index with its columns, uniqueness and definition. |
| **DDL** | A generated `CREATE TABLE` statement you can copy or open in the editor. |
| **Quality** | Schema check findings for this table, with suggested fixes. |

The toolbar offers **Select rows** and **Count**, which open ready-made queries, **Diagram**, which opens the diagram focused on this table, **Indexes?**, which asks the assistant whether the table is well indexed, and **Review with agent**, which opens a new task.

Selecting a table also sets it as the assistant's context.

### 6.3 Schema quality checks

The Quality tabs run deterministic checks. They use no AI and cost nothing. Findings are ranked high, medium, low or info:

- Tables without a primary key.
- Foreign keys without a supporting index.
- Columns named like references, such as `customer_id`, with no foreign key constraint.
- Columns that usually hold unique values, such as `email` or `pan`, with no unique constraint.
- Money-like columns stored as floating point.
- Date-like columns stored as text on PostgreSQL.
- Tables with no `created_at` column.
- Very wide tables, redundant indexes, large tables with no secondary index.
- Tables with no relationships, and mixed singular and plural table names.

Where a fix is a SQL statement, **Open in editor** puts it in a SQL tab for you to review and run.

### 6.4 The schema diagram

Open a diagram from a connection, a table, or the navigation. Tables appear as boxes with their columns, primary keys and foreign keys, connected by relationship lines.

- **Zoom and pan** with the mouse, or use the controls in the corner. A minimap appears for larger diagrams.
- **Search** dims every table that does not match a table or column name.
- **Focus table** highlights one table and its neighbours. **related only** hides everything else, and **depth 1–3** controls how many relationship hops to include. Use this for large schemas; showing hundreds of tables at once is not useful.
- **Drag** tables to rearrange them, then click **save** to keep the layout.
- **Auto layout** rearranges the visible tables automatically, and the fit button zooms to show them all.
- **Right-click** a table to hide it. **unhide** brings hidden tables back.
- **Double-click** a table to open it.
- **show views** and **all columns** toggle views and long column lists.
- The export button downloads the diagram as Mermaid text plus table positions.

### 6.5 The SQL workspace

Open a query tab with **+ SQL** or Ctrl+Shift+N.

- Pick the connection from the dropdown.
- Autocomplete suggests keywords, table names and column names from the live schema.
- **Ctrl+Enter** runs the statement under the cursor, or the selection if you have one. **Ctrl+Shift+Enter** runs everything. The **Run** button does the same as Ctrl+Enter.
- A badge next to the toolbar shows how the statement is classified, such as `SELECT`, or `DELETE · destructive`.
- **Explain** shows the query plan in the **Plan** tab without running the query.
- **dry run** executes the statement inside a transaction and rolls it back, so you see the effect without keeping it.
- Results show in the lower half with paging, row counts and timing. **JSON** copies the rows; **CSV** downloads them. Results are capped at 1,000 rows.
- **Saved queries** loads a saved query; **Save** stores the current one in the project.
- The AI buttons **Explain**, **Why slow?** and **Review** send the selected SQL to the assistant as a question.
- If a query fails, **Why did it fail?** asks the assistant with the error attached.

**Safety.** Anything other than a read-only statement shows a confirmation dialog describing the risk before it runs. This protects you from yourself as well as from agents.

Every statement you or an agent runs is kept in the **History** tab of the bottom panel.

### 6.6 Asking the assistant

The assistant lives in the right-hand panel.

1. Select what the question is about: a table in the navigation, text in the SQL editor, or a query result. Chips above the input show what will be sent. Remove a chip with its **×** to leave that context out.
2. Type your question and press Enter. Shift+Enter adds a new line.
3. Choose which agent answers from the dropdown. By default it is the agent named **Assistant**.

The answer appears in the thread and is also recorded as a task, so you can click **task ›** to see every tool call behind it. Follow-up questions in the same thread include the earlier questions and answers. Remove the **thread** chip to start a new thread.

Examples that work well with the sample database:

- "Is this table properly indexed?" with a table selected.
- "Why is this query slow?" with SQL selected.
- "Show customers whose total investment is greater than 10 lakh."
- "Generate a query for customers with active SIPs but don't run it."
- "Generate a migration for adding an external UUID to customers."
- "Execute the selected SQL."

The command palette also offers AI actions for whatever is selected, such as "Why is this query slow?" or "Generate migration for customers".

### 6.7 Agents

Open the **agent dashboard** from the top bar, the magnifier next to **Agents**, or the command palette. Each card shows the agent's status, current task, its last action, how many tools it has used and files it has changed, and buttons to approve or stop.

Click an agent to open its workspace:

| Sub-tab | Contents |
|---|---|
| **Activity** | The live timeline of the agent's events. The side panel lists the current task, tools used, database objects touched, files changed and recent errors. |
| **Tasks** | Every task assigned to this agent, with a **Run** button for tasks that are not running. |
| **Artifacts** | Everything this agent has produced. |
| **Execution history** | Every run with steps, model, tokens, estimated cost, latency and errors. |
| **Configuration** | Name, role, instructions, provider, model, maximum steps per task, permissions, and a delete button. |

The toolbar has **Pause**, **Resume**, **Stop**, **Review approval**, a reset button that returns a finished agent to IDLE, and **Assign task**.

#### Creating an agent

Click **+** next to **Agents** or **New agent** on the dashboard.

1. Pick a **Preset** to fill in a sensible role, instructions and permissions: Database, Architect, Backend, Research, Testing, Security, Code Review or Documentation.
2. Adjust the name, role and instructions. Instructions are the agent's standing orders.
3. Choose the **Provider** and **Model**. Providers that are not set up are shown as not configured.
4. Set **Max steps**, the most model calls the agent may make on one task.
5. Tick **Only available in the current project** if the agent is project-specific. Otherwise it is available in every project of the workspace.
6. Set **permissions** (section 8).

#### Agent statuses

| Status | Meaning |
|---|---|
| IDLE | Nothing assigned right now. |
| QUEUED / WAITING | Has work waiting to start. |
| RUNNING | Working on a task. The status message says what it is doing. |
| WAITING_FOR_APPROVAL | Paused until you approve or reject an action. Shown as **NEEDS APPROVAL**. |
| PAUSED | Paused by you. |
| COMPLETED | Finished its last task. |
| FAILED | Its last task failed. The error is shown. |
| STOPPED / CANCELLED | You stopped it. |

### 6.8 Tasks

Create a task with **+** next to **Tasks**, **New task** on the dashboard, **Assign task** on an agent, or **Review with agent** on a table or connection.

| Field | Meaning |
|---|---|
| **Objective** | What you want done, in plain language. |
| **Details** | Optional extra instructions or acceptance criteria. |
| **Agent** | Who does it. A task can be left unassigned. |
| **Database** | The connection the agent works against. |
| **Priority** | low, normal, high or urgent. Higher priority tasks start first. |
| **Depends on** | Tasks that must complete before this one starts. |
| **Attach selected table / SQL** | Sends your current selection as context. |
| **Start immediately** | Queue the task now; otherwise it waits in TODO. |

The task tab shows:

- **Overview**: the result, artifacts produced, errors with recovery actions, the agent, database, timing, AI usage, context, and the tasks it depends on or feeds into.
- **Activity**: every event for this task.
- **Transcript**: the conversation between SchemaForge and the model, including tool inputs and outputs. Private model reasoning is never shown.
- **Runs**: each attempt with its steps, tokens, cost and errors.

Toolbar actions change with the status: **Start**, **Pause**, **Resume**, **Stop**, **Cancel**, **Review approval**, **Retry**, **Run again**, and delete.

#### Task statuses

| Status | Meaning |
|---|---|
| TODO | Created but not started. |
| QUEUED | Waiting for its agent to be free, for its dependencies to finish, or for a free slot. Up to four tasks run at once. |
| RUNNING | The agent is working on it. |
| WAITING_FOR_APPROVAL | Needs your decision. |
| PAUSED | Paused by you. |
| BLOCKED | A task it depends on failed or was cancelled. |
| COMPLETED | Done. The result is on the Overview tab. |
| FAILED | Something went wrong. The error and recovery actions are shown. |
| CANCELLED | Stopped or cancelled by you. |

The **Tasks** tab (magnifier next to **Tasks**) groups every task by state. Tick **include chat questions** to also show assistant questions.

### 6.9 Approvals

When an agent wants to do something its permissions mark as "ask", it stops and an approval appears:

- In yellow in the top bar.
- In the **Approvals** tab of the bottom panel.
- On the agent's card and on the task.

Each approval shows which agent wants to do what, the task, the risk class, and the exact SQL or command. You can:

- Type an optional **note** for the agent.
- Click **Review SQL** to open the statement in the editor, where you can explain or dry-run it first.
- Click **Approve**. The agent runs the action and continues.
- Click **Reject**. The agent is told you declined, with your note, and must adjust or explain what it would have done.

Every approval and rejection is recorded in the activity log with the agent, task and your note.

### 6.10 Artifacts

Artifacts are the durable outputs of agent work. Open one from the navigation, a task, an agent, or the **Artifacts** tab, which can search titles and content and filter by type.

An artifact tab shows the content, rendered for documents or as plain text for SQL and code, plus which agent and task produced it. Actions:

- **Copy** the content.
- **Open in SQL editor** for SQL and migrations, ready to review, dry-run and execute.
- **Hand to agent** opens a new task asking an agent to review and validate the artifact.
- **raw** toggles between rendered and plain text.

Agents can list and read artifacts themselves, and a task that depends on another automatically receives the upstream task's result and artifacts.

### 6.11 Project knowledge

Knowledge entries are short facts every agent in the project should respect. Open **Knowledge** from the navigation or the command palette.

- Add an entry with a category, title, content and tags. Categories include convention, decision, relationship, business-rule, migration-rule, api-contract, known-problem, research and note.
- Search and filter by category, then edit or delete entries.
- Agents can save knowledge themselves while working. Entries scoped to a single agent are that agent's private memory.

For every task, SchemaForge picks the most relevant entries, up to six, by matching the task's words. It does not send the whole knowledge base.

### 6.12 Project settings

Open **Project settings** from the command palette.

- **Source root path** points at the project's source code. It enables the file, search and git tools for agents in this project. Agents can only reach files inside this folder.
- **Instructions for agents** are sent with every task in the project. Put conventions and hard rules here, for example "Never drop tables in this project".
- **Project-level SQL policy** restricts every agent in the project. It can only make agents stricter, never looser.

### 6.13 Settings and AI providers

Open **Settings** from the gear icon.

| Provider | What you need | Default model |
|---|---|---|
| **Built-in heuristic** | Nothing. Always available and free. | `heuristic-v1` |
| **Anthropic** | An API key in Settings, or the `ANTHROPIC_API_KEY` environment variable. | `claude-opus-5` |
| **OpenAI-compatible** | A base URL, plus a key if the service needs one. Works with OpenAI, Ollama, LM Studio, OpenRouter and similar services. | `gpt-4.1`, or whatever you set |

Keys are encrypted before storage and shown only as "set".

After adding a key, open each agent's **Configuration** tab and switch its provider and model. Different agents can use different providers.

For Anthropic, **Refusal fallbacks** is on by default. If a request is declined by a safety check, the API retries it on another model automatically. You can turn this off.

For OpenAI-compatible services, you can enter prices per million tokens so cost estimates are meaningful.

#### What the built-in heuristic agent can and cannot do

The heuristic agent follows fixed rules instead of a language model. It uses the same tools, permissions, approvals and events as a real model, which makes it good for trying SchemaForge offline and for cheap, repeatable checks.

It can:
- Review tables using the schema quality checks and save the report as an artifact.
- Answer index questions about a selected table.
- Explain a selected query's plan, point out full table scans and suggest indexes.
- Turn simple questions into `SELECT` or `COUNT` queries, including filters like "greater than 10 lakh", "active", "top 10", and joins along foreign keys. It runs them unless you say not to.
- Draft "add column" migrations with a rollback section.
- Execute selected SQL, subject to approval.

It cannot hold a real conversation, handle complex questions, design schemas, or write application code. Use a real model provider for those.

---

## 7. The seeded agents

| Agent | Role | SQL permissions | Best used for |
|---|---|---|---|
| **Assistant** | Database assistant | Reads allowed; writes and schema changes ask; destructive denied | Answering questions in the chat panel. |
| **Database Agent** | Database engineer | Reads allowed; writes and schema changes ask; destructive denied | Schema inspection, index analysis, writing SQL and migrations. |
| **Architect Agent** | Software architect | Reads only | Reviewing designs for normalization, naming and relationships. |
| **Performance Agent** | Query performance analyst | Reads only | Query plans and indexing. |
| **Migration Agent** | Migration engineer | Reads allowed; writes, schema changes and destructive all ask | Generating and, after approval, applying migrations. |
| **Review Agent** | Code and schema reviewer | Reads only; cannot write files or run commands | Combining upstream results into a final review. |

With no API key configured, all six use the built-in heuristic provider.

---

## 8. Safety and permissions

### How SQL is classified

SchemaForge reads every statement, ignoring comments and string contents, and puts it in one of four classes. A batch of several statements takes the highest class.

| Class | Examples |
|---|---|
| **safe** | `SELECT`, `WITH … SELECT`, `EXPLAIN`, `SHOW` |
| **write** | `INSERT`, `UPDATE … WHERE`, `DELETE … WHERE`, `CALL`, transaction control, `EXPLAIN ANALYZE` of a write |
| **ddl** (schema change) | `CREATE`, `ALTER … ADD`, `COMMENT`, `GRANT`, `VACUUM`, `SELECT INTO` |
| **destructive** | `DROP`, `TRUNCATE`, `DELETE` or `UPDATE` without `WHERE`, `ALTER … DROP`, column type changes |

### Permission decisions

Every SQL class and every tool resolves to one decision:

| Decision | Effect |
|---|---|
| **allow** | The agent does it immediately. It is still logged. |
| **ask** | The agent pauses for your approval. |
| **deny** | The agent is refused and told to explain instead. |

Without explicit settings, read-only tools are allowed and tools that write files or run commands ask.

### Layers

Permissions can be set at four levels: workspace, project, agent and task. When several levels set a rule, **the strictest one wins**. A project policy of "deny destructive" therefore overrides an agent that allows it. Agent permissions are edited in the agent's Configuration tab and project policy in Project settings.

### Other safeguards

- **Read-only connections** refuse every non-safe statement, for users and agents alike.
- **You** get a confirmation dialog before running anything non-safe in the SQL editor.
- **Dry run** lets you and agents test a change and roll it back.
- **Query limits**: queries time out after 30 seconds on PostgreSQL, the editor shows at most 1,000 rows, and agents see at most 200 rows.
- **Sign-in** is required for every API call and for the live event stream. Only the app itself and the development server may call the API from a browser, so other websites you visit cannot reach it.
- **Secrets** such as passwords and API keys are encrypted at rest and stripped from error messages before they reach an agent. Account passwords are stored only as salted hashes.
- **File access** is limited to the project's source root folder.
- **Git**: agents can view status, diffs and history only. They cannot commit, push or merge.

### Agent tools

| Tool | What it does | Default decision |
|---|---|---|
| `list_tables`, `describe_table`, `search_schema`, `get_relationships` | Read database structure | allow |
| `run_sql` | Execute SQL | depends on SQL class |
| `explain_sql` | Show a query plan | allow |
| `create_artifact`, `list_artifacts`, `read_artifact` | Save and read deliverables | allow |
| `search_knowledge`, `save_knowledge` | Read and write project knowledge | allow |
| `list_files`, `read_file`, `search_files` | Read project source code | allow |
| `write_file` | Create or overwrite a file | ask |
| `git_status`, `git_diff`, `git_log` | Inspect the repository | allow |
| `run_command` | Run a shell command in the project folder | ask |

---

## 9. A complete workflow

This walkthrough uses the sample database. It follows the full cycle: explore, delegate, observe, approve, hand off, review.

### Step 1: Open the project

Start SchemaForge, open http://127.0.0.1:4310 and sign in. On the very first start, create the owner account. Check the top bar shows the **Personal** workspace and the **Investment Platform (sample)** project. The dashboard shows agents, tasks, approvals and artifacts at a glance.

### Step 2: Explore the database

1. In **Databases**, expand **sample-investment (SQLite)** and click `customers`.
2. Look at **Columns** and **Keys & relationships**. Note that nothing enforces unique emails.
3. Click **Diagram**, choose `sip_mandates` in **Focus table**, and turn on **related only**. You see how mandates connect customers, funds and folios.
4. Open the connection tab and its **Quality** sub-tab. Note that `kyc_documents` has no primary key and several foreign keys are unindexed.

### Step 3: Ask quick questions

1. With `sip_mandates` selected, type "Is this table properly indexed?" in the assistant and press Enter.
2. Open **+ SQL** and run:

   ```sql
   SELECT f.name, COUNT(*) AS sips
   FROM sip_mandates s JOIN funds f ON f.id = s.fund_id
   WHERE s.status = 'ACTIVE'
   GROUP BY f.name;
   ```

3. Click **Why slow?**. The assistant explains the query plan and suggests an index.

### Step 4: Record what matters

Open **Knowledge** and add a convention you want every agent to respect, for example "Every table must have a primary key and a created_at column". Agents will see it on related tasks.

### Step 5: Build a multi-agent pipeline

Create three tasks with **New task**:

1. **Review**: objective "Review the customer, folio and SIP mandate schema and identify design problems", agent **Architect Agent**, database **sample-investment**, start immediately.
2. **Migration**: objective "Generate a migration for adding an external UUID to customers", agent **Migration Agent**, **Depends on** the review task, start immediately. It stays QUEUED until the review completes.
3. **Final review**: objective "Review the customers schema and summarize open problems", agent **Review Agent**, **Depends on** the migration task, start immediately.

Dependencies run in order. Each downstream task automatically receives the upstream task's result and artifacts in its context.

### Step 6: Watch the agents work

1. Open the **agent dashboard**. Cards turn green while agents run and show their current step.
2. Click **Architect Agent** to see its live timeline: listing tables, describing each table, running the analysis, saving the report.
3. Expand **details** on any event to see the exact tool input and output.
4. Use the bottom **Activity** tab filtered by agent or event type for the full picture across agents.

### Step 7: Review the output

1. Open the review task. The **Result** summarizes the findings and **Artifacts** holds the full analysis report.
2. Open the migration artifact produced by the Migration Agent. It contains the `ALTER TABLE` statement, a unique index, and a commented rollback section.

### Step 8: Apply a change with approval

1. On the migration artifact, click **Open in SQL editor**.
2. Tick **dry run** and click **Run** to see that it would succeed without changing anything.
3. To have the agent apply it, create a task "Execute the selected SQL" for the **Migration Agent** with the SQL selected and **attach selected SQL** ticked.
4. The agent stops at the `ALTER TABLE`. A yellow **approval pending** appears.
5. Open **Approvals**, read the statement and risk, add a note if you want, and click **Approve**, or **Reject** if you have second thoughts.
6. The agent runs the statement and completes. The approval, the executed SQL and the result are all in the activity log.
7. Click **Refresh schema** on the connection to see the new column.

### Step 9: Handle a failure

If a task fails, its Overview shows the error with actions:

- **Retry** starts a new run. Earlier runs, tool calls and artifacts are kept.
- **Inspect activity** jumps to the timeline to see where it went wrong.
- **Check connection** opens the database connection if the error was a connection problem.
- **Assign another agent** retries the task with a different agent.

A task whose dependency failed shows **BLOCKED**. Retry the upstream task, then retry the blocked one.

### Step 10: Find anything later

Press **Ctrl+K** and type. The palette searches tables, columns, agents, tasks, artifacts, saved queries, knowledge and activity. Type `>` first to list commands only.

---

## 10. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+K or Ctrl+P | Command palette and global search |
| Ctrl+Shift+N | New SQL tab |
| Ctrl+Enter | Run the statement under the cursor, or the selection |
| Ctrl+Shift+Enter | Run the whole editor |
| Ctrl+J | Show or hide the bottom panel |
| Ctrl+B | Show or hide the navigation |
| Ctrl+I | Show or hide the inspector |
| Ctrl+W or middle click | Close the current tab |
| Esc | Close the palette or a dialog |
| Right-click a diagram table | Hide it |
| Double-click a diagram table | Open it |

---

## 11. Where data lives and configuration

Everything is stored in the `data` folder next to the project:

| File | Contents |
|---|---|
| `data/schemaforge.db` | Accounts, sign-in sessions, workspaces, projects, connections, agents, tasks, runs, events, approvals, artifacts, knowledge, history, settings. |
| `data/master.key` | The key that encrypts passwords and API keys. **Back it up.** Without it, stored secrets cannot be recovered. |
| `data/sample-investment.db` | The sample database. |

To start fresh, stop the server and delete the `data` folder. This also deletes your account, stored passwords, keys, tasks and history. The next start asks you to create a new owner account.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4310 | Server port |
| `HOST` | 127.0.0.1 | Server address. Keep it on localhost. |
| `SCHEMAFORGE_DATA_DIR` | `./data` | Where data is stored |
| `SCHEMAFORGE_MASTER_KEY` | none | Use this passphrase instead of `master.key` |
| `SCHEMAFORGE_MAX_ROWS` | 1000 | Row limit for query results |
| `SCHEMAFORGE_QUERY_TIMEOUT_MS` | 30000 | PostgreSQL statement timeout |
| `SCHEMAFORGE_MAX_CONCURRENT_RUNS` | 4 | Tasks that may run at the same time |
| `SCHEMAFORGE_ALLOW_REGISTRATION` | off | Allow accounts beyond the first. Anyone who can reach the server could then register. |
| `SCHEMAFORGE_SESSION_DAYS` | 7 | Days of inactivity before you must sign in again |
| `PUBLIC_URL` | the address you opened | Fixes the address used for Google and GitHub callbacks and secure cookies |
| `SCHEMAFORGE_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API, comma separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Enables Google sign-in; overrides the values in Settings |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | Enables GitHub sign-in; overrides the values in Settings |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | none | Anthropic provider |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | none | OpenAI-compatible provider |

---

## 12. Troubleshooting

| Symptom | What to do |
|---|---|
| Connection dot is red | Open the connection, read the error on **Overview**, fix it under **Settings**, then click **Test**. |
| Tables look out of date | Click **Refresh schema** on the connection. |
| Task fails with "Provider is not configured" | Add the provider's key in **Settings**, or switch the agent to the built-in heuristic provider. |
| Task stays QUEUED | Its agent is busy, a dependency has not finished, or four tasks are already running. |
| Task shows BLOCKED | A task it depends on failed or was cancelled. Retry that task first. |
| Tasks show FAILED after a restart | Tasks cannot survive a server restart. Click **Retry**. |
| Agent seems stuck | Check **Approvals**. It is probably waiting for you. |
| The live badge is yellow | The event stream reconnects by itself. If it stays yellow, check the server is running. |
| Editor shows a confirmation when running SQL | The statement is not read-only. Read the risk and confirm only if you mean it. |
| Forgot your password | On the server machine, run `npm run user -- reset-password <email> <new-password>`. |
| "Registration is closed" | The owner account already exists. Sign in with it, or restart the server with `SCHEMAFORGE_ALLOW_REGISTRATION=true`. |
| "Too many failed sign-in attempts" | Wait 15 minutes, or restart the server, which clears the counter. |
| Sent back to the sign-in screen | Your session expired after 7 idle days, or you logged out in another tab. Sign in again. |

---

## 13. Current limitations

SchemaForge is an early working version. The most important limitations are listed here; the full list with file locations is in [AGENTS.md](AGENTS.md).

- **All accounts share the same data.** There are no per-user workspaces or roles yet, which is why registration closes after the owner account.
- **Google and GitHub sign-in have not been tried against the real services** because no credentials were available during development.
- **The Anthropic provider has not been tested against the live API** and will likely fail after an agent's first step. Test it before relying on it.
- Long queries on SQLite connections freeze the server until they finish.
- Agents can inspect git but not create branches or commits yet.
- Only one main tab is visible at a time; side-by-side agent views are planned.
- The heuristic agent understands a limited set of question patterns.
- Activity history grows without automatic cleanup.

Planned next, in order: goal-level orchestration that plans a whole multi-agent pipeline from one request, MCP tool integration, external coding agents such as Claude Code, linking application code to database tables, migration management and schema diff, better knowledge search, and MySQL support.
