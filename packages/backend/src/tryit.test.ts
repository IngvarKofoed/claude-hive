// The worktree's setup and Try it (docs/specs/2026-11-27-worktree-setup-and-try-it.md), driven through a fake runner on
// a throwaway repo with git-ignored local files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { fakeApps } from "./preview/apps";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { SETUP_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, type FakeTurn, keeperReport, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
};
const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "A size per printer.", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }],
  tests: ["clamps to 8–48"],
};
const built = {
  status: "done", blockedReason: null, summary: "Added a font size per printer.", departures: [], issues: [],
  decisions: [],
};
const clean = { status: "done", blockedReason: null, summary: "Looks right.", bugs: [], issues: [] };
const setupDone = {
  status: "done", blockedReason: null, installed: "npm install",
  start: [{ what: "the app", command: "PORT=5200 npm run dev", url: "http://localhost:5200" }],
  test: "npm test", shared: ["the Postgres database in .env"], notes: "",
};

describe("worktree setup and Try it", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let ports: ReturnType<typeof fakePorts>;
  let apps: ReturnType<typeof fakeApps>;
  let events: HiveEvent[];
  let brokenRoles: Set<string>;
  let setupLimitMs: number;

  const role = (name: string): Role => {
    if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
    return { name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "work", instructions: `Be the ${name}.` };
  };
  const newHive = () => {
    const hub = new EventHub();
    hub.subscribe((e) => events.push(e));
    return new Hive({
      db, hub, git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir,
      today: () => "2026-11-27", ports, setupLimitMs, apps,
    });
  };

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    runner.holdSetup = true;
    brokenRoles = new Set();
    format = makeSpecFormat();
    repo = makeRepo();
    // Local files: two the app needs, and junk.
    writeFileSync(join(repo.root, ".gitignore"), ".env\ndata/\nnode_modules/\n");
    repo.git("add", ".gitignore");
    repo.git("commit", "-q", "-m", "ignore local files");
    writeFileSync(join(repo.root, ".env"), "PORT=3000\n");
    mkdirSync(join(repo.root, "data"));
    writeFileSync(join(repo.root, "data", "dev.db"), "rows");
    mkdirSync(join(repo.root, "node_modules"));
    writeFileSync(join(repo.root, "node_modules", "x.js"), "");
    ports = fakePorts();
    apps = fakeApps();
    events = [];
    setupLimitMs = 10 * 60_000;
    hive = newHive();
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    db.close();
  });

  const turnsOf = (roleName: string) => runner.turns.filter((t) => t.request.role.name === roleName);
  const lastOf = (roleName: string) => turnsOf(roleName).at(-1)!;
  const lastSetup = () => runner.setupTurns.at(-1)!;

  /** A blocked build's spec keeper turn finds the block isn't about the spec, so Retry and Back to Spec are offered. */
  async function keeperFallsBack(id: string) {
    await waitFor(() => turnsOf("spec-writer").at(-1)?.request.message.includes("The developer is blocked") ?? false);
    const keeper = lastOf("spec-writer");
    await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message) });
    await waitFor(() => hive.card(id).state === "needs-you");
  }
  const notes = (id: string) => hive.card(id).chat.flatMap((c) => (c.kind === "message" && c.from === "hive" ? [c.text] : []));

  /** A card in Refine, with its setup turn running. */
  async function inRefine() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Font", "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => runner.setupTurns.length === 1);
    return { id: card.id, po: lastOf("product-owner"), setup: lastSetup(), worktree: hive.card(card.id).worktreePath! };
  }

  /** A card whose spec is signed off and whose planner is running; its setup is done unless asked otherwise. */
  async function inPlan(opts: { finishSetup?: boolean } = {}) {
    const s = await inRefine();
    if (opts.finishSetup !== false) await s.setup.end({ kind: "ok", report: setupDone });
    await s.po.request.hiveTools!.writeBrief!(brief);
    s.po.handlers.onSessionCreated();
    await s.po.end();
    await hive.good(s.id, { skipMockup: true });
    const writer = runner.last;
    writeFileSync(join(s.worktree, hive.card(s.id).spec!.path), "# Printer font size\n\n## Outcome\n\n- It works.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    hive.review(s.id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(s.id);
    const planner = runner.last;
    planner.handlers.onSessionCreated();
    return { ...s, planner };
  }

  /** A card in Try it: built, and a clean Check round. */
  async function inTryIt() {
    const s = await inPlan();
    await s.planner.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    await developer.end({ kind: "ok", report: built });
    await waitFor(() => turnsOf("reviewer").length === 1);
    await lastOf("reviewer").end({ kind: "ok", report: clean });
    await waitFor(() => hive.card(s.id).lane === "tryit");
    return { ...s, developer };
  }

  describe("the setup", () => {
    it("starts in the background when the card enters Refine, with its ports and the local files to choose from", async () => {
      const { id, po, setup } = await inRefine();
      const card = hive.card(id);
      expect(card.port).toBe(5200);
      expect(card.setup).toMatchObject({ status: "running", copied: [] });
      expect(card.setup!.leftOut).toEqual([".env", "data/", "node_modules/"]);
      expect(setup.request.outputFormat).toBe(SETUP_SCHEMA);
      expect(setup.request.message).toContain(`The checkout: ${hive.board().projects[0]!.path}`);
      expect(setup.request.message).toContain("The card's ports: 5200–5209");
      expect(setup.request.message).toMatch(/- \.env \(\d+ B\)/);
      expect(setup.request.message).toMatch(/- data\/ \(\d+ B\)/);
      expect(setup.request.message).toContain("Left out already as junk: node_modules/.");
      expect(setup.request.hiveTools?.copyLocalFiles).toBeDefined();
      expect(setup.request.hiveTools?.writeBrief).toBeUndefined();

      // The badge follows your chat, not the setup.
      await po.end();
      expect(hive.card(id)).toMatchObject({ state: "needs-you", turnRunning: false });
      setup.handlers.onTextBlock("Copying .env now.");
      expect(hive.card(id).chat.some((c) => c.kind === "message" && c.text === "Copying .env now.")).toBe(false);
    });

    it("copies through the hive's tool, and keeps track of what's in the worktree", async () => {
      const { id, setup, worktree } = await inRefine();
      const reply = await setup.request.hiveTools!.copyLocalFiles!([".env", "data/", "app.txt"]);
      expect(reply).toContain(".env: copied (1 file)");
      expect(reply).toContain("data/: copied (1 file)");
      expect(reply).toMatch(/app\.txt: refused/);
      expect(readFileSync(join(worktree, ".env"), "utf8")).toBe("PORT=3000\n");
      expect(existsSync(join(worktree, "data", "dev.db"))).toBe(true);
      expect(hive.card(id).setup).toMatchObject({ copied: [".env", "data/"], leftOut: ["node_modules/"] });
      expect(events.some((e) => e.type === "setup.updated")).toBe(true);
      expect(repo.git("status", "--porcelain")).toBe("");
    });

    it("stores a done report, with a note listing what was copied, left out and shared", async () => {
      const { id, setup } = await inRefine();
      await setup.request.hiveTools!.copyLocalFiles!([".env"]);
      await setup.end({ kind: "ok", report: setupDone });
      expect(hive.card(id).setup).toMatchObject({
        status: "done", installed: "npm install", test: "npm test", start: setupDone.start, copied: [".env"],
      });
      expect(notes(id).at(-1)).toBe(
        "The worktree is set up. Copied: .env. Left out: data/, node_modules/. " +
          "Shared with your checkout: the Postgres database in .env.",
      );
    });

    it("ends as failed, with a note, when it's blocked, reports nothing, or fails", async () => {
      const { id, setup } = await inRefine();
      await setup.end({ kind: "ok", report: { ...setupDone, status: "blocked", blockedReason: "The checkout is unreadable." } });
      expect(hive.card(id).setup).toMatchObject({ status: "failed", reason: "The checkout is unreadable." });
      expect(notes(id).at(-1)).toBe(
        "The worktree's setup didn't finish: The checkout is unreadable. The developer installs what it needs itself.",
      );

      hive.setupAgain(id);
      await waitFor(() => runner.setupTurns.length === 2);
      await lastSetup().end({ kind: "ok" });
      expect(hive.card(id).setup).toMatchObject({ status: "failed", reason: "It didn't return a report." });
    });

    it("keeps the setup that worked when preparing it again fails", async () => {
      const { id, setup } = await inRefine();
      await setup.end({ kind: "ok", report: setupDone });
      hive.setupAgain(id);
      await waitFor(() => runner.setupTurns.length === 2);
      await lastSetup().end({ kind: "ok", report: { ...setupDone, status: "blocked", blockedReason: "The install hung." } });
      await waitFor(() => notes(id).some((n) => n.startsWith("Preparing the worktree again didn't finish")));
      expect(hive.card(id).setup).toMatchObject({ status: "done", start: setupDone.start, test: "npm test" });
      expect(notes(id).at(-1)).toBe("Preparing the worktree again didn't finish: The install hung. The earlier setup stays.");
    });

    it("refuses the setup's questions", async () => {
      const { setup } = await inRefine();
      await expect(setup.handlers.canUseTool("AskUserQuestion", { questions: [] }, new AbortController().signal))
        .resolves.toMatchObject({ behavior: "deny" });
    });

    it("stops a setup that runs past its time limit", async () => {
      setupLimitMs = 50;
      hive.close();
      hive = newHive();
      const { id, setup } = await inRefine();
      await waitFor(() => setup.interrupted);
      await waitFor(() => hive.card(id).setup?.status === "failed");
      expect(hive.card(id).setup!.reason).toBe("It ran longer than 10 minutes and was stopped.");
    });

    it("fails when no block of ports is free", async () => {
      const taken = Array.from({ length: 80 }, (_, i) => 5200 + i * 10);
      ports.assign = async (used) => (taken.every((p) => used.includes(p)) ? null : 5200);
      for (const p of taken) db.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)").run(`p${p}`, "x", `/x/${p}`, "t");
      for (const p of taken) {
        db.insertCard({
          id: `c${p}`, projectId: `p${p}`, title: "x", ideaTitle: "x", ideaText: "x", lane: "ideas", state: "needs-you", branch: null,
          worktreePath: null, brief: null, moveError: null, specPath: null, reviewedSpecHash: null, reviewApplying: false,
          plan: null, build: null, check: null, setup: null, port: p, feedback: null, appStopped: false,
          landing: null, landed: null, shipAfterCheck: false,
        });
      }
      await hive.addProject(repo.root);
      const project = hive.board().projects.find((p) => !p.path.startsWith("/x/"))!;
      const card = hive.createCard(project.id, "Font", "One too many.");
      await hive.moveCard(card.id, "refine");
      await waitFor(() => hive.card(card.id).setup?.status === "failed");
      expect(hive.card(card.id).setup!.reason).toMatch(/No free ports/);
      expect(runner.setupTurns).toHaveLength(0);
    });

    it("gives two cards whose setups start together different blocks of ports", async () => {
      ports.assign = async (taken) => {
        await new Promise((r) => setTimeout(r, 20)); // lsof takes a while
        return [5200, 5210].find((p) => !taken.includes(p)) ?? null;
      };
      await hive.addProject(repo.root);
      const project = hive.board().projects[0]!;
      const a = hive.createCard(project.id, "Font", "First idea.");
      const b = hive.createCard(project.id, "Font", "Second idea.");
      await Promise.all([hive.moveCard(a.id, "refine"), hive.moveCard(b.id, "refine")]);
      await waitFor(() => runner.setupTurns.length === 2);
      expect(new Set([hive.card(a.id).port, hive.card(b.id).port])).toEqual(new Set([5200, 5210]));
    });

    it("records a path copied from inside a listed folder", async () => {
      const { id, setup } = await inRefine();
      await setup.request.hiveTools!.copyLocalFiles!(["data/dev.db"]);
      expect(hive.card(id).setup).toMatchObject({ copied: ["data/dev.db"] });
    });

    it("can be run again from Try it, but not while one runs", async () => {
      const { id, setup } = await inRefine();
      expect(() => hive.setupAgain(id)).toThrow(/being set up already/);
      await setup.end({ kind: "ok", report: setupDone });
      hive.setupAgain(id);
      await waitFor(() => runner.setupTurns.length === 2);
      expect(lastSetup().request.sessionId).not.toBe(setup.request.sessionId);
      expect(hive.card(id).port).toBe(5200); // the card keeps its block
    });
  });

  describe("Build and setup", () => {
    it("waits for a setup still running, then starts the developer with the ports and commands", async () => {
      const { id, planner, setup } = await inPlan({ finishSetup: false });
      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => notes(id).includes("Build waits for the worktree's setup. Stop ends it, and Build goes ahead."));
      expect(turnsOf("developer")).toHaveLength(0);
      expect(hive.card(id)).toMatchObject({ lane: "build", state: "working", turnRunning: true });

      await setup.end({ kind: "ok", report: setupDone });
      await waitFor(() => turnsOf("developer").length === 1);
      const message = lastOf("developer").request.message;
      expect(message).toContain("use only the card's ports, 5200–5209");
      expect(message).toContain("- Start the app: `PORT=5200 npm run dev` (http://localhost:5200)");
      expect(message).toContain("- Tests: npm test");
      expect(message).toContain("- Still shared with the person's checkout: the Postgres database in .env");
    });

    it("lets Stop end the setup Build waits for, and then goes ahead", async () => {
      const { id, planner, setup } = await inPlan({ finishSetup: false });
      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => hive.card(id).turnRunning);
      await hive.stop(id);
      expect(setup.interrupted).toBe(true);
      await waitFor(() => turnsOf("developer").length === 1);
      expect(hive.card(id).setup).toMatchObject({ status: "failed", reason: "It was stopped." });
      // Without a finished setup, the developer still gets the card's ports.
      expect(lastOf("developer").request.message).toContain("use only the card's ports, 5200–5209");
      expect(lastOf("developer").request.message).not.toContain("- Start ");
    });

    it("runs a setup first for a worktree that never had one", async () => {
      const { id, planner, setup } = await inPlan({ finishSetup: false });
      await setup.end({ kind: "ok", report: setupDone });
      db.updateCard(id, { setup: null }); // as for a worktree made before setup existed
      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => runner.setupTurns.length === 2);
      expect(turnsOf("developer")).toHaveLength(0);
      await lastSetup().end({ kind: "ok", report: setupDone });
      await waitFor(() => turnsOf("developer").length === 1);
    });

    it("starts the same developer after the setup when a re-plan brings the card back to a worktree with no setup", async () => {
      const s = await inPlan();
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      lastOf("developer").handlers.onSessionCreated();
      await lastOf("developer").end({ kind: "ok", report: { ...built, status: "blocked", blockedReason: "No printers table." } });
      await keeperFallsBack(s.id);
      await hive.backToSpec(s.id);
      await runner.last.end();
      hive.review(s.id);
      await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
      await hive.signoff(s.id);
      db.updateCard(s.id, { setup: null }); // as for a worktree made before setup existed
      await runner.last.end({ kind: "ok", report: plan });
      await waitFor(() => runner.setupTurns.length === 2);
      await lastSetup().end({ kind: "ok", report: setupDone });
      await waitFor(() => turnsOf("developer").length === 2);
      expect(lastOf("developer").request.message).toContain("The spec was revised and signed off again");
    });

    it("lets Stop end a setup Build waits for even before its turn has started", async () => {
      // Listing the checkout's files is held once Build starts waiting, so Stop comes before the setup's turn.
      let gate: Promise<void> | null = null;
      let release!: () => void;
      const slowGit = { ...git, listLocalFiles: async (root: string) => (await gate, git.listLocalFiles(root)) };
      hive.close();
      hive = new Hive({
        db, hub: new EventHub(), git: slowGit, runner, probe: new FakeProbe(), role, log: () => {},
        specFormatDir: format.dir, today: () => "2026-11-27", ports, setupLimitMs, apps,
      });
      const { id, planner, setup } = await inPlan({ finishSetup: false });
      await setup.end({ kind: "ok", report: setupDone });
      db.updateCard(id, { setup: null });
      gate = new Promise<void>((r) => (release = r));
      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => hive.card(id).setup?.status === "running");
      await hive.stop(id);
      release();
      await waitFor(() => turnsOf("developer").length === 1);
      expect(hive.card(id).setup).toMatchObject({ status: "failed", reason: "It was stopped." });
      expect(runner.setupTurns).toHaveLength(1);
    });

    it("gives the reviewer the card's ports and commands too", async () => {
      const s = await inPlan();
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      await lastOf("developer").end({ kind: "ok", report: built });
      await waitFor(() => turnsOf("reviewer").length === 1);
      expect(lastOf("reviewer").request.message).toContain("- Start the app: `PORT=5200 npm run dev`");
      expect(ports.stopped.at(-1)).toEqual({ ports: [5200, 5201, 5202, 5203, 5204, 5205, 5206, 5207, 5208, 5209], worktree: s.worktree });
    });
  });

  describe("Try it", () => {
    it("sends your words to the same developer, clearing the build report and Check, after stopping the card's servers", async () => {
      const { id, developer } = await inTryIt();
      const stops = ports.stopped.length;
      await hive.feedback(id, { text: "It crashes with no printers." });
      await waitFor(() => turnsOf("developer").length === 2);
      expect(ports.stopped.length).toBe(stops + 1);
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "build", build: null, check: null, feedback: "It crashes with no printers." });
      const fixer = lastOf("developer");
      expect(fixer.request.sessionId).toBe(developer.request.sessionId);
      expect(fixer.request.message).toMatch(/^The person tried the card's build and found this:\n\nIt crashes with no printers\./);
      expect(fixer.request.message).toContain("`git status` may show files left from trying the app");
      expect(fixer.request.message).toContain("describe the whole build as it stands now");
      expect(notes(id)).toContain("Sent back from Try it: It crashes with no printers.");

      await fixer.end({ kind: "ok", report: built });
      await waitFor(() => turnsOf("reviewer").length === 2);
      expect(hive.card(id).feedback).toBeNull();
      expect(lastOf("reviewer").request.message).toContain("Check round 1");
      await lastOf("reviewer").end({ kind: "ok", report: clean });
      await waitFor(() => hive.card(id).lane === "tryit");
    });

    it("refuses empty feedback, another lane, and a card outside Try it", async () => {
      const { id } = await inTryIt();
      await expect(hive.feedback(id, { text: "  " })).rejects.toMatchObject({ status: 400 });
      await expect(hive.feedback(id, { text: "Wrong look.", lane: "mockup" })).rejects.toMatchObject({ status: 400 });
      await hive.accept(id);
      await expect(hive.feedback(id, { text: "Late bug." })).rejects.toMatchObject({ status: 409 });
    });

    it("accepts the card into Ship, stopping its servers, and Back to Try it brings it back", async () => {
      const { id } = await inTryIt();
      const stops = ports.stopped.length;
      await hive.accept(id);
      expect(hive.card(id).lane).toBe("ship");
      expect(ports.stopped.length).toBe(stops + 1);
      expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'accept'").get()).toEqual({ n: 1 });
      await expect(hive.accept(id)).rejects.toMatchObject({ status: 409 });
      await hive.backToTryIt(id);
      expect(hive.card(id).lane).toBe("tryit");
    });

    it("clears the feedback when the developer's build goes back to Spec", async () => {
      const { id } = await inTryIt();
      await hive.feedback(id, { text: "It crashes with no printers." });
      await waitFor(() => turnsOf("developer").length === 2);
      await lastOf("developer").end({ kind: "ok", report: { ...built, status: "blocked", blockedReason: "Needs a printers table." } });
      await keeperFallsBack(id);
      await hive.backToSpec(id);
      expect(hive.card(id)).toMatchObject({ lane: "spec", feedback: null });
    });
  });

  describe("the app in Try it", () => {
    it("starts when the card enters Try it, from the setup's entries, with the port read from an old setup's URL", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      expect(apps.started[0]!.entries).toEqual([
        { what: "the app", command: "PORT=5200 npm run dev", dir: ".", port: 5200, url: "http://localhost:5200" },
      ]);
      expect(hive.card(id).apps).toEqual([
        { what: "the app", port: 5200, url: "http://localhost:5200", state: "running", reason: null, output: [] },
      ]);
      expect(events.some((e) => e.type === "app.updated")).toBe(true);
      // The ports it's about to use were swept first.
      expect(ports.stopped.some((s) => s.ports.length === 1 && s.ports[0] === 5200)).toBe(true);
    });

    it("refuses entries outside the card's ports or the worktree, and two on one port", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      const setup = hive.card(id).setup!;
      db.updateCard(id, {
        setup: {
          ...setup,
          start: [
            { what: "backend", command: "x", dir: "api", port: 5201, url: null },
            { what: "frontend", command: "y", dir: ".", port: 5201, url: null },
            { what: "stray", command: "z", dir: "../elsewhere", port: 5202, url: null },
            { what: "default port", command: "w", dir: ".", port: 3000, url: null },
          ],
        },
      });
      await hive.appRestart(id);
      expect(hive.card(id).apps.map((a) => [a.what, a.state, a.reason])).toEqual([
        ["backend", "running", null],
        ["frontend", "stopped", "Another process already uses port 5201. Prepare it again."],
        ["stray", "stopped", "Its folder is outside the worktree. Prepare it again."],
        ["default port", "stopped", "Its port 3000 is outside the card's ports. Prepare it again."],
      ]);
    });

    it("remembers your Stop across a hive restart, until you press Start", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      await hive.appStop(id);
      expect(hive.card(id)).toMatchObject({ appStopped: true, apps: [{ state: "stopped" }] });

      const restarted = newHive();
      restarted.recoverAfterRestart();
      await new Promise((r) => setTimeout(r, 50));
      expect(apps.started).toHaveLength(1);

      await restarted.appStart(id);
      expect(apps.started).toHaveLength(2);
      expect(restarted.card(id)).toMatchObject({ appStopped: false, apps: [{ state: "running" }] });
      restarted.close();
    });

    it("leaves the app stopped when you press Stop while its ports are being cleared", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      ports.stopListeners = async () => (await gate, []);
      const restarting = hive.appRestart(id);
      await new Promise((r) => setTimeout(r, 10));
      await hive.appStop(id);
      release();
      await restarting;
      expect(apps.started).toHaveLength(1);
      expect(hive.card(id)).toMatchObject({ appStopped: true, apps: [{ state: "stopped" }] });
    });

    it("starts the app again after a hive restart", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      const restarted = newHive();
      restarted.recoverAfterRestart();
      await waitFor(() => apps.started.length === 2);
      expect(apps.started[1]!.cardId).toBe(id);
      restarted.close();
    });

    it("stops the app as the card leaves Try it, and forgets your Stop", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      await hive.appStop(id);
      await hive.accept(id);
      expect(apps.stopped.filter((c) => c === id).length).toBeGreaterThanOrEqual(2);
      expect(hive.card(id)).toMatchObject({ lane: "ship", apps: [], appStopped: false });
      await hive.backToTryIt(id);
      await waitFor(() => apps.started.length === 2);
    });

    it("stops the app while a setup runs in Try it, and starts it with the new commands when it's done", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      hive.setupAgain(id);
      await waitFor(() => apps.stopped.includes(id));
      await waitFor(() => runner.setupTurns.length === 2);
      await lastSetup().end({
        kind: "ok",
        report: { ...setupDone, start: [{ what: "the app", command: "npm run dev -- --port 5203", dir: ".", port: 5203, url: null }] },
      });
      await waitFor(() => apps.started.length === 2);
      expect(apps.started[1]!.entries[0]).toMatchObject({ command: "npm run dev -- --port 5203", port: 5203 });
    });

    it("links a loopback address as localhost, for a stored setup and a new one", async () => {
      const { id } = await inTryIt();
      await waitFor(() => apps.started.length === 1);
      db.updateCard(id, {
        setup: { ...hive.card(id).setup!, start: [{ what: "the app", command: "x", dir: ".", port: 5201, url: "http://127.0.0.1:5201/" }] },
      });
      await hive.appRestart(id);
      expect(hive.card(id).apps[0]!.url).toBe("http://localhost:5201/");

      hive.setupAgain(id);
      await waitFor(() => runner.setupTurns.length === 2);
      await lastSetup().end({
        kind: "ok",
        report: { ...setupDone, start: [{ what: "the app", command: "y", dir: ".", port: 5203, url: "http://[::1]:5203/app" }] },
      });
      await waitFor(() => apps.started.length === 3);
      expect(hive.card(id).setup!.start[0]!.url).toBe("http://localhost:5203/app");
      expect(apps.started[2]!.entries[0]!.url).toBe("http://localhost:5203/app");
    });

    it("refuses Start, Stop and Restart outside Try it, and Start without a finished setup", async () => {
      const { id } = await inTryIt();
      db.updateCard(id, { setup: { ...hive.card(id).setup!, status: "failed", reason: "x" } });
      await expect(hive.appStart(id)).rejects.toMatchObject({ status: 409 });
      await hive.accept(id);
      await expect(hive.appStop(id)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("after a restart", () => {
    it("resumes a cut-off setup turn in the background", async () => {
      const { id, setup } = await inRefine();
      setup.handlers.onSessionCreated();
      await lastOf("product-owner").end();
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.setupTurns).toHaveLength(2);
      expect(lastSetup().request.sessionId).toBe(setup.request.sessionId);
      expect(lastSetup().request.message).toMatch(/Finish setting up the worktree and report/);
      expect(restarted.card(id)).toMatchObject({ state: "needs-you", turnRunning: false });
      restarted.close();
    });

    it("marks a setup the hive never got to start as failed, without starting a waiting Build", async () => {
      const { id, planner, setup } = await inPlan({ finishSetup: false });
      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => hive.card(id).lane === "build");
      db.db.prepare("UPDATE sessions SET turn_running = 0 WHERE id = ?").run(setup.request.sessionId);
      const developers = turnsOf("developer").length;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(id).setup).toMatchObject({ status: "failed", reason: "The hive stopped before it finished." });
      expect(turnsOf("developer")).toHaveLength(developers);
      expect(restarted.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "Build hasn't started yet.", actions: ["retry"] });
      restarted.close();
    });
  });
});
