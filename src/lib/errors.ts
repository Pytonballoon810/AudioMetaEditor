const IPC_ERROR_PREFIX_REGEX = /^\[([^\]]+)\]\s*(.*)$/;

export function toUserErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.trim();
  if (!message) {
    return fallbackMessage;
  }

  const prefixedMatch = message.match(IPC_ERROR_PREFIX_REGEX);
  if (!prefixedMatch) {
    return message;
  }

  const [, channel, detail] = prefixedMatch;
  const normalizedDetail = (detail ?? '').trim();
  if (!normalizedDetail) {
    return `${fallbackMessage} (${channel})`;
  }

  // Keep the technical channel for debugging, but place user-facing detail first.
  return `${normalizedDetail} (${channel})`;
}
