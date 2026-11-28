# Mockup lane and designer role

Builds the Mockup lane. At Refine's Good you pick between two buttons: go on to Mockup, or skip to Spec. In Mockup a
designer session makes the mockup with you, as plain HTML pages in one folder of the card's worktree,
`docs/mockups/<card>/`. It edits the pages in place as you comment in the chat. If you'd rather use Claude Design, you
make the mockup yourself on claude.ai and paste its link into the chat. Either way, the designer tells the hive which
mockup is current through a hive tool, and the card page links to it: the hive serves HTML pages itself, and a Claude
Design mockup shows as its link. Good is the accept, with two buttons. Keep the mockup, and its folder is committed on
the card's branch. Don't keep it, and nothing from Mockup reaches the branch. Then the spec writer starts with the
Mockup chat and where the mockup is.

## Outcome

**What you get:**

- **Two ways out of Refine:** "Good · on to Mockup" and "Good · skip to Spec".
- **A Mockup lane:** the designer's chat sits next to a Mockup panel. The designer opens with a first HTML mockup, and
  it edits the mockup as you comment. The panel's link always opens the current mockup: a page the hive serves, or the
  Claude Design link you pasted. When you ask, the designer writes a starting prompt for Claude Design. When you paste a
  link, it asks for exported files or a description, and sums up the look in the chat.
- **Two ways out of Mockup:** "Good · keep in docs/mockups" commits `docs/mockups/<card>/` on the card's branch, so the
  mockup lands with the card. "Good · don't keep" leaves nothing from Mockup on the branch, and until sign-off "Keep it
  after all" can still commit it. Both go to Spec, where the spec writer is told about the Mockup chat and the mockup.
- **Looking back:** Mockup shows its chat and the mockup, or "– Mockup" when the card skipped it. Role prompts lists the
  designer under Mockup.

**How to verify:**

- **The mockup:** on a card in Refine, press "Good · on to Mockup". The designer replies with a first mockup. "Open the
  mockup" opens it in a new tab, at `/api/cards/<id>/mockup/…`. Ask for a change, then reload the tab: the change is
  there.
- **Claude Design:** ask for a Claude Design prompt, and you get one you can copy. Paste a claude.ai link and say to use
  it. The panel's link becomes that URL, and the designer asks for exported files or a description of the screens.
  Until the folder has files, the Good buttons' hint says the hive can't open the link.
- **Keep:** press "Good · keep in docs/mockups". The card's branch gets a new commit, `Mockup: <title>`, which touches
  only `docs/mockups/<card>/`. Ask the spec writer where the mockup is, and it names that folder.
- **Don't keep, and skip:** on another card, press "Good · don't keep". No commit is made, and Spec says the pages are
  deleted at sign-off. After sign-off the folder is gone from the worktree, and `git status` there doesn't list it. On a
  third card, press "Good · don't keep", then "Keep it after all" in Spec: the `Mockup: <title>` commit appears. On a
  fourth, press "Good · skip to Spec". The lane strip shows "– Mockup", not as a link.

## Key decisions

- **A hive tool names the current mockup** (extends). A new `set_mockup` tool, offered to the designer through
  `ROLE_TURNS` like `write_brief` is to the product owner, takes a `page` in the card's folder or a `link`. The card
  stores what it names. Plain code never reads the designer's prose to find the mockup, or guesses it from the newest
  file.
- **One folder per card, from the first page** (new). The designer writes only in `docs/mockups/<card>/`, where
  `<card>` is the worktree's folder name, the same slug as the branch `hive/<card>`. Keeping the mockup commits that
  folder alone with the existing `commitFile`, the same way sign-off commits only the spec. So the path the designer
  works in is the path that lands, and there's nothing to copy at Good. It never builds the mockup inside the app, and
  it changes no app code.
- **The hive serves the folder itself, sandboxed** (new). `GET /api/cards/:id/mockup/<path>` sends files from that one
  folder only. It sends them with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`,
  so a page's scripts run in an opaque origin and can't read the hive's API. That opaque origin also makes the page's
  own folder cross-origin to it, so this route alone adds `Access-Control-Allow-Origin: *`. Those requests carry
  `Origin: null`, which the hive's local-only guard (`localOnly` in `security.ts`) refuses for any other request. So
  the guard lets `Origin: null` through for `GET` and `HEAD` of a mockup file only, and keeps its Host check. Module
  scripts, `fetch()` of a sibling file and fonts from the folder then work. The cost is that any web page in your
  browser could read a mockup's files, through a sandboxed frame of its own, if it knew the card id. It can't make any
  other request. `Cache-Control: no-store` makes a reload show the designer's latest edit. No server per card, and no
  ports.
- **A mockup you don't keep is removed at sign-off, not at Good** (extends). The brief says it leaves nothing on the
  branch. That stays true: sign-off commits only the spec. Keeping the pages in the worktree until then lets the spec
  writer read them while it writes, as the brief's "where the mockup is" needs. It also lets you change your mind: in
  Spec, "Keep it after all" runs the same commit. The pages have to go at sign-off, though: Build's checkpoint
  (`git add -A`) would otherwise commit them. So this rests on two exits that make no checkpoint: leaving Mockup with
  Don't keep commits nothing, and sign-off commits only the spec. A checkpoint added later to either exit must leave an
  unkept mockup folder out.
- **Claude Design is a link, plus the files you export** (new). The hive never talks to claude.ai. When you keep a
  Claude Design mockup, the hive writes a `README.md` with its link into the folder. Since no session can open the
  link, the designer closes the gap: when it sets a link, it asks for a path to exported files or a description of the
  screens, copies in any exports, and writes a short summary of the look into the chat. The spec writer reads that
  summary in the Mockup chat. Good's buttons show a hint while a link has no exported files beside it.
- **Good carries the choice** (extends). The one `POST /good` endpoint takes `{ skipMockup?: boolean }` in Refine and
  `{ keep: boolean }` in Mockup. `board/moves.ts` sends `good` from Refine to Mockup and from Mockup to Spec, and gets a
  new action, `skip-mockup`, from Refine to Spec.
- **A skip is `mockup: null` on the card** (extends). There are no lane-visit records. The card gets a `mockup` field
  when it enters Mockup, and a card without one skipped the lane: "– Mockup", with nothing to look back at. This settles
  what `2026-11-27-card-lane-artifacts` left to this spec.
- **The `implemented` lane flag goes** (breaking). Mockup was the last lane with `implemented: false`, and the flag's
  own comment says it goes once every lane exists. `laneImplemented` goes with it, and so do its callers: the "Not
  implemented yet" badge in `cardBadge.ts` and branch in the card page, the check in For you's `waitsForYou`, and
  `LaneSteps`' and `lookBackLanes`' use of it for skips. Every caller is in this repo.

## Goals

- Agree on a card's look before its spec is written, in the same chat-and-artifact shape as Refine.
- Let you use whichever tool suits the card: the designer's HTML, or your own Claude Design.
- Leave the branch clean unless you choose to keep the mockup.

## Non-goals

- Mockups built inside the app, and the hive running the card's app during Mockup.
- The hive making, editing or syncing Claude Design mockups.
- Dropping or uploading files into the card's chat.
- Keeping a copy of a mockup you didn't keep in the hive's own data.
- Versions kept or compared side by side, the ◆ badge, and picking a version.
- Comments pinned by clicking on the mockup, the mockup framed inside the card page, and a screenshot at Good.
- Try it feedback about the look going back to Mockup, and the tester comparing screens with the mockup.
- Enforcing the designer's limits. As with every role, they live only in its instructions.

## Design

### The card's mockup

The shared types, in `packages/shared/src/index.ts`:

```ts
export type MockupRef =
  | { kind: "pages"; page: string }   // the page to open, relative to the worktree: "docs/mockups/<card>/index.html"
  | { kind: "link"; url: string };    // a Claude Design mockup, or any https page you pasted
export interface MockupInfo {
  folder: string;             // "docs/mockups/<card>", relative to the worktree
  current: MockupRef | null;  // what the designer last named with set_mockup
  kept: boolean | null;       // your choice at Good; null while the card is in Mockup
  files: string[];            // the folder's files, relative to it, read now; [] once the folder or worktree is gone
}
// CardDetail.mockup: MockupInfo | null, null when the card never entered Mockup.
// SSE: { type: "mockup.updated"; cardId; mockup: MockupInfo }
```

- **Storage:** `cards.mockup` is a JSON column holding `{ folder, current, kept }`. `card()` adds `files` by walking the
  folder: dotfiles are skipped, the list is sorted and stops at 200 entries. The folder is stored, not derived, so a
  landed card with no worktree still knows its path.
- **The `ChatAuthor` `"designer"`** is added, shown as "Designer".

### Into Mockup

`Hive.good(cardId, body)` in Refine:

- **`skipMockup: true`** does what Good does today: it starts the spec writer. The shared part moves into
  `enterSpec(cardId)`, and `mockup` stays null.
- **Otherwise,** it first loads `roles/designer.md`. A missing or broken file refuses the move, so the card stays in
  Refine. Then it sets the lane to Mockup and `mockup` to `{ folder, current: null, kept: null }`. It starts a new
  designer session (a conversation, on the worktree) with `designerFirstMessage`, which holds:
  - the idea;
  - the brief;
  - the Refine chat;
  - the folder;
  - a request to open with a first mockup through `set_mockup`, and to say in a line that Claude Design is the
    alternative.

Mockup joins `CHAT_LANES`, so your messages, `AskUserQuestion`, Stop, Retry and a turn cut off by a restart all work as
they do in Refine. For you says "Reply to the designer, or say Good."

### `set_mockup`

The tool goes in `sessions/hiveTools.ts` beside `write_brief`, with a `setMockup` callback on `HiveTools`. Its shape is
`{ page?: string; link?: string }`, and exactly one must be set. Each call replaces the current mockup.

- **`page`** is a path relative to the worktree, inside the card's folder. It must end in `.html` and exist. The check
  resolves the real path, so `..` or a symlink can't point outside the folder.
- **`link`** must parse as an `https:` URL.
- A call made while the card isn't in Mockup is refused.
- Like `write_brief`, it answers in text: "Not saved: …" with the reason, or "The Mockup panel now opens <page or URL>."
  Saving also sends `mockup.updated`.

### Serving the pages

`Hive.mockupFile(cardId, path)` resolves `path` against `<worktree>/<folder>`. It returns the folder and the file's
path relative to it, never an absolute path. It answers 404 when:

- the card has no mockup or no worktree;
- the file is missing or a dotfile;
- the real path lies outside the folder.

The route calls `sendFile(relativePath, { root: <worktree>/<folder> })`, with the two headers from Key decisions. The
`root` matters: every worktree sits under `<repo>/.claude/worktrees/`, and `sendFile` refuses an absolute path with a
dot-folder in it, the failure `2026-11-27-card-lane-artifacts` records for the page's `index.html`. With `root`, its
dot-folder check covers only the part inside the mockup folder, which also enforces the dotfile rule. The URL mirrors the folder,
so a page's relative links to its CSS, images and other pages just work. Vite already proxies `/api` in development.
The CORS header, with the guard's `Origin: null` exception for mockup reads, lets the sandboxed page load its own module
scripts, fonts and `fetch()`ed files. `localStorage` still throws in an opaque origin, which a clickable mockup rarely
needs.

### Out of Mockup

`Hive.good(cardId, { keep })` in Mockup refuses while a turn runs or a question waits, as in Refine. `keep` is required.

- **Keep** refuses until the designer has named a mockup, and refuses an HTML mockup whose folder is empty.
  - For a link, the hive writes `<folder>/README.md`: the card's title, the line "The mockup for this card, made in
    Claude Design: <url>", and a note that any exported files sit beside it. If a `README.md` is already there, the hive
    adds the link line at its end, unless the link is already in it.
  - Then it runs `commitFile(worktree, folder, "Mockup: <title>")`. A git error refuses the move, and the card stays in
    Mockup.
  - It sets `kept: true`.
- **Don't keep** sets `kept: false`, and leaves the folder in place for now.
- **Either way** the card goes on to `enterSpec`.

**Keep it after all.** While the card is in Spec, `POST /api/cards/:id/keep-mockup` runs the same steps as Keep: the
README for a link, then the commit. It sets `kept: true` and sends `mockup.updated`. It's refused unless `kept` is
false, and while the card is moving. Beyond that it refuses what Keep refuses: until the designer has named a mockup,
and for pages, once the folder has no files. A link needs no files. The README step recreates the folder if it's gone,
so a link can still be kept after a Back to Spec, before the next sign-off, while pages deleted at sign-off can't.
It commits only the mockup folder, so it doesn't
touch the spec or its review, and it doesn't wait for the spec writer's turn. A note in the Spec chat records it. The
spec writer gets no turn of its own, since that could change the spec under its review. If the spec should point at
the mockup, you tell it.

**At sign-off,** after the spec is committed, a card with `kept: false` has its folder deleted from the worktree. It
was never committed. A failed delete refuses sign-off, so the folder can't reach Build's checkpoint. If you go Back to
Spec and sign off again, there's nothing left to delete.

### The spec writer's first message

`specFirstMessage` gets two more sections after the Refine chat. Each chat transcript comes from one helper,
`chatTranscript(cardId, lane, label)`.

- **The Mockup chat,** as `you:` / `designer:` lines.
- **The mockup,** one paragraph by case:

  | Case | What the spec writer is told |
  | --- | --- |
  | Pages, kept | The folder and the page you approved. They land with the card. Read them, and point the spec at them as the look. |
  | Pages, not kept | The folder. Read the pages now, but the hive deletes them at sign-off, so the spec mustn't point at them. |
  | Link, kept | The URL, which it can't open, since claude.ai needs your login. Go by the designer's summary of the look in the chat, and by the README and any exported files in the folder. |
  | Link, not kept | The URL, which it can't open. Go by the designer's summary in the chat, and by any exported files in the folder until sign-off. |
  | No mockup named | You went on without one. Go by the chat. |
  | Skipped | One line: you skipped Mockup, so there's no mockup. |

### The designer's role

`roles/designer.md` has `lane: mockup`, `model: opus` and `kind: conversation`. `ROLE_TURNS` gets
`designer: { tools: ["set_mockup"] }`, and `designer` leaves `PLANNED_ROLES`. Its instructions say:

- **Where:** the mockup is plain HTML pages, with their CSS and scripts, in the folder the message gives. Write no other
  file, never build the mockup inside the app, and change no app code. Don't commit, and don't start servers: the hive
  serves the folder.
- **The look:** read the app's code and styles, and copy its colours, fonts and components into the mockup, so it looks
  like the real thing.
- **Iterating:** edit the pages in place. Each change replaces the mockup. Call `set_mockup` with the page to open
  first, and again whenever that page changes.
- **Claude Design:** the person works on claude.ai themselves. When they ask, write a starting prompt from the brief
  and the chats, in a fenced block they can copy. When they paste a link, call `set_mockup` with it.
- **Close the gap a link leaves:** no session can open claude.ai. So when you set a link, ask with `AskUserQuestion`
  for a path to exported files, or for a description of the screens. Copy any exports into the folder; the hive writes
  the folder's `README.md`. Then write a short summary of the look into the chat, since the spec writer reads it there.
- **Keep the folder current:** when the mockup moves from pages to a link, remove the pages that are no longer part of
  it, so keeping it saves only what's current.
- **Asking and replying:** ask questions with `AskUserQuestion`, keep replies short, say when you think the mockup is
  ready, and leave Good, and the choice to keep the mockup, to the person.

### The card page

- **Refine:** `GoodBar` shows "Good · on to Mockup" (primary) and "Good · skip to Spec". The hint reads: "Happy with
  the brief? Mock up the look, or skip to the spec when there's nothing to show."
- **Mockup:** the left column is the Designer chat, with a `MockupBar` at the end of its Send row. It shows "Good · keep
  in docs/mockups" (primary) and "Good · don't keep". Keep is disabled, with a hint, until a mockup is named. Both are
  disabled while the designer is working. While the current mockup is a link and the folder has no files, the hint
  reads: "The hive can't open this link. Give the designer a path to exported screens, or the spec goes by the chat
  alone." The right column is a Mockup panel above the Brief panel:
  - **Pages:** "Open the mockup ↗", opening `/api/cards/<id>/mockup/<page within the folder>` in a new tab (`rel="noopener"`),
    the page's path in mono, and "Reload the tab after the designer's changes."
  - **A link:** "Open the mockup ↗" to the URL, with the URL in mono.
  - **None yet:** "The designer's mockup shows here once it has one."
  - `mockup.updated` updates it live, through `cardState` as `brief.updated` does.
- **The same buttons in For you:** Refine's two Goods and Mockup's two Goods are lane actions in `LANE_ACTIONS`
  (`packages/shared/src/laneActions.ts`, from `2026-11-28-for-you-actions`), with these labels. Refine gets `good` and
  `skip-mockup`. Mockup gets `keep`, `dont-keep`, `retry` and `stop`, as a chat lane. So For you offers the same choices
  as the card page. Keep is greyed there for the same reasons: until a mockup is named, and when a folder of pages is
  empty.
- **Spec, with a mockup you didn't keep:** while Keep it after all would be accepted, a line above the spec says what
  isn't kept, with a "Keep it after all" button:
  - **Pages:** "The mockup isn't kept: its pages are deleted at sign-off."
  - **A link:** "The mockup isn't kept: its link isn't saved in docs/mockups." When files sit beside it, the line adds
    ", and the files beside it are deleted at sign-off".

  The look-back view stays read-only, so the action sits here.
- **Looking back at Mockup:** the chat is titled "Designer". The Mockup panel shows:
  - **Kept:** "Kept in docs/mockups/<card>/", with the file list, each file a link while it's in the worktree. Once the
    worktree is gone: "Kept: on main at docs/mockups/<card>/."
  - **Not kept, pages:** "Not kept." With the link while the pages still exist (in Spec), and "Its pages were deleted at
    sign-off." after that.
  - **A link,** kept or not: the URL.
  - **Nothing named:** "No mockup was made."
- **Skips:** `skippedLanes(detail)` returns `["mockup"]` when the card is past Mockup with `mockup` null, and nothing
  otherwise. `LaneSteps` draws those lanes as "– skipped", not as links, and `lookBackLanes` leaves them out. Older
  cards, which all went straight from Refine to Spec, show "– Mockup".

`docs/mockups/CardMockup.dc.html` shows versions with pinned comments, which are out of scope. This lane differs from it
on purpose: one chat and one Mockup panel with a link, like Refine's layout. The buttons use the mockup's "Good · …"
wording.

### Docs

- **`CONCEPT.md`:**
  - the Mockup row of The Board: HTML pages from the designer, or your own Claude Design, never in the app; you skip
    the lane from Refine; Good keeps the mockup or not;
  - the Mockups section, to the same effect, with where a kept mockup lives.

  Versions, pinned comments and the screenshot at Good stay, as future work.
- **`ARCHITECTURE.md`:**
  - the designer's row in Roles: "Only its mockup folder, `docs/mockups/<card>/`";
  - the Refine and Mockup rows of Card Moves, plus sign-off's delete;
  - `Card.mockup` in the data model;
  - the `good` body, the mockup route and `keep-mockup` in the API;
  - in the Preview service, "Mockup will use the same runner" goes;
  - in Frontend, the `implemented` bullet goes.
- **The changelog entry** `docs/changelog/2026-11-28-mockup-lane-and-designer-role.md`. It revisits
  `2026-11-27-mockups-designers-call`, since mockups are no longer "in the app or a page of its own", and settles
  `2026-11-27-card-lane-artifacts`'s skip.

## Open questions

- **Q:** Should the designer open with a first HTML mockup straight away, or ask first which kind you want?
  **Default:** straight away, the way the product owner opens with a draft brief. Its first reply says in a line that
  you can use Claude Design instead.
- **Q:** Should the Spec lane also link to the mockup, beside the spec? **Default:** no. Looking back at Mockup has it,
  and the brief doesn't ask for it.
- **Q:** Should `set_mockup` accept any https link, or only claude.ai? **Default:** any https link. It's shown only as a
  link, and limiting it to claude.ai would turn away a Figma link for no gain.

## Alternatives considered

- **Delete an unkept mockup at Good.** Rejected: the spec writer couldn't read the pages, and the brief gives it
  "where the mockup is".
- **A git-ignored scratch folder, copied into `docs/mockups/<card>/` at keep.** Rejected: two places, a copy step, and
  a path that changes at Good under anything that cited it.
- **Serve the pages on the card's own port, from a static server.** Rejected: a process to start, sweep and stop for
  each card, to send files the backend can send itself.
- **Find the current mockup from the designer's reply, or from the newest `.html` file.** Rejected: routing on prose,
  which the backend's rules forbid.
- **Keep `implemented`, set to true everywhere.** Rejected: an always-true flag that the code's own comment says should
  go.
- **Sandbox without CORS, with the limits in the designer's role.** Rejected: exported Claude Design files would still
  break.
- **No sandbox: serve the pages same-origin.** Rejected: a mockup's script, or an exported third-party file, could call
  the hive's API, which has no auth.
- **Good refuses a link mockup until the folder holds something readable.** Rejected in favour of the designer asking,
  plus a hint.
- **Accept the Claude Design gap, and only say so on the page.** Rejected: the spec would quietly miss the look.
- **One-way Don't keep, with warnings only.** Rejected: you can still change your mind in Spec, cheaply, since the
  folder is there.
- **Leave Don't keep as first written, with no way back.** Rejected for the same reason.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead first settles `MockupRef`, `MockupInfo`, `mockup.updated` and the
  `good` body in `packages/shared`, and drops `implemented` there and in `forYou.ts`. Then it builds the backend and
  the docs:
  - `board/moves.ts`, the `cards.mockup` column, and `set_mockup` in `hiveTools.ts` and `sdkRunner.ts`;
  - in `hive.ts`: `good`, `enterSpec`, `keepMockup`, sign-off's delete, both first messages, `mockupFile` and For you;
  - the route, `roles/designer.md`, `CONCEPT.md`, `ARCHITECTURE.md`, the changelog entry, and tests.

  Once the types are in, a subagent builds the frontend in parallel: `GoodBar`, `MockupBar` and its hints, the Mockup
  panel and its look-back, Spec's "Keep it after all" line, `skippedLanes` in `LaneSteps` and `Card.tsx`, the removal
  of `implemented` from `cardBadge.ts`,
  `LaneSteps` and `Card.tsx`, `cardState`, and tests. The
  lead then runs the frontend CLAUDE.md's Playwright check.
- **Opus 5.5 lead, Sonnet 5.5 for the frontend.** The folder confinement, the sandboxed route and the delete at
  sign-off carry the risk. The frontend renders a settled type.

## Amendments

- 2026-11-28: The sandboxed-serving Key decision and Serving the pages now say that the local-only guard lets `Origin: null` through for GET and HEAD of mockup files only. Without that exception the guard refuses those requests before the CORS header matters; the cost you accepted is unchanged.
- 2026-11-28: Keep it after all now refuses what Keep refuses (a named mockup, and files only for pages), and the Spec line has wording for a link. This brings the body in line with the code-wrong verdicts on the link-only and unnamed-pages issues; the Outcome's "until sign-off" is unchanged.
- 2026-11-28: The card page now says Refine's and Mockup's Good buttons are lane actions in `LANE_ACTIONS`, so For you offers them too, with Keep greyed for the same reasons. The For you actions spec landed on main after sign-off and left Mockup's list for this card to fill.
- 2026-11-28: The Key decision on removing an unkept mockup at sign-off now says that leaving Mockup and signing off make no checkpoint, and that a later checkpoint at either exit must leave an unkept mockup folder out. Don't keep relies on this, and ARCHITECTURE.md's "Each lane exit" row doesn't yet make the exception.
