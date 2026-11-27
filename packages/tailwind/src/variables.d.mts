export function resolveVariables(
  value: string,
  lookup: (name: string) => string | null | undefined,
): string | null
