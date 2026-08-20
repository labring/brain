import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppMultiSelect,
  type AppMultiSelectOption,
  AppSelect,
  type AppSelectOption,
} from "./app-select";

const SINGLE_OPTIONS = [
  {
    label: "MySQL",
    value: "mysql",
  },
  {
    disabled: true,
    label: "Redis",
    value: "redis",
  },
] satisfies readonly AppSelectOption[];

const MULTI_OPTIONS = [
  {
    label: "postgresql",
    value: "postgresql",
  },
  {
    label: "pgbouncer",
    value: "pgbouncer",
  },
] satisfies readonly AppMultiSelectOption[];

const COMBOBOX_ROLE_RE = /role="combobox"/;
const TRIGGER_TAG_RE = /<[^>]*data-slot="app-select-trigger"[^>]*>/;
const MYSQL_RE = /MySQL/;
const SELECTED_COUNT_RE = /2 selected/;
const SINGLE_ARIA_RE = /aria-label="Database engine"/;
const SINGLE_DESCRIPTION_RE = /aria-describedby="database-engine-description"/;
const MULTI_ARIA_RE = /aria-label="Log containers"/;
const SINGLE_EMPTY_SLOT_RE = /data-slot="app-select-empty"/;
const MULTI_EMPTY_SLOT_RE = /data-slot="app-multi-select-empty"/;
const NO_ENGINES_RE = /No engines/;
const NO_CONTAINERS_RE = /No containers/;
const NON_SEARCHABLE_FILTER_RE =
  /const filter = searchable \? undefined : null;/g;
const COMBOBOX_FILTER_PROP_RE = /filter=\{filter\}/g;
const APP_SELECT_POPUP_Z_INDEX_RE = /className="isolate z-\[(\d+)\]"/;
const DIALOG_Z_INDEX_RE = /z-\[(\d+)\] grid w-full/;
const SOURCE = readFileSync(
  fileURLToPath(new URL("./app-select.tsx", import.meta.url))
).toString();
const DIALOG_SOURCE = readFileSync(
  fileURLToPath(new URL("./dialog.tsx", import.meta.url))
).toString();

test("AppSelect renders the selected option in the trigger", () => {
  const html = renderToStaticMarkup(
    <AppSelect
      aria-describedby="database-engine-description"
      aria-label="Database engine"
      onValueChange={() => undefined}
      options={SINGLE_OPTIONS}
      value="mysql"
    />
  );

  assert.match(html, SINGLE_ARIA_RE);
  assert.match(html, SINGLE_DESCRIPTION_RE);
  assert.match(html, MYSQL_RE);
  assert.match(html, COMBOBOX_ROLE_RE);
  const triggerTag = html.match(TRIGGER_TAG_RE)?.[0];
  assert.ok(
    triggerTag?.includes("text-left"),
    "trigger should left-align selected text"
  );
});

test("AppSelect renders an empty state without a combobox trigger", () => {
  const html = renderToStaticMarkup(
    <AppSelect emptyMessage="No engines" options={[]} />
  );

  assert.match(html, SINGLE_EMPTY_SLOT_RE);
  assert.match(html, NO_ENGINES_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});

test("AppMultiSelect renders the selected count in the trigger", () => {
  const html = renderToStaticMarkup(
    <AppMultiSelect
      aria-label="Log containers"
      onValueChange={() => undefined}
      options={MULTI_OPTIONS}
      placeholder="Container"
      value={["postgresql", "pgbouncer"]}
    />
  );

  assert.match(html, MULTI_ARIA_RE);
  assert.match(html, SELECTED_COUNT_RE);
});

test("AppMultiSelect renders an empty state without a combobox trigger", () => {
  const html = renderToStaticMarkup(
    <AppMultiSelect emptyMessage="No containers" options={[]} value={[]} />
  );

  assert.match(html, MULTI_EMPTY_SLOT_RE);
  assert.match(html, NO_CONTAINERS_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});

test("AppSelect disables combobox filtering when search is hidden", () => {
  assert.equal(
    [...SOURCE.matchAll(NON_SEARCHABLE_FILTER_RE)].length,
    2,
    "single and multi select should not filter by hidden combobox input"
  );
  assert.equal(
    [...SOURCE.matchAll(COMBOBOX_FILTER_PROP_RE)].length,
    2,
    "single and multi select should pass the resolved filter to Base UI"
  );
});

test("AppSelect popup renders above dialog content", () => {
  const popupZIndex = SOURCE.match(APP_SELECT_POPUP_Z_INDEX_RE)?.[1];
  const dialogZIndex = DIALOG_SOURCE.match(DIALOG_Z_INDEX_RE)?.[1];

  assert.ok(popupZIndex, "AppSelect popup should define an explicit z-index");
  assert.ok(dialogZIndex, "Dialog content should define an explicit z-index");
  assert.ok(
    Number(popupZIndex) > Number(dialogZIndex),
    "AppSelect popup should stack above dialog content"
  );
});
