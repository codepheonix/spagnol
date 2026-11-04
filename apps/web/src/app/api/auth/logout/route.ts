import { cookies } from "next/headers";
import { handle, json } from "@/lib/api";
import { logout, SESSION_COOKIE } from "@/lib/auth";

export const POST = handle(async () => {
  await logout();
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
});
