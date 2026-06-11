export interface SettingsDraftBackingState<TDraft> {
  base: TDraft;
  identityKey?: string;
  latest: TDraft;
  latestKey: string;
  resourceChanged: boolean;
  saveFailureMessage: string | null;
}

export interface SettingsDraftBackingSyncResult<TDraft> {
  draft?: TDraft;
  state: SettingsDraftBackingState<TDraft>;
}

const DRAFT_AVAILABLE_MESSAGE = "Your draft is still available.";

export function createSettingsDraftBackingState<TDraft>(
  backing: TDraft,
  backingKey: string,
  identityKey?: string
): SettingsDraftBackingState<TDraft> {
  return {
    base: backing,
    identityKey,
    latest: backing,
    latestKey: backingKey,
    resourceChanged: false,
    saveFailureMessage: null,
  };
}

export function syncSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>,
  options: {
    backing: TDraft;
    backingKey: string;
    draft: TDraft;
    identityKey?: string;
    isDirty: (base: TDraft, draft: TDraft) => boolean;
  }
): SettingsDraftBackingSyncResult<TDraft> {
  if (
    state.identityKey !== undefined &&
    options.identityKey !== undefined &&
    options.identityKey !== state.identityKey
  ) {
    return {
      draft: options.backing,
      state: createSettingsDraftBackingState(
        options.backing,
        options.backingKey,
        options.identityKey
      ),
    };
  }

  if (options.backingKey === state.latestKey) {
    return { state };
  }

  if (options.isDirty(state.base, options.draft)) {
    return {
      state: {
        ...state,
        identityKey: options.identityKey ?? state.identityKey,
        latest: options.backing,
        latestKey: options.backingKey,
        resourceChanged: true,
        saveFailureMessage: null,
      },
    };
  }

  return {
    draft: options.backing,
    state: createSettingsDraftBackingState(
      options.backing,
      options.backingKey,
      options.identityKey
    ),
  };
}

export function applySettingsDraftBackingResult<TDraft>(
  result: SettingsDraftBackingSyncResult<TDraft>,
  apply: {
    draft: (draft: TDraft) => void;
    state: (state: SettingsDraftBackingState<TDraft>) => void;
  }
) {
  apply.state(result.state);
  if (result.draft !== undefined) {
    apply.draft(result.draft);
  }
}

export function reloadSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>
): SettingsDraftBackingSyncResult<TDraft> {
  return {
    draft: state.latest,
    state: {
      ...state,
      base: state.latest,
      resourceChanged: false,
      saveFailureMessage: null,
    },
  };
}

export function keepEditingSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>
): SettingsDraftBackingState<TDraft> {
  return {
    ...state,
    resourceChanged: false,
  };
}

export function commitSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>,
  draft: TDraft
): SettingsDraftBackingState<TDraft> {
  return {
    ...state,
    base: draft,
    latest: draft,
    resourceChanged: false,
    saveFailureMessage: null,
  };
}

export function settingsDraftSaveFailureMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return `${error.message} ${DRAFT_AVAILABLE_MESSAGE}`;
  }
  return `${fallbackMessage} ${DRAFT_AVAILABLE_MESSAGE}`;
}

export function failSettingsDraftSave<TDraft>(
  state: SettingsDraftBackingState<TDraft>,
  error: unknown,
  fallbackMessage: string
): SettingsDraftBackingState<TDraft> {
  return {
    ...state,
    saveFailureMessage: settingsDraftSaveFailureMessage(error, fallbackMessage),
  };
}
