import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatCents, formatSignedCents } from "../../shared/money";
import { formatSpanishDate, joinNames, todayIsoLocal } from "../../shared/text";
import { api, type BalanceMember, type Expense, type Transfer } from "../lib/api";
import { Banner, PageLoading } from "../components/ui";
import { useSession } from "../session";

export function HomePage() {
  const { me } = useSession();
  const [mine, setMine] = useState<BalanceMember | null>(null);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [reminder, setReminder] = useState("");

  useEffect(() => {
    api.balances().then((data) => {
      setMine(data.members.find((member) => member.userId === me?.id) ?? null);
      setTransfers(data.transfers);
      setBalancesLoaded(true);
    }).catch(() => setBalancesLoaded(true));
    api.expenses(5).then((data) => setExpenses(data.expenses)).catch(() => setExpenses([]));
    api.reminder().then((data) => setReminder(data.show ? data.message : "")).catch(() => undefined);
  }, [me?.id]);

  const net = mine?.netCents ?? 0;
  const today = formatSpanishDate(todayIsoLocal());
  const sentence = net < 0 ? `Debes ${formatCents(-net)}` : net > 0 ? `Te deben ${formatCents(net)}` : "Estás al día";
  const tone = net > 0 ? "text-gain" : net < 0 ? "text-clay" : "text-ink";

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted">{today}</p>
        <h1 className="text-[32px] font-semibold leading-tight">Hola, {me?.name.split(" ")[0]}</h1>
      </header>
      {reminder && (
        <Banner>
          <p>{reminder}</p>
          <div className="mt-3 flex gap-3">
            <Link className="font-semibold underline" to="/saldos">Ver saldos</Link>
            <button className="font-semibold" onClick={() => api.dismissReminder().then(() => setReminder(""))}>Ahora no</button>
          </div>
        </Banner>
      )}
      <section>
        {balancesLoaded ? (
          <>
            <p className={`text-base ${tone}`}>{sentence}</p>
            <p className={`mt-1 text-5xl font-semibold tracking-tight ${tone}`}>{formatSignedCents(net)}</p>
          </>
        ) : (
          <div className="skeleton h-[84px]" aria-hidden="true" />
        )}
      </section>
      <Link to="/gastos/nuevo" className="flex h-12 items-center justify-center rounded-full bg-accent text-base font-semibold text-white">
        Añadir gasto
      </Link>
      <section>
        <h2 className="mb-3 text-xl font-semibold tracking-tight">Transferencias sugeridas</h2>
        {!balancesLoaded ? (
          <PageLoading rows={1} />
        ) : transfers.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm">No hay deudas pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {transfers.map((transfer) => (
              <li key={`${transfer.fromId}-${transfer.toId}`} className="rounded-2xl bg-card px-4 py-3">
                <p className="font-medium">{transfer.fromName} paga a {transfer.toName}</p>
                <p className="text-sm text-muted">{formatCents(transfer.amountCents)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Últimos gastos</h2>
          <Link className="text-sm font-semibold underline underline-offset-2" to="/gastos">Ver historial</Link>
        </div>
        {expenses === null ? <PageLoading rows={2} /> : <ExpenseList expenses={expenses} empty="Todavía no hay gastos." />}
      </section>
    </div>
  );
}

export function ExpenseList({ expenses, empty, people = false }: { expenses: Expense[]; empty: string; people?: boolean }) {
  if (expenses.length === 0) return <p className="rounded-2xl bg-card px-4 py-3 text-sm">{empty}</p>;
  return (
    <ul className="space-y-3">
      {expenses.map((expense) => (
        <li key={expense.id}>
          <Link to={`/gastos/${expense.id}`} className="block rounded-2xl bg-card px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted">{formatSpanishDate(expense.expenseDate)}</p>
                <p className="truncate text-lg font-semibold tracking-tight">{expense.merchant || expense.description}</p>
                <p className="text-sm text-muted">Pagó {expense.payerName}</p>
                {people && <p className="text-sm text-muted">Para {joinNames(expense.participants.map((person) => person.name))}</p>}
              </div>
              <p className="text-lg font-semibold tracking-tight">{formatCents(expense.totalCents, expense.currency)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
