// The endpoints this slice builds (spec: API), a subset of docs/ARCHITECTURE.md's API.
import { Router, type NextFunction, type Request, type Response } from "express";
import { APP_VERSION, type HealthResponse } from "@hive/shared";
import type { EventHub } from "../events";
import { HttpError, type Hive } from "../hive";

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

  r.post("/projects", route(async (req) => {
    await hive.addProject(body(req).path);
    return hive.board();
  }));
  r.post("/projects/:id/check", route(async (req) => {
    await hive.checkTrust(param(req, "id"));
    return hive.board();
  }));

  r.post("/cards", route((req) => hive.createCard(body(req).projectId, body(req).text)));
  r.get("/cards/:id", route((req) => hive.card(param(req, "id"))));
  r.post("/cards/:id/move", route((req) => hive.moveCard(param(req, "id"), body(req).lane)));
  r.post("/cards/:id/messages", route((req) => hive.sendMessage(param(req, "id"), body(req).text)));
  r.post("/cards/:id/stop", route((req) => hive.stop(param(req, "id"))));
  r.post("/cards/:id/retry", route((req) => hive.retry(param(req, "id"))));
  r.post("/cards/:id/good", route((req) => hive.good(param(req, "id"))));
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
  r.post("/for-you/:itemId", route((req) => hive.answer(param(req, "itemId"), body(req) as any)));

  r.use((_req, res) => res.status(404).json({ error: "No such endpoint." }));
  return r;
}
