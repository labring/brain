import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import type { ReactNode } from "react";

export type PointerContextMenuItem =
  | { separator: true }
  | {
      danger?: boolean;
      icon?: ReactNode;
      label: string;
      onClick: () => void;
      separator?: false;
    };

interface PointerContextMenuProps {
  align?: "start" | "end";
  items: PointerContextMenuItem[];
  onClose: () => void;
  side?: "top" | "right" | "bottom" | "left";
  x: number;
  y: number;
}

export function PointerContextMenu({
  align = "start",
  items,
  onClose,
  side = "bottom",
  x,
  y,
}: PointerContextMenuProps) {
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DropdownMenuTrigger
        render={
          <button
            aria-label="Context menu anchor"
            style={{
              appearance: "none",
              background: "transparent",
              border: 0,
              height: 0,
              left: x,
              margin: 0,
              overflow: "hidden",
              padding: 0,
              position: "fixed",
              top: y,
              width: 0,
            }}
            tabIndex={-1}
            type="button"
          />
        }
      />
      <DropdownMenuContent
        align={align}
        className="w-[180px]"
        side={side}
        sideOffset={0}
      >
        {items.map((item, index) =>
          item.separator ? (
            <DropdownMenuSeparator key={index} />
          ) : (
            <DropdownMenuItem
              key={index}
              onClick={item.onClick}
              variant={item.danger ? "destructive" : "default"}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
