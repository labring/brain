export type ProjectCreationPaneEntryMode =
  | "general"
  | "githubDirect"
  | "dockerDirect"
  | "databaseDirect"
  | "templateDirect";

export interface ProjectCreationPaneState {
  entryMode: ProjectCreationPaneEntryMode;
  open: boolean;
  resetKey: number;
}

export type ProjectCreationPaneStateAction =
  | { type: "close" }
  | { entryMode?: ProjectCreationPaneEntryMode; type: "open" };

export const initialProjectCreationPaneState: ProjectCreationPaneState = {
  entryMode: "general",
  open: false,
  resetKey: 0,
};

export function projectCreationPaneStateReducer(
  state: ProjectCreationPaneState,
  action: ProjectCreationPaneStateAction
): ProjectCreationPaneState {
  switch (action.type) {
    case "open":
      return {
        entryMode: action.entryMode ?? "general",
        open: true,
        resetKey: state.resetKey + 1,
      };
    case "close":
      return { ...state, open: false };
    default:
      return state;
  }
}
