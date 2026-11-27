# Role prompts: each role's instructions, read-only in the page

A **Role prompts** page shows what each lane's sessions are told when they start: every file in `roles/`, with its
settings and its instructions rendered as Markdown. Under the instructions it shows what else the session gets,
which isn't in the file:
- the fixed-format report its turns must end with;
- the hive's own tools it's offered;
- for the spec writer and the planner, the path of the spec format's `format.md`, which is appended after their
  instructions.

You reach the page from a new **☰** menu at the right end of the header. The backend reads `roles/` on every request,
so the page always shows the text the next session will start with. Look: `docs/mockups/HeaderMenu.dc.html` and
`docs/mockups/RolePrompts.dc.html`.

## Outcome

**What you get:**

- **A ☰ button at the right end of the header** on every page. It opens a small menu with one entry, **Role
  prompts**.
- **A Role prompts page** (`/roles`, and `/roles/<name>` for one role). On the left, every role file grouped by its
  lane in board order, each with its model and session kind. On the right, the selected role's lane, model, kind and
  file path, then its instructions as Markdown.
- **What else a session gets, under the prompt:**
  - the path of any appended spec-format file;
  - the fields of the report the role ends each turn with, each with its type and description;
  - each hive tool it's offered, with its description and inputs.

  The list's meta line marks these too, e.g. "+ format.md, report" for the planner and "+ write_brief" for the
  product owner.
- **Roles still to come are listed, greyed out.** The designer, the tester and the manager have no file yet. Each
  shows in its lane as "Not written yet".
- **A broken role file shows its error** as its own entry, instead of breaking the page.

**How to verify:**

- **The menu:** on the Board, press ☰. A menu opens with Role prompts. Escape or a click outside closes it. Choosing
  Role prompts opens the page and closes the menu.
- **The page:** all 8 role files are listed under Refine, Spec, Plan, Build, Check and Ship, with Product owner first.
  Designer (under Mockup), Tester (under Check, after Reviewer) and Manager (under Across lanes, the last group) are
  greyed out and read "Not written yet". Click Developer. The URL becomes `/roles/developer`, and the panel shows
  Build lane, Opus, Work session, `roles/developer.md`, and the same text as the file, with its bold leads and code
  rendered.
- **Under the prompt:**
  - Planner shows Also appended with `format.md`'s full path, then a Report section listing `status`,
    `blockedReason`, `steps` (with `title`, `detail`, `chunk` and `check` nested under it), `chunks` and `tests`.
  - Product owner shows Hive tools with `write_brief`, its description, and inputs from `title` to `openPoints`.
  - Spec writer shows Also appended, and no Report or Hive tools section.
- **It's live:** add a line to `roles/committer.md` and reload `/roles/committer`. The new line is there, with no
  restart.
- **Errors stay local:** remove the front matter from a copy of a role file in `roles/`. That role shows "Role <name>
  has no front matter" under Across lanes and in its panel, and every other role still shows. Delete the copy
  afterwards.

## Key decisions

- **The backend reads `roles/` on every request** (new). `GET /api/roles` lists the folder and parses each `.md` file
  with the existing `parseRole` in `packages/backend/src/sessions/roles.ts`. That's the same folder and parser the
  session runner uses, so the page can't disagree with what the next session gets. Nothing is cached and there's no
  SSE event, so after editing a file, you reload.
- **`parseRole` keeps the `lane:` line** (extends). The front matter already has it, but `Role` drops it today. It
  becomes `lane?: string` on `Role` and drives the grouping. The session runner ignores it.
- **One table says what each role gets beyond its file** (extends). Today that knowledge is in three places:
  - `turnOptions()` in `hive.ts` hard-codes `format.md` and the report schemas;
  - `startTurn()` picks the hive tools by role name;
  - the committer's turn passes `COMMIT_SCHEMA` inline.

  All of that moves into one constant, `ROLE_TURNS`. For each role it lists the spec-format files, the report schema
  and the hive tool names. `turnOptions()`, `startTurn()`, the committer's turn and the new endpoint all read it, so
  the page can't drift from what sessions get. Session behaviour is unchanged. Settings no session is told about
  stay where they are: the spec reviewer's `persist: false` and the setup's `background`.
- **Reports and tools are shown from the very objects sessions get** (new). The report is the JSON schema passed as
  `outputFormat`. A tool's inputs come from the same zod shape the SDK tool is built from, turned into JSON schema with
  `z.toJSONSchema` (zod 4, already a backend dependency). One small frontend renderer turns a JSON schema into a nested
  list of fields, each with its type and description. It's used for reports and for tool inputs alike.
- **Hive tool definitions move into an SDK-free module** (extends). The names, descriptions and zod shapes of
  `write_brief` and `copy_local_files` move from `sdkRunner.ts` to `sessions/hiveTools.ts`. `sdkRunner.ts` still wraps
  them with the SDK's `tool()`, and the roles endpoint reads the same definitions without loading the SDK.
- **A short list of roles not written yet** (new). `PLANNED_ROLES` in `sessions/roles.ts` names the designer
  (Mockup), the tester (Check) and the manager (no lane), from ARCHITECTURE.md's Roles table. A file on disk always
  wins over an entry there. Like `implemented: false` in `LANES`, the list is temporary: the slice that writes a role's
  file removes its entry. Only the missing roles are in it, so it never repeats what `roles/` already says.
- **The page names `format.md` but doesn't show it** (new). `format.md` belongs to your spec-format skill, not to the
  hive, and is long. The panel gives its full path under `specFormatDir`, which honours `HIVE_SPEC_FORMAT_DIR`.
- **The ☰ menu is a disclosure, not an ARIA menu** (new). It's a button with `aria-expanded`, and a short list of links
  under it. ARIA `role="menu"` commits to arrow-key handling that one or two links don't need. It closes the way the
  New idea form does (Escape, with focus back on the button), and also on a click outside or when a link is chosen.
- **Built from the existing blocks** (reuses). `Markdown` renders the instructions, `Chip` shows lane, model and kind,
  `Panel` holds the list and the detail, and the menu's shadow is `--shadow-tile`, like the New idea form. There are no
  new tokens.

## Goals

- See exactly what each role is told, without opening the repo.
- Make it obvious when a role gets more than its own file, and what.
- See which roles the docs plan that have no file yet.
- Start a ☰ menu in the header for pages you visit now and then, so the main nav keeps to the views in CONCEPT.md.

## Non-goals

- **Editing role files from the page.** You edit them in the repo as today.
- **The first message each lane sends.** That's written by `hive.ts` per lane, not stored as text anywhere.
- **Showing `format.md` itself,** or Claude Code's own system prompt that the role text is appended to.
- **Turn settings the session isn't told about,** such as `persist: false` or a background turn.
- **Moving Lanes, Rulebooks or Projects into the menu.** Those aren't built.
- **Live updates.** The page reads once when it opens.

## Design

### Backend

- **`listRoles(dir = ROLES_DIR)`** in `sessions/roles.ts` reads every `*.md` file in the folder. Each file becomes a
  parsed role, or `{ name, error }` when `parseRole` throws. The name is the file name without `.md`, the same name
  `loadRole` takes.
- **`ROLE_TURNS`** sits beside `LANE_ROLE` in `hive.ts`. Its keys are role names, and each entry has `specFormat`
  (file names), `report` (a schema from `spec/reports.ts`, or none) and `tools` (names from `sessions/hiveTools.ts`).
  Today:

  | Role | Spec format | Report | Tools |
  | --- | --- | --- | --- |
  | `product-owner` | | | `write_brief` |
  | `setup` | | `SETUP_SCHEMA` | `copy_local_files` |
  | `spec-writer` | `format.md` | | |
  | `spec-reviewer` | | `REVIEW_SCHEMA` | |
  | `planner` | `format.md` | `PLAN_SCHEMA` | |
  | `developer` | | `DEVELOPER_SCHEMA` | |
  | `reviewer` | | `CHECK_SCHEMA` | |
  | `committer` | | `COMMIT_SCHEMA` | |

  `startTurn()` builds `hiveTools` from the entry's tool names, which map to the same callbacks as today.
- **`Hive.roles()`** turns the listing into the response. For each role:
  - it fills `extras` with the entry's spec-format files, joined onto `deps.specFormatDir`;
  - `report` is the entry's schema;
  - `tools` holds each tool's name, description and `z.toJSONSchema(z.object(shape))`.

  Each `PLANNED_ROLES` entry with no file of the same name is added as `planned: true`. Then it sorts the roles:
  - lanes in `LANES` order;
  - within a lane, the lane's own role from `LANE_ROLE` first, then the rest alphabetically. So Product owner comes
    before Setup, Spec writer before Spec reviewer, and Reviewer before Tester;
  - roles with no lane, or a lane that isn't in `LANES`, come last, alphabetically. Today that's the manager. A file
    `parseRole` can't read has no lane either, since it throws before returning one, so it lands here too.
- **A new dependency, `HiveDeps.listRoles: () => RoleEntry[]`,** sits next to `role`. `server.ts` passes
  `() => listRoles()`, and tests pass their own list or a temporary folder. This follows how `role` is injected
  today.
- **The route** in `routes/api.ts` is `r.get("/roles", route(() => hive.roles()))`.

The shared type, in `packages/shared/src/index.ts`:

```ts
export type JsonSchema = Record<string, unknown>;
export interface RoleInfo {
  name: string;            // "developer": the file name, and what loadRole takes
  lane: Lane | null;       // from the front matter; null when missing or not a known lane
  model: string | null;    // "opus"
  kind: string | null;     // "conversation" | "work" | "one-off"
  instructions: string;    // the text after the front matter
  extras: string[];        // full paths of files appended after it, e.g. ".../spec-format/format.md"
  report: JsonSchema | null;                                          // what each turn must end with
  tools: { name: string; description: string; input: JsonSchema }[];  // the hive's own tools it's offered
  error?: string;          // set when the file can't be read as a role
  planned?: true;          // no file yet: listed from PLANNED_ROLES
}
// An errored entry has lane, model and kind null, instructions "", extras [], report null and tools [], even if
// ROLE_TURNS names it. A planned entry is the same, except that it has its lane from PLANNED_ROLES.
export interface RolesResponse { roles: RoleInfo[] }
```

### Header menu

- **`components/HeaderMenu.tsx`** is the ☰ button (44px square, `aria-label="More"`), placed after New idea.
- **Open, it shows a list** of one link: "Role prompts", with the line "What each lane's sessions are told". It
  uses the same positioning as the New idea form.
- **On `/roles`, the button looks current** (`--color-surface-muted`), since the page you're on lives behind it. It
  uses a `data-current` attribute that the CSS selects on.

### Role prompts page

- **Routes:** `pages/RolePrompts.tsx`, on both `/roles` and `/roles/:name`. `/roles` shows the first role in place,
  and the URL stays `/roles`. An unknown name keeps the list and puts "There's no role called <name>." in the panel.
- **The list** is grouped under each lane's name from `LANES`, plus an "Across lanes" group for roles with no lane.
  Lanes with no role (Ideas, Try it, Done) are left out.
  - Each entry is a link with a display name ("spec-writer" → "Spec writer") and a meta line: model · kind.
  - When the role gets anything beyond its file, the meta line ends with "· +" and a comma list: the extras' file
    names, then "report", then each tool's name. So the planner reads "Opus · work · + format.md, report", and the
    setup "Sonnet · work · + report, copy_local_files".
  - The selected entry carries `aria-current="page"`.
- **The panel**, top to bottom:
  1. **The header:** the display name, chips for "<Lane> lane", the model and "<Kind> session", and the path
     `roles/<name>.md` in mono.
  2. **A quiet note:** "Added to the end of Claude Code's own system prompt. Your CLAUDE.md and settings still apply.
     What the card needs comes in the session's first message."
  3. **The instructions,** through `Markdown`.
  4. **Also appended,** when there are extras: each one's full path in mono, with "Appended after the instructions,
     from your spec-format skill."
  5. **Report,** when there is one: "Each turn ends with this report, checked against its schema." Then the schema
     as a field list.
  6. **Hive tools,** when there are any: each tool's name in mono, its description, then its inputs as a field list.

  Sections 4 to 6 each start with a small heading in the panel's existing section-title style, and are left out when
  empty.
- **The field list** (`components/SchemaFields.tsx`) renders an object schema's properties in order. Each field shows:
  - its name, in mono;
  - its type in words: "text", "number", "whole number" (`integer`), "yes/no", "text or null", "one of done,
    blocked", "list of text", or "list of" with the item's fields nested under it;
  - its description, when there is one.

  An object nests its own fields the same way. It reads only `type`, `enum`, `items`, `properties` and
  `description`, and any other keyword is ignored. A schema shape it doesn't know shows as its `type`, or "any".
- **A role with an error** shows only the error in its panel, and the error replaces the meta line in the list.
- **A planned role** is greyed out in the list (`--color-text-subtle`, through a `data-planned` attribute), with "Not
  written yet" as its meta line. It's still a link. Its panel shows the display name and lane chip, then "Not written
  yet: there's no `roles/<name>.md`. It comes with its lane's slice."
- **The subtitle** says the text is read from `roles/` as it is now, and that a running session keeps the text it
  started with. That's true because instructions are fixed at a session's first turn (ARCHITECTURE.md, Roles).
- **A failed fetch** shows the error with `role="alert"`, as For you does.

The page differs from the mockup in four places:
- The mockup's "Sonnet · work, in the background" under Setup was written by hand. The page shows only what the file
  and `ROLE_TURNS` say: "Sonnet · work · + report, copy_local_files".
- The mockup leaves out the planned roles.
- The mockup leaves out the sections under the prompt. Its developer would end with a Report section.
- The mockup's note says "The card itself comes as the session's first message". That's not true of every role: the
  spec reviewer and the committer get a task, not the card. So the page says "What the card needs comes in the
  session's first message."

### Docs

- **`ARCHITECTURE.md`:** `GET /api/roles` goes into the API list, and "Role prompts" into the page list in the
  diagram and in `pages/`.
- **`CONCEPT.md`:** "Role prompts" goes under The Page.
- **The changelog entry** is `docs/changelog/<date>-role-prompts-page.md`.

## Alternatives considered

- **Show the whole appended text,** with `format.md` in full after the spec writer's and planner's instructions.
  Rejected: it shows a long file the hive doesn't own, and repeats it twice.
- **Bundle `roles/*.md` into the frontend at build time** (`import.meta.glob` with `?raw`). Rejected: the built
  page served on 4317 would show the files as of the last build, not what the next session gets.
- **Leave reports and tools out, or only name them.** Rejected: most roles get a report schema or a tool that their
  file doesn't mention. Without them, the page would suggest that the developer gets nothing beyond its file.
- **Show the raw JSON schema.** Rejected: the field list says the same thing in a form you can read at a glance.
- **A plain "Role prompts" link in the header nav instead of the ☰ menu.** Rejected: you asked for the menu, so that
  pages you visit now and then don't crowd the main nav.
- **Show only what's in `roles/`, without the planned roles.** Rejected: you wanted the roles still to come visible,
  greyed out. `PLANNED_ROLES` is the cost, and each lane's slice removes its entry, as with `implemented: false`.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead first adds `RoleInfo` / `RolesResponse` to `packages/shared`, then
  builds the backend and the docs:
  - `sessions/roles.ts` and `sessions/hiveTools.ts`;
  - `ROLE_TURNS`, wired into `turnOptions()`, `startTurn()` and the committer's turn;
  - `Hive.roles()`, the route, `server.ts`, and tests.

  Once the type is in, a subagent builds the frontend in parallel: `HeaderMenu`, `Header.tsx`, `SchemaFields`,
  `pages/RolePrompts.tsx`, the route in `main.tsx`, `api.roles()`, CSS modules and tests. The lead then runs the
  frontend CLAUDE.md's Playwright check end to end.
- **Opus 5.5 lead, Sonnet 5.5 for the frontend.** Moving every role's turn settings into `ROLE_TURNS` touches how
  every session starts, so it must leave each session exactly as it is today, and that's the part needing judgment.
  The frontend renders a settled type.
