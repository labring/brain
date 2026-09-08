import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTemplateEntries,
  resolveTemplateEntryUrls,
  stampTemplateEntryOpenPort,
  templateAppUrlFromDocs,
  templateDeclaredEntries,
  templateEntryOpenPort,
  templateEntryUrl,
  templateIngressHostsFromDocs,
  templateInstanceDefaults,
} from "./template-entries";

const TEMPLATE_EXPRESSION_START = String.fromCharCode(36, 123, 123);
const APP_HOST_EXPRESSION = `${TEMPLATE_EXPRESSION_START} defaults.app_host }}`;
const HOST = "eagler-demo.example.sealos.run";
const OPEN = `https://${HOST}/admin`;
const SHARE = `https://${HOST}/?server=wss://${HOST}/`;

function service(annotations?: Record<string, string>) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: "eaglercraft",
      ...(annotations === undefined ? {} : { annotations }),
    },
    spec: {
      ports: [
        { name: "game", port: 5200, targetPort: 5200 },
        { name: "admin", port: 5201, targetPort: 5201 },
      ],
    },
  };
}

function ingress(
  name: string,
  paths: { path: string; port: number | string }[]
) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: { name },
    spec: {
      rules: [
        {
          host: HOST,
          http: {
            paths: paths.map((entry) => ({
              backend: {
                service: {
                  name: "eaglercraft",
                  port:
                    typeof entry.port === "number"
                      ? { number: entry.port }
                      : { name: entry.port },
                },
              },
              path: entry.path,
              pathType: "Prefix",
            })),
          },
        },
      ],
    },
  };
}

const APP_CR = {
  apiVersion: "app.sealos.io/v1",
  kind: "App",
  metadata: { name: "eaglercraft" },
  spec: { data: { url: OPEN }, type: "link" },
};

function eaglercraftDocs() {
  return [
    service(),
    ingress("eaglercraft", [{ path: "/", port: 5200 }]),
    ingress("eaglercraft-admin", [
      { path: "/api", port: 5201 },
      { path: "/admin.css", port: 5201 },
      { path: "/admin", port: 5201 },
    ]),
    APP_CR,
  ];
}

test("templateDeclaredEntries reads spec.entries strings and ignores the rest", () => {
  assert.deepEqual(
    templateDeclaredEntries({
      spec: { entries: { open: ` ${OPEN} `, share: 42, other: "x" } },
    }),
    { open: OPEN }
  );
  assert.deepEqual(templateDeclaredEntries({ spec: {} }), {});
  assert.deepEqual(templateDeclaredEntries(null), {});
});

test("templateEntryUrl keeps a query string verbatim and rejects secrets and fragments", () => {
  assert.equal(templateEntryUrl(SHARE), SHARE);
  assert.equal(templateEntryUrl(`wss://${HOST}/`), `wss://${HOST}/`);
  assert.equal(templateEntryUrl(`https://${HOST}/#token=abc`), undefined);
  assert.equal(templateEntryUrl(`https://user:pw@${HOST}/`), undefined);
  assert.equal(templateEntryUrl("ftp://example.com/"), undefined);
  assert.equal(templateEntryUrl("/admin"), undefined);
  assert.equal(templateEntryUrl(""), undefined);
});

test("templateAppUrlFromDocs reads the Sealos App CR url", () => {
  assert.equal(templateAppUrlFromDocs(eaglercraftDocs()), OPEN);
  assert.equal(templateAppUrlFromDocs([service()]), undefined);
  assert.equal(
    templateAppUrlFromDocs([{ ...APP_CR, apiVersion: "other/v1" }]),
    undefined
  );
});

test("templateIngressHostsFromDocs lists every Ingress rule host", () => {
  assert.deepEqual(
    [...templateIngressHostsFromDocs(eaglercraftDocs())],
    [HOST]
  );
});

test("Open falls back to the App CR url; Share never does", () => {
  const hosts = new Set([HOST]);
  assert.deepEqual(
    resolveTemplateEntryUrls({ appUrl: OPEN, declared: {}, hosts }),
    { open: OPEN }
  );
  assert.deepEqual(
    resolveTemplateEntryUrls({
      appUrl: `https://${HOST}/invite/secret-code`,
      declared: {},
      hosts,
    }),
    { open: `https://${HOST}/invite/secret-code` }
  );
  assert.deepEqual(
    resolveTemplateEntryUrls({
      appUrl: `https://${HOST}/`,
      declared: { open: OPEN, share: SHARE },
      hosts,
    }),
    { open: OPEN, share: SHARE }
  );
  // A fragment-bearing App CR url is not a probeable entry at all.
  assert.deepEqual(
    resolveTemplateEntryUrls({
      appUrl: `https://${HOST}/#token=abc`,
      declared: {},
      hosts,
    }),
    {}
  );
});

test("an entry no Ingress of the deployment serves is dropped", () => {
  assert.deepEqual(
    resolveTemplateEntryUrls({
      appUrl: "https://elsewhere.example.sealos.run/",
      declared: { share: "https://elsewhere.example.sealos.run/?x=1" },
      hosts: new Set([HOST]),
    }),
    {}
  );
  assert.deepEqual(
    resolveTemplateEntryUrls({
      declared: { open: `https://${HOST.toUpperCase()}/admin` },
      hosts: new Set([HOST]),
    }),
    { open: `https://${HOST.toUpperCase()}/admin` }
  );
});

test("templateEntryOpenPort follows the longest matching Ingress path to its Service port", () => {
  const docs = eaglercraftDocs();
  assert.deepEqual(templateEntryOpenPort({ docs, openUrl: OPEN }), {
    port: 5201,
    serviceName: "eaglercraft",
  });
  assert.deepEqual(
    templateEntryOpenPort({ docs, openUrl: `https://${HOST}/admin/users` }),
    { port: 5201, serviceName: "eaglercraft" }
  );
  // `/admin` is not a prefix of `/administrator`; the root rule wins there.
  assert.deepEqual(
    templateEntryOpenPort({ docs, openUrl: `https://${HOST}/administrator` }),
    { port: 5200, serviceName: "eaglercraft" }
  );
  assert.deepEqual(templateEntryOpenPort({ docs, openUrl: SHARE }), {
    port: 5200,
    serviceName: "eaglercraft",
  });
});

test("templateEntryOpenPort resolves a named backend port through the Service", () => {
  const docs = [
    service(),
    ingress("eaglercraft", [{ path: "/", port: "admin" }]),
  ];
  assert.deepEqual(
    templateEntryOpenPort({ docs, openUrl: `https://${HOST}/` }),
    {
      port: 5201,
      serviceName: "eaglercraft",
    }
  );
});

test("templateEntryOpenPort finds nothing without a host, path, or Service match", () => {
  const docs = eaglercraftDocs();
  assert.equal(
    templateEntryOpenPort({
      docs,
      openUrl: "https://elsewhere.example.sealos.run/admin",
    }),
    undefined
  );
  assert.equal(
    templateEntryOpenPort({
      docs: [ingress("eaglercraft", [{ path: "/", port: 5200 }])],
      openUrl: OPEN,
    }),
    undefined
  );
  assert.equal(
    templateEntryOpenPort({
      docs: [service(), ingress("eaglercraft", [{ path: "/", port: 9999 }])],
      openUrl: OPEN,
    }),
    undefined
  );
  assert.equal(
    templateEntryOpenPort({ docs, openUrl: "not a url" }),
    undefined
  );
});

test("templateEntryOpenPort never falls through to a shorter rule when the longest cannot be resolved", () => {
  const consoleRule = {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: { name: "console" },
    spec: {
      rules: [
        {
          host: HOST,
          http: {
            paths: [
              {
                backend: { service: { name: "console", port: { number: 80 } } },
                path: "/admin",
                pathType: "Prefix",
              },
            ],
          },
        },
      ],
    },
  };
  // `/admin` → console (Service not among the documents); `/` → eaglercraft.
  // The root rule serves a different backend, so nothing is named.
  assert.equal(
    templateEntryOpenPort({
      docs: [
        service(),
        consoleRule,
        ingress("eaglercraft", [{ path: "/", port: 5200 }]),
      ],
      openUrl: OPEN,
    }),
    undefined
  );
  // The longest rule names a port its Service does not have: same answer.
  assert.equal(
    templateEntryOpenPort({
      docs: [
        service(),
        ingress("eaglercraft", [
          { path: "/", port: 5200 },
          { path: "/admin", port: 9999 },
        ]),
      ],
      openUrl: OPEN,
    }),
    undefined
  );
  // Equal-length rules still try each other: the second `/admin` resolves.
  assert.deepEqual(
    templateEntryOpenPort({
      docs: [
        service(),
        consoleRule,
        ingress("eaglercraft", [{ path: "/admin", port: 5201 }]),
      ],
      openUrl: OPEN,
    }),
    { port: 5201, serviceName: "eaglercraft" }
  );
});

test("stampTemplateEntryOpenPort writes the annotation unless the template preset one", () => {
  const fresh = service();
  assert.equal(
    stampTemplateEntryOpenPort([fresh], {
      port: 5201,
      serviceName: "eaglercraft",
    }),
    true
  );
  assert.equal(
    fresh.metadata.annotations?.["brain.io/default-open-port"],
    "5201"
  );

  const preset = service({ "brain.io/default-open-port": "5200" });
  assert.equal(
    stampTemplateEntryOpenPort([preset], {
      port: 5201,
      serviceName: "eaglercraft",
    }),
    false
  );
  assert.equal(
    preset.metadata.annotations?.["brain.io/default-open-port"],
    "5200"
  );

  assert.equal(
    stampTemplateEntryOpenPort([service()], { port: 80, serviceName: "other" }),
    false
  );
});

test("applyTemplateEntries renders, resolves, and presets the Default Open Port", () => {
  const docs = eaglercraftDocs();
  const entries = applyTemplateEntries({
    declared: {
      open: `https://${APP_HOST_EXPRESSION}.example.sealos.run/admin`,
      share: `https://${APP_HOST_EXPRESSION}.example.sealos.run/?server=wss://${APP_HOST_EXPRESSION}.example.sealos.run/`,
    },
    docs,
    render: (value) => value.replaceAll(APP_HOST_EXPRESSION, "eagler-demo"),
  });
  assert.deepEqual(entries, { open: OPEN, share: SHARE });
  const stamped = docs[0] as ReturnType<typeof service>;
  assert.equal(
    stamped.metadata.annotations?.["brain.io/default-open-port"],
    "5201"
  );
});

test("applyTemplateEntries yields nothing for a template with neither entry nor App CR", () => {
  const docs = [service(), ingress("eaglercraft", [{ path: "/", port: 5200 }])];
  assert.equal(
    applyTemplateEntries({ declared: {}, docs, render: (value) => value }),
    undefined
  );
  assert.equal(
    (docs[0] as ReturnType<typeof service>).metadata.annotations,
    undefined
  );
});

test("templateInstanceDefaults keeps only resolved default values", () => {
  assert.deepEqual(
    templateInstanceDefaults({
      spec: {
        defaults: {
          app_host: { type: "string", value: "eagler-demo" },
          app_name: "eaglercraft",
          unresolved: { value: `${TEMPLATE_EXPRESSION_START} random(8) }}` },
          bad: 3,
        },
      },
    }),
    { app_host: "eagler-demo", app_name: "eaglercraft" }
  );
  assert.deepEqual(templateInstanceDefaults(null), {});
});
