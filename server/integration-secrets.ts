// Remember values for redaction for the life of the process, even after disconnect.
// Connection modules hold their own active secrets; nothing here is persisted.
const values = new Set<string>();
export function registerIntegrationSecret(value?: string) {
  if (value && value.length >= 8) values.add(value);
}
export function redactIntegrationSecrets(input: string) {
  let text = input;
  for (const value of values) text = text.split(value).join("[REDACTED]");
  return text.replace(
    /(?:github_pat_[\w]{20,}|gh[pousr]_[\w]{20,}|[ps]k-lf-[\w-]{12,}|wb_[\w-]{30,})/g,
    "[REDACTED]",
  );
}
