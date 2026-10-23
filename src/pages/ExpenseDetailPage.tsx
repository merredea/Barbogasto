import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatCents, formatQuantity } from "../../shared/money";
import { formatSpanishDate, joinNames } from "../../shared/text";
import { ApiError, api, type Expense, type ExpenseItem } from "../lib/api";
import { Banner, PageLoading, SecondaryButton } from "../components/ui";

export function ExpenseDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [expense, setExpense] = useState<(Expense & { items: ExpenseItem[] }) | null>(null);
  const [error, setError] = useState("");
  const [reconcile, setReconcile] = useState(false);

  useEffect(() => {
    api.expense(id).then(setExpense).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se ha podido abrir el gasto."));
  }, [id]);

  async function remove(confirmed = false) {
    setError("");
    try {
      await api.deleteExpense(id, confirmed);
      navigate("/gastos");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "conciliacion") setReconcile(true);
      else setError(caught instanceof ApiError ? caught.message : "No se ha podido eliminar.");
    }
  }

  if (!expense) return error ? <p className="text-sm text-muted">{error}</p> : <PageLoading rows={3} />;
  return (
    <div className="page-enter space-y-4">
      <Link to="/gastos" className="text-sm font-semibold text-pine">Volver</Link>
      <header>
        <h1 className="text-2xl font-semibold">{expense.merchant || expense.description}</h1>
        <p className="text-muted">{formatSpanishDate(expense.expenseDate)} · pagó {expense.payerName}</p>
        <p className="mt-2 text-3xl font-semibold">{formatCents(expense.totalCents, expense.currency)}</p>
      </header>
      {expense.note && <p className="rounded-2xl bg-card px-4 py-3 text-sm">{expense.note}</p>}
      {error && <Banner tone="error">{error}</Banner>}
      {reconcile && (
        <Banner tone="error">
          <p>Hay pagos anotados de estas personas. Si lo eliminas, los saldos se recalcularán y esos pagos se conservan.</p>
          <button className="mt-2 font-semibold" onClick={() => remove(true)}>Eliminar y recalcular</button>
        </Banner>
      )}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
          {expense.splitMode === "equal" ? "A partes iguales" : "Por productos"} · {joinNames(expense.participants.map((person) => person.name))}
        </h2>
        <ul className="space-y-2">
          {expense.participants.map((person) => (
            <li key={person.userId} className="flex justify-between rounded-2xl bg-card px-4 py-3">
              <span>{person.name}</span>
              <span className="font-semibold">{formatCents(person.shareCents, expense.currency)}</span>
            </li>
          ))}
        </ul>
      </section>
      {expense.items.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Líneas</h2>
          <ul className="space-y-2">
            {expense.items.map((item) => (
              <li key={item.id} className="rounded-2xl bg-card px-4 py-3">
                <div className="flex justify-between gap-3">
                  <p className="font-medium">{item.name}{item.needsReview ? " · revisar" : ""}</p>
                  <p>{formatCents(item.lineCents, expense.currency)}</p>
                </div>
                <p className="text-sm text-muted">
                  {formatQuantity(item.quantityMillis)}
                  {item.allocations.length > 0
                    ? ` · ${item.allocations.map((allocation) => expense.participants.find((person) => person.userId === allocation.userId)?.name ?? "").filter(Boolean).join(", ")}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link to={`/gastos/${expense.id}/editar`} className="flex h-12 items-center justify-center rounded-full bg-accent font-semibold text-white">Editar</Link>
      <SecondaryButton type="button" onClick={() => remove(false)}>Eliminar gasto</SecondaryButton>
    </div>
  );
}
