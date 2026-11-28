// The project chats' endpoints (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md, API and events).
import type { Router } from "express";
import type { ProjectChats } from "../chats";
import { body, param, route } from "./route";

export function chatRoutes(r: Router, chats: ProjectChats): void {
  // A chat being deleted is gone to every request about it, as a card being deleted is.
  r.use("/chats/:id", (req, res, next) => {
    if (chats.isDeleting(param(req, "id"))) res.status(404).json({ error: "No such chat." });
    else next();
  });

  r.get("/projects/:id/chats", route((req) => chats.list(param(req, "id"))));
  r.post("/projects/:id/chats", route((req) => chats.create(param(req, "id"), body(req).text)));
  r.get("/chats/:id", route((req) => chats.detail(param(req, "id"))));
  r.post("/chats/:id/messages", route((req) => chats.send(param(req, "id"), body(req).text)));
  r.post("/chats/:id/answer", route((req) => chats.answer(param(req, "id"), body(req).itemId, body(req).answers)));
  r.post("/chats/:id/stop", route((req) => chats.stop(param(req, "id"))));
  r.post("/chats/:id/draft", route((req) => chats.draft(param(req, "id"))));
  r.delete("/chats/:id/draft", route((req) => chats.closeDraft(param(req, "id"))));
  r.delete("/chats/:id", route((req) => chats.delete(param(req, "id"))));
}
