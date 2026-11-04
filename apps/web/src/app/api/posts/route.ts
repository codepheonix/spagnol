import { prisma, type PostStatus } from "@sm/db";
import { createPost, postInputSchema } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const status = url.searchParams.get("status") as PostStatus | null;
  const posts = await prisma.post.findMany({ where: { brandId: brand.id, status: status ?? undefined }, orderBy: { updatedAt: "desc" }, take: 100, include: { targets: { include: { socialAccount: { select: { id: true, provider: true, displayName: true, backend: true } } } }, media: { include: { media: { select: { id: true, mimeType: true, originalName: true } } } } } });
  return json({ posts });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const body = await req.json();
  const brand = await apiBrand(user, body?.brandId ?? null);
  const input = await parseJson(new Request(req.url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), postInputSchema);
  const post = await createPost(user.id, brand.id, input);
  return json({ post }, { status: 201 });
});
