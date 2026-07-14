"use client";

import { useEffect } from "react";

import {
  type ProjectShortcutIconKeyMap,
  projectShortcutIconAssetUrls,
} from "@/features/projects/project-shortcut-icons";

const preloadedProjectShortcutIconUrls = new Set<string>();

export function useProjectShortcutIconPreload(
  projectShortcutIconKeys: ProjectShortcutIconKeyMap | undefined
) {
  useEffect(() => {
    if (projectShortcutIconKeys === undefined || typeof Image === "undefined") {
      return;
    }

    for (const url of projectShortcutIconAssetUrls(
      projectShortcutIconKeys.values()
    )) {
      if (preloadedProjectShortcutIconUrls.has(url)) {
        continue;
      }
      preloadedProjectShortcutIconUrls.add(url);
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    }
  }, [projectShortcutIconKeys]);
}
