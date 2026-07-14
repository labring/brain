export interface DeployTaskDisplayEvent {
  message: string | null;
  phase: string | null;
  seq: number;
}

const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI terminal output includes ESC bytes.
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const CONTROL_CHARS_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deploy logs can contain raw terminal control bytes.
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const OVERWRITE_RE = /\[[0-9]+D\[[Jj]/g;
const WHITESPACE_RE = /\s+/g;
const SPINNER_ONLY_RE = /^[\s.·•\-=|/\\◐◓◑◒■◇]+$/;
const MAX_EVENT_MESSAGE_LENGTH = 120;
const MAX_ERROR_MESSAGE_LENGTH = 240;
const MAX_DISPLAY_EVENTS = 3;

function compactText(value: string): string {
  return value
    .replace(ANSI_ESCAPE_RE, "")
    .replace(OVERWRITE_RE, "")
    .replace(CONTROL_CHARS_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function summarizeDeployTaskText(
  value: string | null | undefined,
  maxLength = MAX_EVENT_MESSAGE_LENGTH
): string | null {
  const text = compactText(value ?? "");
  if (text === "") {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function summarizeDeployTaskError(
  value: string | null | undefined
): string | null {
  return summarizeDeployTaskText(value, MAX_ERROR_MESSAGE_LENGTH);
}

function isUsefulDisplayEvent(event: DeployTaskDisplayEvent): boolean {
  const message = summarizeDeployTaskText(event.message);
  if (message == null) {
    return false;
  }
  return !SPINNER_ONLY_RE.test(message);
}

export function deployTaskDisplayEvents(
  events: DeployTaskDisplayEvent[] | undefined,
  limit = MAX_DISPLAY_EVENTS
): DeployTaskDisplayEvent[] {
  return (events ?? [])
    .filter(isUsefulDisplayEvent)
    .slice(-limit)
    .map((event) => ({
      ...event,
      message: summarizeDeployTaskText(event.message),
    }));
}
