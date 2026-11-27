import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** What New idea starts with when the board's field opens it. An empty title counts as none. */
export interface NewIdeaPreset {
  projectId?: string;
  title?: string;
}

export interface NewIdeaValue {
  open: boolean;
  /** The preset of the latest `openNewIdea`; `nonce` changes with every call, even for the same values. */
  preset: NewIdeaPreset & { nonce: number };
  openNewIdea: (preset?: NewIdeaPreset) => void;
  closeNewIdea: () => void;
}

const NOOP: NewIdeaValue = { open: false, preset: { nonce: 0 }, openNewIdea: () => {}, closeNewIdea: () => {} };
const NewIdeaContext = createContext<NewIdeaValue>(NOOP);

/** Whether the New idea form is open and what it starts with. Outside a provider it does nothing. */
export function useNewIdea(): NewIdeaValue {
  return useContext(NewIdeaContext);
}

export function NewIdeaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<NewIdeaValue["preset"]>({ nonce: 0 });

  const openNewIdea = useCallback((next: NewIdeaPreset = {}) => {
    setPreset((prev) => ({ ...next, nonce: prev.nonce + 1 }));
    setOpen(true);
  }, []);
  // Closing drops the preset, so a header mounted later (on another page) doesn't fill in a title already added.
  const closeNewIdea = useCallback(() => {
    setOpen(false);
    setPreset((prev) => (prev.projectId || prev.title ? { nonce: prev.nonce } : prev));
  }, []);

  const value = useMemo(() => ({ open, preset, openNewIdea, closeNewIdea }), [open, preset, openNewIdea, closeNewIdea]);
  return <NewIdeaContext.Provider value={value}>{children}</NewIdeaContext.Provider>;
}
