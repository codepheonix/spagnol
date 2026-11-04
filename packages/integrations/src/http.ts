import { ProviderError } from "./contract";

export interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
  text: string;
}

/**
 * Minimal fetch wrapper with timeout, JSON handling and 429/5xx classification.
 * It never logs request bodies or headers (they may contain credentials).
 */
export async function http<T = unknown>(url: string, opts: HttpOptions = {}): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body = opts.body ?? null;
  if (opts.json !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new ProviderError(`Network error calling provider: ${(err as Error).message}`, { category: "network", retryable: true });
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data: data as T, text };
}

export function retryAfterSeconds(headers: Headers): number | undefined {
  const v = headers.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(1, Math.round((date - Date.now()) / 1000)) : undefined;
}

export function classifyHttpError(res: HttpResponse, message: string, providerRequestId?: string): ProviderError {
  const s = res.status;
  if (s === 401) return new ProviderError(message, { category: "auth_expired", retryable: false, status: s, providerRequestId });
  if (s === 403) return new ProviderError(message, { category: "permission", retryable: false, status: s, providerRequestId });
  if (s === 404) return new ProviderError(message, { category: "not_found", retryable: false, status: s, providerRequestId });
  if (s === 429)
    return new ProviderError(message, {
      category: "rate_limited",
      retryable: true,
      retryAfterSeconds: retryAfterSeconds(res.headers) ?? 60,
      status: s,
      providerRequestId,
    });
  if (s >= 500) return new ProviderError(message, { category: "provider_error", retryable: true, status: s, providerRequestId });
  if (s >= 400) return new ProviderError(message, { category: "validation", retryable: false, status: s, providerRequestId });
  return new ProviderError(message, { category: "unknown", retryable: false, status: s, providerRequestId });
}
