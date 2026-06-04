import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SingleSelect, type SingleSelectOption } from "./single-select";

const OPTIONS = [
  {
    label: "MySQL",
    value: "mysql",
  },
  {
    disabled: true,
    label: "Redis",
    value: "redis",
  },
] satisfies readonly SingleSelectOption[];

const ARIA_LABEL_RE = /aria-label="Database engine"/;
const MYSQL_RE = /MySQL/;
const EMPTY_SLOT_RE = /data-slot="single-select-empty"/;
const NO_ENGINES_RE = /No engines/;
const COMBOBOX_ROLE_RE = /role="combobox"/;

test("SingleSelect renders the selected option in the trigger", () => {
  const html = renderToStaticMarkup(
    <SingleSelect
      aria-label="Database engine"
      onValueChange={() => undefined}
      options={OPTIONS}
      value="mysql"
    />
  );

  assert.match(html, ARIA_LABEL_RE);
  assert.match(html, MYSQL_RE);
});

test("SingleSelect renders an empty state without a Select trigger", () => {
  const html = renderToStaticMarkup(
    <SingleSelect emptyMessage="No engines" options={[]} />
  );

  assert.match(html, EMPTY_SLOT_RE);
  assert.match(html, NO_ENGINES_RE);
  assert.doesNotMatch(html, COMBOBOX_ROLE_RE);
});
