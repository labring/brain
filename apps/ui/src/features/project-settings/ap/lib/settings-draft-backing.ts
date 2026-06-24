export interface SettingsDraftBackingState<TDraft> {
  base: TDraft;
  baseKey: string;
  identityKey?: string;
  latest: TDraft;
  latestKey: string;
  saveFailureMessage: string | null;
  submitConflictMessage: string | null;
}

export interface SettingsDraftBackingSyncResult<TDraft> {
  draft?: TDraft;
  state: SettingsDraftBackingState<TDraft>;
}

export type SettingsDraftSubmitResult<TDraft> =
  | {
      base: TDraft;
      draft: TDraft;
      state: SettingsDraftBackingState<TDraft>;
      status: "ready";
    }
  | {
      state: SettingsDraftBackingState<TDraft>;
      status: "conflict";
    };

const DRAFT_AVAILABLE_MESSAGE = "Your draft is still available.";

export function createSettingsDraftBackingState<TDraft>(
  backing: TDraft,
  backingKey: string,
  identityKey?: string
): SettingsDraftBackingState<TDraft> {
  return {
    base: backing,
    baseKey: backingKey,
    identityKey,
    latest: backing,
    latestKey: backingKey,
    saveFailureMessage: null,
    submitConflictMessage: null,
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
      baseKey: state.latestKey,
      saveFailureMessage: null,
      submitConflictMessage: null,
    },
  };
}

export function keepEditingSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>
): SettingsDraftBackingState<TDraft> {
  return {
    ...state,
    submitConflictMessage: null,
  };
}

export function commitSettingsDraftBackingState<TDraft>(
  state: SettingsDraftBackingState<TDraft>,
  draft: TDraft
): SettingsDraftBackingState<TDraft> {
  return {
    ...state,
    base: draft,
    baseKey: state.latestKey,
    latest: draft,
    saveFailureMessage: null,
    submitConflictMessage: null,
  };
}

export function prepareSettingsDraftSubmit<TDraft, TDomain extends string>(
  state: SettingsDraftBackingState<TDraft>,
  options: {
    conflictMessage: string;
    domains: readonly TDomain[];
    draft: TDraft;
    isDomainDirty: (domain: TDomain, base: TDraft, draft: TDraft) => boolean;
    isLatestDomainChanged?: (
      domain: TDomain,
      input: {
        base: TDraft;
        latest: TDraft;
      }
    ) => boolean;
    mergeDraft: (input: {
      base: TDraft;
      dirtyDomains: readonly TDomain[];
      draft: TDraft;
      latest: TDraft;
    }) => TDraft;
  }
): SettingsDraftSubmitResult<TDraft> {
  const dirtyDomains = options.domains.filter((domain) =>
    options.isDomainDirty(domain, state.base, options.draft)
  );

  if (state.baseKey === state.latestKey || dirtyDomains.length === 0) {
    return {
      base: state.base,
      draft: options.draft,
      state: {
        ...state,
        saveFailureMessage: null,
        submitConflictMessage: null,
      },
      status: "ready",
    };
  }

  const changedDomains = options.domains.filter(
    (domain) =>
      options.isLatestDomainChanged?.(domain, {
        base: state.base,
        latest: state.latest,
      }) ?? options.isDomainDirty(domain, state.base, state.latest)
  );
  const changedDomainSet = new Set(changedDomains);
  const hasConflict = dirtyDomains.some((domain) =>
    changedDomainSet.has(domain)
  );

  if (hasConflict) {
    return {
      state: {
        ...state,
        saveFailureMessage: null,
        submitConflictMessage: options.conflictMessage,
      },
      status: "conflict",
    };
  }

  const mergedDraft = options.mergeDraft({
    base: state.base,
    dirtyDomains,
    draft: options.draft,
    latest: state.latest,
  });
  return {
    base: state.latest,
    draft: mergedDraft,
    state: {
      ...state,
      saveFailureMessage: null,
      submitConflictMessage: null,
    },
    status: "ready",
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
    submitConflictMessage: null,
  };
}
