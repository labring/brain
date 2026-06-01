"use client";

import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { Cpu } from "lucide-react";
import { useState } from "react";

function replicaSuffix(value: number) {
  return value === 1 ? " Replica" : " Replicas";
}

export default function SettingsSliderPreview() {
  const [replicas, setReplicas] = useState(3);
  const [target, setTarget] = useState(80);

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Default">
        <div className="w-full max-w-md rounded-lg bg-white/5 px-3 pt-2.5 pb-3">
          <SettingsSlider
            ariaLabel="Replica count"
            formatBound={(value) =>
              `${value} ${value === 1 ? "Replica" : "Replicas"}`
            }
            label="Number of Replicas"
            max={10}
            maxDecimals={0}
            min={1}
            onValueChange={setReplicas}
            step={1}
            value={replicas}
            valueSuffix={replicaSuffix}
          />
        </div>
      </Preview>

      <Preview title="Compound header">
        <div className="w-full max-w-md rounded-lg bg-white/5 px-3 pt-2.5 pb-3">
          <SettingsSlider.Root
            formatBound={(value) => `${value}%`}
            max={100}
            maxDecimals={0}
            min={1}
            onValueChange={setTarget}
            step={1}
            value={target}
            valueSuffix="%"
          >
            <SettingsSlider.Stack>
              <SettingsSlider.Header>
                <SettingsSlider.Group>
                  <Cpu
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <SettingsSlider.Label>CPU target</SettingsSlider.Label>
                </SettingsSlider.Group>
                <SettingsSlider.Value />
              </SettingsSlider.Header>
              <SettingsSlider.Control aria-label="CPU utilization target">
                <SettingsSlider.Track>
                  <SettingsSlider.Range />
                </SettingsSlider.Track>
                <SettingsSlider.Thumb />
              </SettingsSlider.Control>
              <SettingsSlider.Bounds />
            </SettingsSlider.Stack>
          </SettingsSlider.Root>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
