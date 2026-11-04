import { prisma } from "@sm/db";
import { localToUtc } from "@sm/core";

export interface BulkRow { line: number; body: string; link?: string; date?: string; time?: string; accounts: string[]; scheduledAt?: string; errors: string[]; }

/** CSV columns: body, accounts (semicolon-separated account ids or display names), date (YYYY-MM-DD), time (HH:mm), link. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function validateBulk(brandId: string, csv: string, timezone: string): Promise<BulkRow[]> {
  const rows = parseCsv(csv);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const accounts = await prisma.socialAccount.findMany({ where: { brandId, status: "connected" } });
  const out: BulkRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const get = (n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? "").trim() : "");
    const errors: string[] = [];
    const body = get("body");
    if (!body) errors.push("body is empty");
    const accs = get("accounts").split(";").map((s) => s.trim()).filter(Boolean).map((s) => accounts.find((a) => a.id === s || a.displayName.toLowerCase() === s.toLowerCase() || a.username?.toLowerCase() === s.toLowerCase()));
    if (!accs.length || accs.some((a) => !a)) errors.push("unknown or missing account(s)");
    let scheduledAt: string | undefined;
    const date = get("date"), time = get("time");
    if (date || time) {
      try { scheduledAt = localToUtc(date, time || "09:00", timezone).toISOString(); if (new Date(scheduledAt) < new Date()) errors.push("date/time is in the past"); } catch { errors.push("invalid date/time"); }
    }
    const key = `${body}|${accs.map((a) => a?.id).join(",")}|${scheduledAt ?? ""}`;
    if (seen.has(key)) errors.push("duplicate row");
    seen.add(key);
    out.push({ line: i + 2, body, link: get("link") || undefined, date, time, accounts: accs.filter((a): a is NonNullable<typeof a> => !!a).map((a) => a.id), scheduledAt, errors });
  });
  return out;
}

