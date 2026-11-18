/**
 * Where to go after sign-in or a confirmation. Only a path on this site is accepted: it must start
 * with one "/" and not continue with "/" or "\" (browsers read "//host" and "/\host" as another site).
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !/^\/(?![/\\])/.test(value) || /[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
