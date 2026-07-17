"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCollectionTarget, removeCollectionTarget } from "@/lib/queries/collection-priority";

export async function saveCollectionTargetAction(input: {
  businessPartnerId: string;
  targetDate: string | null;
  targetAmount: number | null;
  note: string | null;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await setCollectionTarget({ ...input, userId });
  revalidatePath("/aging");
}

export async function removeCollectionTargetAction(businessPartnerId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await removeCollectionTarget(businessPartnerId);
  revalidatePath("/aging");
}
