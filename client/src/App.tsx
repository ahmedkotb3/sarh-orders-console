import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, RefreshCw, LogOut, ShieldCheck, ChevronLeft, ChevronRight, X } from "lucide-react";
import { clearToken, getToken, Order, PageResult, request, saveToken, Status } from "./api";

const statuses: Status[] = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
type User = { id: string; email: string; role: "admin" | "agent" };
type LoginResponse = { token: string; user: User };
type FormItem = { name: string; quantity: string; unitPrice: string };
type CreatePayload = {
  customerName: string;
  customerEmail: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  amount: number;
};
type PendingCreate = { idempotencyKey: string; payload: CreatePayload };
const pendingCreateStorageKey = "sarh-pending-order-create";

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.customerName === "string"
    && typeof payload.customerEmail === "string"
    && Number.isFinite(payload.amount)
    && Array.isArray(payload.items)
    && payload.items.every((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const line = item as Record<string, unknown>;
      return typeof line.name === "string" && Number.isFinite(line.quantity) && Number.isFinite(line.unitPrice);
    });
}

function readPendingCreate(): PendingCreate | null {
  const saved = sessionStorage.getItem(pendingCreateStorageKey);
  if (!saved) return null;
  try {
    const value: unknown = JSON.parse(saved);
    if (typeof value === "object" && value !== null) {
      const pending = value as Record<string, unknown>;
      if (typeof pending.idempotencyKey === "string" && pending.idempotencyKey.length > 0
        && pending.idempotencyKey.length <= 200 && isCreatePayload(pending.payload)) {
        return { idempotencyKey: pending.idempotencyKey, payload: pending.payload };
      }
    }
  } catch {
    sessionStorage.removeItem(pendingCreateStorageKey);
    return null;
  }
  sessionStorage.removeItem(pendingCreateStorageKey);
  return null;
}

function validateCreatePayload(payload: CreatePayload): string | null {
  if (payload.customerName.length < 2 || payload.customerName.length > 120) return "Customer name must be 2-120 characters.";
  if (payload.customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.customerEmail)) return "Enter a valid customer email.";
  if (payload.items.length < 1 || payload.items.length > 5) return "An order must have between 1 and 5 line items.";
  for (const item of payload.items) {
    if (item.name.length < 1 || item.name.length > 120) return "Each item name must be 1-120 characters.";
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) return "Each quantity must be a whole number from 1 to 9999.";
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0.01 || item.unitPrice > 10000000) return "Each unit price must be between 0.01 and 10,000,000.";
  }
  const calculated = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (!Number.isFinite(payload.amount) || payload.amount < 0.01 || payload.amount > 100000000) return "The order total must be between 0.01 and 100,000,000.";
  if (Math.abs(calculated - payload.amount) > 0.011) return "The order total must equal the sum of line items.";
  return null;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function date(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function App() {
  const [pendingCreate, setPendingCreate] = useState(readPendingCreate);
  const [user, setUser] = useState<User | null>(null);
  const [loginEmail, setLoginEmail] = useState("admin@sarh.local");
  const [loginPassword, setLoginPassword] = useState("AdminPass123!");
  const [loginError, setLoginError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "amount">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [resultState, setResultState] = useState<{ queryKey: string; data: PageResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [showCreate, setShowCreate] = useState(Boolean(pendingCreate));
  const [creating, setCreating] = useState(false);
  const [hasUnconfirmedAttempt, setHasUnconfirmedAttempt] = useState(Boolean(pendingCreate));
  const [createError, setCreateError] = useState("");
  const [customerName, setCustomerName] = useState(pendingCreate?.payload.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(pendingCreate?.payload.customerEmail ?? "");
  const [items, setItems] = useState<FormItem[]>(pendingCreate
    ? pendingCreate.payload.items.map(item => ({ name: item.name, quantity: String(item.quantity), unitPrice: String(item.unitPrice) }))
    : [{ name: "", quantity: "1", unitPrice: "" }]);
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);
  const createAttempt = useRef<PendingCreate | null>(pendingCreate);
  const createInProgress = useRef(false);

  const queryKey = new URLSearchParams({
    q, status, sortBy, sortOrder, page: String(page), pageSize: "25"
  }).toString();
  const result = resultState?.queryKey === queryKey ? resultState.data : null;

  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setListError("");
    try {
      const next = await request<PageResult>(`/api/orders?${queryKey}`, { signal });
      if (sequence === requestSequence.current) setResultState({ queryKey, data: next });
    } catch (error) {
      if (signal?.aborted) return;
      if (sequence === requestSequence.current) setListError(error instanceof Error ? error.message : "Could not load orders");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();
    void loadOrders(controller.signal);
    return () => controller.abort();
  }, [loadOrders, user]);

  useEffect(() => {
    if (!getToken()) return;
    request<{ user: User }>("/api/auth/me").then(data => setUser(data.user)).catch(() => {
      clearToken(); setUser(null);
    });
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setLoginError("");
    try {
      const data = await request<LoginResponse>("/api/auth/login", {
        method: "POST", body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      saveToken(data.token); setUser(data.user); setResultState(null); setPage(1);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed");
    }
  };

  const logout = () => {
    clearToken(); setUser(null); setResultState(null); setNotice("");
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const total = useMemo(() => items.reduce((sum, item) => {
    const quantity = Number(item.quantity), unitPrice = Number(item.unitPrice);
    return sum + (Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0);
  }, 0), [items]);

  const createOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (createInProgress.current) return;
    setCreateError("");
    const payload = {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      items: items.map(item => ({
        name: item.name.trim(), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice)
      })),
      amount: Number(total.toFixed(2))
    };
    const validationError = validateCreatePayload(payload);
    if (validationError) { setCreateError(validationError); return; }
    createInProgress.current = true;
    setCreating(true);
    setHasUnconfirmedAttempt(true);
    const previousAttempt = createAttempt.current;
    const attempt = previousAttempt && JSON.stringify(previousAttempt.payload) === JSON.stringify(payload)
      ? previousAttempt
      : { idempotencyKey: crypto.randomUUID(), payload };
    createAttempt.current = attempt;
    try {
      sessionStorage.setItem(pendingCreateStorageKey, JSON.stringify(attempt));
      await request<Order>("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.idempotencyKey },
        body: JSON.stringify(attempt.payload)
      });
      sessionStorage.removeItem(pendingCreateStorageKey);
      createAttempt.current = null;
      setPendingCreate(null);
      setHasUnconfirmedAttempt(false);
      setShowCreate(false); setCustomerName(""); setCustomerEmail("");
      setItems([{ name: "", quantity: "1", unitPrice: "" }]); setPage(1);
      setNotice("Order created successfully.");
      await loadOrders();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Order could not be created");
    } finally {
      createInProgress.current = false;
      setCreating(false);
    }
  };

  if (!user) return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">S</div>
        <p className="eyebrow">SARH BUSINESS SOLUTIONS</p>
        <h1>Orders Console</h1>
        <p className="muted">Sign in to manage operations orders.</p>
        <form onSubmit={login} className="stack">
          <label>Email<input type="email" autoComplete="username" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} /></label>
          {loginError && <div className="alert error">{loginError}</div>}
          <button className="primary full" type="submit">Sign in</button>
        </form>
        <p className="login-hint">Local demo: admin@sarh.local / AdminPass123!</p>
      </section>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark small">S</div><div><strong>SARH</strong><span>Operations console</span></div></div>
        <div className="top-actions"><span className="role"><ShieldCheck size={15} />{user.role}</span><span className="user-email">{user.email}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17} /></button></div>
      </header>
      <section className="page-heading">
        <div><p className="eyebrow">OPERATIONS / ORDERS</p><h1>Orders</h1><p className="muted">Find, review, and register customer orders.</p></div>
        <button className="primary" onClick={() => { setCreateError(""); setShowCreate(true); }}><Plus size={17} /> New order</button>
      </section>
      {notice && <div className="alert success">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14}/></button></div>}
      <section className="stats-row">
        <div className="stat-card"><span>Total matching orders</span><strong>{result?.total.toLocaleString() ?? "—"}</strong><small>Based on current filters</small></div>
        <div className="stat-card"><span>Current page</span><strong>{result ? `${result.data.length} / ${result.pageSize}` : "—"}</strong><small>{loading ? "Refreshing results…" : "Server-paginated"}</small></div>
        <div className="stat-card"><span>Signed in as</span><strong className="role-text">{user.role}</strong><small>{user.role === "admin" ? "Administrative access" : "Order agent access"}</small></div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>All orders</h2><p className="muted">Search customer details and narrow the result set.</p></div><button className="secondary" onClick={() => void loadOrders()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
        <div className="filters">
          <div className="search-box"><Search size={17}/><input aria-label="Search customer name or email" placeholder="Search name or email…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
          <select aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select aria-label="Sort field" value={sortBy} onChange={e => { setSortBy(e.target.value as "createdAt" | "amount"); setPage(1); }}><option value="createdAt">Date created</option><option value="amount">Amount</option></select>
          <button className="secondary sort-button" onClick={() => setSortOrder(old => old === "desc" ? "asc" : "desc")}>{sortOrder === "desc" ? "Newest / highest ↓" : "Oldest / lowest ↑"}</button>
        </div>
        {listError && <div className="alert error">{listError}<button onClick={() => void loadOrders()} className="text-button">Retry</button></div>}
        <div className="table-wrap">
          <table><thead><tr><th>Order / Customer</th><th>Status</th><th>Items</th><th>Amount</th><th>Created</th></tr></thead>
            <tbody>
              {result?.data.map(order => <tr key={order.id}>
                <td><div className="customer-cell"><strong>{order.customerName}</strong><span>{order.customerEmail}</span><small>#{order.id.slice(0, 8).toUpperCase()}</small></div></td>
                <td><span className={`status status-${order.status.toLowerCase()}`}>{order.status}</span></td>
                <td><span className="item-count">{order.items.length} line{order.items.length === 1 ? "" : "s"}</span></td>
                <td className="amount">{money(order.amount)}</td><td className="date-cell">{date(order.createdAt)}</td>
              </tr>)}
              {result && result.data.length === 0 && !loading && <tr><td colSpan={5} className="empty">No orders match these filters.</td></tr>}
              {!result && !listError && <tr><td colSpan={5} className="empty">Loading orders…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>{result ? `Showing ${(result.page - 1) * result.pageSize + (result.data.length ? 1 : 0)}–${(result.page - 1) * result.pageSize + result.data.length} of ${result.total.toLocaleString()}` : "Waiting for results"}</span>
          <div className="pagination"><button className="icon-button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={17}/></button><span>Page {result?.page ?? page} of {result?.totalPages ?? "—"}</span><button className="icon-button" aria-label="Next page" disabled={!result || page >= result.totalPages || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={17}/></button></div>
        </div>
      </section>
      <footer>Orders Console <span>·</span> Local development build <span>·</span> PostgreSQL-backed</footer>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !creating) setShowCreate(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="modal-header"><div><p className="eyebrow">MANUAL ENTRY</p><h2 id="create-title">Create order</h2></div><button className="icon-button" onClick={() => setShowCreate(false)} disabled={creating} aria-label="Close"><X size={18}/></button></div>
          <form onSubmit={createOrder} className="stack create-form">
            <div className="two-col"><label>Customer name<input required minLength={2} maxLength={120} disabled={creating || hasUnconfirmedAttempt} value={customerName} onChange={e => setCustomerName(e.target.value)} /></label><label>Customer email<input required type="email" maxLength={254} disabled={creating || hasUnconfirmedAttempt} value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} /></label></div>
            <div className="items-heading"><h3>Line items</h3><button type="button" className="text-button" disabled={creating || hasUnconfirmedAttempt || items.length >= 5} onClick={() => setItems(old => [...old, { name: "", quantity: "1", unitPrice: "" }])}><Plus size={14}/> Add item</button></div>
            {items.map((item, index) => <div className="item-form-row" key={index}>
              <label>Item name<input required minLength={1} maxLength={120} disabled={creating || hasUnconfirmedAttempt} value={item.name} onChange={e => updateItem(index, "name", e.target.value)} /></label>
              <label>Qty<input required type="number" min="1" max="9999" step="1" disabled={creating || hasUnconfirmedAttempt} value={item.quantity} onChange={e => updateItem(index, "quantity", e.target.value)} /></label>
              <label>Unit price<input required type="number" min="0.01" max="10000000" step="0.01" disabled={creating || hasUnconfirmedAttempt} value={item.unitPrice} onChange={e => updateItem(index, "unitPrice", e.target.value)} /></label>
              <button type="button" className="remove-item" aria-label="Remove item" disabled={creating || hasUnconfirmedAttempt || items.length === 1} onClick={() => setItems(old => old.filter((_, i) => i !== index))}><X size={15}/></button>
            </div>)}
            <div className="total-line"><span>Calculated total</span><strong>{money(total)}</strong></div>
            {createError && <div className="alert error">{createError}</div>}
            <div className="modal-actions"><button type="button" className="secondary" disabled={creating} onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="primary" disabled={creating}>{creating ? "Creating…" : hasUnconfirmedAttempt ? "Retry safely" : "Create order"}</button></div>
            <p className="fine-print">{pendingCreate ? "Unconfirmed submission restored. Retry with these same details to safely resolve it." : "The idempotency key is retained for transport retries and an unconfirmed submission."}</p>
          </form>
        </section>
      </div>}
    </main>
  );
}
