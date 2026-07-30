import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type { BillingMeteredPrice } from "./billing-pricing-data";

const PRICES: BillingMeteredPrice[] = [
  {
    hourlyPriceMicroUnits: 10_000,
    label: "CPU",
    billingBasis: "duration",
    sourceName: "cpu",
    type: "cpu",
    unit: "vCPU",
  },
  {
    hourlyPriceMicroUnits: 20_480,
    label: "Memory",
    billingBasis: "duration",
    sourceName: "memory",
    type: "memory",
    unit: "GiB",
  },
  {
    hourlyPriceMicroUnits: 2,
    label: "Network traffic",
    billingBasis: "quantity",
    sourceName: "network",
    type: "network",
    unit: "MiB",
  },
  {
    hourlyPriceMicroUnits: 750_000,
    label: "NVIDIA A100",
    billingBasis: "duration",
    sourceName: "gpu-a100",
    type: "gpu",
    unit: "GPU",
  },
];

async function withTestDom(run: (act: typeof actAndDrain) => Promise<void>) {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    await run(actAndDrain);
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
}

function editNumberInput(input: Element | undefined, value: string) {
  if (input == null) {
    return;
  }
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value } });
  fireEvent.keyUp(input, { key: value.at(-1) ?? "0" });
}

test("calculator updates timed resources and one-time traffic in cluster currency", async () => {
  await withTestDom(async (act) => {
    const { BillingCalculator } = await import("./billing-pricing");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingCalculator
            currency="usd"
            gpuEnabled={false}
            prices={PRICES}
          />
        );
      });

      assert.ok(rendered?.getByText("$0.030480"));
      await act(() => {
        editNumberInput(rendered?.getByLabelText("CPU"), "2");
        editNumberInput(rendered?.getByLabelText("Duration"), "2");
        editNumberInput(rendered?.getByLabelText("Network traffic"), "100");
      });

      assert.ok(rendered?.getByText("$0.081160"));
      assert.equal(rendered?.queryByLabelText("GPU count"), null);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("calculator includes GPU controls and pricing only when enabled", async () => {
  await withTestDom(async (act) => {
    const { BillingCalculator } = await import("./billing-pricing");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingCalculator currency="usd" gpuEnabled prices={PRICES} />
        );
      });

      assert.ok(rendered?.getByLabelText("GPU model"));
      await act(() => {
        editNumberInput(rendered?.getByLabelText("GPU count"), "1");
      });
      assert.ok(rendered?.getByText("$0.780480"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
