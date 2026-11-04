import { prisma } from "@sm/db";
import { getAiConfig } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { PostEditor } from "@/components/PostEditor";

export default async function NewPostPage() {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id, status: { not: "disconnected" } }, select: { id: true, provider: true, displayName: true, backend: true, status: true } });
  const media = await prisma.mediaAsset.findMany({ where: { brandId: brand.id, status: "ready" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, originalName: true, mimeType: true } });
  return (
    <div>
      <h1>New post — {brand.name}</h1>
      <PostEditor brandId={brand.id} accounts={accounts} media={media} timezone={brand.timezone} aiEnabled={Boolean(await getAiConfig())} />
    </div>
  );
}
