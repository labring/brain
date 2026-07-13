import { Suspense } from "react";
import { GlassEquivalenceFixture } from "./glass-equivalence-fixture";

export const metadata = {
  title: "Glass equivalence fixture",
};

export default function GlassEquivalencePage() {
  return (
    <Suspense fallback={null}>
      <GlassEquivalenceFixture />
    </Suspense>
  );
}
