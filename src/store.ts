export interface Order { id: string; email: string; totalCents: number; currency: string; status: 'pending' | 'paid' | 'refunded'; crmContactId?: string }

/** In-memory store. Idempotency: each webhook event id is processed at most once. */
export class Store {
  orders = new Map<string, Order>();
  seenEvents = new Set<string>();
  /** returns false if the event was already processed */
  markEvent(id: string): boolean {
    if (this.seenEvents.has(id)) return false;
    this.seenEvents.add(id);
    return true;
  }
}
