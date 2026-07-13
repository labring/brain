import {
  type DeviconVariant,
  databaseDeviconSrc,
} from "@workspace/ui/assets/devicons";
import { Database } from "lucide-react";

export type DatabaseEngineIconVariant = DeviconVariant;

export interface DatabaseEngineIconProps {
  alt?: string;
  className?: string;
  engine?: string | null;
  iconUrl?: string | null;
  variant?: DatabaseEngineIconVariant;
}

export function DatabaseEngineIcon({
  alt = "",
  className,
  engine,
  iconUrl,
  variant = "original",
}: DatabaseEngineIconProps) {
  const resolvedIconUrl =
    iconUrl?.trim() || databaseDeviconSrc(engine, variant);

  if (resolvedIconUrl) {
    return (
      <img
        alt={alt}
        className={className}
        data-slot="database-engine-icon"
        decoding="async"
        height={16}
        loading="lazy"
        src={resolvedIconUrl}
        width={16}
      />
    );
  }

  return (
    <Database
      aria-hidden={alt === "" ? true : undefined}
      aria-label={alt || undefined}
      className={className}
      data-slot="database-engine-icon"
      role={alt === "" ? undefined : "img"}
      size={16}
    />
  );
}
