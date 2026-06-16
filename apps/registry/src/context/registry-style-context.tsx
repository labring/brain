"use client";

import type { RegistrySidebarSection } from "@registry/nav-types";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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

  const [selectedStyle, setSelectedStyleState] = useState(firstStyle);

  const setSelectedStyle = useCallback((style: string) => {
    setSelectedStyleState(style);
  }, []);

  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "registry" && parts[1]) {
      const pathStyle = parts[1];
      if (styles.includes(pathStyle)) {
        setSelectedStyleState(pathStyle);
      }
    }
  }, [pathname, styles]);

  useEffect(() => {
    if (styles.length === 0) {
      return;
    }
    if (!styles.includes(selectedStyle)) {
      setSelectedStyleState(styles[0]);
    }
  }, [styles, selectedStyle]);

  useEffect(() => {
    if (firstStyle && !selectedStyle) {
      setSelectedStyleState(firstStyle);
    }
  }, [firstStyle, selectedStyle]);

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
