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
const dataViewSortMenuSource = readFileSync(
  "apps/ui/src/features/data-browser/components/database/shared/DataViewSortMenu.tsx",
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
    /MenuPrimitive\.Popup[\s\S]*min-w-\[180px\]/,
    "DropdownMenuContent should enforce the shared minimum menu width"
  );
  assert.match(
    dropdownMenuSource,
    /MenuPrimitive\.Item[\s\S]*focus:bg-input\/30[\s\S]*data-highlighted:bg-input\/30/,
    "DropdownMenuItem should keep the shared selector hover/highlight styling"
  );
});

test("DataViewSortMenu uses shared DropdownMenu spacing", () => {
  assert.match(
    dataViewSortMenuSource,
    /<DropdownMenuContent align=\{align\}>/,
    "DataViewSortMenu should rely on the shared DropdownMenu content width"
  );
  assert.doesNotMatch(
    dataViewSortMenuSource,
    /sortMenuLabelClass|sortMenuItemClass|h-7|py-0|rounded-md|w-\[180px\]/,
    "DataViewSortMenu should not override shared menu row spacing"
  );
});

test("DataViewSortMenu owns DB Access sort menu behavior", () => {
  assert.match(
    dataViewSortMenuSource,
    /\{clearEnabled && \([\s\S]*DropdownMenuSeparator[\s\S]*Clear sort/,
    "Clear sort and its separator should only render when the current column is sorted"
  );
  assert.match(
    dataViewSortMenuSource,
    /activeSortMenuItemClass =[\s\S]*bg-input[\s\S]*activeSortMenuIconStyle =[\s\S]*color: "var\(--color-blue-400\)"[\s\S]*stroke: "var\(--color-blue-400\)"[\s\S]*ArrowUpAZ[\s\S]*activeSortMenuIconStyle[\s\S]*ArrowDownAZ[\s\S]*activeSortMenuIconStyle/,
    "The active sort item should keep blue-400 icon emphasis while highlighted"
  );
});

test("DB Access column headers share DataViewSortMenu", () => {
  for (const { label, path } of sortMenuFiles) {
    const source = readFileSync(path, "utf8");

    assert.doesNotMatch(
      source,
      /@workspace\/ui\/lib\/popover-surface/,
      `${label} should not locally import the popup surface`
    );
    assert.match(
      source,
      /<DataViewSortMenu[\s\S]*sortColumn=/,
      `${label} should render the shared DB Access sort menu`
    );
    assert.doesNotMatch(
      source,
      /DropdownMenuSeparator|activeSortMenuItemClass|className="w-40"/,
      `${label} should not keep local sort menu styling`
    );
  }
});
