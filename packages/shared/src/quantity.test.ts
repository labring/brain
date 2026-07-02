import assert from "node:assert/strict";
import { test } from "node:test";

import { BinaryScale, Quantity } from "./index";

// Display a stored quantity string as a Gi number (<=2 decimals, trimmed),
// mirroring how StorageSizeInput shows a stored value.
function gi(stored: string): string {
  return Quantity.parse(stored)
    .formatForDisplay({
      format: "BinarySI",
      scale: BinaryScale.Gibi,
      digits: 2,
    })
    .replace("Gi", "");
}

test("write path: a Gi value canonicalizes to the same string the backend stores", () => {
  // 0.1Gi is not a whole number of bytes, so K8s uses the milli suffix — this is
  // exactly what SealOS-created PVCs look like (storage: 107374182400m).
  assert.equal(Quantity.parse("0.1Gi").toString(), "107374182400m");
  assert.equal(Quantity.parse("0.5Gi").toString(), "512Mi");
  assert.equal(Quantity.parse("1Gi").toString(), "1Gi");
  assert.equal(Quantity.parse("1.5Gi").toString(), "1536Mi");
  assert.equal(Quantity.parse("20Gi").toString(), "20Gi");
  assert.equal(Quantity.parse("100Gi").toString(), "100Gi");
});

test("read path: any stored K8s form displays as a Gi number with <=2 decimals", () => {
  assert.equal(gi("107374182400m"), "0.1");
  assert.equal(gi("512Mi"), "0.5");
  assert.equal(gi("256Mi"), "0.25");
  assert.equal(gi("128Mi"), "0.13"); // 0.125 rounded to 2dp
  assert.equal(gi("2Ti"), "2048");
  assert.equal(gi("10Gi"), "10");
});

test("expand-only compare matches the backend's resource.Quantity.Cmp", () => {
  // grow: 0.5Gi > 0.1Gi (stored as 107374182400m)
  assert.equal(Quantity.parse("0.5Gi").cmp(Quantity.parse("107374182400m")), 1);
  // shrink: 0.1Gi < 0.5Gi (stored as 512Mi)
  assert.equal(Quantity.parse("0.1Gi").cmp(Quantity.parse("512Mi")), -1);
  // equal across forms: 0.5Gi === 512Mi
  assert.equal(Quantity.parse("0.5Gi").cmp(Quantity.parse("512Mi")), 0);
});
