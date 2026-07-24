function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deployOutputObjectValue(
  output: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  return output == null ? null : objectValue(output[key]);
}

function deployOutputStringValue(
  output: Record<string, unknown> | null,
  key: string
): string | null {
  return output == null ? null : stringValue(output[key]);
}

export function deployOutputProgressSummary(
  output: Record<string, unknown> | null
): Record<string, unknown> | null {
  const buildResult = deployOutputObjectValue(output, "buildResult");
  const deliveryManifest = deployOutputObjectValue(output, "deliveryManifest");
  const templateYaml = deployOutputStringValue(output, "templateYaml");

  if (buildResult == null && deliveryManifest == null && templateYaml == null) {
    return null;
  }

  return {
    complete:
      buildResult != null && deliveryManifest != null && templateYaml != null,
    files: {
      buildResult: buildResult != null,
      deliveryManifest: deliveryManifest != null,
      template: templateYaml != null,
    },
  };
}
