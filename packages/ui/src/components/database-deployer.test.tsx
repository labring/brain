import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  DatabaseDeployer,
  type DatabaseDeploymentChoice,
  databaseReplicaOptionLabel,
} from "./database-deployer";

const DATABASE_OPTIONS = [
  {
    engine: "postgresql",
    id: "postgresql",
    label: "PostgreSQL",
  },
] satisfies readonly DatabaseDeploymentChoice[];

const REPLICA_COUNT_SELECT_RE = /aria-label="Database replica count"/;
const NUMERIC_REPLICA_UNIT_OPTION_RE = />\d+ replicas?</;
const PRIVATE_ACCESS_DESCRIPTION_RE = /Private access by default/;

const noop = () => {
  /* test noop */
};

test("database deployer renders replica options without unit suffix", () => {
  const html = renderToStaticMarkup(
    <DatabaseDeployer databaseOptions={DATABASE_OPTIONS} onDeploy={noop} />
  );

  assert.match(html, REPLICA_COUNT_SELECT_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_OPTION_RE);
  assert.doesNotMatch(html, PRIVATE_ACCESS_DESCRIPTION_RE);
  assert.equal(databaseReplicaOptionLabel(1), "1");
  assert.equal(databaseReplicaOptionLabel(10), "10");
});
