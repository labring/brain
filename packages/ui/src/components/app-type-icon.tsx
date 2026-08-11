import { appTypeIconSrc } from "@workspace/ui/assets/app-icons";
import { Boxes } from "lucide-react";

export interface AppTypeIconProps {
  alt?: string;
  /** An account-service app-type code, e.g. `"DB"` or `"DEV-BOX"`. */
  appTypeCode?: string | null;
  className?: string;
}

export function AppTypeIcon({
  alt = "",
  appTypeCode,
  className,
}: AppTypeIconProps) {
  const iconSrc = appTypeIconSrc(appTypeCode);

  if (iconSrc) {
    return (
      <img
        alt={alt}
        className={className}
        data-slot="app-type-icon"
        decoding="async"
        height={16}
        loading="lazy"
        src={iconSrc}
        width={16}
      />
    );
  }

  return (
    <Boxes
      aria-hidden={alt === "" ? true : undefined}
      aria-label={alt || undefined}
      className={className}
      data-slot="app-type-icon"
      role={alt === "" ? undefined : "img"}
      size={16}
    />
  );
}
