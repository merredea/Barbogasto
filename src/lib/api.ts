import type { TicketDraft } from "../../shared/ticket";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  pushEnabled: boolean;
  group: { id: string; name: string; currency: string; timezone: string };
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
}

export interface ExpenseParticipant {
  userId: string;
  name: string;
  shareCents: number;
}

export interface ExpenseItem {
  id: string;
  name: string;
  quantityMillis: number;
  unitPriceCents: number | null;
  lineCents: number;
  kind: string;
  needsReview: boolean;
  allocations: { userId: string; shareCents: number }[];
}

export interface Expense {
  id: string;
  description: string;
  merchant: string | null;
  note: string | null;
  expenseDate: string;
  currency: string;
  totalCents: number;
  payerId: string;
  payerName: string;
  splitMode: "equal" | "items";
  participants: ExpenseParticipant[];
  items?: ExpenseItem[];
}

export interface BalanceMember {
  userId: string;
  name: string;
  netCents: number;
  paidCents: number;
  shareCents: number;
}

export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amountCents: number;
}

export interface Settlement {
  id: string;
  payerId: string;
  payerName: string;
  receiverId: string;
  receiverName: string;
  amountCents: number;
  paidOn: string;
  note: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit; idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers();
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  } else {
    body = init.body;
  }
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const response = await fetch(path, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "include",
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string; message?: string }) : {};
  if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) onUnauthorized();
  if (!response.ok) throw new ApiError(response.status, data.error ?? "error", data.message ?? "No se ha podido completar la operación.");
  return data as T;
}

export const api = {
  me: () => request<Me>("/api/auth/me"),
  login: (email: string, password: string) => request<Me>("/api/auth/login", { json: { email, password } }),
  register: (input: { name: string; email: string; password: string; inviteToken?: string }) =>
    request<Me>("/api/auth/register", { json: input }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { json: {} }),
  members: () => request<{ members: Member[] }>("/api/members"),
  invites: () => request<{ invitations: { id: string; expires_at: string; used_at: string | null; created_at: string }[] }>("/api/invitations"),
  createInvite: () => request<{ token: string; expiresAt: string }>("/api/invitations", { json: {} }),
  previewInvite: (token: string) => request<{ groupName: string; inviterName: string; expiresAt: string }>(`/api/invitations/${token}`),
  expenses: (limit = 200) => request<{ expenses: Expense[] }>(`/api/expenses?limit=${limit}`),
  expense: (id: string) => request<Expense & { items: ExpenseItem[] }>(`/api/expenses/${id}`),
  saveExpense: (body: unknown, idempotencyKey: string, id?: string) =>
    request<Expense>(id ? `/api/expenses/${id}` : "/api/expenses", { method: id ? "PUT" : "POST", json: body, idempotencyKey }),
  deleteExpense: (id: string, reconcile = false) =>
    request<{ ok: boolean }>(`/api/expenses/${id}${reconcile ? "?reconcile=1" : ""}`, { method: "DELETE" }),
  balances: () => request<{ members: BalanceMember[]; transfers: Transfer[]; settlements: Settlement[] }>("/api/balances"),
  createSettlement: (body: unknown, idempotencyKey: string) =>
    request<{ id: string }>("/api/settlements", { json: body, idempotencyKey }),
  deleteSettlement: (id: string) => request<{ ok: boolean }>(`/api/settlements/${id}`, { method: "DELETE" }),
  scan: (file: Blob, idempotencyKey: string) => {
    const form = new FormData();
    form.append("image", file, "ticket.jpg");
    return request<TicketDraft>("/api/tickets/scan", { body: form, idempotencyKey });
  },
  pushKey: () => request<{ publicKey: string | null }>("/api/push/key"),
  subscribe: (subscription: PushSubscriptionJSON) => request<{ ok: boolean }>("/api/push/subscribe", { json: subscription }),
  unsubscribe: () => request<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE" }),
  reminder: () => request<{ show: boolean; message: string; period?: string }>("/api/reminder"),
  dismissReminder: () => request<{ ok: boolean }>("/api/reminder/dismiss", { json: {} }),
};
