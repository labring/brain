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
  templateArgs?: Record<string, string>;
  templateName?: string;
}

export type ProjectCreationPaneStateAction =
  | { type: "close" }
  | {
      entryMode?: ProjectCreationPaneEntryMode;
      templateArgs?: Record<string, string>;
      templateName?: string;
      type: "open";
    };

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
    case "open": {
      const entryMode = action.entryMode ?? "general";
      return {
        entryMode,
        open: true,
        resetKey: state.resetKey + 1,
        ...(entryMode === "templateDirect" && action.templateName != null
          ? { templateName: action.templateName }
          : {}),
        ...(entryMode === "templateDirect" && action.templateArgs != null
          ? { templateArgs: action.templateArgs }
          : {}),
      };
    }
    case "close":
      return { ...state, open: false };
    default:
      return state;
  }
}
