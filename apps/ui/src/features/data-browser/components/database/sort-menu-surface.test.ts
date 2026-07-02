import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sortMenuFiles = [
  {
    label: "SQL table column header",
    path: "apps/ui/src/features/data-browser/components/database/sql/TableView/TableView.ColumnHeader.tsx",
  },
  {
    label: "Redis key column header",
    path: "apps/ui/src/features/data-browser/components/database/redis/RedisKeyDetailView.tsx",
  },
] as const;

const dropdownMenuSource = readFileSync(
  "packages/ui/src/components/dropdown-menu.tsx",
  "utf8"
);

test("DropdownMenu uses the selector popup surface by default", () => {
  assert.match(
    dropdownMenuSource,
    /@workspace\/ui\/lib\/popover-surface/,
    "DropdownMenu should import the shared popup surface"
  );
  assert.match(
    dropdownMenuSource,
    /<MenuPrimitive\.Popup[\s\S]*popoverSurfaceClass/,
    "DropdownMenuContent should apply the shared popup surface"
  );
  assert.match(
    dropdownMenuSource,
    /MenuPrimitive\.Item[\s\S]*focus:bg-input\/30[\s\S]*data-highlighted:bg-input\/30/,
    "DropdownMenuItem should use selector hover/highlight styling"
  );
});

test("DB Access sort menus rely on shared DropdownMenu styling", () => {
  for (const { label, path } of sortMenuFiles) {
    const source = readFileSync(path, "utf8");

    assert.doesNotMatch(
      source,
      /@workspace\/ui\/lib\/popover-surface/,
      `${label} should not locally import the popup surface`
    );
    assert.match(
      source,
      /<DropdownMenuContent[\s\S]*className="w-40"[\s\S]*\{"Sort actions"\}/,
      `${label} sort dropdown should use the shared DropdownMenu surface`
    );
    assert.doesNotMatch(
      source,
      /const sortMenuItemClass/,
      `${label} should not define local hover/highlight styling`
    );
    assert.match(
      source,
      /const activeSortMenuItemClass =[\s\S]*bg-input[\s\S]*focus:bg-input/,
      `${label} active sort item should use the selector selected styling`
    );
  }
});
