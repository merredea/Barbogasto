import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatCents, formatSignedCents } from "../../shared/money";
import { todayIsoLocal } from "../../shared/text";
import { ApiError, api, type BalanceMember, type Transfer } from "../lib/api";
import { Banner, PageLoading } from "../components/ui";
import { useSession } from "../session";

export function BalancesPage() {
  const { me } = useSession();
  const [members, setMembers] = useState<BalanceMember[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [reminder, setReminder] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reminderLoaded, setReminderLoaded] = useState(false);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState<string | null>(null);

  function load() {
    return api.balances().then((data) => {
      setMembers(data.members);
      setTransfers(data.transfers);
      setLoaded(true);
    });
  }

  useEffect(() => {
    load().catch(() => {
      setLoaded(true);
      setError("No se han podido cargar los saldos.");
    });
    api.reminder().then((data) => {
      setReminder(data.show ? data.message : "");
      setReminderLoaded(true);
    }).catch(() => setReminderLoaded(true));
  }, [me?.id]);

  async function markPaid(transfer: Transfer) {
    const key = `${transfer.fromId}-${transfer.toId}`;
    setPaying(key);
    setError("");
    try {
      await api.createSettlement(
        {
          payerId: transfer.fromId,
          receiverId: transfer.toId,
          amountCents: transfer.amountCents,
          paidOn: todayIsoLocal(),
          note: "Liquidación",
        },
        crypto.randomUUID(),
      );
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se ha podido marcar como pagada.");
    } finally {
      setPaying(null);
    }
  }

  if (!loaded || !reminderLoaded) {
    return (
      <div className="space-y-5" role="status" aria-label="Cargando">
        <div className="skeleton h-8 w-32" aria-hidden="true" />
        <PageLoading rows={4} />
      </div>
    );
  }

  return (
    <div className="page-enter space-y-5">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Saldos</h1>
        <Link className="text-sm font-semibold text-pine" to="/ajustes">Ajustes</Link>
      </header>
      {error && <Banner tone="error">{error}</Banner>}
      {reminder && (
        <Banner>
          <p>{reminder}</p>
          <button className="mt-3 font-semibold" onClick={() => api.dismissReminder().then(() => setReminder(""))}>Ahora no</button>
        </Banner>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Para quedar en paz</h2>
        <p className="text-sm text-muted">Al marcar una deuda como pagada, el saldo se vuelve a calcular con todos los gastos.</p>
        {transfers.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm">No hay deudas. El grupo está equilibrado.</p>
        ) : (
          <ul className="space-y-2">
            {transfers.map((transfer) => {
              const key = `${transfer.fromId}-${transfer.toId}`;
              return (
                <li key={key} className="rounded-2xl bg-card px-4 py-3">
                  <p className="font-medium">{transfer.fromName} paga a {transfer.toName}</p>
                  <p className="text-sm text-muted">{formatCents(transfer.amountCents)}</p>
                  <button
                    className="mt-3 h-12 w-full rounded-full bg-accent text-sm font-semibold text-white disabled:opacity-50"
                    type="button"
                    disabled={paying !== null}
                    onClick={() => markPaid(transfer)}
                  >
                    {paying === key ? "Liquidando…" : "Marcar como pagada"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Posición de cada persona</h2>
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between rounded-2xl bg-card px-4 py-3">
              <div>
                <p className="font-medium">{member.name}{member.userId === me?.id ? " · tú" : ""}</p>
                <p className={`text-sm ${member.netCents > 0 ? "text-gain" : member.netCents < 0 ? "text-clay" : "text-muted"}`}>{member.netCents < 0 ? "Debe" : member.netCents > 0 ? "Le deben" : "En paz"}</p>
              </div>
              <p className={`font-semibold ${member.netCents > 0 ? "text-gain" : member.netCents < 0 ? "text-clay" : ""}`}>{formatSignedCents(member.netCents)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
