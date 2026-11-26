import type { Question } from "@hive/shared";

/** What the person picked per question (by question text) and typed per question. */
export interface QuestionInput {
  picks: Record<string, string[]>;
  free: Record<string, string>;
}

/** Your own words win; otherwise the picked label(s), joined with ", ". Unanswered questions are left out. */
export function buildAnswers(questions: Question[], input: QuestionInput): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const free = (input.free[q.question] ?? "").trim();
    const picks = input.picks[q.question] ?? [];
    if (free) answers[q.question] = free;
    else if (picks.length > 0) answers[q.question] = picks.join(", ");
  }
  return answers;
}

export function isComplete(questions: Question[], answers: Record<string, string>): boolean {
  return questions.every((q) => q.question in answers);
}

/** Toggle a label: single select replaces (or clears on a second click), multi select adds or removes. */
export function togglePick(current: string[], label: string, multiSelect: boolean): string[] {
  if (current.includes(label)) return current.filter((l) => l !== label);
  return multiSelect ? [...current, label] : [label];
}
