function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deployTaskFailureSummary(error: unknown): string {
  const message = errorMessage(error);
  if (
    message.includes("No valid skills found") ||
    message.includes("Skills require a SKILL.md")
  ) {
    return "Deploy skill installation failed.";
  }
  if (message.includes("Timed out waiting for deploy Devbox runtime")) {
    return "Timed out waiting for deploy runtime.";
  }
  if (message.includes("BuildKit build could not start")) {
    return "BuildKit build could not start.";
  }
  if (message.includes("Codex gateway completed without deployment output")) {
    return "Codex gateway completed without deployment output.";
  }
  return "Deployment task failed.";
}
