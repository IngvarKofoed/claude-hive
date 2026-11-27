// The hive's orchestration: projects, cards and their moves, and every session's turns, from Ideas through Refine,
// Spec, Plan and Build (docs/specs/2026-11-26-board-refine-chat.md, docs/specs/2026-11-26-spec-lane-review-gate.md,
// docs/specs/2026-11-26-build-lane-developer.md).
// Plain code decides; Claude sessions only do the work (packages/backend/CLAUDE.md, Rules).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AnswerBody, BoardResponse, Brief, CardDetail, CardSummary, ChatAuthor, ChatItem, ErrorAction, FileChange, Lane,
  PendingItem, Plan, Question, SpecInfo,
} from "@hive/shared";
import { canMove, laneAfter, laneAfterBuild, laneAfterPlan } from "./board/moves";
import { HiveDb, projectSummary, type CardRow, type SessionRow } from "./db";
import type { EventHub } from "./events";
import type { Role, RunningTurn, SessionRunner, ToolDecision, TrustProbe, TurnOutcome } from "./sessions/types";
import { readSpec, reviewState, SpecWatch, specPathFor } from "./spec";
import {
  DEVELOPER_SCHEMA, findingsMessage, parseDeveloperReport, parsePlanReport, parseReviewReport, PLAN_SCHEMA,
  REVIEW_SCHEMA,
} from "./spec/reports";
import type { MergeResult } from "./git";

/** The git service's API (packages/backend/src/git). */
export interface GitService {
  resolveRepoRoot(path: string): Promise<string>;
  hasBranch(root: string, branch: string): Promise<boolean>;
  ensureWorktreesExcluded(root: string): Promise<void>;
  createCardWorktree(root: string, slug: string): Promise<{ worktreePath: string; branch: string }>;
  commitFile(worktree: string, path: string, message: string): Promise<boolean>;
  mergeMain(worktree: string): Promise<MergeResult>;
  mergeInProgress(worktree: string): Promise<boolean>;
  abortMerge(worktree: string): Promise<void>;
  commitAll(worktree: string, message: string): Promise<boolean>;
  changedFiles(worktree: string): Promise<FileChange[]>;
  cardSlug(title: string, id: string): string;
}

/** An error whose message is meant for the page, with the HTTP status to send it with. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface HiveDeps {
  db: HiveDb;
  hub: EventHub;
  git: GitService;
  runner: SessionRunner;
  probe: TrustProbe;
  /** Loads a role by name, e.g. "product-owner". */
  role: (name: string) => Role;
  /** The folder with the spec format's `format.md` and `review.md` (~/.claude/skills/spec-format). */
  specFormatDir: string;
  /** Today's date as YYYY-MM-DD, for spec file names. */
  today?: () => string;
  log?: (message: string) => void;
}

/** The role whose session a lane talks to. */
const LANE_ROLE: Partial<Record<Lane, string>> = {
  refine: "product-owner",
  spec: "spec-writer",
  plan: "planner",
  build: "developer",
};
const REVIEWER = "spec-reviewer";
const CHAT_LANES: Lane[] = ["refine", "spec"];

const AUTHOR: Record<string, ChatAuthor> = {
  "product-owner": "product-owner",
  "spec-writer": "spec-writer",
  planner: "planner",
  developer: "developer",
};

/** The idea's first sentence, cut to 60 characters (spec: Board and moves). */
export function titleFromIdea(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

function refineFirstMessage(projectName: string, idea: string): string {
  return [
    `A new idea for the project ${projectName}:`,
    "",
    idea,
    "",
    "Read the repo, then open with a draft brief through write_brief, and ask what you need to know with AskUserQuestion.",
  ].join("\n");
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");

function briefText(brief: Brief | null): string {
  if (!brief) return "(The product owner wrote no brief.)";
  return [
    `Title: ${brief.title}`,
    `Problem: ${brief.problem}`,
    `Who it's for: ${brief.whoItsFor}`,
    "What done looks like:",
    list(brief.whatDoneLooksLike),
    "Out of scope:",
    list(brief.outOfScope),
    "Open points:",
    list(brief.openPoints),
  ].join("\n");
}

/** The plan as text, for the developer's message. */
function planText(plan: Plan | null): string {
  if (!plan) return "(The card has no plan.)";
  const steps = plan.steps.map((s, i) =>
    [`${i + 1}. ${s.title} [chunk: ${s.chunk}]`, s.detail ? `   ${s.detail}` : "", `   Checked by: ${s.check}`]
      .filter(Boolean)
      .join("\n"));
  const chunks = plan.chunks.map((c) => `- ${c.name} (${c.model}): ${c.owns.join(", ") || "(no files listed)"}`);
  return ["Steps:", ...steps, "", "Chunks:", ...chunks, "", "Tests:", list(plan.tests)].join("\n");
}

/** What bringing in main did, as the hive's note in Build's chat. */
export function mergeNote(merge: MergeResult): string {
  switch (merge.kind) {
    case "clean":
      return merge.commits === 0 ? "Main was already in." : `Brought in main: ${count(merge.commits, "new commit", "new commits")}.`;
    case "conflict":
      return `Bringing in main stopped on conflicts in ${merge.files.join(", ") || "some files"}. The developer resolves them first.`;
    case "failed":
      return `Bringing in main failed: ${sentence(merge.reason)} The developer was told to bring it in itself.`;
  }
}

/** What bringing in main did, and what to do about it, for the developer. */
function mergeInstruction(merge: MergeResult): string {
  switch (merge.kind) {
    case "clean":
      return merge.commits === 0
        ? "main was already in this branch."
        : `the hive merged ${count(merge.commits, "new commit", "new commits")} from main into this branch.`;
    case "conflict":
      return `the merge of main stopped on conflicts in ${merge.files.join(", ") || "some files"}. Resolve them and ` +
        "commit the merge first.";
    case "failed":
      return `git merge main failed: ${sentence(merge.reason)} Merge main into this branch yourself first.`;
  }
}

/** A question waiting for an answer that a live turn is blocked on. */
interface Waiter {
  resolve(answer: AnswerBody): void;
}

const localDate = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time

export class Hive {
  private turns = new Map<string, RunningTurn>(); // session id → running turn
  private waiters = new Map<string, Waiter>(); // pending item id → live turn waiting on it
  private stopping = new Set<string>(); // session ids being stopped by you
  private withdrawn = new Set<string>(); // session ids whose turn had a question withdrawn
  private followUps = new Map<string, string[]>(); // session id → messages that missed a turn already ending
  private moving = new Set<string>(); // card ids with a move in flight
  private starting = new Set<string>(); // card ids whose developer is being started (bringing in main)
  private reviews = new Map<string, { sessionId: string; hash: string }>(); // card id → running review and H0
  private lastSpec = new Map<string, string>(); // card id → the spec.updated last sent, to send only changes
  private watch = new SpecWatch();

  constructor(private deps: HiveDeps) {}

  private get db() {
    return this.deps.db;
  }

  private log(message: string) {
    (this.deps.log ?? console.error)(message);
  }

  /** Stops watching spec folders. */
  close(): void {
    this.watch.closeAll();
  }

  // ---------- reads ----------

  board(): BoardResponse {
    return {
      projects: this.db.listProjects().map(projectSummary),
      cards: this.db.listCards().map(cardSummary),
    };
  }

  card(id: string): CardDetail {
    const card = this.requireCard(id);
    const project = this.db.getProject(card.projectId)!;
    return {
      ...cardSummary(card),
      projectName: project.name,
      ideaText: card.ideaText,
      branch: card.branch,
      worktreePath: card.worktreePath,
      brief: card.brief,
      spec: card.specPath ? this.refreshSpec(card.id) : null,
      plan: card.plan,
      build: card.build,
      issues: this.db.issuesFor(card.id),
      decisions: this.db.decisionsFor(card.id),
      chat: this.db.chatFor(card.id, card.lane),
      pending: this.db.openPendingFor(card.id)?.item ?? null,
      turnRunning: this.anyTurnRunning(card.id),
    };
  }

  // ---------- projects ----------

  async addProject(path: string): Promise<void> {
    if (typeof path !== "string" || !path.trim()) throw new HttpError(400, "Give the path to a git repo.");
    let root: string;
    try {
      root = await this.deps.git.resolveRepoRoot(path.trim());
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (this.db.getProjectByPath(root)) throw new HttpError(409, `${root} is already a project.`);
    if (!(await this.deps.git.hasBranch(root, "main"))) {
      throw new HttpError(400, `${root} has no main branch. Cards start from main.`);
    }
    const project = { id: randomUUID(), name: basename(root), path: root, trustWarning: false };
    this.db.insertProject(project);
    this.deps.hub.emit({ type: "project.updated", project: projectSummary(project) });
    void this.checkTrust(project.id); // the row warns once the probe is back; adding doesn't wait for it
  }

  /** Run the trust probe and set the project's warning (spec: the trust probe). */
  async checkTrust(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) throw new HttpError(404, "No such project.");
    const hasClaudeMd = ["CLAUDE.md", join(".claude", "CLAUDE.md")].some((f) => existsSync(join(project.path, f)));
    let warning = false;
    if (hasClaudeMd) {
      try {
        warning = !(await this.deps.probe.loadsProjectClaudeMd(project.path));
      } catch (error) {
        this.log(`Trust probe failed for ${project.path}: ${(error as Error).message}`);
        return; // can't tell; leave the warning as it was
      }
    }
    this.db.setTrustWarning(project.id, warning);
    this.deps.hub.emit({ type: "project.updated", project: projectSummary({ ...project, trustWarning: warning }) });
  }

  // ---------- cards and moves ----------

  createCard(projectId: string, text: string): CardSummary {
    if (!this.db.getProject(projectId)) throw new HttpError(404, "No such project.");
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type an idea first.");
    const card: CardRow = {
      id: randomUUID(), projectId, title: titleFromIdea(text), ideaText: text.trim(), lane: "ideas",
      state: "needs-you", branch: null, worktreePath: null, brief: null, moveError: null,
      specPath: null, reviewedSpecHash: null, reviewApplying: false, plan: null, build: null,
    };
    this.db.insertCard(card);
    this.emitCard(card.id);
    return cardSummary(card);
  }

  async moveCard(id: string, lane: Lane): Promise<CardSummary> {
    const card = this.requireCard(id);
    if (!canMove(card.lane, lane)) throw new HttpError(409, `A card can't move from ${card.lane} to ${lane} yet.`);
    return this.oneMoveAtATime(id, () => this.enterRefine(card, lane));
  }

  /** A second move while the first is still running would trip over what the first just made. */
  private async oneMoveAtATime<T>(id: string, move: () => Promise<T>): Promise<T> {
    if (this.moving.has(id)) throw new HttpError(409, "This card is already moving.");
    this.moving.add(id);
    try {
      return await move();
    } finally {
      this.moving.delete(id);
    }
  }

  private async enterRefine(card: CardRow, lane: Lane): Promise<CardSummary> {
    const id = card.id;
    const project = this.db.getProject(card.projectId)!;

    // The lane changes only once the worktree exists; a git failure leaves the card in Ideas.
    let worktree: { worktreePath: string; branch: string };
    try {
      await this.deps.git.ensureWorktreesExcluded(project.path);
      worktree = await this.deps.git.createCardWorktree(project.path, this.deps.git.cardSlug(card.title, card.id));
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(409, (error as Error).message);
    }
    // Load the role before the lane changes, so a broken role file leaves the card in Ideas instead of in Refine
    // with no session to talk to.
    let role: Role;
    try {
      role = this.deps.role(LANE_ROLE.refine!);
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(500, (error as Error).message);
    }
    this.db.updateCard(id, { lane, branch: worktree.branch, worktreePath: worktree.worktreePath, moveError: null });

    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId: id, lane, role: LANE_ROLE.refine!, kind: role.kind });
    this.startTurn(id, sessionId, refineFirstMessage(project.name, card.ideaText));
    return cardSummary(this.requireCard(id));
  }

  /** Refine → Spec when you say Good. Mockup is skipped in this slice. */
  async good(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "good");
    if (!to) throw new HttpError(409, "Good moves a card on from Refine.");
    if (this.anyTurnRunning(cardId) || this.db.openPendingFor(cardId)) {
      throw new HttpError(409, "Wait for the product owner to finish.");
    }
    const format = this.formatFile("format.md");
    this.formatFile("review.md"); // the review gate needs it later; refuse now rather than in the middle of Spec
    return this.oneMoveAtATime(cardId, async () => {
      const role = this.deps.role(LANE_ROLE.spec!);
      const specPath = specPathFor(card.worktreePath!, card.brief?.title || card.title, (this.deps.today ?? localDate)());
      this.db.updateCard(cardId, { lane: to, specPath, reviewedSpecHash: null, reviewApplying: false });
      const sessionId = randomUUID();
      this.db.insertSession({ id: sessionId, cardId, lane: to, role: LANE_ROLE.spec!, kind: role.kind });
      this.watchSpec(cardId);
      this.startTurn(cardId, sessionId, this.specFirstMessage(cardId, specPath), { extraInstructions: format });
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** Spec → Plan, only while the spec on disk is the text the last finished review produced. */
  async signoff(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "signoff");
    if (!to || !card.specPath) throw new HttpError(409, "Sign off moves a card on from Spec.");
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    if (card.reviewApplying) throw new HttpError(409, "The review wasn't finished. Retry it first.");
    if (!card.reviewedSpecHash) throw new HttpError(409, "Run the review first.");
    const { hash } = readSpec(card.worktreePath!, card.specPath);
    if (hash !== card.reviewedSpecHash) {
      this.refreshSpec(cardId);
      throw new HttpError(409, "The spec changed since the review. Review it again first.");
    }
    return this.oneMoveAtATime(cardId, async () => {
      try {
        await this.deps.git.commitFile(card.worktreePath!, card.specPath!, `Spec: ${card.title}`);
      } catch (error) {
        throw new HttpError(409, (error as Error).message);
      }
      this.watch.unwatch(cardId);
      this.db.updateCard(cardId, { lane: to });
      this.startPlanner(cardId);
      return cardSummary(this.requireCard(cardId));
    });
  }

  /**
   * A blocked plan or build goes back to the spec writer with its reason; a new review and sign-off follow. A build's
   * partial work is committed first, after aborting an unfinished merge of main, which the next Build merges again.
   */
  async backToSpec(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const from = card.lane;
    const to = laneAfter(from, "back-to-spec");
    if (!to) throw new HttpError(409, "Only a card in Plan or Build can go back to Spec.");
    const who = from === "build" ? "developer" : "planner";
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, `Wait for the ${who} to finish.`);
    const last = this.db.lastChatItem(cardId, from);
    if (!last || last.kind !== "error" || !last.actions.includes("back-to-spec")) {
      throw new HttpError(409, `Only a blocked ${from === "build" ? "build" : "plan"} goes back to Spec.`);
    }
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    if (!writer) throw new HttpError(409, "This card has no spec writer to go back to.");
    return this.oneMoveAtATime(cardId, async () => {
      if (from === "build") {
        const worktree = card.worktreePath!;
        try {
          if (await this.deps.git.mergeInProgress(worktree)) await this.deps.git.abortMerge(worktree);
          await this.deps.git.commitAll(worktree, `Build (unfinished): ${card.title}`);
        } catch (error) {
          throw new HttpError(409, `The build's partial work couldn't be committed: ${(error as Error).message}`);
        }
      }
      this.db.updateCard(cardId, { lane: to, reviewedSpecHash: null, reviewApplying: false });
      this.watchSpec(cardId);
      this.startTurn(cardId, writer.id, [
        `The ${who} couldn't ${from === "build" ? "build" : "plan"} from the signed-off spec. What it reported:`,
        "",
        last.message,
        "",
        "Revise the spec to resolve this, then say briefly what you changed. It needs a new review and sign-off.",
      ].join("\n"), this.turnOptions(LANE_ROLE.spec!));
      return cardSummary(this.requireCard(cardId));
    });
  }

  // ---------- chat ----------

  sendMessage(cardId: string, text: string): void {
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type a message first.");
    const card = this.requireCard(cardId);
    if (!CHAT_LANES.includes(card.lane)) throw new HttpError(409, "Nobody to chat with in this lane.");
    this.refuseWhileMoving(cardId);
    const session = this.requireLaneSession(cardId);
    const open = this.db.openPendingFor(cardId);
    const answersQuestion = open?.item.kind === "question";

    // While a review runs or is being applied, the spec mustn't change outside it (spec: Review).
    if (card.lane === "spec") {
      if (this.reviews.has(cardId)) throw new HttpError(409, "Wait for the review to finish.");
      if (card.reviewApplying && this.turns.has(session.id) && !answersQuestion) {
        throw new HttpError(409, "The spec writer is applying the review. Answer its questions, or wait.");
      }
      if (card.reviewApplying && !this.turns.has(session.id)) {
        this.db.updateCard(cardId, { reviewApplying: false });
        this.addNote(cardId, "spec", "The unfinished review is set aside. Press Review again when the spec is ready.");
        this.refreshSpec(cardId);
      }
    }

    this.addChat(cardId, card.lane, "you", text.trim());
    // A message sent while a question waits answers it instead of joining the turn.
    if (open && open.item.kind === "question") {
      const answers = Object.fromEntries(open.item.questions.map((q) => [q.question, text.trim()]));
      this.answer(open.id, { answers }, { alreadyInChat: true });
      return;
    }
    this.deliver(cardId, session.id, text.trim());
  }

  answer(itemId: string, body: AnswerBody, opts: { alreadyInChat?: boolean } = {}): void {
    const pending = this.db.getPending(itemId);
    if (!pending) throw new HttpError(404, "Nothing is waiting with that id.");
    if (pending.answered) throw new HttpError(409, "That has already been answered.");
    if (pending.item.kind === "question" && !isAnswers(body)) throw new HttpError(400, "Send answers.");
    if (pending.item.kind === "permission" && !("allow" in body)) throw new HttpError(400, "Send allow.");
    const lane = this.db.getSession(pending.sessionId)?.lane ?? this.requireCard(pending.cardId).lane;

    this.db.setPendingAnswer(itemId, body);
    this.deps.hub.emit({ type: "pending.updated", cardId: pending.cardId, pending: null });
    // Your answer stays in the chat however it was given, since the question card goes once it's answered.
    if (isAnswers(body) && !opts.alreadyInChat) {
      this.addChat(pending.cardId, lane, "you", summarizeAnswers(body.answers));
    }

    const waiter = this.waiters.get(itemId);
    if (waiter) {
      this.waiters.delete(itemId);
      this.setState(pending.cardId, "working");
      waiter.resolve(body);
      return;
    }
    // The turn that asked is gone (a restart, or its canUseTool call was aborted): the answer goes to the session
    // as a message, joining a turn that is still running rather than starting a second one beside it.
    if (pending.item.kind === "question" && isAnswers(body)) {
      this.deliver(pending.cardId, pending.sessionId, answerAsMessage(pending.item.questions, body.answers));
    } else {
      this.setState(pending.cardId, "needs-you");
    }
  }

  async stop(cardId: string): Promise<void> {
    this.requireCard(cardId);
    if (this.starting.has(cardId)) throw new HttpError(409, "Build is bringing in main. Stop once the developer runs.");
    for (const session of this.cardSessions(cardId)) {
      const running = this.turns.get(session.id);
      if (!running) continue;
      this.stopping.add(session.id);
      await running.interrupt();
    }
  }

  retry(cardId: string): void {
    const card = this.requireCard(cardId);
    this.refuseWhileMoving(cardId);
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "A turn is already running.");
    const last = this.db.lastChatItem(cardId, card.lane);
    if (!last || last.kind !== "error" || !last.actions.includes("retry")) {
      throw new HttpError(409, "There is no failed turn to retry.");
    }
    if (card.lane === "build") {
      // A stored report whose checkpoint failed: redo only the checkpoint and the move, not the build.
      if (card.build) {
        void this.oneMoveAtATime(cardId, () => this.finishBuild(cardId))
          .catch((error: unknown) => this.log(`Finishing the build of card ${cardId} failed: ${String(error)}`));
        return;
      }
      // A developer that has had no turn yet in this visit: start it afresh, bringing in main again.
      const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
      if (!developer?.lastMessage) {
        void this.startDeveloper(cardId)
          .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
        return;
      }
    }
    const session = this.requireLaneSession(cardId);
    if (!session.lastMessage) throw new HttpError(409, "There is no failed turn to retry.");
    this.startTurn(cardId, session.id, session.lastMessage, this.turnOptions(session.role));
  }

  // ---------- the review gate ----------

  /** Start the blind review of the spec as it is on disk now (spec: Review). */
  review(cardId: string): void {
    const card = this.requireCard(cardId);
    if (card.lane !== "spec" || !card.specPath) throw new HttpError(409, "Only a spec can be reviewed.");
    this.refuseWhileMoving(cardId);
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    if (card.reviewApplying) throw new HttpError(409, "The last review wasn't finished. Retry it first.");
    const { hash } = readSpec(card.worktreePath!, card.specPath);
    if (!hash) throw new HttpError(409, "There is no spec to review yet.");
    const reviewMd = join(this.deps.specFormatDir, "review.md");
    if (!existsSync(reviewMd)) throw new HttpError(409, `The review guide is missing: ${reviewMd}`);

    const role = this.deps.role(REVIEWER);
    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId, lane: "spec", role: REVIEWER, kind: role.kind });
    this.reviews.set(cardId, { sessionId, hash });
    this.startTurn(
      cardId,
      sessionId,
      `Review the spec at ${join(card.worktreePath!, card.specPath)}. Read ${reviewMd} and follow its "For the reviewer" part.`,
      this.turnOptions(REVIEWER),
    );
    this.refreshSpec(cardId);
  }

  private onReviewEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const started = this.reviews.get(cardId);
    this.reviews.delete(cardId);
    const again = (message: string) => this.addError(cardId, "spec", message, ["review"]);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return again("The review was stopped. Press Review again.");
    if (outcome.kind === "error") return again(`The review failed: ${outcome.message}`);
    const report = parseReviewReport(outcome.report);
    if (!report) return again("The review didn't return a report.");
    if (report.status === "blocked") return again(`The reviewer couldn't review the spec: ${report.reason}`);

    const card = this.requireCard(cardId);
    const { hash } = readSpec(card.worktreePath!, card.specPath!);
    if (!started || hash !== started.hash) {
      this.addNote(cardId, "spec", "The spec changed during the review, so its findings may not fit. Press Review again.");
      return;
    }
    if (report.findings.length === 0) {
      this.db.updateCard(cardId, { reviewedSpecHash: hash });
      this.addNote(cardId, "spec", "The review found nothing to change. You can sign off.");
      return;
    }
    const fixes = report.findings.filter((f) => f.kind === "fix").length;
    const decisions = report.findings.length - fixes;
    this.addNote(cardId, "spec",
      `The review found ${count(fixes, "fix", "fixes")} and ${count(decisions, "decision", "decisions")}. ` +
        "The spec writer is applying them.");
    let options: ReturnType<Hive["turnOptions"]>;
    try {
      options = this.turnOptions(LANE_ROLE.spec!);
    } catch (error) {
      return again(`The review's findings can't be sent to the spec writer: ${(error as Error).message}`);
    }
    this.db.updateCard(cardId, { reviewApplying: true });
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!)!;
    this.startTurn(cardId, writer.id, findingsMessage(report.findings), options);
  }

  /** The spec writer's turn ended. If it was the review turn, only a finished one makes the spec reviewed. */
  private onWriterEnded(cardId: string, outcome: TurnOutcome, stopped: boolean, withdrew: boolean): void {
    const card = this.requireCard(cardId);
    if (!card.reviewApplying) return;
    const finished = outcome.kind === "ok" && !outcome.interrupted && !stopped && !withdrew;
    if (finished) {
      const { hash } = readSpec(card.worktreePath!, card.specPath!);
      this.db.updateCard(cardId, { reviewApplying: false, reviewedSpecHash: hash });
      this.addNote(cardId, "spec", "The review is applied. You can sign off.");
    } else {
      const why = outcome.kind === "error" ? `: ${outcome.message}` : ".";
      this.addError(cardId, "spec", `The review wasn't finished${why} Retry sends its findings again.`, ["retry"]);
    }
  }

  // ---------- the planner ----------

  private startPlanner(cardId: string): void {
    const card = this.requireCard(cardId);
    let planner = this.db.getSessionFor(cardId, "plan", LANE_ROLE.plan!);
    const again = !!planner;
    if (!planner) {
      const role = this.deps.role(LANE_ROLE.plan!);
      const id = randomUUID();
      this.db.insertSession({ id, cardId, lane: "plan", role: LANE_ROLE.plan!, kind: role.kind });
      planner = this.db.getSession(id)!;
    }
    const message = again
      ? `The spec was revised and signed off again: ${card.specPath}. Read it again and write the build plan as your report.`
      : `The spec for this card is signed off: ${card.specPath}. Read it and the code, and write the build plan as your report.`;
    this.startTurn(cardId, planner.id, message, this.turnOptions(LANE_ROLE.plan!));
  }

  private onPlannerEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const fail = (message: string, actions: ErrorAction[]) => this.addError(cardId, "plan", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The planner was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The planner failed: ${outcome.message}`, ["retry"]);
    const report = parsePlanReport(outcome.report);
    if (!report) return fail("The planner didn't return a plan.", ["retry", "back-to-spec"]);
    if (report.status === "blocked") {
      return fail(`The planner couldn't plan from this spec: ${report.reason}`, ["retry", "back-to-spec"]);
    }
    this.db.updateCard(cardId, { plan: report.plan, lane: laneAfterPlan("done") });
    this.db.addEvent(cardId, "plan", report.plan, randomUUID());
    this.deps.hub.emit({ type: "plan.updated", cardId, plan: report.plan });
    this.emitCard(cardId);
    void this.startDeveloper(cardId)
      .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
  }

  // ---------- the developer ----------

  /**
   * Each entry to Build: bring in main, then start the developer, or resume it with the revised spec and plan.
   * Whatever bringing in main did is told to the developer; there is no separate error path for it.
   */
  private async startDeveloper(cardId: string): Promise<void> {
    const roleName = LANE_ROLE.build!;
    this.starting.add(cardId);
    this.setState(cardId, "working");
    try {
      // A new visit starts without a report (Card.build is set only between a done report and the move to Check),
      // and without a last message: until this visit's first turn starts, Retry starts the developer afresh,
      // bringing in main again, instead of re-sending an earlier visit's message with its old plan.
      this.db.updateCard(cardId, { build: null });
      const existing = this.db.getSessionFor(cardId, "build", roleName);
      if (existing) this.db.updateSession(existing.id, { lastMessage: null });
      const role = this.deps.role(roleName); // a broken role file fails here, before the merge
      const card = this.requireCard(cardId);
      const merge = await this.deps.git.mergeMain(card.worktreePath!);
      this.addNote(cardId, "build", mergeNote(merge));
      let developer = this.db.getSessionFor(cardId, "build", roleName);
      const again = !!developer?.existsYet;
      if (!developer) {
        const id = randomUUID();
        this.db.insertSession({ id, cardId, lane: "build", role: roleName, kind: role.kind });
        developer = this.db.getSession(id)!;
      }
      const opening = again
        ? `The spec was revised and signed off again: ${card.specPath}, and the planner re-planned. Bring your work ` +
          "in line with the spec and the new plan below, then end with your report."
        : `The spec for this card is signed off: ${card.specPath}. Read it, then build to the planner's plan below, ` +
          "and end with your report.";
      this.startTurn(cardId, developer.id, [
        opening,
        "",
        `Bringing in main: ${mergeInstruction(merge)}`,
        "",
        "The plan:",
        "",
        planText(card.plan),
      ].join("\n"), this.turnOptions(roleName));
    } catch (error) {
      this.addError(cardId, "build", `Build couldn't start: ${(error as Error).message}`, ["retry"]);
    } finally {
      this.starting.delete(cardId);
      if (!this.anyTurnRunning(cardId)) {
        this.setState(cardId, "needs-you");
        this.deps.hub.emit({ type: "turn.ended", cardId });
      }
    }
  }

  private async onDeveloperEnded(cardId: string, session: SessionRow, outcome: TurnOutcome, stopped: boolean): Promise<void> {
    const fail = (message: string, actions: ErrorAction[]) => this.addError(cardId, "build", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The developer was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The developer failed: ${outcome.message}`, ["retry"]);
    const report = parseDeveloperReport(outcome.report);
    if (!report) return fail("The developer didn't return a report.", ["retry", "back-to-spec"]);
    if (report.status === "blocked") {
      return fail(`The developer couldn't build this: ${report.reason}`, ["retry", "back-to-spec"]);
    }
    const card = this.requireCard(cardId);
    const mergeUnfinished = await this.deps.git.mergeInProgress(card.worktreePath!);
    if (laneAfterBuild("done", mergeUnfinished) !== "check") {
      return fail("The developer reported done, but the merge of main isn't finished.", ["retry", "back-to-spec"]);
    }
    // The report is stored before the checkpoint, so nothing in it is lost if git refuses the commit.
    this.db.transaction(() => {
      this.db.updateCard(cardId, { build: { summary: report.summary, departures: report.departures, files: [] } });
      for (const issue of report.issues) this.db.addIssue(cardId, { foundIn: "build", ...issue });
      for (const decision of report.decisions) {
        this.db.addDecision(cardId, { lane: "build", source: "developer", ...decision }, session.id);
      }
      this.db.addEvent(cardId, "build", report, randomUUID());
    });
    await this.finishBuild(cardId);
  }

  /** Leave Build with a done report stored: the checkpoint, the changed files, then the move to Check. */
  private async finishBuild(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    let files: FileChange[];
    try {
      await this.deps.git.commitAll(card.worktreePath!, `Build: ${card.title}`);
      files = await this.deps.git.changedFiles(card.worktreePath!);
    } catch (error) {
      const why = sentence((error as Error).message);
      this.addError(cardId, "build", `The build's checkpoint couldn't be committed: ${why} Retry commits it again.`, ["retry"]);
      return;
    }
    this.db.updateCard(cardId, { build: { ...card.build!, files }, lane: laneAfterBuild("done") });
    this.emitCard(cardId);
  }

  // ---------- startup ----------

  /**
   * After a restart. A chat lane's cut-off turn is not resumed; it waits for you. A cut-off planner or developer turn
   * is resumed once, as for any hands-off lane. A cut-off review, or review turn, gets its own way to start again.
   * A card in Build that nothing is resuming gets a line with Retry, so it's never stuck without a way on; nothing
   * starts a build by itself, since that would spend a long Opus turn without anyone asking.
   */
  recoverAfterRestart(): void {
    for (const session of this.db.listRunningSessions()) {
      this.db.updateSession(session.id, { turnRunning: false });
      this.db.updateCard(session.cardId, { state: "needs-you" });
      const card = this.db.getCard(session.cardId);
      if (!card) continue;
      if (session.role === REVIEWER) {
        this.addError(card.id, "spec", "The review was cut off when the hive stopped. Press Review again.", ["review"]);
      } else if (session.role === LANE_ROLE.plan || session.role === LANE_ROLE.build) {
        const planner = session.role === LANE_ROLE.plan;
        // A missing spec format or role file must not stop the hive from starting; the session waits for Retry.
        try {
          this.startTurn(card.id, session.id, planner
            ? "Your last turn was cut off when the hive stopped. Finish the build plan and report it."
            : "Your last turn was cut off when the hive stopped. Carry on building to the plan, then report.",
          this.turnOptions(session.role));
        } catch (error) {
          this.db.updateSession(session.id, { turnRunning: false });
          this.db.updateCard(card.id, { state: "needs-you" });
          this.addError(card.id, session.lane,
            `The ${planner ? "planner" : "developer"} couldn't restart: ${(error as Error).message}`, ["retry"]);
        }
      } else if (session.role === LANE_ROLE.spec && card.reviewApplying) {
        this.addError(card.id, "spec",
          "The review wasn't finished: the hive stopped while the spec writer was applying it. Retry sends its findings again.",
          ["retry"]);
      } else {
        this.addError(card.id, session.lane, "The last reply was cut off when the hive stopped. Send a message to carry on.", []);
      }
    }
    for (const card of this.db.listCards()) {
      if (card.lane === "spec" && card.specPath) this.watchSpec(card.id);
      if (card.lane === "build") this.offerBuildWayOn(card);
    }
  }

  /** A card in Build with nothing running and no error line offering Retry gets one. */
  private offerBuildWayOn(card: CardRow): void {
    if (this.anyTurnRunning(card.id)) return;
    const last = this.db.lastChatItem(card.id, "build");
    if (last?.kind === "error" && last.actions.includes("retry")) return;
    const developer = this.db.getSessionFor(card.id, "build", LANE_ROLE.build!);
    const message = card.build
      ? "The build's checkpoint wasn't committed: the hive stopped first. Retry commits it."
      : !developer?.lastMessage
        ? "Build hasn't started yet."
        : "Build was cut off when the hive stopped. Retry carries on.";
    this.addError(card.id, "build", message, ["retry"]);
    this.setState(card.id, "needs-you");
  }

  // ---------- turns ----------

  /** What a role's turns need beyond the basics (spec: Session runner). */
  private turnOptions(roleName: string): { extraInstructions?: string; outputFormat?: Record<string, unknown>; persist?: boolean } {
    switch (roleName) {
      case LANE_ROLE.spec:
        return { extraInstructions: this.formatFile("format.md") };
      case LANE_ROLE.plan:
        return { extraInstructions: this.formatFile("format.md"), outputFormat: PLAN_SCHEMA };
      case LANE_ROLE.build:
        return { outputFormat: DEVELOPER_SCHEMA };
      case REVIEWER:
        return { outputFormat: REVIEW_SCHEMA, persist: false };
      default:
        return {};
    }
  }

  private startTurn(
    cardId: string,
    sessionId: string,
    message: string,
    options: { extraInstructions?: string; outputFormat?: Record<string, unknown>; persist?: boolean } = {},
  ): void {
    const card = this.requireCard(cardId);
    const session = this.db.getSession(sessionId)!;
    const isReviewer = session.role === REVIEWER;
    this.db.updateSession(sessionId, { turnRunning: true, lastMessage: message });
    this.withdrawn.delete(sessionId);
    this.setState(cardId, "working");
    this.deps.hub.emit({ type: "turn.started", cardId });

    const turn: RunningTurn = this.deps.runner.start(
      {
        sessionId,
        resume: session.existsYet,
        cwd: card.worktreePath!,
        role: this.deps.role(session.role),
        message,
        ...(session.role === LANE_ROLE.refine
          ? { hiveTools: { writeBrief: (brief: Brief) => Promise.resolve(this.writeBrief(cardId, brief)) } }
          : {}),
        ...options,
      },
      {
        onTextDelta: (text) => {
          if (!isReviewer) this.deps.hub.emit({ type: "chat.delta", cardId, text });
        },
        onTextBlock: (text) => {
          if (!isReviewer) this.addChat(cardId, session.lane, AUTHOR[session.role] ?? "hive", text);
        },
        onActivity: (text) => this.deps.hub.emit({ type: "chat.activity", cardId, text }),
        onSessionCreated: () => this.db.updateSession(sessionId, { existsYet: true }),
        canUseTool: (toolName, input, signal) => this.canUseTool(cardId, session, toolName, input, signal),
      },
    );
    this.turns.set(sessionId, turn);
    if (session.lane === "spec") this.refreshSpec(cardId);

    void turn.done
      .catch((error: unknown): TurnOutcome => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then(async (outcome) => {
        if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
        const stopped = this.stopping.delete(sessionId);
        this.db.updateSession(sessionId, { turnRunning: false });
        this.dropOpenPending(cardId, sessionId);
        const withdrew = this.withdrawn.delete(sessionId);

        if (session.role === REVIEWER) this.onReviewEnded(cardId, outcome, stopped);
        else if (session.role === LANE_ROLE.plan) this.onPlannerEnded(cardId, outcome, stopped);
        else if (session.role === LANE_ROLE.build) await this.onDeveloperEnded(cardId, session, outcome, stopped);
        else if (session.role === LANE_ROLE.spec && this.requireCard(cardId).reviewApplying) {
          this.onWriterEnded(cardId, outcome, stopped, withdrew);
        } else if (outcome.kind === "error" && !stopped) {
          this.addError(cardId, session.lane, outcome.message, ["retry"]);
        }

        this.deps.hub.emit({ type: "chat.activity", cardId, text: null });
        // A handler above may have started the next turn (a review's findings go straight to the spec writer);
        // turn.ended then would tell the page nothing runs while the spec writer is applying them.
        if (!this.anyTurnRunning(cardId)) {
          this.setState(cardId, "needs-you");
          this.deps.hub.emit({ type: "turn.ended", cardId });
        }
        if (this.requireCard(cardId).specPath) this.refreshSpec(cardId);

        const next = this.followUps.get(sessionId);
        if (next) {
          this.followUps.delete(sessionId);
          try {
            this.startTurn(cardId, sessionId, next.join("\n\n"), this.turnOptions(session.role));
          } catch (error) {
            this.addError(cardId, session.lane, `Your last message couldn't be sent: ${(error as Error).message}`, []);
          }
        }
      })
      // Nothing thrown while handling a turn's end may become an unhandled rejection, which would stop the hive.
      .catch((error: unknown) => this.log(`Handling the end of a turn on card ${cardId} failed: ${String(error)}`));
  }

  /** A message for the session: it joins the running turn, or waits for it to end, or starts a new turn. */
  private deliver(cardId: string, sessionId: string, message: string): void {
    const running = this.turns.get(sessionId);
    const role = this.db.getSession(sessionId)!.role;
    if (!running) return this.startTurn(cardId, sessionId, message, this.turnOptions(role));
    if (running.push(message)) return;
    this.followUps.set(sessionId, [...(this.followUps.get(sessionId) ?? []), message]);
  }

  private async canUseTool(
    cardId: string, session: SessionRow, toolName: string, input: Record<string, unknown>, signal: AbortSignal,
  ): Promise<ToolDecision> {
    if (toolName.startsWith("mcp__hive__")) return { behavior: "allow", updatedInput: input };
    if (session.role === REVIEWER && toolName === "AskUserQuestion") {
      return { behavior: "deny", message: "A blind reviewer has nobody to ask. Put the question in a finding instead." };
    }

    const item: PendingItem =
      toolName === "AskUserQuestion"
        ? { id: randomUUID(), kind: "question", questions: toQuestions(input.questions) }
        : { id: randomUUID(), kind: "permission", toolName, detail: JSON.stringify(input).slice(0, 500) };
    this.db.insertPending({ item, cardId, sessionId: session.id });
    this.deps.hub.emit({ type: "pending.updated", cardId, pending: item });
    this.setState(cardId, "needs-you");

    let answer: AnswerBody;
    try {
      answer = await new Promise<AnswerBody>((resolve, reject) => {
        this.waiters.set(item.id, { resolve });
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    } catch {
      this.waiters.delete(item.id);
      this.withdrawn.add(session.id);
      return { behavior: "deny", message: "The question was withdrawn.", interrupt: true };
    }

    if (item.kind === "question" && "answers" in answer) {
      return { behavior: "allow", updatedInput: { ...input, answers: answer.answers } };
    }
    return "allow" in answer && answer.allow
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "The person declined this action." };
  }

  /** A turn that ended with a question still open (stopped, or failed) leaves nothing waiting on it. */
  private dropOpenPending(cardId: string, sessionId: string): void {
    const open = this.db.openPendingFor(cardId);
    if (open && open.sessionId === sessionId && this.waiters.has(open.id)) {
      this.waiters.delete(open.id);
      this.withdrawn.add(sessionId);
      this.db.setPendingAnswer(open.id, { withdrawn: true });
      this.deps.hub.emit({ type: "pending.updated", cardId, pending: null });
    }
  }

  private writeBrief(cardId: string, brief: Brief): string {
    const clean: Brief = {
      title: brief.title.trim(),
      problem: brief.problem.trim(),
      whoItsFor: brief.whoItsFor.trim(),
      whatDoneLooksLike: brief.whatDoneLooksLike,
      outOfScope: brief.outOfScope,
      openPoints: brief.openPoints,
    };
    if (!clean.title || !clean.problem) return "Not saved: title and problem are required.";
    this.db.updateCard(cardId, { brief: clean, title: clean.title });
    this.db.addEvent(cardId, "brief", clean, randomUUID());
    this.deps.hub.emit({ type: "brief.updated", cardId, brief: clean });
    this.emitCard(cardId);
    return "The brief is saved and shown next to the chat.";
  }

  // ---------- the spec on disk ----------

  private specFirstMessage(cardId: string, specPath: string): string {
    const card = this.requireCard(cardId);
    const project = this.db.getProject(card.projectId)!;
    const chat = this.db
      .chatFor(cardId, "refine")
      .filter((c): c is Extract<ChatItem, { kind: "message" }> => c.kind === "message" && c.from !== "hive")
      .map((c) => `${c.from === "you" ? "you" : "product owner"}: ${c.text}`)
      .join("\n\n");
    return [
      `The idea for this card, in the project ${project.name}:`,
      "",
      card.ideaText,
      "",
      "The brief the product owner wrote with the person:",
      "",
      briefText(card.brief),
      "",
      "The Refine chat:",
      "",
      chat || "(empty)",
      "",
      `Write the whole spec to ${specPath}, relative to your working folder, in one go, following the spec format in ` +
        "your instructions. Then sum up in a few sentences what it proposes.",
    ].join("\n");
  }

  private watchSpec(cardId: string): void {
    const card = this.requireCard(cardId);
    if (!card.worktreePath || !card.specPath) return;
    try {
      this.watch.watch(cardId, card.worktreePath, card.specPath, () => this.refreshSpec(cardId));
    } catch (error) {
      this.log(`Can't watch the spec of card ${cardId}: ${(error as Error).message}`);
    }
  }

  /** Read the spec from disk, work out its review state, and send spec.updated if either changed. */
  private refreshSpec(cardId: string): SpecInfo | null {
    const card = this.db.getCard(cardId);
    if (!card?.specPath || !card.worktreePath) return null;
    const { text, hash } = readSpec(card.worktreePath, card.specPath);
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    const spec: SpecInfo = {
      path: card.specPath,
      text,
      review: reviewState({
        hash,
        reviewedSpecHash: card.reviewedSpecHash,
        reviewApplying: card.reviewApplying,
        reviewerRunning: this.reviews.has(cardId),
        writerRunning: !!writer && this.turns.has(writer.id),
      }),
    };
    const key = `${hash}|${spec.review}`;
    if (this.lastSpec.get(cardId) !== key) {
      this.lastSpec.set(cardId, key);
      this.deps.hub.emit({ type: "spec.updated", cardId, spec });
    }
    return spec;
  }

  private formatFile(name: string): string {
    const path = join(this.deps.specFormatDir, name);
    try {
      return readFileSync(path, "utf8");
    } catch {
      throw new HttpError(409, `The spec format is missing: ${path}`);
    }
  }

  // ---------- helpers ----------

  private addChat(cardId: string, lane: Lane, from: ChatAuthor, text: string): void {
    const item: ChatItem = { kind: "message", id: randomUUID(), at: new Date().toISOString(), from, text };
    this.db.addEvent(cardId, "chat", { from, text, lane }, item.id, item.at);
    if (this.requireCard(cardId).lane === lane) this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private addNote(cardId: string, lane: Lane, text: string): void {
    this.addChat(cardId, lane, "hive", text);
  }

  private addError(cardId: string, lane: Lane, message: string, actions: ErrorAction[]): void {
    const item: ChatItem = { kind: "error", id: randomUUID(), at: new Date().toISOString(), message, actions };
    this.db.addEvent(cardId, "error", { message, actions, lane }, item.id, item.at);
    if (this.requireCard(cardId).lane === lane) this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private setState(cardId: string, state: CardRow["state"]): void {
    this.db.updateCard(cardId, { state });
    this.emitCard(cardId);
  }

  private emitCard(id: string): void {
    this.deps.hub.emit({ type: "card.updated", card: cardSummary(this.requireCard(id)) });
  }

  private requireCard(id: string): CardRow {
    const card = this.db.getCard(id);
    if (!card) throw new HttpError(404, "No such card.");
    return card;
  }

  /** A move in flight (Sign off committing the spec) must not race a turn that would change what it moves. */
  private refuseWhileMoving(cardId: string): void {
    if (this.moving.has(cardId)) throw new HttpError(409, "This card is moving. Try again in a moment.");
  }

  /** Every session the card has had: the lane roles' sessions and any reviewer. */
  private cardSessions(cardId: string): SessionRow[] {
    const ids = [...Object.entries(LANE_ROLE).map(([lane, role]) => this.db.getSessionFor(cardId, lane as Lane, role!))];
    const review = this.reviews.get(cardId);
    if (review) ids.push(this.db.getSession(review.sessionId));
    return ids.filter((s): s is SessionRow => !!s);
  }

  /** A turn is running on the card, or its developer is being started (bringing in main comes first). */
  private anyTurnRunning(cardId: string): boolean {
    return this.starting.has(cardId) || this.cardSessions(cardId).some((s) => this.turns.has(s.id));
  }

  /** The session of the card's current lane's role. */
  private requireLaneSession(cardId: string): SessionRow {
    const card = this.requireCard(cardId);
    const role = LANE_ROLE[card.lane];
    const session = role ? this.db.getSessionFor(cardId, card.lane, role) : undefined;
    if (!session) throw new HttpError(409, "This card has no conversation yet. Drag it to Refine first.");
    return session;
  }
}

export function cardSummary(c: CardRow): CardSummary {
  return { id: c.id, projectId: c.projectId, title: c.title, lane: c.lane, state: c.state, moveError: c.moveError };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** git's reason as a sentence, so the hive's next sentence doesn't run on from it. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

function toQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q: any) => ({
    question: String(q?.question ?? ""),
    header: String(q?.header ?? ""),
    options: Array.isArray(q?.options)
      ? q.options.map((o: any) => ({ label: String(o?.label ?? ""), description: String(o?.description ?? "") }))
      : [],
    multiSelect: !!q?.multiSelect,
  }));
}

function isAnswers(body: AnswerBody): body is { answers: Record<string, string> } {
  const answers = (body as { answers?: unknown }).answers;
  return typeof answers === "object" && answers !== null && !Array.isArray(answers)
    && Object.values(answers).every((v) => typeof v === "string");
}

function summarizeAnswers(answers: Record<string, string>): string {
  return Object.values(answers).join("\n");
}

/** An answer whose turn is gone, sent as a new turn with the question and options it asked (spec: Questions). */
export function answerAsMessage(questions: Question[], answers: Record<string, string>): string {
  const parts = questions.map((q) => {
    const options = q.options.map((o) => `- ${o.label}`).join("\n");
    return `${q.question}\n${options}\nMy answer: ${answers[q.question] ?? "(no answer)"}`;
  });
  return `Earlier you asked me this, but your turn ended before I answered:\n\n${parts.join("\n\n")}`;
}
