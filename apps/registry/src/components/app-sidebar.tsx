"use client";

import {
  BrushIcon,
  CheckmarkCircle04Icon,
  NoteEditIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  RegistryNavItem,
  RegistryPreviewState,
  RegistrySidebarSection,
} from "@registry/nav-types";
import { registryItemHref } from "@registry/nav-utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StyleSwitcher } from "@/components/style-switcher";
import { useRegistryStyle } from "@/context/registry-style-context";

interface StyleTreeNode {
  sections: RegistrySidebarSection[];
  style: string;
}

function buildStyleTree(sections: RegistrySidebarSection[]): StyleTreeNode[] {
  const byStyle = new Map<string, RegistrySidebarSection[]>();
  for (const section of sections) {
    const list = byStyle.get(section.style) ?? [];
    list.push(section);
    byStyle.set(section.style, list);
  }
  return Array.from(byStyle.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([style, secs]) => ({
      style,
      sections: [...secs].sort((x, y) => x.group.localeCompare(y.group)),
    }));
}

function openGroupFromPathname(pathname: string) {
  const groupOpen: Record<string, boolean> = {};
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "registry" && parts[1] && parts[2]) {
    groupOpen[`${parts[1]}/${parts[2]}`] = true;
  }
  return groupOpen;
}

function flattenNavItems(
  sections: RegistrySidebarSection[]
): RegistryNavItem[] {
  const seen = new Set<string>();
  const out: RegistryNavItem[] = [];
  for (const s of sections) {
    for (const item of s.items) {
      const key = `${item.style}/${item.group}/${item.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

const REGISTRY_STATE_ICONS: Record<RegistryPreviewState, typeof BrushIcon> = {
  designing: BrushIcon,
  coding: SourceCodeIcon,
  reviewing: NoteEditIcon,
  done: CheckmarkCircle04Icon,
};

const REGISTRY_STATE_LABEL: Record<RegistryPreviewState, string> = {
  designing: "Designing",
  coding: "Coding",
  reviewing: "Reviewing",
  done: "Done",
};

const REGISTRY_STATE_COLOR_CLASS: Record<RegistryPreviewState, string> = {
  designing: "text-violet-500",
  coding: "text-blue-500",
  reviewing: "text-amber-500",
  done: "text-green-500",
};

export default function AppSidebar({
  registrySections = [],
}: {
  registrySections?: RegistrySidebarSection[];
}) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const { selectedStyle } = useRegistryStyle();
  const styleTree = useMemo(
    () => buildStyleTree(registrySections),
    [registrySections]
  );

  const sectionsForSelectedStyle = useMemo(() => {
    return styleTree.find((n) => n.style === selectedStyle)?.sections ?? [];
  }, [styleTree, selectedStyle]);

  const flatItems = useMemo(() => {
    const filtered = registrySections.filter((s) => s.style === selectedStyle);
    return flattenNavItems(filtered);
  }, [registrySections, selectedStyle]);

  /** `undefined` / missing = open by default; only `false` keeps a group collapsed. */
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setGroupOpen((prev) => ({
      ...prev,
      ...openGroupFromPathname(pathname),
    }));
  }, [pathname]);

  const setGroupOpenKey = (key: string, open: boolean) => {
    setGroupOpen((prev) => ({
      ...prev,
      [key]: open,
    }));
  };

  const linkButton = (item: RegistryNavItem) => {
    const href = registryItemHref(item);
    const active = pathname === href;
    const stateIcon = REGISTRY_STATE_ICONS[item.state];
    const stateLabel = REGISTRY_STATE_LABEL[item.state];
    const stateColorClass = REGISTRY_STATE_COLOR_CLASS[item.state];
    return (
      <SidebarMenuItem key={href}>
        <SidebarMenuButton
          className={cn(
            "h-8 max-h-8 min-h-8 shrink-0 cursor-pointer gap-2 rounded-xl px-2 py-0 text-xs leading-none"
          )}
          isActive={active}
          render={
            <Link
              aria-label={
                item.description
                  ? `${item.title}: ${item.description}. Status: ${stateLabel}.`
                  : `${item.title}. Status: ${stateLabel}.`
              }
              className="flex min-h-0 min-w-0 flex-1 items-center gap-2 overflow-hidden group-data-[collapsible=icon]:justify-center"
              href={href}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex shrink-0 items-center justify-center [&_svg]:size-4",
                  stateColorClass,
                  "[&_svg]:text-current"
                )}
              >
                <HugeiconsIcon icon={stateIcon} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                {item.title}
              </span>
            </Link>
          }
          tooltip={{
            delay: 400,
            children: (
              <div className="flex max-w-xs flex-col gap-1.5 text-left">
                <span className="font-medium text-foreground">
                  {item.title}
                </span>
                {item.description ? (
                  <span className="text-balance text-[11px] text-muted-foreground leading-snug">
                    {item.description}
                  </span>
                ) : null}
                <span className={cn("font-medium", stateColorClass)}>
                  Status: {stateLabel}
                </span>
              </div>
            ),
            hidden: isMobile,
            className:
              "rounded-xl border border-sidebar-border bg-popover text-xs text-foreground shadow-md",
          }}
        />
      </SidebarMenuItem>
    );
  };

  return (
    <div className="[--sidebar-width:14rem]">
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex flex-col gap-1 bg-background p-2 pb-0 group-data-[collapsible=icon]:hidden">
          <StyleSwitcher registrySections={registrySections} />
        </SidebarHeader>
        <SidebarContent className="bg-background pt-0">
          <div className="group-data-[collapsible=icon]:hidden">
            <SidebarGroup className="pt-0">
              <SidebarGroupContent className="min-w-0 px-0">
                {sectionsForSelectedStyle.map(({ group, items }) => {
                  const gkey = `${selectedStyle}/${group}`;
                  const isOpen = groupOpen[gkey] !== false;
                  return (
                    <Collapsible
                      className="relative min-w-0 pb-0.5"
                      key={gkey}
                      onOpenChange={(open) => {
                        setGroupOpenKey(gkey, open);
                      }}
                      open={isOpen}
                    >
                      <CollapsibleTrigger
                        className={cn(
                          "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl py-0 text-left font-medium text-xs outline-hidden ring-sidebar-ring",
                          "focus-visible:ring-2"
                        )}
                        type="button"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-100",
                            isOpen && "rotate-90"
                          )}
                        />
                        <span className="truncate">{group}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="data-closed:fade-out-0 data-open:fade-in-0 pl-1.5 data-closed:animate-out data-open:animate-in">
                        <SidebarMenu className="min-w-0 border-sidebar-border border-l pl-2">
                          {items.map((item) => linkButton(item))}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </SidebarGroupContent>
            </SidebarGroup>
          </div>

          <SidebarGroup className="hidden group-data-[collapsible=icon]:block">
            <SidebarGroupContent>
              <SidebarMenu className="min-w-0">
                {flatItems.map((item) => linkButton(item))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
    </div>
  );
}
