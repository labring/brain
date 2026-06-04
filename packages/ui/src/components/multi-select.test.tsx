import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MultiSelect, type MultiSelectOption } from "./multi-select";

const OPTIONS = [
  {
    label: "postgresql",
    value: "postgresql",
  },
  {
    label: "pgbouncer",
    value: "pgbouncer",
  },
] satisfies readonly MultiSelectOption[];

const ARIA_LABEL_RE = /aria-label="Log containers"/;
const SELECTED_COUNT_RE = /2 selected/;
const EMPTY_SLOT_RE = /data-slot="multi-select-empty"/;
const NO_CONTAINERS_RE = /No containers/;
const POPOVER_TRIGGER_RE = /data-slot="popover-trigger"/;

test("MultiSelect renders selected count in the trigger", () => {
  const html = renderToStaticMarkup(
    <MultiSelect
      aria-label="Log containers"
      onValueChange={() => undefined}
      options={OPTIONS}
      placeholder="Container"
      value={["postgresql", "pgbouncer"]}
    />
  );

  assert.match(html, ARIA_LABEL_RE);
  assert.match(html, SELECTED_COUNT_RE);
});

test("MultiSelect renders an empty state without a popover trigger", () => {
  const html = renderToStaticMarkup(
    <MultiSelect emptyMessage="No containers" options={[]} value={[]} />
  );

  assert.match(html, EMPTY_SLOT_RE);
  assert.match(html, NO_CONTAINERS_RE);
  assert.doesNotMatch(html, POPOVER_TRIGGER_RE);
});
