"use client";

import {
  AnimatedThemeToggler,
  type AnimatedThemeTogglerProps,
} from "@workspace/ui/components/animated-theme-toggler";
import { useTheme } from "next-themes";

/**
 * next-themes-backed {@link AnimatedThemeToggler}. The provider owns
 * persistence; the toggler only reports the requested theme and paints the
 * View Transition reveal. Kept in @workspace/ui because app packages do not
 * resolve `next-themes` directly (same boundary as sonner.tsx).
 */
function ThemeToggle(
  props: Omit<AnimatedThemeTogglerProps, "theme" | "onThemeChange">
) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <AnimatedThemeToggler
      onThemeChange={setTheme}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      {...props}
    />
  );
}

export { ThemeToggle };
