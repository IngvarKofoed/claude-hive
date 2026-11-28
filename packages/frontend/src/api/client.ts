import type {
  AddProjectBody,
  AddProjectResponse,
  FolderCompletions,
  AnswerBody,
  ChatAnswerBody,
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
  GoodBody,
  MockupInfo,
  ProjectChatDetail,
  ProjectChatList,
  ProjectChatSummary,
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

/** The URL the hive serves a mockup file at. `path` is relative to the mockup's folder, as the entries of `files` are. */
export function mockupHref(cardId: string, path: string): string {
  return `/api/cards/${encodeURIComponent(cardId)}/mockup/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The same for a `MockupRef` page, which is relative to the worktree: the folder prefix is cut off first. */
export function mockupPageHref(cardId: string, mockup: Pick<MockupInfo, "folder">, page: string): string {
  const prefix = `${mockup.folder}/`;
  return mockupHref(cardId, page.startsWith(prefix) ? page.slice(prefix.length) : page);
}

export const api = {
  board: () => request<BoardResponse>("GET", "/board"),
  forYou: () => request<ForYouResponse>("GET", "/for-you"),
  roles: () => request<RolesResponse>("GET", "/roles"),
  // Both return the whole board, with the project as it now stands.
  addProject: (body: AddProjectBody) => request<AddProjectResponse>("POST", "/projects", body),
  folders: (path: string) => request<FolderCompletions>("GET", `/folders?path=${encodeURIComponent(path)}`),
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
  // Refine: { skipMockup }; Mockup: { keep }.
  good: (id: string, body: GoodBody) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/good`, body),
  // Spec: commit the mockup folder after all.
  keepMockup: (id: string) => request<unknown>("POST", `/cards/${encodeURIComponent(id)}/keep-mockup`),
  review: (id: string) => request<{ ok: true }>("POST", `/cards/${encodeURIComponent(id)}/review`),
  signoff: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/signoff`),
  backToSpec: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/back-to-spec`),
  backToBuild: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/back-to-build`),
  moveOn: (id: string) => request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/move-on`),
  // Try it: send your words to Build, accept into Ship, bring a Ship card back, and run the worktree setup.
  feedback: (id: string, text: string) =>
    request<CardSummary>("POST", `/cards/${encodeURIComponent(id)}/feedback`, { text } satisfies FeedbackBody),
  // Try it: take your words back after a failed pick, so Accept and the box are yours again.
  editSendBack: (id: string) => request<CardSummary>("DELETE", `/cards/${encodeURIComponent(id)}/send-back`),
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
  // Project chats (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md).
  projectChats: (projectId: string) =>
    request<ProjectChatList>("GET", `/projects/${encodeURIComponent(projectId)}/chats`),
  newProjectChat: (projectId: string, body: MessageBody) =>
    request<ProjectChatSummary>("POST", `/projects/${encodeURIComponent(projectId)}/chats`, body),
  projectChat: (id: string) => request<ProjectChatDetail>("GET", `/chats/${encodeURIComponent(id)}`),
  sendChatMessage: (id: string, body: MessageBody) =>
    request<unknown>("POST", `/chats/${encodeURIComponent(id)}/messages`, body),
  answerChat: (id: string, body: ChatAnswerBody) =>
    request<unknown>("POST", `/chats/${encodeURIComponent(id)}/answer`, body),
  stopChat: (id: string) => request<unknown>("POST", `/chats/${encodeURIComponent(id)}/stop`),
  // Make it an idea: start the draft turn, or close the draft form.
  draftIdea: (id: string) => request<unknown>("POST", `/chats/${encodeURIComponent(id)}/draft`),
  closeDraft: (id: string) => request<unknown>("DELETE", `/chats/${encodeURIComponent(id)}/draft`),
  deleteChat: (id: string) => request<unknown>("DELETE", `/chats/${encodeURIComponent(id)}`),
};
