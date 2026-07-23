"use client";

import type { RegistrySidebarSection } from "@registry/nav-types";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

function uniqueSortedStyles(sections: RegistrySidebarSection[]): string[] {
  const set = new Set<string>();
  for (const s of sections) {
    set.add(s.style);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function styleFromPathname(pathname: string, styles: string[]): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const pathStyle = parts[0] === "registry" ? parts[1] : undefined;
  return pathStyle && styles.includes(pathStyle) ? pathStyle : null;
}

export interface RegistryStyleContextValue {
  selectedStyle: string;
  setSelectedStyle: (style: string) => void;
  styles: string[];
}

const RegistryStyleContext = createContext<RegistryStyleContextValue | null>(
  null
);

export function RegistryStyleProvider({
  sections,
  children,
}: {
  sections: RegistrySidebarSection[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const styles = useMemo(() => uniqueSortedStyles(sections), [sections]);
  const firstStyle = styles[0] ?? "";

  const [selectedStyleState, setSelectedStyleState] = useState(
    () => styleFromPathname(pathname, styles) ?? firstStyle
  );
  const [prevPathname, setPrevPathname] = useState(pathname);

  const setSelectedStyle = useCallback((style: string) => {
    setSelectedStyleState(style);
  }, []);

  // Entering /registry/{style} adopts that style; later in-page choices win
  // until the next navigation. Adjusted during render so the sidebar never
  // paints a frame of the previous style.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const pathStyle = styleFromPathname(pathname, styles);
    if (pathStyle) {
      setSelectedStyleState(pathStyle);
    }
  }

  // Selections that no longer exist (or an empty style list resolving late)
  // fall back to the first style at read time.
  const selectedStyle = styles.includes(selectedStyleState)
    ? selectedStyleState
    : firstStyle;

  const value = useMemo(
    () => ({
      styles,
      selectedStyle,
      setSelectedStyle,
    }),
    [styles, selectedStyle, setSelectedStyle]
  );

  return (
    <RegistryStyleContext.Provider value={value}>
      {children}
    </RegistryStyleContext.Provider>
  );
}

export function useRegistryStyle(): RegistryStyleContextValue {
  const ctx = useContext(RegistryStyleContext);
  if (!ctx) {
    throw new Error(
      "useRegistryStyle must be used within RegistryStyleProvider"
    );
  }
  return ctx;
}

export function registryStyleDisplayName(style: string): string {
  if (style === "linear") {
    return "SealAI";
  }
  return style;
}

/** `public/registry/{style}/brand.jpg` */
export function registryStyleBrandUrl(style: string): string {
  const enc = encodeURIComponent(style);
  return `/registry/${enc}/brand.jpg`;
}
