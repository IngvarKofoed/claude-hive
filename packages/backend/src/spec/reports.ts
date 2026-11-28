// The fixed-format reports of the spec reviewer, the planner, the developer and Check's reviewer. Each is checked against its JSON schema by the SDK
// (outputFormat) and again here, and every report can say it's blocked (docs/ARCHITECTURE.md, Role reports).
import type { Bug, Departure, IssueJudgment, Plan, ReportedDecision, ReportedIssue, SendBackPoint } from "@hive/shared";

const blockable = {
  status: { type: "string", enum: ["done", "blocked"] },
  blockedReason: { type: ["string", "null"], description: "Why you couldn't do it; null when status is done" },
};

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "summary", "findings"],
  properties: {
    ...blockable,
    summary: { type: "string", description: "One or two sentences on what you found, or that nothing cleared the bar" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "category", "where", "stakes", "options"],
        properties: {
          kind: { type: "string", enum: ["decision", "fix"] },
          category: { type: "string" },
          where: { type: "string", description: "The section or line of the spec" },
          stakes: { type: "string", description: "What goes wrong if it stays as written" },
          options: { type: "array", items: { type: "string" }, description: "The resolutions; one for a fix" },
        },
      },
    },
  },
} as const;

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "steps", "chunks", "tests"],
  properties: {
    ...blockable,
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "chunk", "check"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          chunk: { type: "string", description: "The name of the chunk that does this step" },
          check: { type: "string", description: "How this step is checked" },
        },
      },
    },
    chunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "owns", "model"],
        properties: {
          name: { type: "string" },
          owns: { type: "array", items: { type: "string" }, description: "The files or globs this chunk owns" },
          model: { type: "string" },
        },
      },
    },
    tests: { type: "array", items: { type: "string" } },
  },
} as const;

const objects = (required: string[], descriptions: Record<string, string>) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required,
    properties: Object.fromEntries(required.map((k) => [k, { type: "string", description: descriptions[k] }])),
  },
});

/** The developer's report (docs/specs/2026-11-26-build-lane-developer.md, Key decisions: one turn, one report). */
export const DEVELOPER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "summary", "departures", "issues", "decisions"],
  properties: {
    ...blockable,
    summary: { type: "string", description: "What was built, in a few sentences" },
    departures: objects(["step", "what", "why"], {
      step: "The plan step you departed from",
      what: "What you did instead",
      why: "Why",
    }),
    issues: objects(["where", "problem", "guess"], {
      where: "The spec's section",
      problem: "Only what would make the spec keeper change the spec or the code: the spec blocked you, forced a " +
        "departure, left readings that build different things, contradicts itself or the code, or has a check that " +
        "can't be carried out. Not wording, a gap filled the obvious way, or a failure that isn't about the spec",
      guess: "What you built instead",
    }),
    decisions: objects(["what", "alternative"], {
      what: "What you decided where the spec left room",
      alternative: "The alternative you didn't take",
    }),
  },
} as const;

/** Check's reviewer's report (docs/specs/2026-11-27-check-lane-reviewer.md, Key decisions: the reviewer's report). */
export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "summary", "bugs", "issues"],
  properties: {
    ...blockable,
    summary: { type: "string", description: "What you checked and what you found, in a few sentences" },
    bugs: objects(["where", "problem"], {
      where: "Where in the code, as file:line",
      problem: "What's wrong: the code doesn't do what the spec clearly says, or it's broken",
    }),
    issues: objects(["where", "problem", "guess"], {
      where: "The spec's section",
      problem: "Only what would make the spec keeper change the spec or the code: the spec is silent where it " +
        "matters, contradicts itself or the code, the code does more than it asks, or a check can't be carried out. " +
        "Not wording, a gap filled the obvious way, or a failure that isn't about the spec",
      guess: "What the code does",
    }),
  },
} as const;

/** The spec keeper's report: one judgment per issue it was given (docs/specs/2026-11-28-spec-keeper.md, The batch). */
export const KEEPER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "summary", "judgments"],
  properties: {
    ...blockable,
    summary: { type: "string", description: "What you judged and what you changed in the spec, in a few sentences" },
    judgments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issueId", "verdict", "level", "reason", "recommendation", "repeats"],
        properties: {
          issueId: { type: "string", description: "The id of the issue judged, as your message gives it" },
          verdict: {
            type: "string", enum: ["spec-wrong", "code-wrong", "no-change"],
            description: "spec-wrong: the spec changes; code-wrong: the code changes; no-change: neither",
          },
          level: {
            type: "string", enum: ["minor", "changes-signoff", "severe"],
            description: "minor: you settle it; changes-signoff: it changes what the person signed off; severe: the card stops",
          },
          reason: { type: "string", description: "Why, in a sentence or two" },
          recommendation: {
            type: "string",
            description: "For changes-signoff and severe: what you would do. Empty for minor",
          },
          repeats: {
            type: ["string", "null"],
            description: "The id of an earlier issue on this card that this is the same problem as, or null",
          },
        },
      },
    },
  },
} as const;

/**
 * The spec keeper's reading of your Send back: each point of your feedback, a bug or a change to the spec. Code picks
 * the lane from the points (docs/specs/2026-11-28-try-it-send-back.md, Send back and the pick).
 */
export const SEND_BACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "reason", "points"],
  properties: {
    ...blockable,
    reason: { type: "string", description: "Why the feedback goes where its points send it, in a sentence or two" },
    points: {
      type: "array",
      description: "Each point the person made, in their order. At least one",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "kind", "why"],
        properties: {
          what: { type: "string", description: "The point, in a short line of the person's own words" },
          kind: {
            type: "string", enum: ["bug", "spec"],
            description: "bug: the code changes and the spec stays; spec: the point changes what the spec says",
          },
          why: { type: "string", description: "Why it's that kind, in a sentence" },
        },
      },
    },
  },
} as const;

/**
 * The spec writer's report at the end of an amendment's turn: what it changed, and whether the change needs the blind
 * review (docs/specs/2026-11-28-try-it-send-back.md, Into Spec: the amendment).
 */
export const AMENDMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "summary", "review", "reason"],
  properties: {
    ...blockable,
    summary: { type: "string", description: "What you changed in the spec for this amendment, in a sentence or two" },
    review: { type: "boolean", description: "true when the change needs the blind review before it's signed off" },
    reason: { type: "string", description: "Why it does or doesn't need the review, in a sentence" },
  },
} as const;

/** The setup session's report (docs/specs/2026-11-27-worktree-setup-and-try-it.md, Key decisions: the setup's report). */
export const SETUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "installed", "start", "test", "shared", "notes"],
  properties: {
    ...blockable,
    installed: { type: "string", description: "What you ran to install dependencies, or that none were needed" },
    start: {
      type: "array",
      description: "The app's long-running servers, one entry per process: the hive runs each with `sh -c` in its " +
        "folder and keeps it running for Try it",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "command", "dir", "port", "url"],
        properties: {
          what: { type: "string", description: "What it starts, e.g. backend" },
          command: { type: "string", description: "The command, with its port settings, run with sh -c in dir" },
          dir: { type: "string", description: "The folder to run it in, relative to the worktree; . for the root" },
          port: { type: "integer", description: "The one port of the card's block this process listens on" },
          url: { type: ["string", "null"], description: "The address to open, or null" },
        },
      },
    },
    test: {
      type: "string",
      description: "The command that runs the tests in the worktree, and nothing else; empty if there are none. " +
        "Explanations go in notes.",
    },
    shared: {
      type: "array", items: { type: "string" },
      description: "What the worktree still shares with the checkout: a server database, a port you couldn't move, a container",
    },
    notes: { type: "string", description: "Anything else the person or the developer should know" },
  },
} as const;

/** The committer's report: the commit message for a card landing on main (docs/specs/2026-11-27-ship-lane.md). */
export const COMMIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "blockedReason", "subject", "body"],
  properties: {
    ...blockable,
    subject: { type: "string", description: "The commit's first line, in the repo's style" },
    body: { type: "string", description: "The rest of the message in the repo's style; empty if the style has none" },
  },
} as const;

/** The committer's subject and body, or null when there's no usable report. */
export function parseCommitReport(raw: unknown): { subject: string; body: string } | null {
  if (!isObject(raw) || raw.status !== "done" || typeof raw.subject !== "string" || !raw.subject.trim()) return null;
  return { subject: raw.subject.trim(), body: typeof raw.body === "string" ? raw.body.trim() : "" };
}

export interface Finding {
  kind: "decision" | "fix";
  category: string;
  where: string;
  stakes: string;
  options: string[];
}

export type ReviewReport =
  | { status: "done"; summary: string; findings: Finding[] }
  | { status: "blocked"; reason: string };

export type CheckReport =
  | { status: "done"; summary: string; bugs: Bug[]; issues: ReportedIssue[] }
  | { status: "blocked"; reason: string };

export type SetupResult =
  | {
      status: "done";
      installed: string;
      start: { what: string; command: string; dir?: string; port?: number; url: string | null }[];
      test: string;
      shared: string[];
      notes: string;
    }
  | { status: "blocked"; reason: string };

export type PlanReport = { status: "done"; plan: Plan } | { status: "blocked"; reason: string };

// What a role reported, before the hive gave it an id. Shared, since the card's history shows them as reported.
export type { ReportedDecision, ReportedIssue } from "@hive/shared";

export type DeveloperReport =
  | {
      status: "done";
      summary: string;
      departures: Departure[];
      issues: ReportedIssue[];
      decisions: ReportedDecision[];
    }
  | { status: "blocked"; reason: string };

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const blocked = (r: Record<string, any>) => ({
  status: "blocked" as const,
  reason: typeof r.blockedReason === "string" && r.blockedReason.trim() ? r.blockedReason : "No reason given.",
});

/** The reviewer's report, or null when there is none or it doesn't have the expected shape. */
export function parseReviewReport(raw: unknown): ReviewReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || !Array.isArray(raw.findings)) return null;
  const findings = raw.findings.filter(
    (f): f is Finding =>
      isObject(f) && (f.kind === "decision" || f.kind === "fix") && typeof f.where === "string" &&
      typeof f.stakes === "string" && typeof f.category === "string" && strings(f.options),
  );
  if (findings.length !== raw.findings.length) return null;
  return { status: "done", summary: typeof raw.summary === "string" ? raw.summary : "", findings };
}

/** The planner's report, or null when there is none or it doesn't have the expected shape. */
export function parsePlanReport(raw: unknown): PlanReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || !Array.isArray(raw.steps) || !Array.isArray(raw.chunks) || !strings(raw.tests)) {
    return null;
  }
  const stepsOk = raw.steps.every(
    (s: unknown) => isObject(s) && ["title", "detail", "chunk", "check"].every((k) => typeof s[k] === "string"),
  );
  const chunksOk = raw.chunks.every(
    (c: unknown) => isObject(c) && typeof c.name === "string" && strings(c.owns) && typeof c.model === "string",
  );
  if (!stepsOk || !chunksOk || raw.steps.length === 0) return null;
  return {
    status: "done",
    plan: {
      steps: raw.steps.map((s: any) => ({ title: s.title, detail: s.detail, chunk: s.chunk, check: s.check })),
      chunks: raw.chunks.map((c: any) => ({ name: c.name, owns: c.owns, model: c.model })),
      tests: raw.tests,
    },
  };
}

/** Every item is an object whose listed keys are all strings. */
function allStrings<K extends string>(items: unknown, keys: K[]): items is Record<K, string>[] {
  return Array.isArray(items) && items.every((i) => isObject(i) && keys.every((k) => typeof i[k] === "string"));
}

/** The developer's report, or null when there is none or it doesn't have the expected shape. */
export function parseDeveloperReport(raw: unknown): DeveloperReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || typeof raw.summary !== "string") return null;
  if (
    !allStrings(raw.departures, ["step", "what", "why"]) ||
    !allStrings(raw.issues, ["where", "problem", "guess"]) ||
    !allStrings(raw.decisions, ["what", "alternative"])
  ) {
    return null;
  }
  return {
    status: "done",
    summary: raw.summary,
    departures: raw.departures.map(({ step, what, why }) => ({ step, what, why })),
    issues: raw.issues.map(({ where, problem, guess }) => ({ where, problem, guess })),
    decisions: raw.decisions.map(({ what, alternative }) => ({ what, alternative })),
  };
}

/** Check's reviewer's report, or null when there is none or it doesn't have the expected shape. */
export function parseCheckReport(raw: unknown): CheckReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || typeof raw.summary !== "string") return null;
  if (!allStrings(raw.bugs, ["where", "problem"]) || !allStrings(raw.issues, ["where", "problem", "guess"])) return null;
  return {
    status: "done",
    summary: raw.summary,
    bugs: raw.bugs.map(({ where, problem }) => ({ where, problem })),
    issues: raw.issues.map(({ where, problem, guess }) => ({ where, problem, guess })),
  };
}

export type KeeperReport =
  | { status: "done"; summary: string; judgments: ({ issueId: string } & IssueJudgment)[] }
  | { status: "blocked"; reason: string };

const VERDICTS = ["spec-wrong", "code-wrong", "no-change"];
const LEVELS = ["minor", "changes-signoff", "severe"];

/**
 * The spec keeper's report, or null when there is none, it doesn't have the expected shape, or it doesn't judge each of
 * `issueIds` exactly once (a report that misses an issue doesn't count).
 */
export function parseKeeperReport(raw: unknown, issueIds: string[]): KeeperReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || !Array.isArray(raw.judgments)) return null;
  const ok = raw.judgments.every(
    (j: unknown) => isObject(j) && typeof j.issueId === "string" && VERDICTS.includes(j.verdict) &&
      LEVELS.includes(j.level) && typeof j.reason === "string" &&
      (j.recommendation === undefined || typeof j.recommendation === "string") &&
      (j.repeats === null || j.repeats === undefined || typeof j.repeats === "string"),
  );
  if (!ok) return null;
  const judged = raw.judgments.map((j: any) => j.issueId as string);
  if (judged.length !== issueIds.length || !issueIds.every((id) => judged.includes(id))) return null;
  return {
    status: "done",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    judgments: raw.judgments.map((j: any) => ({
      issueId: j.issueId, verdict: j.verdict, level: j.level, reason: j.reason,
      recommendation: j.recommendation ?? "", repeats: j.repeats ? j.repeats : null,
    })),
  };
}

export type SendBackReport =
  | { status: "done"; reason: string; points: SendBackPoint[] }
  | { status: "blocked"; reason: string };

/** The keeper's reading of your Send back, or null when there is none, or it has no points or a malformed one. */
export function parseSendBackReport(raw: unknown): SendBackReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const ok = raw.points.every((p: unknown) =>
    isObject(p) && typeof p.what === "string" && (p.kind === "bug" || p.kind === "spec") && typeof p.why === "string");
  if (!ok) return null;
  return {
    status: "done",
    reason: typeof raw.reason === "string" ? raw.reason : "",
    points: raw.points.map((p: any) => ({ what: p.what, kind: p.kind, why: p.why })),
  };
}

export type AmendmentReport =
  | { status: "done"; summary: string; review: boolean; reason: string }
  | { status: "blocked"; reason: string };

/** The spec writer's amendment report, or null when there is none or it doesn't have the expected shape. */
export function parseAmendmentReport(raw: unknown): AmendmentReport | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done" || typeof raw.review !== "boolean") return null;
  return {
    status: "done",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    review: raw.review,
    reason: typeof raw.reason === "string" ? raw.reason : "",
  };
}

/** The setup session's report, or null when there is none or it doesn't have the expected shape. */
export function parseSetupReport(raw: unknown): SetupResult | null {
  if (!isObject(raw)) return null;
  if (raw.status === "blocked") return blocked(raw);
  if (raw.status !== "done") return null;
  if (typeof raw.installed !== "string" || typeof raw.test !== "string" || typeof raw.notes !== "string") return null;
  if (!strings(raw.shared) || !Array.isArray(raw.start)) return null;
  const startOk = raw.start.every(
    (s: unknown) => isObject(s) && typeof s.what === "string" && typeof s.command === "string" &&
      (s.url === null || typeof s.url === "string") && (s.dir === undefined || typeof s.dir === "string") &&
      (s.port === undefined || Number.isInteger(s.port)),
  );
  if (!startOk) return null;
  return {
    status: "done",
    installed: raw.installed,
    start: raw.start.map((s: any) => ({
      what: s.what, command: s.command, url: s.url,
      ...(s.dir !== undefined ? { dir: s.dir } : {}), ...(s.port !== undefined ? { port: s.port } : {}),
    })),
    test: raw.test,
    shared: raw.shared,
    notes: raw.notes,
  };
}

/** The findings, as the one message the spec writer gets after a review. */
export function findingsMessage(findings: Finding[]): string {
  const lines = findings.map((f, i) => {
    const options = f.options.map((o) => `   - ${o}`).join("\n");
    return `${i + 1}. [${f.kind}] ${f.category}, at ${f.where}\n   ${f.stakes}\n${options}`;
  });
  return [
    "A blind review of the spec found the following.",
    "- Apply every finding marked fix.",
    "- Put every finding marked decision to the person with AskUserQuestion, offering the options listed. A decision " +
      "the person already settled in this chat is noted in one line, not asked again.",
    "- Write the answers into the spec, and give a suggestion the person rejects one line in Alternatives considered.",
    "- Change nothing the review didn't raise. End with a short summary of what changed.",
    "",
    ...lines,
  ].join("\n");
}
