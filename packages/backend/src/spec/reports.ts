// The fixed-format reports of the spec reviewer and the planner. Each is checked against its JSON schema by the SDK
// (outputFormat) and again here, and every report can say it's blocked (docs/ARCHITECTURE.md, Role reports).
import type { Plan } from "@hive/shared";

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

export type PlanReport = { status: "done"; plan: Plan } | { status: "blocked"; reason: string };

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
