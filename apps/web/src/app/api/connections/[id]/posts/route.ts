import { prisma } from "@sm/db";
import { adapterFor, buildAccountContext } from "@sm/core";
import { apiUser, handle, HttpError, json } from "@/lib/api";

/** Recent posts of a connected account, read live from the provider (for the Comment → DM post picker). */
export const GET = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!account) throw new HttpError(404, "Account not found.", "not_found");
  const adapter = adapterFor(account);
  if (!adapter.listRecentPosts) return json({ posts: [], unsupported: true });
  const limit = Math.min(50, Number(new URL(req.url).searchParams.get("limit") ?? 25));
  const posts = await adapter.listRecentPosts(await buildAccountContext(account), limit);
  return json({ posts });
});
