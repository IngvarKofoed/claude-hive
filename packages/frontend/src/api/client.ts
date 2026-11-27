import type {
  AddProjectBody,
  AnswerBody,
  ApiError,
  BoardResponse,
  CardDetail,
  CardSummary,
  ForYouResponse,
  RolesResponse,
  FeedbackBody,
  ShipPlan,
  MessageBody,
  MoveBody,
  NewCardBody,
  UpdateIdeaBody,
  DeleteResult,
} from "@hive/shared";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const message = (data as ApiError | undefined)?.error;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  board: () => request<BoardResponse>("GET", "/board"),
  forYou: () => request<ForYouResponse>("GET", "/for-you"),
  roles: () => request<RolesResponse>("GET", "/roles"),
  // Both return the whole board, with the project as it now stands.
  addProject: (body: AddProjectBody) => request<BoardResponse>("POST", "/projects", body),
  checkProject: (id: string) => request<BoardResponse>("POST", `/projects/${encodeURIComponent(id)}/check`),
  newCard: (body: NewCardBody) => request<CardSummary | undefined>("POST", "/cards", body),
  updateIdea: (id: string, body: UpdateIdeaBody) =>
    request<CardSummary>("PATCH", `/cards/${encodeURIComponent(id)}`, body),
  card: (id: string) => request<CardDetail>("GET", `/cards/${encodeURIComponent(id)}`),
  moveCard: (id: string, body: MoveBody) =>
    request<CardSummary | undefined>("POST", `/cards/${encodeURIComponent(id)}/move`, body),
  sendMessage: (id: string, body: MessageBody) =>
    request<unknown>("POST", `/cards/${encodeURIComponent(id)}/messages`, body),
  stop: (id: string) => request<unknown>("POST", `/cards/${encodeURIComponent(id)}/stop`),
  retry: (id: string) => request<unknown>("POST", `/cards/${encodeURIComponent(id)}/retry`),
  // Refine → Spec, Spec → Plan (refused unless the review is fresh), a blocked plan → Spec.
  good: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/good`),
  review: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/review`),
  signoff: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/signoff`),
  backToSpec: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/back-to-spec`),
  backToBuild: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/back-to-build`),
  moveOn: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/move-on`),
  // Try it: send your words to Build, accept into Ship, bring a Ship card back, and run the worktree setup.
  feedback: (id: string, text: string) =>
    request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/feedback`, { text } satisfies FeedbackBody),
  accept: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/accept`),
  deleteCard: (id: string) => request<DeleteResult>("DELETE", `/cards/${encodeURIComponent(id)}`),
  backToTryIt: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/back-to-tryit`),
  shipPlan: (id: string) => request<ShipPlan>("GET", `/cards/${encodeURIComponent(id)}/ship`),
  land: (id: string, discard?: boolean) =>
    request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/land`, discard ? { discard: true } : undefined),
  setup: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/setup`),
  appStart: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/app/start`),
  appStop: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/app/stop`),
  appRestart: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/app/restart`),
  answer: (itemId: string, body: AnswerBody) =>
    request<unknown>("POST", `/for-you/${encodeURIComponent(itemId)}`, body),
};
