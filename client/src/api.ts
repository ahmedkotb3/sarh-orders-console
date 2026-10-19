export type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED";
export type LineItem = { id?: string; name: string; quantity: number; unitPrice: number };
export type Order = {
  id: string; customerName: string; customerEmail: string; status: Status;
  amount: number; createdAt: string; items: LineItem[];
};
export type PageResult = { data: Order[]; page: number; pageSize: number; total: number; totalPages: number };
const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function saveToken(token: string) { sessionStorage.setItem("sarh-demo-token", token); }
export function getToken() { return sessionStorage.getItem("sarh-demo-token"); }
export function clearToken() { sessionStorage.removeItem("sarh-demo-token"); }

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as T;
}
