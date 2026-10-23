import { useEffect, useState } from "react";
import { api, type Expense } from "../lib/api";
import { PageLoading } from "../components/ui";
import { ExpenseList } from "./HomePage";

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  useEffect(() => {
    api.expenses(10000).then((data) => setExpenses(data.expenses)).catch(() => setExpenses([]));
  }, []);

  if (expenses === null) {
    return (
      <div className="space-y-5" role="status" aria-label="Cargando">
        <div className="skeleton h-8 w-40" aria-hidden="true" />
        <PageLoading rows={6} />
      </div>
    );
  }

  const groups = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const month = expense.expenseDate.slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(expense);
    groups.set(month, list);
  }

  return (
    <div className="page-enter space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Historial</h1>
        <p className="text-sm text-muted">{expenses.length === 1 ? "1 gasto" : `${expenses.length} gastos`}</p>
      </header>
      {expenses.length === 0 ? (
        <ExpenseList expenses={[]} empty="Todavía no hay gastos." />
      ) : (
        [...groups.entries()].map(([month, monthExpenses]) => (
          <section key={month} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{monthTitle(month)}</h2>
            <ExpenseList expenses={monthExpenses} empty="" people />
          </section>
        ))
      )}
    </div>
  );
}

function monthTitle(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
