// The endpoints this slice builds (spec: API), a subset of docs/ARCHITECTURE.md's API.
import { homedir } from "node:os";
import { Router, type NextFunction, type Request, type Response } from "express";
import { APP_VERSION, type HealthResponse, type UpdateIdeaBody } from "@hive/shared";
import type { EventHub } from "../events";
import { HttpError, type Hive } from "../hive";
import { completeFolders } from "../projects/folders";

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

/** Runs a handler and turns HttpErrors into `{ error }` with their status. */
const route = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handler(req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
};

const param = (req: Request, name: string) => String(req.params[name]);

export function apiRouter(hive: Hive, hub: EventHub): Router {
  const r = Router();
  const body = (req: Request) => (req.body ?? {}) as Record<string, any>;

  r.get("/health", route((): HealthResponse => ({ status: "ok", version: APP_VERSION })));
  r.get("/events", hub.handler);
  r.get("/board", route(() => hive.board()));
  r.get("/roles", route(() => hive.roles()));

  // A card being deleted is gone to every request about it (docs/specs/2026-11-27-delete-a-card.md).
  r.use("/cards/:id", (req, res, next) => {
    if (hive.isDeleting(param(req, "id"))) res.status(404).json({ error: "No such card." });
    else next();
  });
  r.delete("/cards/:id", route((req) => hive.deleteCard(param(req, "id"))));

  // A missing folder answers { missing } so the page asks before creating it
  // (docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md).
  r.post("/projects", route(async (req) => {
    const answer = await hive.addProject(body(req).path, body(req).create === true);
    return answer ?? hive.board();
  }));
  r.get("/folders", route((req) => completeFolders(String(req.query.path ?? ""), homedir())));
  r.post("/projects/:id/check", route(async (req) => {
    await hive.checkTrust(param(req, "id"));
    return hive.board();
  }));

  r.post("/cards", route((req) => hive.createCard(body(req).projectId, body(req).title, body(req).text)));
  r.patch("/cards/:id", route((req) => hive.updateIdea(param(req, "id"), body(req) as UpdateIdeaBody)));
  r.get("/cards/:id", route((req) => hive.cardForPage(param(req, "id"))));
  r.post("/cards/:id/move", route((req) => hive.moveCard(param(req, "id"), body(req).lane)));
  r.post("/cards/:id/messages", route((req) => hive.sendMessage(param(req, "id"), body(req).text)));
  r.post("/cards/:id/stop", route((req) => hive.stop(param(req, "id"))));
  r.post("/cards/:id/retry", route((req) => hive.retry(param(req, "id"))));
  r.post("/cards/:id/good", route((req) => hive.good(param(req, "id"), body(req))));
  r.post("/cards/:id/keep-mockup", route((req) => hive.keepMockup(param(req, "id"))));
  // The card's mockup folder, served sandboxed (docs/specs/2026-11-28-mockup-lane-and-designer-role.md, Serving the
  // pages). Not through route(): it would answer with JSON before sendFile has finished.
  r.get("/cards/:id/mockup/*path", (req, res) => {
    const notFound = () => {
      if (!res.headersSent) res.status(404).json({ error: "No such file in the mockup." });
    };
    const segments = (req.params as Record<string, unknown>).path;
    let target: { root: string; file: string };
    try {
      target = hive.mockupFile(param(req, "id"), Array.isArray(segments) ? segments.join("/") : String(segments ?? ""));
    } catch {
      return notFound();
    }
    res.sendFile(target.file, {
      root: target.root,
      dotfiles: "deny",
      cacheControl: false,
      headers: {
        // The page's scripts run in an opaque origin and can't read the hive's API.
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals",
        // That origin makes the folder cross-origin to its own page: module scripts, fonts and fetch() need this.
        "Access-Control-Allow-Origin": "*",
        // A reload shows the designer's latest edit.
        "Cache-Control": "no-store",
      },
    }, (error) => {
      if (error) notFound();
    });
  });
  r.post("/cards/:id/review", route((req) => hive.review(param(req, "id"))));
  r.post("/cards/:id/signoff", route((req) => hive.signoff(param(req, "id"))));
  r.post("/cards/:id/back-to-spec", route((req) => hive.backToSpec(param(req, "id"))));
  r.post("/cards/:id/back-to-build", route((req) => hive.backToBuild(param(req, "id"))));
  r.post("/cards/:id/move-on", route((req) => hive.moveOn(param(req, "id"))));
  r.post("/cards/:id/feedback", route((req) => hive.feedback(param(req, "id"), req.body ?? {})));
  r.post("/cards/:id/accept", route((req) => hive.accept(param(req, "id"))));
  r.post("/cards/:id/back-to-tryit", route((req) => hive.backToTryIt(param(req, "id"))));
  r.get("/cards/:id/ship", route((req) => hive.shipPlan(param(req, "id"))));
  r.post("/cards/:id/land", route(async (req) => {
    await hive.land(param(req, "id"), req.body ?? {});
    return { ok: true };
  }));
  r.post("/cards/:id/app/start", route(async (req) => {
    await hive.appStart(param(req, "id"));
    return { ok: true };
  }));
  r.post("/cards/:id/app/stop", route(async (req) => {
    await hive.appStop(param(req, "id"));
    return { ok: true };
  }));
  r.post("/cards/:id/app/restart", route(async (req) => {
    await hive.appRestart(param(req, "id"));
    return { ok: true };
  }));
  r.post("/cards/:id/setup", route(async (req) => {
    hive.setupAgain(param(req, "id"));
    return { ok: true };
  }));
  r.get("/for-you", route(() => hive.forYou()));
  r.post("/for-you/:itemId", route((req) => hive.answer(param(req, "itemId"), body(req) as any)));

  r.use((_req, res) => res.status(404).json({ error: "No such endpoint." }));
  return r;
}
