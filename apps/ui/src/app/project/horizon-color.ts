/**
 * Minimal CSS color parsing + OKLab conversion for the horizon WebGL engine
 * (AIM-77). Handles only the formats our tokens actually use — the Tailwind
 * v4 oklch palette, hex/rgb fallbacks, `color(srgb …)` — not general CSS.
 *
 * The shader interpolates gradient stops in premultiplied OKLab (CSS Images 4
 * behavior for non-legacy color stops), so parsing lands on OKLab and the
 * sRGB/Display-P3 conversions mirror the GLSL constants in horizon-webgl.
 */

export interface OklabColor {
  a: number;
  alpha: number;
  b: number;
  l: number;
}

export type OutputColorSpace = "display-p3" | "srgb";

/** Clamp to the [0, 1] range colors and alphas live in. */
export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

const HEX_SHORT_LENGTH = 3;
const HEX_LONG_LENGTH = 6;
const HEX_ALPHA_LENGTH = 8;

const srgbTransferEncode = (c: number): number =>
  c <= 0.003_130_8 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;

const srgbTransferDecode = (c: number): number =>
  c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export function linearSrgbToOklab(
  r: number,
  g: number,
  b: number,
  alpha = 1
): OklabColor {
  const l = Math.cbrt(
    0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b
  );
  const m = Math.cbrt(
    0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b
  );
  const s = Math.cbrt(
    0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b
  );
  return {
    a: 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    alpha,
    b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    l: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
  };
}

export function srgbToOklab(
  r: number,
  g: number,
  b: number,
  alpha = 1
): OklabColor {
  return linearSrgbToOklab(
    srgbTransferDecode(r),
    srgbTransferDecode(g),
    srgbTransferDecode(b),
    alpha
  );
}

/** Unclamped — out-of-gamut oklab yields components outside [0, 1]. */
export function oklabToLinearSrgb(color: OklabColor): [number, number, number] {
  const l = color.l + 0.396_337_777_4 * color.a + 0.215_803_757_3 * color.b;
  const m = color.l - 0.105_561_345_8 * color.a - 0.063_854_172_8 * color.b;
  const s = color.l - 0.089_484_177_5 * color.a - 1.291_485_548 * color.b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    4.076_741_662_1 * l3 - 3.307_711_591_3 * m3 + 0.230_969_929_2 * s3,
    -1.268_438_004_6 * l3 + 2.609_757_401_1 * m3 - 0.341_319_396_5 * s3,
    -0.004_196_086_3 * l3 - 0.703_418_614_7 * m3 + 1.707_614_701 * s3,
  ];
}

const LINEAR_SRGB_TO_P3 = [
  0.822_462_1, 0.177_538, 0, 0.033_194_1, 0.966_805_8, 0, 0.017_082_7,
  0.072_397_4, 0.910_519_9,
] as const;

/**
 * OKLab → gamma-encoded output color, gamut-clamped per channel. Display-P3
 * shares the sRGB transfer curve, so the spaces differ only by the linear
 * primaries matrix.
 */
export function oklabToGamma(
  color: OklabColor,
  space: OutputColorSpace
): [number, number, number] {
  let [r, g, b] = oklabToLinearSrgb(color);
  if (space === "display-p3") {
    const m = LINEAR_SRGB_TO_P3;
    const [sr, sg, sb] = [r, g, b];
    r = m[0] * sr + m[1] * sg + m[2] * sb;
    g = m[3] * sr + m[4] * sg + m[5] * sb;
    b = m[6] * sr + m[7] * sg + m[8] * sb;
  }
  return [
    srgbTransferEncode(clamp01(r)),
    srgbTransferEncode(clamp01(g)),
    srgbTransferEncode(clamp01(b)),
  ];
}

const SLASH_PATTERN = /\//g;
const COMPONENT_SEPARATOR_PATTERN = /[\s,]+/;

const splitComponents = (body: string): string[] =>
  body
    .replace(SLASH_PATTERN, " / ")
    .split(COMPONENT_SEPARATOR_PATTERN)
    .filter((part) => part.length > 0);

const parseAlphaComponent = (raw: string | undefined): number => {
  if (raw === undefined) {
    return 1;
  }
  const value = raw.endsWith("%")
    ? Number.parseFloat(raw) / 100
    : Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp01(value) : 1;
};

/** Splits "L C H / A"-style bodies into numbers plus an optional alpha. */
const parseNumericBody = (body: string): { alpha: number; parts: string[] } => {
  const segments = splitComponents(body);
  const slash = segments.indexOf("/");
  if (slash === -1) {
    return { alpha: 1, parts: segments };
  }
  return {
    alpha: parseAlphaComponent(segments[slash + 1]),
    parts: segments.slice(0, slash),
  };
};

const parseHex = (hex: string): OklabColor | null => {
  const body = hex.slice(1);
  const expand =
    body.length === HEX_SHORT_LENGTH
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  if (expand.length !== HEX_LONG_LENGTH && expand.length !== HEX_ALPHA_LENGTH) {
    return null;
  }
  const channel = (i: number) =>
    Number.parseInt(expand.slice(i * 2, i * 2 + 2), 16) / 255;
  const alpha = expand.length === HEX_ALPHA_LENGTH ? channel(3) : 1;
  return srgbToOklab(channel(0), channel(1), channel(2), alpha);
};

const parseLightness = (raw: string): number =>
  raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);

const parseOklch = (body: string): OklabColor | null => {
  const { alpha, parts } = parseNumericBody(body);
  const [rawL, rawC, rawH] = parts;
  if (rawL === undefined || rawC === undefined || rawH === undefined) {
    return null;
  }
  const l = parseLightness(rawL);
  const c = Number.parseFloat(rawC);
  const h = Number.parseFloat(rawH);
  if (!(Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h))) {
    return null;
  }
  const hueRad = (h * Math.PI) / 180;
  return { a: c * Math.cos(hueRad), alpha, b: c * Math.sin(hueRad), l };
};

const parseOklabFn = (body: string): OklabColor | null => {
  const { alpha, parts } = parseNumericBody(body);
  const [rawL, rawA, rawB] = parts;
  if (rawL === undefined || rawA === undefined || rawB === undefined) {
    return null;
  }
  const l = parseLightness(rawL);
  const a = Number.parseFloat(rawA);
  const b = Number.parseFloat(rawB);
  if (!(Number.isFinite(l) && Number.isFinite(a) && Number.isFinite(b))) {
    return null;
  }
  return { a, alpha, b, l };
};

const parseRgb = (body: string): OklabColor | null => {
  const parsed = parseNumericBody(body);
  const [rawR, rawG, rawB, rawA] = parsed.parts;
  if (rawR === undefined || rawG === undefined || rawB === undefined) {
    return null;
  }
  // Legacy comma syntax carries alpha as a fourth component, no slash.
  const alpha = rawA === undefined ? parsed.alpha : parseAlphaComponent(rawA);
  const channel = (raw: string) =>
    raw.endsWith("%")
      ? Number.parseFloat(raw) / 100
      : Number.parseFloat(raw) / 255;
  const [r, g, b] = [channel(rawR), channel(rawG), channel(rawB)];
  if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) {
    return null;
  }
  return srgbToOklab(r, g, b, alpha);
};

const parseColorFn = (body: string): OklabColor | null => {
  const { alpha, parts } = parseNumericBody(body);
  const [space, rawR, rawG, rawB] = parts;
  if (
    space !== "srgb" ||
    rawR === undefined ||
    rawG === undefined ||
    rawB === undefined
  ) {
    return null;
  }
  const [r, g, b] = [
    Number.parseFloat(rawR),
    Number.parseFloat(rawG),
    Number.parseFloat(rawB),
  ];
  if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) {
    return null;
  }
  return srgbToOklab(r, g, b, alpha);
};

const FUNCTION_PATTERN = /^([a-z3-]+)\((.*)\)$/;

/** Parses the CSS color formats our tokens use; null when unrecognized. */
export function parseCssColorToOklab(input: string): OklabColor | null {
  const text = input.trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }
  if (text === "transparent") {
    return { a: 0, alpha: 0, b: 0, l: 0 };
  }
  if (text.startsWith("#")) {
    return parseHex(text);
  }
  const match = FUNCTION_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const [, fn, body] = match;
  if (fn === undefined || body === undefined) {
    return null;
  }
  switch (fn) {
    case "color":
      return parseColorFn(body);
    case "oklab":
      return parseOklabFn(body);
    case "oklch":
      return parseOklch(body);
    case "rgb":
    case "rgba":
      return parseRgb(body);
    default:
      return null;
  }
}
