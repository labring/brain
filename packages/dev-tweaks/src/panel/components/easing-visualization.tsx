import type { EasingConfig } from "../store/dev-tweaks-store";

interface EasingVisualizationProps {
  easing: EasingConfig;
}

const easingPresets: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

export function EasingVisualization({ easing }: EasingVisualizationProps) {
  const ease = easing.ease;

  const s = 200;
  const pad = 10;
  const inner = s - pad * 2;
  const unit = inner / 2; // [-0.5, 1.5] = 2 units on each axis

  // Equal scaling on both axes → 45° diagonal. [0,1] centered in [-0.5, 1.5].
  const toSvg = (nx: number, ny: number) => ({
    x: pad + (nx + 0.5) * unit,
    y: pad + (1.5 - ny) * unit,
  });

  const start = toSvg(0, 0);
  const end = toSvg(1, 1);
  const p1 = toSvg(ease[0], ease[1]);
  const p2 = toSvg(ease[2], ease[3]);

  const curvePath = `M ${start.x} ${start.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${end.x} ${end.y}`;

  return (
    <svg
      aria-hidden="true"
      className="dev-tweaks-spring-viz dev-tweaks-easing-viz"
      preserveAspectRatio="xMidYMid slice"
      viewBox={`0 0 ${s} ${s}`}
    >
      <line
        stroke="rgba(255, 255, 255, 0.15)"
        strokeDasharray="4,4"
        strokeWidth="1"
        x1={start.x}
        x2={end.x}
        y1={start.y}
        y2={end.y}
      />

      <path
        d={curvePath}
        fill="none"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export { easingPresets };
