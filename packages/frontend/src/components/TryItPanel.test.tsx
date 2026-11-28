import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppProcess, CardDetail, IssueStatus, PendingItem, SetupReport, SpecIssue } from "@hive/shared";
import { api } from "../api/client";
import { TryItPanel } from "./TryItPanel";

const doneSetup: SetupReport = {
  status: "done",
  reason: null,
  copied: [".env"],
  leftOut: [],
  installed: "npm ci",
  start: [{ what: "the app", command: "PORT=5300 npm run dev", url: "http://localhost:5300" }],
  test: "npm test",
  shared: ["the dev database"],
  notes: "",
};

function detail(over: Partial<CardDetail> = {}): CardDetail {
  return {
    id: "c1",
    projectId: "p1",
    projectName: "m",
    title: "T",
    ideaTitle: "i",
    ideaText: "i",
    lane: "tryit",
    state: "needs-you",
    moveError: null,
    branch: "hive/c1",
    worktreePath: "/r/.claude/worktrees/c1",
    brief: null,
    mockup: null,
    spec: { path: "docs/specs/x.md", text: "# T\n\n## Outcome\n\n- You get a button\n\n## Design\n\nsecret", review: "fresh" },
    specPath: "docs/specs/x.md",
    plan: null,
    build: null,
    check: null,
    setup: null,
    port: null,
    feedback: null,
    shipAfterCheck: false,
    checklist: null,
    apps: [],
    appStopped: false,
    issues: [],
    decisions: [],
    chat: [],
    pastChats: {},
    history: { plans: [], builds: [], checks: [], tryit: [] },
    pending: null,
    turnRunning: false,
    landed: null,
    landing: false,
    sendBack: null,
    amendment: null,
    fromChat: null,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("TryItPanel earlier feedback", () => {
  it("folds your earlier feedback shut, newest on top, as written", () => {
    const history = {
      plans: [],
      builds: [],
      checks: [],
      tryit: [
        { kind: "feedback" as const, text: "second\nline" },
        { kind: "feedback" as const, text: "first" },
      ],
    };
    render(<TryItPanel detail={detail({ history })} onMoved={() => {}} />);
    const summary = screen.getByText("Your earlier feedback");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.getAllByText(/^Feedback \d$/).map((h) => h.textContent)).toEqual(["Feedback 2", "Feedback 1"]);
    expect(screen.getByText(/second/).textContent).toBe("second\nline");
  });

  it("has no fold without feedback entries", () => {
    const history = { plans: [], builds: [], checks: [], tryit: [{ kind: "accepted" as const }] };
    render(<TryItPanel detail={detail({ history })} onMoved={() => {}} />);
    expect(screen.queryByText("Your earlier feedback")).toBeNull();
  });
});

describe("TryItPanel setup", () => {
  it("offers Prepare it when there is no setup, and calls the API", async () => {
    const setup = vi.spyOn(api, "setup").mockResolvedValue({ ok: true });
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    expect(screen.getByText("/r/.claude/worktrees/c1")).toBeInTheDocument();
    expect(screen.getByText("This worktree has no local files from your checkout yet, and no command to start it on the card's ports.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prepare it" }));
    expect(setup).toHaveBeenCalledWith("c1");
  });

  it("shows the failure reason with the button", () => {
    render(
      <TryItPanel
        detail={detail({ setup: { ...doneSetup, status: "failed", reason: "npm ci failed" } })}
        onMoved={() => {}}
      />,
    );
    expect(screen.getByText("npm ci failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare it" })).toBeInTheDocument();
  });

  it("shows Preparing… without a button while it runs", () => {
    render(<TryItPanel detail={detail({ setup: { ...doneSetup, status: "running" } })} onMoved={() => {}} />);
    expect(screen.getByText("Preparing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prepare/ })).toBeNull();
  });

  it("shows the commands, address, tests and shared warning when done, with Prepare it again", async () => {
    const setup = vi.spyOn(api, "setup").mockResolvedValue({ ok: true });
    render(<TryItPanel detail={detail({ setup: doneSetup })} onMoved={() => {}} />);
    expect(screen.getByText("PORT=5300 npm run dev")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://localhost:5300" })).toHaveAttribute("href", "http://localhost:5300");
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText(/Shared with your checkout/)).toBeInTheDocument();
    expect(screen.getByText("the dev database")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare it" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Prepare it again" }));
    expect(setup).toHaveBeenCalledWith("c1");
  });
});

const proc = (over: Partial<AppProcess> = {}): AppProcess => ({
  what: "the app",
  port: 5300,
  url: "http://localhost:5300",
  state: "running",
  reason: null,
  output: [],
  ...over,
});

describe("TryItPanel the app", () => {
  it("shows Starting… with Stop, and no link", () => {
    render(<TryItPanel detail={detail({ setup: doneSetup, apps: [proc({ state: "starting" })] })} onMoved={() => {}} />);
    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("http://localhost:5300")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("shows Running with an active link, Stop and Restart", () => {
    render(<TryItPanel detail={detail({ setup: doneSetup, apps: [proc()] })} onMoved={() => {}} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://localhost:5300" })).toHaveAttribute("href", "http://localhost:5300");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByText("PORT=5300 npm run dev")).toBeNull();
  });

  it("shows Stopped with the reason, the output, Start and Restart but no link", () => {
    render(
      <TryItPanel
        detail={detail({
          setup: doneSetup,
          apps: [proc({ state: "stopped", reason: "Exited with code 1", output: ["boom", "bang"] })],
        })}
        onMoved={() => {}}
      />,
    );
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Exited with code 1")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toHaveTextContent("boom bang");
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
  });

  it("offers Start when setup is done and nothing is listed, and calls the API", async () => {
    const start = vi.spyOn(api, "appStart").mockResolvedValue({ ok: true });
    render(<TryItPanel detail={detail({ setup: doneSetup })} onMoved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(start).toHaveBeenCalledWith("c1");
  });

  it("Stop and Restart call the API", async () => {
    const stop = vi.spyOn(api, "appStop").mockResolvedValue({ ok: true });
    const restart = vi.spyOn(api, "appRestart").mockResolvedValue({ ok: true });
    render(<TryItPanel detail={detail({ setup: doneSetup, apps: [proc()] })} onMoved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("c1");
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(restart).toHaveBeenCalledWith("c1");
  });

  it("shows an API error in the error line", async () => {
    vi.spyOn(api, "appStart").mockRejectedValue(new Error("No port free"));
    render(<TryItPanel detail={detail({ setup: doneSetup })} onMoved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No port free");
  });

  it("has no app buttons before the setup is done", () => {
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    for (const n of ["Start", "Stop", "Restart"]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
});

describe("TryItPanel guide", () => {
  it("renders only the Outcome section", () => {
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    expect(screen.getByText("You get a button")).toBeInTheDocument();
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("says so when the spec has no Outcome section", () => {
    render(<TryItPanel detail={detail({ spec: null })} onMoved={() => {}} />);
    expect(screen.getByText("The spec has no Outcome section.")).toBeInTheDocument();
  });
});

describe("TryItPanel your call", () => {
  it("disables Send back while empty, sends the text, then clears it", async () => {
    const feedback = vi.spyOn(api, "feedback").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(<TryItPanel detail={detail()} onMoved={onMoved} />);
    const send = screen.getByRole("button", { name: "Send back" });
    expect(send).toBeDisabled();
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "It crashes");
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(feedback).toHaveBeenCalledWith("c1", "It crashes");
    await waitFor(() => expect(box).toHaveValue(""));
    expect(onMoved).toHaveBeenCalled();
  });

  it("shows an error under the box and keeps the text", async () => {
    vi.spyOn(api, "feedback").mockRejectedValue(new Error("Nothing may run"));
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    await userEvent.type(screen.getByRole("textbox"), "bug");
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing may run");
    expect(screen.getByRole("textbox")).toHaveValue("bug");
  });

  it("Accept calls the API", async () => {
    const accept = vi.spyOn(api, "accept").mockResolvedValue({} as never);
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("c1");
  });
});

const issueWith = (status: IssueStatus): SpecIssue => ({
  id: "i1",
  foundIn: "build",
  where: "Outcome",
  problem: "silent",
  guess: "kept it",
  status,
  judgment: null,
  answer: null,
});
const question: PendingItem = {
  id: "q1",
  kind: "question",
  questions: [{ question: "Outcome: silent. The spec keeper recommends keeping it.", header: "Issue", multiSelect: false, options: [{ label: "Keep it as built", description: "" }, { label: "Change the code", description: "" }] }],
  issueIds: ["i1"],
};
const accept = () => screen.getByRole("button", { name: "Accept" });
const send = () => screen.getByRole("button", { name: "Send back" });

describe("TryItPanel spec keeper", () => {
  it("shows the question at the top and disables both buttons while it waits", () => {
    render(<TryItPanel detail={detail({ pending: question, issues: [issueWith("waiting")] })} onMoved={() => {}} />);
    expect(screen.getByText(/The spec keeper recommends keeping it/)).toBeInTheDocument();
    expect(accept()).toBeDisabled();
    expect(send()).toBeDisabled();
    expect(screen.getByText("Answer the spec keeper's question first.")).toBeInTheDocument();
  });

  it("holds Accept but opens Send back, with an empty box, for a held issue", async () => {
    const feedback = vi.spyOn(api, "feedback").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(<TryItPanel detail={detail({ issues: [issueWith("held")] })} onMoved={onMoved} />);
    expect(accept()).toBeDisabled();
    expect(send()).toBeEnabled();
    expect(screen.getByText("Changes you asked for go to Build with Send back.")).toBeInTheDocument();
    await userEvent.click(send());
    expect(feedback).toHaveBeenCalledWith("c1", "");
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
  });

  it("disables both buttons while a keeper turn runs", () => {
    render(<TryItPanel detail={detail({ turnRunning: true })} onMoved={() => {}} />);
    expect(accept()).toBeDisabled();
    expect(send()).toBeDisabled();
  });

  it("needs words for Send back when nothing is held, and Accept is open", async () => {
    render(<TryItPanel detail={detail({ issues: [issueWith("kept")] })} onMoved={() => {}} />);
    expect(accept()).toBeEnabled();
    expect(send()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What you found"), "x");
    expect(send()).toBeEnabled();
  });

  it("shows a failed keeper turn with Retry", async () => {
    const retry = vi.spyOn(api, "retry").mockResolvedValue({} as never);
    const chat: CardDetail["chat"] = [{ kind: "error", id: "e1", at: "t", message: "The spec keeper's turn failed", actions: ["retry"] }];
    render(<TryItPanel detail={detail({ chat })} onMoved={() => {}} />);
    expect(screen.getByText("The spec keeper's turn failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("c1");
  });
});

describe("TryItPanel send back", () => {
  it("posts the words without a lane", async () => {
    const feedback = vi.spyOn(api, "feedback").mockResolvedValue({} as never);
    render(<TryItPanel detail={detail()} onMoved={() => {}} />);
    await userEvent.type(screen.getByLabelText("What you found"), "Not per printer");
    await userEvent.click(send());
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(feedback.mock.calls[0]).toEqual(["c1", "Not per printer"]);
  });

  it("shows the words and a reading line instead of the box while the pick runs", () => {
    render(<TryItPanel detail={detail({ turnRunning: true, sendBack: { text: "Not per printer" } })} onMoved={() => {}} />);
    expect(screen.queryByLabelText("What you found")).toBeNull();
    expect(screen.getByText("Not per printer")).toBeInTheDocument();
    expect(screen.getByText("The spec keeper is reading your feedback…")).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  describe("after a failed pick", () => {
    const failedPick = () =>
      detail({
        sendBack: { text: "Not per printer" },
        chat: [
          {
            kind: "error",
            id: "e1",
            at: "t",
            message: "The pick failed",
            actions: ["retry", "back-to-build", "back-to-spec"],
          },
        ],
      });

    it("offers Retry, Back to Build, Back to Spec and Edit, and greys Accept with its reason", () => {
      render(<TryItPanel detail={failedPick()} onMoved={() => {}} />);
      for (const name of ["Retry", "Back to Build", "Back to Spec", "Edit"]) {
        expect(screen.getByRole("button", { name })).toBeEnabled();
      }
      expect(accept()).toBeDisabled();
      expect(screen.getByText("Send your feedback, or edit it away first.")).toBeInTheDocument();
      // The words the two backs would send are on the line.
      expect(screen.getByText("Not per printer")).toBeInTheDocument();
    });

    it("Back to Build and Back to Spec call the generic calls and report onMoved", async () => {
      const toBuild = vi.spyOn(api, "backToBuild").mockResolvedValue({} as never);
      const toSpec = vi.spyOn(api, "backToSpec").mockResolvedValue({} as never);
      const onMoved = vi.fn();
      render(<TryItPanel detail={failedPick()} onMoved={onMoved} />);
      await userEvent.click(screen.getByRole("button", { name: "Back to Build" }));
      expect(toBuild).toHaveBeenCalledWith("c1");
      await userEvent.click(screen.getByRole("button", { name: "Back to Spec" }));
      expect(toSpec).toHaveBeenCalledWith("c1");
      expect(onMoved).toHaveBeenCalledTimes(2);
    });

    it("Edit calls the client and puts your words back in the box", async () => {
      const edit = vi.spyOn(api, "editSendBack").mockResolvedValue({} as never);
      render(<TryItPanel detail={failedPick()} onMoved={() => {}} />);
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(edit).toHaveBeenCalledWith("c1");
      await waitFor(() => expect(screen.getByLabelText("What you found")).toHaveValue("Not per printer"));
    });
  });
});
