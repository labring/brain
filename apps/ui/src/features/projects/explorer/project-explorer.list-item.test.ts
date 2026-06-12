import assert from "node:assert/strict";
import { test } from "node:test";

import { isProjectDeleteVerificationMatch } from "./project-explorer.list-item";

test("project delete confirmation matches the Project Display Name", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "Brain Template E2E 0610103045",
      "Brain Template E2E 0610103045"
    ),
    true
  );
});

test("project delete confirmation trims surrounding whitespace", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "  Brain Template E2E 0610103045  ",
      "Brain Template E2E 0610103045"
    ),
    true
  );
});

test("project delete confirmation does not accept the Project ID", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "6bf1a225-7e79-4724-ad46-aa5bf38e1112",
      "Brain Template E2E 0610103045"
    ),
    false
  );
});

test("project delete confirmation keeps display-name casing strict", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "brain template e2e 0610103045",
      "Brain Template E2E 0610103045"
    ),
    false
  );
});
