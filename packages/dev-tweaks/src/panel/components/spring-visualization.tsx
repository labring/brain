import type { ReactElement } from "react";
import type { SpringConfig } from "../store/dev-tweaks-store";
import { springParams, springProgress } from "../transition-math";

interface SpringVisualizationProps {
  isSimpleMode: boolean;
  spring: SpringConfig;
}

export function SpringVisualization({
  spring,
  isSimpleMode,
}: SpringVisualizationProps) {
  const width = 256;
  const height = 140;

  // Same param mapping and closed-form curve as timeline scrubbing, so the
  // preview shows exactly the physics that plays.
  const params = isSimpleMode
    ? springParams({
        type: "spring",
        visualDuration: spring.visualDuration ?? 0.3,
        bounce: spring.bounce ?? 0.2,
      })
    : springParams({
        type: "spring",
        stiffness: spring.stiffness ?? 400,
        damping: spring.damping ?? 17,
        mass: spring.mass ?? 1,
      });

  const duration = 2;
  const steps = 100;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const time = (i / steps) * duration;
    points.push([time, springProgress(time, params)]);
  }

  const values = points.map(([, value]) => value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue;

  const pathData = points
    .map(([time, value], i) => {
      const x = (time / duration) * width;
      const normalizedValue = (value - minValue) / (valueRange || 1);
      const y = height - (normalizedValue * height * 0.6 + height * 0.2);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const gridLines: ReactElement[] = [];
  for (let i = 1; i < 4; i++) {
    const x = (width / 4) * i;
    const y = (height / 4) * i;
    gridLines.push(
      <line
        key={`v-${i}`}
        stroke="rgba(255, 255, 255, 0.08)"
        strokeWidth="1"
        x1={x}
        x2={x}
        y1={0}
        y2={height}
      />,
      <line
        key={`h-${i}`}
        stroke="rgba(255, 255, 255, 0.08)"
        strokeWidth="1"
        x1={0}
        x2={width}
        y1={y}
        y2={y}
      />
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="dev-tweaks-spring-viz"
      viewBox={`0 0 ${width} ${height}`}
    >
      {gridLines}
      <line
        stroke="rgba(255, 255, 255, 0.15)"
        strokeDasharray="4,4"
        strokeWidth="1"
        x1={0}
        x2={width}
        y1={height / 2}
        y2={height / 2}
      />
      <path
        d={pathData}
        fill="none"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
