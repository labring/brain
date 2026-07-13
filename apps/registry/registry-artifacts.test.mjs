import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const registryDirectory = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  await readFile(path.join(registryDirectory, "registry.json"), "utf8")
);
const publishedRegistry = JSON.parse(
  await readFile(
    path.join(registryDirectory, "public", "r", "registry.json"),
    "utf8"
  )
);
const itemsByName = new Map(registry.items.map((item) => [item.name, item]));
const checkedItemNames = ["canvas-node", "container-node", "database-node"];
const workspaceComponentPrefix = "@workspace/ui/components/";
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

function importSpecifiers(source) {
  const pattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]+?\s+from\s+)?["']([^"']+)["']/g;
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

function targetCandidates(target) {
  if (sourceExtensions.has(path.posix.extname(target))) {
    return [target];
  }
  return [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.mjs`,
    path.posix.join(target, "index.ts"),
    path.posix.join(target, "index.tsx"),
    path.posix.join(target, "index.js"),
  ];
}

function assertTargetExists({ itemName, importer, specifier, targets }) {
  assert.ok(
    targetCandidates(specifier).some((candidate) => targets.has(candidate)),
    `${itemName}: ${importer} imports ${specifier}, but that target is not included`
  );
}

function targetComesFromRegistryDependency(item, target) {
  const [root, dependencyName] = target.split("/");
  return (
    root === "components" &&
    dependencyName !== undefined &&
    item.registryDependencies?.includes(dependencyName)
  );
}

test("published aggregate registry matches its item artifacts", async () => {
  assert.equal(publishedRegistry.$schema, registry.$schema);
  assert.equal(publishedRegistry.name, registry.name);
  assert.equal(publishedRegistry.homepage, registry.homepage);
  assert.deepEqual(
    publishedRegistry.items.map((item) => item.name),
    registry.items.map((item) => item.name)
  );

  for (const publishedItem of publishedRegistry.items) {
    const itemArtifact = JSON.parse(
      await readFile(
        path.join(
          registryDirectory,
          "public",
          "r",
          `${publishedItem.name}.json`
        ),
        "utf8"
      )
    );
    const expectedPublishedItem = Object.fromEntries(
      Object.entries(itemArtifact).filter(([key]) => key !== "$schema")
    );
    expectedPublishedItem.files = itemArtifact.files.map((file) =>
      Object.fromEntries(
        Object.entries(file).filter(([key]) => key !== "content")
      )
    );

    assert.deepEqual(
      publishedItem,
      expectedPublishedItem,
      `published aggregate entry is stale for ${publishedItem.name}`
    );
  }
});

for (const itemName of checkedItemNames) {
  const item = itemsByName.get(itemName);
  assert.ok(item, `registry item ${itemName} is missing`);

  test(`${itemName} committed artifact matches registry.json`, async () => {
    const artifact = JSON.parse(
      await readFile(
        path.join(registryDirectory, "public", "r", `${itemName}.json`),
        "utf8"
      )
    );
    const expectedFiles = item.files.map(
      ({ path: sourcePath, target, type }) => ({
        path: sourcePath,
        target,
        type,
      })
    );
    const actualFiles = artifact.files.map(
      ({ path: sourcePath, target, type }) => ({
        path: sourcePath,
        target,
        type,
      })
    );

    assert.deepEqual(actualFiles, expectedFiles);
    assert.deepEqual(
      artifact.registryDependencies ?? [],
      item.registryDependencies ?? []
    );

    for (const sourceFile of item.files) {
      const generatedFile = artifact.files.find(
        (candidate) => candidate.target === sourceFile.target
      );
      assert.ok(generatedFile, `${itemName}: missing ${sourceFile.target}`);
      const source = await readFile(
        path.resolve(registryDirectory, sourceFile.path),
        "utf8"
      );
      assert.equal(
        generatedFile.content,
        source,
        `${itemName}: generated content is stale for ${sourceFile.target}`
      );
    }
  });

  test(`${itemName} imports resolve through its registry dependency closure`, async () => {
    const itemTargets = new Set(item.files.map((file) => file.target));

    for (const sourceFile of item.files) {
      const source = await readFile(
        path.resolve(registryDirectory, sourceFile.path),
        "utf8"
      );

      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith(".")) {
          const resolvedTarget = path.posix.normalize(
            path.posix.join(path.posix.dirname(sourceFile.target), specifier)
          );
          if (targetComesFromRegistryDependency(item, resolvedTarget)) {
            continue;
          }
          assertTargetExists({
            importer: sourceFile.target,
            itemName,
            specifier: resolvedTarget,
            targets: itemTargets,
          });
          continue;
        }

        if (!specifier.startsWith(workspaceComponentPrefix)) {
          continue;
        }
        const componentPath = specifier.slice(workspaceComponentPrefix.length);
        const dependencyName = componentPath.split("/", 1)[0];
        const dependency = itemsByName.get(dependencyName);
        if (!dependency || dependencyName === itemName) {
          continue;
        }

        assert.ok(
          item.registryDependencies?.includes(dependencyName),
          `${itemName}: ${sourceFile.target} imports ${specifier} without declaring registry dependency ${dependencyName}`
        );
        assertTargetExists({
          importer: sourceFile.target,
          itemName,
          specifier: `components/${componentPath}`,
          targets: new Set(dependency.files.map((file) => file.target)),
        });
      }
    }
  });
}
