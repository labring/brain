import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DatabaseEngineIcon } from "./database-engine-icon";

const CUSTOM_ICON_SRC_RE = /src="https:\/\/example\.test\/custom\.svg"/;
const POSTGRESQL_ORIGINAL_ICON_RE = /postgresql-original\.svg/;
const STABLE_IMAGE_DIMENSIONS_RE =
  /<img(?=[^>]*height="16")(?=[^>]*width="16")[^>]*>/;
const LAZY_ASYNC_IMAGE_RE =
  /<img(?=[^>]*decoding="async")(?=[^>]*loading="lazy")[^>]*>/;
const REDIS_PLAIN_ICON_RE = /redis-plain\.svg/;
const DECORATIVE_DATABASE_FALLBACK_RE =
  /<svg(?=[^>]*aria-hidden="true")(?=[^>]*data-slot="database-engine-icon")[^>]*>/;

test("DatabaseEngineIcon prefers an explicit icon URL over the engine brand", () => {
  const html = renderToStaticMarkup(
    <DatabaseEngineIcon
      engine="postgresql"
      iconUrl=" https://example.test/custom.svg "
    />
  );

  assert.match(html, CUSTOM_ICON_SRC_RE);
  assert.doesNotMatch(html, POSTGRESQL_ORIGINAL_ICON_RE);
});

test("DatabaseEngineIcon renders the original shared brand by default", () => {
  const html = renderToStaticMarkup(<DatabaseEngineIcon engine=" POSTGRES " />);

  assert.match(html, POSTGRESQL_ORIGINAL_ICON_RE);
});

test("DatabaseEngineIcon gives brand images stable intrinsic dimensions", () => {
  const html = renderToStaticMarkup(<DatabaseEngineIcon engine="redis" />);

  assert.match(html, STABLE_IMAGE_DIMENSIONS_RE);
});

test("DatabaseEngineIcon defers brand image loading without blocking decode", () => {
  const html = renderToStaticMarkup(<DatabaseEngineIcon engine="mysql" />);

  assert.match(html, LAZY_ASYNC_IMAGE_RE);
});

test("DatabaseEngineIcon exposes the shared plain variant", () => {
  const html = renderToStaticMarkup(
    <DatabaseEngineIcon engine="redis" variant="plain" />
  );

  assert.match(html, REDIS_PLAIN_ICON_RE);
});

test("DatabaseEngineIcon renders a decorative generic database for unknown engines", () => {
  const html = renderToStaticMarkup(<DatabaseEngineIcon engine="clickhouse" />);

  assert.match(html, DECORATIVE_DATABASE_FALLBACK_RE);
});
