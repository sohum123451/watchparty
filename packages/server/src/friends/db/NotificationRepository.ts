import crypto from "node:crypto";
import { NotificationRow } from "../../auth/db/schema.js";

export interface INotificationRepository {
  createNotification(data: {
    userId: string;
    type: string;
    actorId?: string | null;
    actorName?: string | null;
    payload?: Record<string, any>;
  }): Promise<NotificationRow>;

  getUserNotifications(userId: string, limit?: number): Promise<NotificationRow[]>;
  getUnreadCount(userId: string): Promise<number>;
  markAsRead(notificationId: string, userId: string): Promise<boolean>;
  markAllAsRead(userId: string): Promise<number>;
  deleteNotification(notificationId: string, userId: string): Promise<boolean>;
  deleteAllUserNotifications(userId: string): Promise<number>;
}

export class MemoryNotificationRepository implements INotificationRepository {
  private notifications: Map<string, NotificationRow> = new Map();

  public async createNotification(data: {
    userId: string;
    type: string;
    actorId?: string | null;
    actorName?: string | null;
    payload?: Record<string, any>;
  }): Promise<NotificationRow> {
    const id = crypto.randomUUID();
    const row: NotificationRow = {
      id,
      userId: data.userId,
      type: data.type,
      actorId: data.actorId ?? null,
      actorName: data.actorName ?? null,
      payload: data.payload ? JSON.stringify(data.payload) : null,
      read: false,
      createdAt: new Date(),
    };

    this.notifications.set(id, row);
    return { ...row };
  }

  public async getUserNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
    const results: NotificationRow[] = [];
    for (const row of this.notifications.values()) {
      if (row.userId === userId) {
        results.push({ ...row });
      }
    }
    // Sort descending by createdAt
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.slice(0, limit);
  }

  public async getUnreadCount(userId: string): Promise<number> {
    let count = 0;
    for (const row of this.notifications.values()) {
      if (row.userId === userId && !row.read) {
        count++;
      }
    }
    return count;
  }

  public async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const row = this.notifications.get(notificationId);
    if (row && row.userId === userId) {
      row.read = true;
      return true;
    }
    return false;
  }

  public async markAllAsRead(userId: string): Promise<number> {
    let updated = 0;
    for (const row of this.notifications.values()) {
      if (row.userId === userId && !row.read) {
        row.read = true;
        updated++;
      }
    }
    return updated;
  }

  public async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const row = this.notifications.get(notificationId);
    if (row && row.userId === userId) {
      this.notifications.delete(notificationId);
      return true;
    }
    return false;
  }

  public async deleteAllUserNotifications(userId: string): Promise<number> {
    let count = 0;
    for (const [id, row] of this.notifications.entries()) {
      if (row.userId === userId) {
        this.notifications.delete(id);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.notifications.clear();
  }
}
