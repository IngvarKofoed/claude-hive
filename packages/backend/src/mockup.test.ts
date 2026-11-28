// The Mockup lane and the designer (docs/specs/2026-11-28-mockup-lane-and-designer-role.md), driven through a fake
// runner on a throwaway repo, with real git for Keep's commit and sign-off's delete.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive, listMockupFiles, type GitService } from "./hive";
import type { Role } from "./sessions/types";
import { FakeProbe, FakeRunner, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
};
const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "…", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }],
  tests: ["clamps to 8–48"],
};
const LINK = "https://claude.ai/design/p/abc123";

describe("the Mockup lane", () => {
  let db: HiveDb;
  let hub: EventHub;
  let runner: FakeRunner;
  let hive: Hive;
  let events: HiveEvent[];
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let brokenRoles: Set<string>;
  let gitService: GitService;

  const role = (name: string): Role => {
    if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
    return { name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "conversation", instructions: `Be the ${name}.` };
  };
  const newHive = () =>
    new Hive({
      db, hub, git: gitService, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir,
      today: () => "2026-11-28",
    });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    hub = new EventHub();
    runner = new FakeRunner();
    events = [];
    hub.subscribe((e) => events.push(e));
    format = makeSpecFormat();
    repo = makeRepo();
    brokenRoles = new Set();
    gitService = git;
    hive = newHive();
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    db.close();
  });

  const turnsOf = (roleName: string) => runner.turns.filter((t) => t.request.role.name === roleName);
  const mockupEvents = (id: string) =>
    events.flatMap((e) => (e.type === "mockup.updated" && e.cardId === id ? [e.mockup] : []));
  const run = (worktree: string, ...args: string[]) =>
    // A throwaway repo's own git, in the card's worktree.
    repo.git("-C", worktree, ...args);
  const commits = (worktree: string) => run(worktree, "log", "--format=%s").trim().split("\n");

  /** A card in Refine whose product owner has written a brief and said one line. */
  async function refined() {
    if (hive.board().projects.length === 0) await hive.addProject(repo.root);
    const card = hive.createCard(hive.board().projects[0]!.id, "Font", "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done");
    const po = runner.last;
    await po.request.hiveTools!.writeBrief!(brief);
    po.handlers.onTextBlock("Here is a first brief.");
    po.handlers.onSessionCreated();
    await po.end();
    return card.id;
  }

  /** A card in Mockup, its designer's first turn still running. */
  async function inMockup() {
    const id = await refined();
    await hive.good(id);
    const card = hive.card(id);
    const worktree = card.worktreePath!;
    const folder = card.mockup!.folder;
    return { id, designer: runner.last, worktree, folder, dir: join(worktree, folder) };
  }

  /** A card in Mockup whose designer has written pages, named one and finished its turn. */
  async function withPages() {
    const m = await inMockup();
    mkdirSync(join(m.dir, "css"), { recursive: true });
    writeFileSync(join(m.dir, "index.html"), "<!doctype html><link rel=stylesheet href=css/app.css><h1>Fonts</h1>\n");
    writeFileSync(join(m.dir, "css", "app.css"), "h1 { color: red; }\n");
    const answer = await m.designer.request.hiveTools!.setMockup!({ page: `${m.folder}/index.html` });
    m.designer.handlers.onTextBlock("Here is a first mockup.");
    m.designer.handlers.onSessionCreated();
    await m.designer.end();
    return { ...m, answer };
  }

  /** A card in Mockup whose designer has named a Claude Design link and finished its turn. */
  async function withLink() {
    const m = await inMockup();
    await m.designer.request.hiveTools!.setMockup!({ link: LINK });
    m.designer.handlers.onTextBlock("The look: one settings page with a size field per printer.");
    m.designer.handlers.onSessionCreated();
    await m.designer.end();
    return m;
  }

  /** The spec writer's first turn ends with a spec on disk, the blind review finds nothing, and you sign off. */
  async function signOff(id: string) {
    const writer = turnsOf("spec-writer").at(-1)!;
    const card = hive.card(id);
    writeFileSync(join(card.worktreePath!, card.spec!.path), "# Printer font size\n\nThe spec.\n");
    writer.handlers.onSessionCreated();
    if (!writer.interrupted) await writer.end();
    hive.review(id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    return hive.signoff(id);
  }

  describe("into Mockup", () => {
    it("Good from Refine makes the card's folder and starts the designer with the idea, brief, chat and folder", async () => {
      const { id, designer, worktree, folder, dir } = await inMockup();
      const card = hive.card(id);
      expect(card.lane).toBe("mockup");
      expect(folder).toBe(`docs/mockups/${worktree.split("/").at(-1)}`);
      expect(card.mockup).toEqual({ folder, current: null, kept: null, files: [] });
      expect(existsSync(dir)).toBe(true);
      // An empty folder is invisible to git: nothing from Mockup is on the branch yet.
      expect(run(worktree, "status", "--porcelain").trim()).toBe("");

      expect(designer.request.role.name).toBe("designer");
      expect(designer.request.cwd).toBe(worktree);
      expect(designer.request.message).toContain("Title: Font");
      expect(designer.request.message).toContain("The idea: Make the printer font adjustable.");
      expect(designer.request.message).toContain("Problem: Labels are too small.");
      expect(designer.request.message).toContain("product owner: Here is a first brief.");
      expect(designer.request.message).toContain(`${folder}/`);
      expect(designer.request.message).toContain("set_mockup");
      expect(designer.request.message).toContain("Claude Design");
      expect(designer.request.hiveTools?.setMockup).toBeTypeOf("function");
      expect(designer.request.hiveTools?.writeBrief).toBeUndefined();
      expect(mockupEvents(id).at(-1)).toEqual({ folder, current: null, kept: null, files: [] });
    });

    it("refuses while a broken designer role can't be loaded, and leaves the card in Refine", async () => {
      const id = await refined();
      brokenRoles.add("designer");
      await expect(hive.good(id)).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/designer/) });
      const card = hive.card(id);
      expect(card.lane).toBe("refine");
      expect(card.mockup).toBeNull();
      expect(existsSync(join(card.worktreePath!, "docs", "mockups"))).toBe(false);
    });

    it("skip to Spec leaves the card without a mockup", async () => {
      const id = await refined();
      await expect(hive.good(id, { skipMockup: "yes" as unknown as boolean })).rejects.toMatchObject({ status: 400 });
      await hive.good(id, { skipMockup: true });
      expect(hive.card(id)).toMatchObject({ lane: "spec", mockup: null });
      expect(turnsOf("designer")).toHaveLength(0);
    });

    it("is a chat lane: your messages go to the designer, its text is the Designer's, and For you asks you to reply", async () => {
      const { id, designer } = await withPages();
      hive.sendMessage(id, "Make the field wider.");
      const next = runner.last;
      expect(next).not.toBe(designer);
      expect(next.request).toMatchObject({ resume: true, message: "Make the field wider." });
      expect(next.request.hiveTools?.setMockup).toBeTypeOf("function");
      next.handlers.onTextBlock("Wider now.");
      await next.end();
      const chat = hive.card(id).chat.flatMap((c) => (c.kind === "message" ? [[c.from, c.text]] : []));
      expect(chat).toEqual([["designer", "Here is a first mockup."], ["you", "Make the field wider."], ["designer", "Wider now."]]);
      expect(hive.forYou().items.find((i) => i.card.id === id)).toMatchObject({
        kind: "your-turn", text: "Reply to the designer, or say Good.",
      });
    });

    it("marks a Mockup turn cut off by a restart, and waits for you instead of resuming it", async () => {
      const { id } = await inMockup();
      const restarted = newHive();
      restarted.recoverAfterRestart();
      const card = restarted.card(id);
      expect(card).toMatchObject({ lane: "mockup", state: "needs-you", turnRunning: false });
      expect(card.chat.at(-1)).toMatchObject({ kind: "error", message: expect.stringMatching(/cut off/), actions: [] });
      expect(turnsOf("designer")).toHaveLength(1);
      restarted.close();
    });
  });

  describe("set_mockup", () => {
    it("saves a page inside the folder, and sends mockup.updated", async () => {
      const { id, folder, answer } = await withPages();
      expect(answer).toBe(`The Mockup panel now opens ${folder}/index.html.`);
      const mockup = hive.card(id).mockup!;
      expect(mockup.current).toEqual({ kind: "pages", page: `${folder}/index.html` });
      expect(mockup.files).toEqual(["css/app.css", "index.html"]);
      expect(mockupEvents(id).at(-1)).toEqual(mockup);
    });

    it("saves an https link, with no files beside it", async () => {
      const { id } = await withLink();
      expect(hive.card(id).mockup).toMatchObject({ current: { kind: "link", url: LINK }, files: [] });
      expect(mockupEvents(id).at(-1)!.current).toEqual({ kind: "link", url: LINK });
    });

    it("sends the folder's files again when a designer turn ends, so exports copied in beside a link show", async () => {
      const { id, designer, dir } = await inMockup();
      await designer.request.hiveTools!.setMockup!({ link: LINK });
      expect(mockupEvents(id).at(-1)!.files).toEqual([]);
      writeFileSync(join(dir, "settings.png"), "png"); // the person's export, copied in after set_mockup
      designer.handlers.onTextBlock("The look: a size field per printer.");
      await designer.end();
      expect(mockupEvents(id).at(-1)).toMatchObject({ current: { kind: "link", url: LINK }, files: ["settings.png"] });
    });

    it("refuses pages outside the folder, other files, both or neither field, and plain http", async () => {
      const { id, designer, folder, dir, worktree } = await inMockup();
      const set = designer.request.hiveTools!.setMockup!;
      writeFileSync(join(dir, "index.html"), "<p>in</p>");
      writeFileSync(join(dir, "notes.txt"), "notes");
      writeFileSync(join(worktree, "docs", "mockups", "escape.html"), "<p>out</p>");
      writeFileSync(join(worktree, "outside.html"), "<p>out</p>");
      symlinkSync(join(worktree, "outside.html"), join(dir, "link.html"));
      const before = events.length;

      const refusals = [
        await set({ page: `${folder}/../escape.html` }),
        await set({ page: `${folder}/link.html` }),
        await set({ page: `${folder}/notes.txt` }),
        await set({ page: `${folder}/missing.html` }),
        await set({ page: `${folder}/index.html`, link: LINK }),
        await set({}),
        await set({ link: "http://claude.ai/design/p/abc123" }),
        await set({ link: "not a url" }),
      ];
      for (const text of refusals) expect(text).toMatch(/^Not saved: /);
      expect(refusals[0]).toContain("inside");
      expect(refusals[1]).toContain("inside");
      expect(refusals[3]).toContain("doesn't exist");
      expect(refusals[4]).toContain("exactly one");
      expect(refusals[6]).toContain("https://");
      expect(hive.card(id).mockup!.current).toBeNull();
      expect(events.slice(before).filter((e) => e.type === "mockup.updated")).toEqual([]);
    });

    it("refuses a call once the card has left Mockup", async () => {
      const { id, designer, folder } = await withPages();
      await hive.good(id, { keep: false });
      const text = await designer.request.hiveTools!.setMockup!({ page: `${folder}/index.html` });
      expect(text).toMatch(/^Not saved: .*isn't in Mockup/);
    });
  });

  describe("the folder's files", () => {
    it("skips dot entries and symlinks, lists nested files sorted, and stops at 200", () => {
      const dir = join(repo.root, "m");
      mkdirSync(join(dir, "b", ".hidden"), { recursive: true });
      mkdirSync(join(dir, "many"));
      writeFileSync(join(dir, "z.html"), "");
      writeFileSync(join(dir, "a.html"), "");
      writeFileSync(join(dir, ".DS_Store"), "");
      writeFileSync(join(dir, "b", "c.css"), "");
      writeFileSync(join(dir, "b", ".hidden", "x.css"), "");
      symlinkSync(repo.root, join(dir, "up"));
      expect(listMockupFiles(dir)).toEqual(["a.html", "b/c.css", "z.html"]);
      for (let i = 0; i < 250; i++) writeFileSync(join(dir, "many", `f${String(i).padStart(3, "0")}.png`), "");
      const files = listMockupFiles(dir);
      expect(files).toHaveLength(200);
      expect(files.slice(0, 3)).toEqual(["a.html", "b/c.css", "many/f000.png"]);
      expect(listMockupFiles(join(repo.root, "nowhere"))).toEqual([]);
    });

    it("are [] on the card once the folder is gone", async () => {
      const { id, dir } = await withPages();
      rmSync(dir, { recursive: true });
      expect(hive.card(id).mockup!.files).toEqual([]);
    });
  });

  describe("Keep", () => {
    it("commits only the card's folder as 'Mockup: <title>' and moves on to Spec", async () => {
      const { id, worktree, folder } = await withPages();
      writeFileSync(join(worktree, "app.txt"), "changed elsewhere\n"); // not the mockup's: stays uncommitted
      const before = commits(worktree).length;
      await hive.good(id, { keep: true });
      expect(commits(worktree)).toHaveLength(before + 1);
      expect(commits(worktree)[0]).toBe("Mockup: Printer font size");
      expect(run(worktree, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort())
        .toEqual([`${folder}/css/app.css`, `${folder}/index.html`]);
      expect(run(worktree, "status", "--porcelain")).toContain("app.txt");
      const card = hive.card(id);
      expect(card.lane).toBe("spec");
      expect(card.mockup).toMatchObject({ kept: true, files: ["css/app.css", "index.html"] });
      expect(mockupEvents(id).at(-1)!.kept).toBe(true);
      expect(turnsOf("spec-writer")).toHaveLength(1);
    });

    it("writes a Claude Design link into README.md and commits it", async () => {
      const { id, worktree, folder, dir } = await withLink();
      await hive.good(id, { keep: true });
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      expect(readme).toContain("# Printer font size");
      expect(readme).toContain(`The mockup for this card, made in Claude Design: ${LINK}`);
      expect(run(worktree, "show", "--name-only", "--format=", "HEAD").trim()).toBe(`${folder}/README.md`);
      expect(hive.card(id).mockup!.files).toEqual(["README.md"]);
    });

    it("adds the link line once to a README that's already there", async () => {
      const { id, dir } = await withLink();
      writeFileSync(join(dir, "README.md"), "# Exported screens\n\nFrom the person.");
      writeFileSync(join(dir, "settings.png"), "png");
      await hive.good(id, { keep: true });
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      expect(readme.startsWith("# Exported screens\n\nFrom the person.\n")).toBe(true);
      expect(readme.split(LINK)).toHaveLength(2);
    });

    it("leaves a README that already has the link as it is", async () => {
      const { id, dir } = await withLink();
      const text = `# Mine\n\n${LINK}\n`;
      writeFileSync(join(dir, "README.md"), text);
      await hive.good(id, { keep: true });
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(text);
    });

    it("is refused without a keep choice, while the designer works, before a mockup is named, and with an empty folder", async () => {
      const { id, designer, folder, dir } = await inMockup();
      await expect(hive.good(id, {})).rejects.toMatchObject({ status: 400 });
      await expect(hive.good(id, { keep: true })).rejects.toMatchObject({ status: 409, message: "Wait for the designer to finish." });
      await designer.end();
      await expect(hive.good(id, { keep: true })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/hasn't named one/) });
      writeFileSync(join(dir, "index.html"), "<p>x</p>");
      await designer.request.hiveTools!.setMockup!({ page: `${folder}/index.html` });
      rmSync(join(dir, "index.html"));
      await expect(hive.good(id, { keep: true })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/empty/) });
      expect(hive.card(id).lane).toBe("mockup");
    });

    it("leaves the card in Mockup when git refuses the commit", async () => {
      gitService = { ...git, commitFile: async () => { throw new Error("index.lock exists"); } };
      hive.close();
      hive = newHive();
      const { id } = await withPages();
      await expect(hive.good(id, { keep: true })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/index.lock/) });
      expect(hive.card(id)).toMatchObject({ lane: "mockup", mockup: { kept: null } });
      expect(turnsOf("spec-writer")).toHaveLength(0);
    });
  });

  describe("Don't keep", () => {
    it("makes no commit and leaves the folder for the spec writer to read", async () => {
      const { id, worktree, dir } = await withPages();
      const before = commits(worktree);
      await hive.good(id, { keep: false });
      expect(commits(worktree)).toEqual(before);
      expect(existsSync(join(dir, "index.html"))).toBe(true);
      expect(hive.card(id)).toMatchObject({ lane: "spec", mockup: { kept: false, files: ["css/app.css", "index.html"] } });
    });

    it("goes on without a named mockup", async () => {
      const { id, designer } = await inMockup();
      await designer.end();
      await hive.good(id, { keep: false });
      expect(hive.card(id)).toMatchObject({ lane: "spec", mockup: { current: null, kept: false } });
    });

    it("deletes the folder at sign-off, so it never reaches the branch", async () => {
      const { id, worktree, dir } = await withPages();
      await hive.good(id, { keep: false });
      await signOff(id);
      expect(hive.card(id).lane).toBe("plan");
      expect(existsSync(dir)).toBe(false);
      expect(run(worktree, "status", "--porcelain")).not.toContain("docs/mockups");
      expect(hive.card(id).mockup).toMatchObject({ kept: false, files: [] });
      expect(mockupEvents(id).at(-1)!.files).toEqual([]);
    });

    it("refuses sign-off when the delete fails, and signs off once it can", async () => {
      const { id, worktree, dir } = await withPages();
      await hive.good(id, { keep: false });
      const parent = join(worktree, "docs", "mockups");
      chmodSync(parent, 0o555);
      try {
        await expect(signOff(id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/couldn't be deleted/) });
        expect(hive.card(id).lane).toBe("spec");
        expect(commits(worktree)[0]).toBe("Spec: Printer font size");
      } finally {
        chmodSync(parent, 0o755);
      }
      await hive.signoff(id);
      expect(hive.card(id).lane).toBe("plan");
      expect(existsSync(dir)).toBe(false);
      expect(commits(worktree).filter((c) => c.startsWith("Spec:"))).toHaveLength(1);
    });

    it("finds nothing left to delete at a second sign-off after Back to Spec", async () => {
      const { id } = await withPages();
      await hive.good(id, { keep: false });
      await signOff(id);
      await runner.last.end({ kind: "ok", report: { ...plan, status: "blocked", blockedReason: "The spec contradicts the code." } });
      await hive.backToSpec(id);
      await signOff(id);
      expect(hive.card(id).lane).toBe("plan");
    });
  });

  describe("Keep it after all", () => {
    it("commits a mockup you didn't keep, in Spec, without waiting for or starting a turn", async () => {
      const { id, worktree, folder } = await withPages();
      await hive.good(id, { keep: false });
      const turns = runner.turns.length; // the spec writer's first turn is still running
      await hive.keepMockup(id);
      expect(runner.turns).toHaveLength(turns);
      expect(commits(worktree)[0]).toBe("Mockup: Printer font size");
      expect(run(worktree, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort())
        .toEqual([`${folder}/css/app.css`, `${folder}/index.html`]);
      const card = hive.card(id);
      expect(card.mockup!.kept).toBe(true);
      expect(mockupEvents(id).at(-1)!.kept).toBe(true);
      expect(card.chat.at(-1)).toMatchObject({ kind: "message", from: "hive", text: `The mockup is kept after all, at ${folder}/.` });
      // Kept now: sign-off leaves it alone.
      await signOff(id);
      expect(hive.card(id).mockup!.files).toEqual(["css/app.css", "index.html"]);
    });

    it("keeps a link-only mockup after all, writing its README in a folder made again if it's gone", async () => {
      const { id, worktree, folder, dir } = await withLink();
      await hive.good(id, { keep: false });
      rmSync(dir, { recursive: true });
      await hive.keepMockup(id);
      expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(`made in Claude Design: ${LINK}`);
      expect(commits(worktree)[0]).toBe("Mockup: Printer font size");
      expect(run(worktree, "show", "--name-only", "--format=", "HEAD").trim()).toBe(`${folder}/README.md`);
      expect(hive.card(id).mockup).toMatchObject({ kept: true, files: ["README.md"] });
    });

    it("refuses what Keep refuses: pages nobody named, and named pages that are gone", async () => {
      const unnamed = await inMockup();
      writeFileSync(join(unnamed.dir, "index.html"), "<p>never named</p>");
      await unnamed.designer.end();
      await hive.good(unnamed.id, { keep: false });
      const before = commits(unnamed.worktree);
      await expect(hive.keepMockup(unnamed.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/hasn't named one/) });
      expect(commits(unnamed.worktree)).toEqual(before);
      expect(hive.card(unnamed.id).mockup).toMatchObject({ kept: false, current: null });

      const gone = await withPages();
      await hive.good(gone.id, { keep: false });
      rmSync(gone.dir, { recursive: true });
      await expect(hive.keepMockup(gone.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/empty/) });
    });

    it("is refused outside Spec, and for a kept or skipped mockup", async () => {
      const m = await withPages();
      await expect(hive.keepMockup(m.id)).rejects.toMatchObject({ status: 409 }); // still in Mockup
      await hive.good(m.id, { keep: true });
      await expect(hive.keepMockup(m.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already kept/) });

      const skipped = hive.createCard(hive.board().projects[0]!.id, "Other", "Another idea.");
      await hive.moveCard(skipped.id, "refine");
      await waitFor(() => hive.card(skipped.id).setup?.status === "done");
      await runner.last.end();
      await hive.good(skipped.id, { skipMockup: true });
      await expect(hive.keepMockup(skipped.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no mockup/) });
    });
  });

  describe("the spec writer's first message", () => {
    const writerMessage = () => turnsOf("spec-writer").at(-1)!.request.message;

    it("pages, kept: the Mockup chat, the folder and page, which land with the card", async () => {
      const { id, folder } = await withPages();
      hive.sendMessage(id, "Looks good.");
      await runner.last.end();
      await hive.good(id, { keep: true });
      const message = writerMessage();
      expect(message).toContain("The Mockup chat:\n\ndesigner: Here is a first mockup.\n\nyou: Looks good.");
      expect(message).toContain(`HTML pages in ${folder}/`);
      expect(message).toContain(`${folder}/index.html`);
      expect(message).toContain("land with the card");
      expect(message).toContain("point the spec at them");
      expect(message.indexOf("The Refine chat:")).toBeLessThan(message.indexOf("The Mockup chat:"));
      expect(message.trimEnd()).toMatch(/Then sum up in a few sentences what it proposes\.$/);
    });

    it("pages, not kept: read them now, but they're deleted at sign-off", async () => {
      const { id, folder } = await withPages();
      await hive.good(id, { keep: false });
      const message = writerMessage();
      expect(message).toContain(`HTML pages in ${folder}/`);
      expect(message).toContain("deletes them at sign-off, so the spec mustn't point at them");
    });

    it("link, kept: the URL it can't open, the designer's summary and the README", async () => {
      const { id, folder } = await withLink();
      await hive.good(id, { keep: true });
      const message = writerMessage();
      expect(message).toContain("designer: The look: one settings page");
      expect(message).toContain(LINK);
      expect(message).toContain("You can't open it");
      expect(message).toContain(`README.md and any exported files in ${folder}/`);
    });

    it("link, not kept: the URL, the summary, and exports only until sign-off", async () => {
      const { id, folder } = await withLink();
      await hive.good(id, { keep: false });
      const message = writerMessage();
      expect(message).toContain(LINK);
      expect(message).toContain("You can't open it");
      expect(message).toContain(`exported files in ${folder}/ until sign-off`);
    });

    it("no mockup named: go by the chat", async () => {
      const { id, designer } = await inMockup();
      designer.handlers.onTextBlock("Shall I start with the settings page?");
      await designer.end();
      await hive.good(id, { keep: false });
      const message = writerMessage();
      expect(message).toContain("The Mockup chat:\n\ndesigner: Shall I start with the settings page?");
      expect(message).toContain("went on without a mockup. Go by the chat");
    });

    it("skipped: one line, and no Mockup chat", async () => {
      const id = await refined();
      await hive.good(id, { skipMockup: true });
      const message = writerMessage();
      expect(message).toContain("The person skipped Mockup, so there's no mockup.");
      expect(message).not.toContain("The Mockup chat:");
    });
  });
});
