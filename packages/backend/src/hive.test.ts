import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { answerAsMessage, Hive, HttpError } from "./hive";
import { FakeProbe, FakeRunner, makeRepo, settle, type TempRepo, waitFor } from "./testing";

const brokenRoles = new Set<string>();
const role = (name: string) => {
  if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
  return { name, model: "opus", kind: "conversation", instructions: "Be a product owner." };
};

describe("Hive", () => {
  let db: HiveDb;
  let hub: EventHub;
  let runner: FakeRunner;
  let probe: FakeProbe;
  let hive: Hive;
  let events: HiveEvent[];
  let repos: TempRepo[];

  const newHive = (extra: { home?: string } = {}) =>
    new Hive({ db, hub, git, runner, probe, role, log: () => {}, specFormatDir: "/nonexistent", ...extra });

  beforeEach(() => {
    brokenRoles.clear();
    db = new HiveDb(":memory:");
    hub = new EventHub();
    runner = new FakeRunner();
    probe = new FakeProbe(true);
    events = [];
    hub.subscribe((e) => events.push(e));
    hive = newHive();
    repos = [];
  });
  afterEach(() => {
    repos.forEach((r) => r.cleanup());
    db.close();
  });

  const repo = (options?: Parameters<typeof makeRepo>[0]) => {
    const r = makeRepo(options);
    repos.push(r);
    return r;
  };

  async function projectWithCard(idea = "Make the printer font adjustable. Some users find it too small.") {
    const r = repo();
    await hive.addProject(r.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Make the printer font adjustable.", idea);
    return { r, project, card };
  }

  async function inRefine() {
    const setup = await projectWithCard();
    await hive.moveCard(setup.card.id, "refine");
    await waitFor(() => hive.card(setup.card.id).setup?.status === "done"); // the worktree's setup, in the background
    return { ...setup, turn: runner.last };
  }

  describe("projects", () => {
    // Adding a project (docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md). The hive's own first
    // commit uses the user's identity, so the tests give git one without the machine's global config.
    let home: string;
    const temps: string[] = [];
    const temp = () => {
      const d = realpathSync(mkdtempSync(join(tmpdir(), "hive-add-")));
      temps.push(d);
      return d;
    };
    const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    /** Every path under `dir` with its contents, to show a refusal left the folder as it was. */
    const contents = (dir: string) =>
      (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
        const p = join(dir, f);
        try {
          return `${f}:${readFileSync(p, "utf8")}`;
        } catch {
          return `${f}/`;
        }
      });
    const expectOneEmptyCommitOnMain = (dir: string) => {
      expect(gitIn(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
      expect(gitIn(dir, "log", "--oneline").split("\n")).toHaveLength(1);
      expect(gitIn(dir, "show", "--stat", "--format=", "HEAD")).toBe("");
    };

    beforeEach(() => {
      vi.stubEnv("GIT_AUTHOR_NAME", "Test");
      vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
      vi.stubEnv("GIT_COMMITTER_NAME", "Test");
      vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
      home = temp();
      hive = newHive({ home });
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
    });

    it("adds a repo's top folder given as <repo>/., with its real path and name", async () => {
      const r = repo();
      expect(await hive.addProject(r.root + "/.")).toBeNull();
      const [p] = hive.board().projects;
      expect(p).toMatchObject({ path: realpathSync(r.root), name: "repo", trustWarning: false });
    });

    it("refuses a repo without main, and the same repo twice", async () => {
      await expect(hive.addProject(repo({ branch: "trunk" }).root)).rejects.toThrow(/no main branch/);
      const r = repo();
      await hive.addProject(r.root);
      await expect(hive.addProject(r.root)).rejects.toMatchObject({ status: 409 });
    });

    it("resolves ~/x against home", async () => {
      mkdirSync(join(home, "x"));
      await hive.addProject("~/x");
      expect(hive.board().projects[0]).toMatchObject({ path: join(home, "x"), name: "x" });
    });

    it("adds an empty folder holding only .DS_Store, and a git init-only folder, each with one empty commit on main", async () => {
      const empty = temp();
      writeFileSync(join(empty, ".DS_Store"), "x");
      expect(await hive.addProject(empty)).toBeNull();
      expectOneEmptyCommitOnMain(empty);
      expect(gitIn(empty, "status", "--porcelain")).toBe("?? .DS_Store");

      const fresh = temp();
      gitIn(fresh, "init", "-q", "-b", "master");
      expect(await hive.addProject(fresh)).toBeNull();
      expectOneEmptyCommitOnMain(fresh);

      expect(hive.board().projects.map((p) => p.path).sort()).toEqual([empty, fresh].sort());
    });

    it("answers { missing } for a path that doesn't exist and creates nothing, then creates it with create", async () => {
      const base = temp();
      const missing = join(base, "new/project");
      expect(await hive.addProject(missing)).toEqual({ missing });
      expect(existsSync(join(base, "new"))).toBe(false);
      expect(hive.board().projects).toHaveLength(0);

      expect(await hive.addProject(missing, true)).toBeNull();
      expectOneEmptyCommitOnMain(missing);
      expect(hive.board().projects[0]).toMatchObject({ path: realpathSync(missing), name: "project" });
    });

    it("names the bare repo or separate git dir for their worktrees, without telling you to add it", async () => {
      const d = temp();
      const bare = join(d, "bare.git");
      gitIn(d, "init", "-q", "--bare", "-b", "main", bare);
      const emptyTree = gitIn(bare, "hash-object", "-t", "tree", "-w", "/dev/null");
      gitIn(bare, "update-ref", "refs/heads/main", gitIn(bare, "commit-tree", "-m", "init", emptyTree));
      gitIn(bare, "worktree", "add", "-q", join(d, "bare-wt"), "main");
      const gitDir = join(d, "gitdir");
      gitIn(d, "init", "-q", "-b", "main", "--separate-git-dir", gitDir, join(d, "checkout"));
      gitIn(join(d, "checkout"), "commit", "-q", "--allow-empty", "-m", "init");
      gitIn(join(d, "checkout"), "worktree", "add", "-q", join(d, "sep-wt"), "-b", "other");

      await expect(hive.addProject(join(d, "bare-wt"))).rejects.toMatchObject({
        status: 400, message: `${d}/bare-wt is a worktree of the git repo ${bare}.`,
      });
      await expect(hive.addProject(join(d, "sep-wt"))).rejects.toMatchObject({
        status: 400, message: `${d}/sep-wt is a worktree of the git repo ${gitDir}.`,
      });
      await expect(hive.addProject(join(d, "sep-wt/new"), true)).rejects.toMatchObject({
        status: 400, message: `${d}/sep-wt/new is inside the git repo ${gitDir}. Pick a folder outside it.`,
      });
      expect(existsSync(join(d, "sep-wt/new"))).toBe(false);
      expect(hive.board().projects).toHaveLength(0);
    });

    it("refuses with 409 a missing path that is already a project, whose folder was removed, creating nothing", async () => {
      const base = temp();
      const gone = join(base, "gone");
      mkdirSync(gone);
      await hive.addProject(gone);
      rmSync(gone, { recursive: true, force: true });
      const message = `${gone} is already a project.`;
      await expect(hive.addProject(gone)).rejects.toMatchObject({ status: 409, message });
      await expect(hive.addProject(gone, true)).rejects.toMatchObject({ status: 409, message });
      expect(existsSync(gone)).toBe(false);
      expect(hive.board().projects).toHaveLength(1);
    });

    it("refuses a missing path under a repo as inside the git repo, with or without create, creating nothing", async () => {
      const r = repo();
      const root = realpathSync(r.root);
      const missing = join(root, "new/thing");
      const message = `${missing} is inside the git repo ${root}. Add ${root} itself, or pick a folder outside it.`;
      await expect(hive.addProject(missing)).rejects.toMatchObject({ status: 400, message });
      await expect(hive.addProject(missing, true)).rejects.toMatchObject({ status: 400, message });
      expect(existsSync(join(root, "new"))).toBe(false);
      expect(hive.board().projects).toHaveLength(0);
    });

    it("refuses folders that can't be a project with the spec's message, adding nothing and changing nothing", async () => {
      const r = repo();
      const root = realpathSync(r.root);
      mkdirSync(join(root, "sub"));
      writeFileSync(join(root, "sub/f.txt"), "f\n");
      const worktree = join(root, ".claude/worktrees/x");
      r.git("worktree", "add", "-q", worktree, "-b", "hive/x", "main");
      const plain = temp();
      writeFileSync(join(plain, "notes.txt"), "keep me\n");
      const refusals: [string, string][] = [
        [join(root, "sub"), `${root}/sub is inside the git repo ${root}. Add ${root} itself, or pick a folder outside it.`],
        [worktree, `${worktree} is a worktree of the git repo ${root}. Add ${root} itself.`],
        [plain, `${plain} isn't a git repo and has files in it. The hive runs git init only in an empty folder: commit it as a repo yourself, or pick an empty folder.`],
        ["some/relative/path", "Give a full path, starting with / or ~."],
        ["", "Give a full path, starting with / or ~."],
        [join(plain, "notes.txt"), `${plain}/notes.txt is a file, not a folder.`],
        [join(root, ".git"), `${root}/.git is inside git's own data, not a work tree.`],
      ];
      const before = { repo: contents(root), plain: contents(plain) };
      for (const [path, message] of refusals) {
        await expect(hive.addProject(path), path).rejects.toMatchObject({ status: 400, message });
      }
      await expect(hive.addProject(42 as unknown as string)).rejects.toMatchObject({ status: 400 });
      expect(hive.board().projects).toHaveLength(0);
      expect(contents(root)).toEqual(before.repo);
      expect(contents(plain)).toEqual(before.plain);
      expect(existsSync(join(plain, ".git"))).toBe(false);
      expect(existsSync(join(root, "sub/.git"))).toBe(false);
    });

    it("warns when the repo has a CLAUDE.md that Claude Code doesn't load", async () => {
      probe.loads = false;
      await hive.addProject(repo({ claudeMd: true }).root);
      await settle();
      expect(hive.board().projects[0]!.trustWarning).toBe(true);
      probe.loads = true;
      await hive.checkTrust(hive.board().projects[0]!.id);
      expect(hive.board().projects[0]!.trustWarning).toBe(false);
    });

    it("skips the probe when the repo has no CLAUDE.md", async () => {
      await hive.addProject(repo().root);
      await settle();
      expect(probe.calls).toHaveLength(0);
    });
  });

  describe("cards and the Ideas → Refine move", () => {
    it("needs a title and a text for an idea, and keeps the typed title", async () => {
      await hive.addProject(repo().root);
      const projectId = hive.board().projects[0]!.id;
      expect(() => hive.createCard(projectId, "  ", "Text.")).toThrow(HttpError);
      expect(() => hive.createCard(projectId, "Title", " ")).toThrow(HttpError);
      expect(() => hive.createCard("nope", "Title", "Text.")).toThrow(/No such project/);
      const card = hive.createCard(projectId, "  Bigger font ", "  Make it bigger.  ");
      expect(card.title).toBe("Bigger font");
      expect(hive.card(card.id)).toMatchObject({ ideaTitle: "Bigger font", ideaText: "Make it bigger." });
    });

    describe("editing an idea", () => {
      it("sets the title and the text while the card is in Ideas, and says so", async () => {
        const { card } = await projectWithCard();
        events.length = 0;
        const after = hive.updateIdea(card.id, { title: " New title ", text: " New text. " });
        expect(after.title).toBe("New title");
        expect(hive.card(card.id)).toMatchObject({ title: "New title", ideaTitle: "New title", ideaText: "New text." });
        expect(events.some((e) => e.type === "card.updated")).toBe(true);
      });

      it("refuses an empty field, an unknown card, a card outside Ideas and a card that is moving", async () => {
        const { card } = await projectWithCard();
        expect(() => hive.updateIdea(card.id, { title: " ", text: "x" })).toThrow(expect.objectContaining({ status: 400 }));
        expect(() => hive.updateIdea(card.id, { title: "x", text: "" })).toThrow(expect.objectContaining({ status: 400 }));
        expect(() => hive.updateIdea("nope", { title: "x", text: "x" })).toThrow(expect.objectContaining({ status: 404 }));
        (hive as any).moving.add(card.id);
        expect(() => hive.updateIdea(card.id, { title: "x", text: "x" })).toThrow(expect.objectContaining({ status: 409 }));
        (hive as any).moving.delete(card.id);
        await hive.moveCard(card.id, "refine");
        expect(() => hive.updateIdea(card.id, { title: "x", text: "x" })).toThrow(expect.objectContaining({ status: 409 }));
      });
    });

    it("creates the worktree, keeps the checkout clean and starts the product owner", async () => {
      const { r, card, turn } = await inRefine();
      const after = hive.card(card.id);
      expect(after.lane).toBe("refine");
      expect(after.branch).toMatch(/^hive\/make-the-printer-font-adjustable-/);
      expect(r.git("worktree", "list")).toContain(".claude/worktrees/");
      expect(r.git("status", "--porcelain")).toBe("");
      expect(turn.request).toMatchObject({ resume: false, cwd: after.worktreePath });
      expect(turn.request.message).toContain("Title: Make the printer font adjustable.");
      expect(turn.request.message).toContain("The idea: Make the printer font adjustable. Some users find it too small.");
      expect(after.state).toBe("working");
    });

    it("leaves the card in Ideas with git's reason when the worktree can't be made", async () => {
      const { r, card } = await projectWithCard();
      r.git("branch", `hive/${git.cardSlug(card.title, card.id)}`);
      await expect(hive.moveCard(card.id, "refine")).rejects.toMatchObject({ status: 409 });
      const after = hive.card(card.id);
      expect(after.lane).toBe("ideas");
      expect(after.moveError).toMatch(/already exists/);
      expect(runner.turns).toHaveLength(0);
    });

    it("refuses every other move", async () => {
      const { card } = await projectWithCard();
      await expect(hive.moveCard(card.id, "mockup")).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("history", () => {
    // Rows as the lanes write them, at given times: the history only reads them.
    let at = 0;
    const row = (cardId: string, type: string, data: object) =>
      db.addEvent(cardId, type, data, `e${++at}`, `2026-11-27T10:00:${String(at).padStart(2, "0")}.000Z`);
    const issue = { where: "Design", problem: "Silent on rounding", guess: "Rounded down" };

    it("gives every later lane's rounds newest first, from the rows each round wrote", async () => {
      const { card } = await projectWithCard();
      row(card.id, "plan", { steps: [], chunks: [], tests: ["first"] });
      row(card.id, "build", {
        status: "done", summary: "Built it.", departures: [], issues: [issue], decisions: [{ what: "A", alternative: "B" }],
      });
      row(card.id, "check", { round: 1, summary: "Two bugs.", bugs: [{ where: "a.ts:1", problem: "x" }], issues: [issue] });
      row(card.id, "build", { status: "done", summary: "Fixed them.", departures: [], issues: [], decisions: [] });
      row(card.id, "check", { round: 2, summary: "Clean.", bugs: [], issues: [] });
      row(card.id, "chat", { lane: "check", from: "hive", text: "Round 2: no bugs." });
      row(card.id, "plan", { steps: [], chunks: [], tests: ["second"] });

      const { history } = hive.card(card.id);
      expect(history.plans.map((p) => p.tests)).toEqual([["second"], ["first"]]);
      expect(history.builds).toEqual([
        { summary: "Fixed them.", departures: [], issues: [], decisions: [] },
        { summary: "Built it.", departures: [], issues: [issue], decisions: [{ what: "A", alternative: "B" }] },
      ]);
      expect(history.checks.map((c) => [c.round, c.summary, c.issues.length])).toEqual([[2, "Clean.", 0], [1, "Two bugs.", 1]]);
      expect(history.tryit).toEqual([]);
    });

    it("puts one acceptance on top of your feedback, only while it's the last word", async () => {
      const { card } = await projectWithCard();
      row(card.id, "feedback", { text: "Make it bigger." });
      row(card.id, "accept", {});
      expect(hive.card(card.id).history.tryit).toEqual([
        { kind: "accepted" },
        { kind: "feedback", text: "Make it bigger." },
      ]);

      // Back to Try it undid that acceptance: more feedback, then a second acceptance.
      row(card.id, "feedback", { text: "Now smaller." });
      expect(hive.card(card.id).history.tryit).toEqual([
        { kind: "feedback", text: "Now smaller." },
        { kind: "feedback", text: "Make it bigger." },
      ]);
      row(card.id, "accept", {});
      expect(hive.card(card.id).history.tryit.map((r) => r.kind)).toEqual(["accepted", "feedback", "feedback"]);
    });
  });

  describe("turns", () => {
    it("stores each text block as a chat message and hands the turn back to you", async () => {
      const { card, turn } = await inRefine();
      turn.handlers.onTextDelta("Hel");
      turn.handlers.onTextBlock("Hello, I've read the repo.");
      turn.handlers.onActivity("reading src/a.ts…");
      turn.handlers.onTextBlock("Here is a first brief.");
      await turn.end();
      const after = hive.card(card.id);
      // The worktree's setup leaves a note of its own in the chat; the product owner's blocks are these.
      expect(after.chat.filter((c) => c.kind === "message" && c.from === "product-owner").map((c) => c.kind === "message" && c.text)).toEqual([
        "Hello, I've read the repo.",
        "Here is a first brief.",
      ]);
      expect(after.state).toBe("needs-you");
      expect(after.turnRunning).toBe(false);
      expect(events.map((e) => e.type)).toContain("chat.delta");
      expect(events.filter((e) => e.type === "chat.activity").at(-1)).toMatchObject({ text: null });
    });

    it("leaves no mark when the role file is broken: the send throws and nothing is running", async () => {
      const { card, turn } = await inRefine();
      await turn.end();
      const sessionId = db.getSessionFor(card.id, "refine", "product-owner")!.id;
      brokenRoles.add("product-owner");
      events.length = 0;
      expect(() => hive.sendMessage(card.id, "Per printer, please")).toThrow(/broken/);
      expect(events.some((e) => e.type === "turn.started")).toBe(false);
      expect(db.getSession(sessionId)!.turnRunning).toBe(false);
      // Still stored, so Retry after a turn that couldn't start sends this message again.
      expect(db.getSession(sessionId)!.lastMessage).toBe("Per printer, please");
      expect(hive.card(card.id)).toMatchObject({ turnRunning: false, state: "needs-you" });
    });

    it("takes the mark back when the runner can't start the turn, and ends the turn after it started", async () => {
      const { card, turn } = await inRefine();
      await turn.end();
      const sessionId = db.getSessionFor(card.id, "refine", "product-owner")!.id;
      vi.spyOn(runner, "start").mockImplementationOnce(() => { throw new Error("spawn failed"); });
      events.length = 0;
      expect(() => hive.sendMessage(card.id, "Per printer, please")).toThrow(/spawn failed/);
      expect(db.getSession(sessionId)!.turnRunning).toBe(false);
      expect(hive.card(card.id)).toMatchObject({ turnRunning: false, state: "needs-you" });
      const types = events.map((e) => e.type);
      expect(types.indexOf("turn.started")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("turn.ended")).toBeGreaterThan(types.indexOf("turn.started"));
    });

    it("saves the brief from write_brief and renames the card", async () => {
      const { card, turn } = await inRefine();
      const reply = await turn.request.hiveTools!.writeBrief!({
        title: "Printer font size", problem: "Text is too small.", whoItsFor: "Users with poor sight",
        whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: ["Max size?"],
      });
      expect(reply).toMatch(/saved/);
      const after = hive.card(card.id);
      expect(after.title).toBe("Printer font size");
      expect(after.brief?.openPoints).toEqual(["Max size?"]);
      expect(events.some((e) => e.type === "brief.updated")).toBe(true);
    });

    it("sends a message during a turn into that turn, and otherwise starts a new one", async () => {
      const { card, turn } = await inRefine();
      hive.sendMessage(card.id, "Per printer, please");
      expect(turn.pushed).toEqual(["Per printer, please"]);
      turn.handlers.onSessionCreated();
      await turn.end();
      hive.sendMessage(card.id, "And max 24");
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request).toMatchObject({ resume: true, message: "And max 24" });
    });

    it("shows a failed turn with Retry, which resends its message", async () => {
      const { card, turn } = await inRefine();
      await turn.end({ kind: "error", message: "Not logged in" });
      const last = hive.card(card.id).chat.at(-1);
      expect(last).toMatchObject({ kind: "error", message: "Not logged in", actions: ["retry"] });
      hive.retry(card.id);
      expect(runner.last.request.message).toBe(turn.request.message);
      expect(runner.last.request.resume).toBe(false); // the failed first turn never created the session
    });

    it("sends a message that misses a turn already ending as a turn of its own", async () => {
      const { card, turn } = await inRefine();
      turn.inputEnded = true; // the result is in and the process is exiting
      hive.sendMessage(card.id, "One more thing");
      expect(turn.pushed).toEqual([]);
      expect(runner.turns).toHaveLength(1);
      await turn.end();
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request.message).toBe("One more thing");
      expect(hive.card(card.id).turnRunning).toBe(true);
    });

    it("refuses a second move while the first is still making the worktree", async () => {
      const { card } = await projectWithCard();
      const first = hive.moveCard(card.id, "refine");
      await expect(hive.moveCard(card.id, "refine")).rejects.toMatchObject({ status: 409 });
      await first;
      expect(hive.card(card.id)).toMatchObject({ lane: "refine", moveError: null });
      expect(runner.turns).toHaveLength(1);
    });

    it("stops a running turn without an error line", async () => {
      const { card, turn } = await inRefine();
      await hive.stop(card.id);
      await settle();
      expect(turn.interrupted).toBe(true);
      expect(hive.card(card.id).chat.some((c) => c.kind === "error")).toBe(false);
    });
  });

  describe("questions", () => {
    const questions = [
      { question: "Per printer or all?", header: "Scope", multiSelect: false,
        options: [{ label: "Per printer", description: "" }, { label: "All", description: "" }] },
    ];

    it("waits on your answer and hands it back as the tool's answers", async () => {
      const { card, turn } = await inRefine();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      const pending = hive.card(card.id).pending!;
      expect(pending.kind).toBe("question");
      expect(hive.card(card.id).state).toBe("needs-you");
      hive.answer(pending.id, { answers: { "Per printer or all?": "Per printer" } });
      await expect(decision).resolves.toMatchObject({
        behavior: "allow", updatedInput: { questions, answers: { "Per printer or all?": "Per printer" } },
      });
      expect(hive.card(card.id).pending).toBeNull();
      expect(hive.card(card.id).chat.at(-1)).toMatchObject({ kind: "message", from: "you", text: "Per printer" });
    });

    it("sends an answer whose question was withdrawn into the turn still running, not a second turn", async () => {
      const { card, turn } = await inRefine();
      const asked = new AbortController();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, asked.signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      asked.abort(); // Stop aborts the canUseTool call before the turn has ended
      await expect(decision).resolves.toMatchObject({ behavior: "deny" });
      hive.answer(pendingId, { answers: { "Per printer or all?": "All" } });
      expect(runner.turns).toHaveLength(1);
      expect(turn.pushed[0]).toContain("My answer: All");
    });

    it("refuses answers that aren't text per question", async () => {
      const { card, turn } = await inRefine();
      void turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      expect(() => hive.answer(pendingId, { answers: "All" } as any)).toThrow(HttpError);
    });

    it("treats a message typed while a question waits as its answer", async () => {
      const { card, turn } = await inRefine();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      hive.sendMessage(card.id, "Only the label printer");
      await expect(decision).resolves.toMatchObject({
        updatedInput: { answers: { "Per printer or all?": "Only the label printer" } },
      });
      expect(turn.pushed).toEqual([]);
    });

    it("allows the hive's own tools without asking", async () => {
      const { turn } = await inRefine();
      await expect(
        turn.handlers.canUseTool("mcp__hive__write_brief", {}, new AbortController().signal),
      ).resolves.toMatchObject({ behavior: "allow" });
    });
  });

  describe("after a restart", () => {
    it("marks a cut-off turn and waits for you instead of resuming", async () => {
      const { card } = await inRefine();
      const restarted = newHive(); // the old hive's in-memory turn is gone
      restarted.recoverAfterRestart();
      const after = restarted.card(card.id);
      expect(after.turnRunning).toBe(false);
      expect(after.state).toBe("needs-you");
      expect(after.chat.at(-1)).toMatchObject({ kind: "error", actions: [] });
      expect(runner.turns).toHaveLength(1);
    });

    it("sends an answer whose turn is gone as a new turn with the question", async () => {
      const { card, turn } = await inRefine();
      void turn.handlers.canUseTool("AskUserQuestion", {
        questions: [{ question: "Max size?", header: "Max", multiSelect: false,
          options: [{ label: "24", description: "" }, { label: "32", description: "" }] }],
      }, new AbortController().signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      restarted.answer(pendingId, { answers: { "Max size?": "24" } });
      expect(runner.last.request.message).toContain("Max size?");
      expect(runner.last.request.message).toContain("My answer: 24");
    });

    it("formats an answer with the options it was asked with", () => {
      const text = answerAsMessage(
        [{ question: "Q?", header: "", multiSelect: false, options: [{ label: "A", description: "" }] }],
        { "Q?": "A" },
      );
      expect(text).toContain("Q?\n- A\nMy answer: A");
    });
  });
});
