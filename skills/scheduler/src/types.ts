export interface Reminder {
  readonly id: string;
  readonly text: string;
  readonly firesAt: string;
  readonly status: "pending" | "delivered" | "cancelled";
}

export interface ReminderStore {
  pending(): Promise<readonly Reminder[]>;
  add(text: string, firesAt: Date): Promise<Reminder>;
  cancel(id: string): Promise<boolean>;
  markDelivered(id: string): Promise<void>;
}
