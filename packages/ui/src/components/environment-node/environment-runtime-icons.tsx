import { Box } from "lucide-react";
import type { ComponentType } from "react";
import {
  CppIcon,
  DotNetIcon,
  GoIcon,
  JavaIcon,
  NodeJsIcon,
  PhpIcon,
  PythonIcon,
  RubyIcon,
  type RuntimeIconProps,
  RustIcon,
} from "../../assets/runtime-icons";

import type { EnvironmentRuntimeKey } from "./environment-node.types";

export type EnvironmentRuntimeIcon = ComponentType<RuntimeIconProps>;

export type EnvironmentRuntimeTone =
  | "blue"
  | "cyan"
  | "green"
  | "neutral"
  | "orange"
  | "purple"
  | "red"
  | "yellow";

export function EnvironmentFallbackIcon({
  size = 24,
  ...props
}: RuntimeIconProps) {
  return <Box size={size} {...props} />;
}

export const NodeJsRuntimeIcon = NodeJsIcon;
export const GoRuntimeIcon = GoIcon;
export const PythonRuntimeIcon = PythonIcon;
export const JavaRuntimeIcon = JavaIcon;
export const RustRuntimeIcon = RustIcon;
export const PhpRuntimeIcon = PhpIcon;
export const RubyRuntimeIcon = RubyIcon;
export const CppRuntimeIcon = CppIcon;
export const DotNetRuntimeIcon = DotNetIcon;

const ENVIRONMENT_RUNTIME_ICONS = {
  cpp: CppRuntimeIcon,
  dotnet: DotNetRuntimeIcon,
  go: GoRuntimeIcon,
  java: JavaRuntimeIcon,
  nodejs: NodeJsRuntimeIcon,
  php: PhpRuntimeIcon,
  python: PythonRuntimeIcon,
  ruby: RubyRuntimeIcon,
  rust: RustRuntimeIcon,
} as const satisfies Record<string, EnvironmentRuntimeIcon>;

const ENVIRONMENT_RUNTIME_TONES = {
  cpp: "blue",
  dotnet: "purple",
  go: "cyan",
  java: "orange",
  nodejs: "green",
  php: "purple",
  python: "yellow",
  ruby: "red",
  rust: "orange",
} as const satisfies Record<string, EnvironmentRuntimeTone>;

export function normalizeEnvironmentRuntimeKey(
  runtimeKey: EnvironmentRuntimeKey
) {
  return runtimeKey.trim().toLowerCase();
}

export function getEnvironmentRuntimeIcon(
  runtimeKey: EnvironmentRuntimeKey | undefined
) {
  if (!runtimeKey) {
    return EnvironmentFallbackIcon;
  }

  return (
    ENVIRONMENT_RUNTIME_ICONS[
      normalizeEnvironmentRuntimeKey(
        runtimeKey
      ) as keyof typeof ENVIRONMENT_RUNTIME_ICONS
    ] ?? EnvironmentFallbackIcon
  );
}

/**
 * Renders the runtime's icon. Prefer this over calling
 * `getEnvironmentRuntimeIcon` in JSX position: the icons are module-level
 * components, and going through a component keeps that provable for React.
 */
export function EnvironmentRuntimeIconGlyph({
  runtimeKey,
  ...props
}: RuntimeIconProps & { runtimeKey: EnvironmentRuntimeKey | undefined }) {
  const Icon = runtimeKey
    ? (ENVIRONMENT_RUNTIME_ICONS[
        normalizeEnvironmentRuntimeKey(
          runtimeKey
        ) as keyof typeof ENVIRONMENT_RUNTIME_ICONS
      ] ?? EnvironmentFallbackIcon)
    : EnvironmentFallbackIcon;

  return <Icon {...props} />;
}

export function getEnvironmentRuntimeTone(
  runtimeKey: EnvironmentRuntimeKey | undefined
): EnvironmentRuntimeTone {
  if (!runtimeKey) {
    return "neutral";
  }

  return (
    ENVIRONMENT_RUNTIME_TONES[
      normalizeEnvironmentRuntimeKey(
        runtimeKey
      ) as keyof typeof ENVIRONMENT_RUNTIME_TONES
    ] ?? "neutral"
  );
}
