import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DockerDeployer } from "./docker-deployer";

const noop = () => undefined;
const DOCKER_DEPLOYER_SLOT_RE = /data-slot="docker-deployer"/;
const IMAGE_RE = /Image/;
const DOCKER_IMAGE_RE = /Docker image/;
const RUNTIME_RE = /Runtime/;
const ENVIRONMENT_VARIABLES_RE = /Environment Variables/;
const NETWORK_RE = /Network/;
const APP_LISTENING_PORT_RE = /App Listening Port/;
const VALUE_80_RE = /value="80"/;
const AUTO_GENERATED_PUBLIC_ADDRESS_RE = /Auto-generated Public Address/;
const DEPLOY_RE = /Deploy/;
const DISABLED_RE = /disabled=""/;
const INGRESS_RE = /Ingress/;
const ARIA_BUSY_RE = /aria-busy="true"/;
const VALUE_8080_RE = /value="8080"/;
const FEATURE_FLAG_RE = /value="FEATURE_FLAG"/;
const VALUE_TRUE_RE = /value="true"/;
const DOCKER_IMAGE_REQUIRED_RE = /Docker image is required\./;

test("DockerDeployer renders Docker Deployment Settings with default network choices", () => {
  const html = renderToStaticMarkup(<DockerDeployer onDeploy={noop} />);

  assert.match(html, DOCKER_DEPLOYER_SLOT_RE);
  assert.match(html, IMAGE_RE);
  assert.match(html, DOCKER_IMAGE_RE);
  assert.match(html, RUNTIME_RE);
  assert.match(html, ENVIRONMENT_VARIABLES_RE);
  assert.match(html, NETWORK_RE);
  assert.match(html, APP_LISTENING_PORT_RE);
  assert.match(html, VALUE_80_RE);
  assert.match(html, AUTO_GENERATED_PUBLIC_ADDRESS_RE);
  assert.match(html, DEPLOY_RE);
  assert.match(html, DISABLED_RE);
  assert.doesNotMatch(html, INGRESS_RE);
  assert.doesNotMatch(html, DOCKER_IMAGE_REQUIRED_RE);
});

test("DockerDeployer disables deploy while busy even when settings are valid", () => {
  const html = renderToStaticMarkup(
    <DockerDeployer
      busy
      initialSettings={{
        appListeningPort: 8080,
        env: [{ name: "FEATURE_FLAG", value: "true" }],
        image: "ghcr.io/acme/api:1.2",
      }}
      onDeploy={noop}
    />
  );

  assert.match(html, ARIA_BUSY_RE);
  assert.match(html, VALUE_8080_RE);
  assert.match(html, FEATURE_FLAG_RE);
  assert.match(html, VALUE_TRUE_RE);
  assert.match(html, DISABLED_RE);
});
