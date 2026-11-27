// The fixed-format reports of the spec reviewer, the planner, the developer and Check's reviewer. Each is checked against its JSON schema by the SDK
// (outputFormat) and again here, and every report can say it's blocked (docs/ARCHITECTURE.md, Role reports).
import type { Bug, Departure, Plan } from "@hive/shared";

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
      problem: "The spec is silent, unclear or contradicts itself, doesn't fit the code, or something is missing, different or extra",
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
      problem: "The spec is silent, unclear or contradicts itself, doesn't fit the code, or the code does more than it asks",
      guess: "What the code does",
    }),
  },
} as const;

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

export type PlanReport = { status: "done"; plan: Plan } | { status: "blocked"; reason: string };

export interface ReportedIssue {
  where: string;
  problem: string;
  guess: string;
}

export interface ReportedDecision {
  what: string;
  alternative: string;
}

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
