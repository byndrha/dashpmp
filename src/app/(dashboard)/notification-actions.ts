"use server";

import { auth } from "@/lib/auth";
import { getNotificationsForUser, markNotificationRead, type NotificationRow } from "@/lib/queries/notifications";

export async function getNotificationsAction(): Promise<NotificationRow[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return getNotificationsForUser(Number(session.user.id), session.user.permissions ?? {});
}

export async function markNotificationReadAction(notificationId: number): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  await markNotificationRead(notificationId, Number(session.user.id));
}
