export type TurnstileValidationOptions = {
  expectedAction: string;
  expectedHostname: string;
  requireExpectedHostname: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidTurnstileSiteverifyResponse(
  value: unknown,
  options: TurnstileValidationOptions,
): boolean {
  if (!isRecord(value)) return false;
  if (value.success !== true) return false;
  if (value.action !== options.expectedAction) return false;
  if (options.requireExpectedHostname && value.hostname !== options.expectedHostname) return false;
  return true;
}
