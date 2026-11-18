/**
 * Outbound-request guard for addresses a user can influence (a self-hosted server URL, a link to
 * fetch). Without it the server could be pointed at its own network: cloud metadata, a database,
 * an admin panel. Rules: https only, a host name (never an IP literal), no credentials in the URL,
 * and every address the name resolves to must be public.
 *
 * Known limit: the name is resolved here and again by the HTTP client, so a hostile DNS server
 * could answer differently the second time. Callers also refuse redirects and cap response size.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderError } from "./contract";

/** Replaceable in tests. */
export const resolver = { lookup: (host: string) => dnsLookup(host, { all: true, verbatim: true }) };

function ipv4IsPublic(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

export function ipIsPublic(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsPublic(ip);
  if (kind !== 6) return false;
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4IsPublic(mapped[1]!);
  if (v === "::" || v === "::1") return false;
  if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v)) return false; // unique-local, link-local, multicast
  if (v.startsWith("64:ff9b:") || v.startsWith("2001:db8:")) return false; // NAT64, documentation
  return true;
}

const refuse = (why: string): never => {
  throw new ProviderError(`That server address cannot be used: ${why}.`, { category: "validation", retryable: false });
};

/** Returns the normalised origin of a user-supplied server URL, or throws. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("it is not a web address");
  }
  if (url.protocol !== "https:") refuse("it must start with https://");
  if (url.username || url.password) refuse("it must not contain a user name or password");
  if (url.port && url.port !== "443") refuse("only the standard https port is allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) refuse("use the server's name, not a numeric address");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i.test(host)) refuse("it is not a public host name");
  let addrs: Array<{ address: string }>;
  try {
    addrs = await resolver.lookup(host);
  } catch {
    return refuse("its name could not be found");
  }
  if (!addrs.length || !addrs.every((a) => ipIsPublic(a.address))) refuse("it points to a private network");
  return url;
}

/** Reads a response body up to a limit, so a hostile server cannot exhaust memory. */
export async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ProviderError("The server's answer was too large.", { category: "provider_error", retryable: false });
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError("The server's answer was too large.", { category: "provider_error", retryable: false });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
