import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { computeSplit, type AdjustmentMode, type ItemKind, type SplitMode } from "../../shared/expense";
import { centsToInput, formatCents, parseEurosToCents, parseQuantityMillis, uniqueSorted } from "../../shared/money";
import { todayIsoLocal } from "../../shared/text";
import type { TicketDraft } from "../../shared/ticket";
import { ApiError, api, type Member } from "../lib/api";
import { prepareImage } from "../lib/image";
import { Banner, Field, PrimaryButton, SecondaryButton, controlClass } from "../components/ui";
import { useSession } from "../session";

interface LineState {
  key: string;
  name: string;
  quantity: string;
  unitPrice: string;
  line: string;
  kind: ItemKind;
  participantIds: string[];
  needsReview: boolean;
}

type Step = "choice" | "details" | "people" | "confirm";

export function ExpenseFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { me } = useSession();
  const [step, setStep] = useState<Step>(editing ? "details" : "choice");
  const [members, setMembers] = useState<Member[]>([]);
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [total, setTotal] = useState("");
  const [date, setDate] = useState(todayIsoLocal());
  const [payerId, setPayerId] = useState(me?.id ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [lines, setLines] = useState<LineState[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("proportional");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    api.members().then((data) => {
      setMembers(data.members);
      if (!editing) {
        setParticipantIds(data.members.map((member) => member.id));
        setPayerId((current) => current || me?.id || data.members[0]?.id || "");
      }
    }).catch(() => setError("No se han podido cargar las personas."));
  }, [editing, me?.id]);

  useEffect(() => {
    if (!id) return;
    api.expense(id).then((expense) => {
      setDescription(expense.description);
      setMerchant(expense.merchant ?? "");
      setNote(expense.note ?? "");
      setTotal(centsToInput(expense.totalCents));
      setDate(expense.expenseDate);
      setPayerId(expense.payerId);
      setParticipantIds(expense.participants.map((person) => person.userId));
      setSplitMode(expense.splitMode);
      setLines(expense.items.map((item) => ({
        key: item.id,
        name: item.name,
        quantity: String(item.quantityMillis / 1000).replace(".", ","),
        unitPrice: item.unitPriceCents == null ? "" : centsToInput(item.unitPriceCents),
        line: centsToInput(item.lineCents),
        kind: item.kind as ItemKind,
        participantIds: item.allocations.map((allocation) => allocation.userId),
        needsReview: item.needsReview,
      })));
      if (expense.splitMode === "items") {
        const adjustments: Record<string, string> = {};
        for (const person of expense.participants) {
          const allocated = expense.items.flatMap((item) => item.allocations).filter((allocation) => allocation.userId === person.userId).reduce((sum, allocation) => sum + allocation.shareCents, 0);
          adjustments[person.userId] = centsToInput(person.shareCents - allocated);
        }
        setAdjustmentMode("manual");
        setManual(adjustments);
      }
      setLoaded(true);
    }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se ha podido abrir el gasto."));
  }, [id]);

  function toggleParticipant(memberId: string) {
    setParticipantIds((current) => {
      const next = current.includes(memberId) ? current.filter((item) => item !== memberId) : [...current, memberId];
      setLines((rows) => rows.map((row) => ({ ...row, participantIds: row.participantIds.filter((person) => next.includes(person)) })));
      return next;
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError("");
    try {
      const image = await prepareImage(file);
      const draft = await api.scan(image, crypto.randomUUID());
      applyTicket(draft);
      setStep("details");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se ha podido leer el ticket.");
      setStep("details");
    } finally {
      setPending(false);
    }
  }

  function applyTicket(draft: TicketDraft) {
    setMerchant(draft.merchant ?? "");
    setDescription(draft.merchant || "Ticket");
    if (draft.date) setDate(draft.date);
    if (draft.totalCents != null) setTotal(centsToInput(draft.totalCents));
    setWarnings(draft.warnings);
    setLines(draft.items.map((item) => ({
      key: crypto.randomUUID(),
      name: item.name,
      quantity: item.quantityMillis ? String(item.quantityMillis / 1000).replace(".", ",") : "1",
      unitPrice: item.unitPriceCents == null ? "" : centsToInput(item.unitPriceCents),
      line: item.lineCents == null ? "" : centsToInput(item.lineCents),
      kind: item.kind,
      participantIds: [],
      needsReview: item.needsReview,
    })));
    if (draft.items.length > 0) setSplitMode("items");
  }

  function buildBody(forceReconcile = false) {
    const totalCents = parseEurosToCents(total);
    if (totalCents == null || totalCents < 0) throw new Error("Escribe un importe válido, por ejemplo 12,50.");
    if (!description.trim()) throw new Error("Añade una descripción.");
    if (!payerId) throw new Error("Elige quién ha pagado.");
    if (participantIds.length === 0) throw new Error("Elige al menos una persona.");
    const items = lines.map((line) => {
      const lineCents = parseEurosToCents(line.line);
      const quantityMillis = parseQuantityMillis(line.quantity || "1");
      const unitPriceCents = line.unitPrice ? parseEurosToCents(line.unitPrice) : null;
      if (!line.name.trim()) throw new Error("Cada línea necesita un nombre.");
      if (lineCents == null || quantityMillis == null) throw new Error(`Revisa «${line.name}».`);
      const assigned = splitMode === "items" ? (line.participantIds.length ? line.participantIds : participantIds) : [];
      return {
        name: line.name.trim(),
        quantityMillis,
        unitPriceCents,
        lineCents,
        kind: line.kind,
        participantIds: assigned,
        needsReview: line.needsReview,
      };
    });
    const manualAdjustmentCents: Record<string, number> = {};
    if (splitMode === "items" && adjustmentMode === "manual") {
      for (const personId of participantIds) {
        const cents = parseEurosToCents(manual[personId] || "0");
        if (cents == null) throw new Error("Revisa el ajuste manual.");
        manualAdjustmentCents[personId] = cents;
      }
    }
    const draft = {
      description: description.trim(),
      merchant: merchant.trim() || null,
      note: note.trim() || null,
      expenseDate: date,
      currency: "EUR" as const,
      totalCents,
      payerId,
      participantIds: uniqueSorted(participantIds),
      splitMode,
      items,
      adjustmentMode,
      manualAdjustmentCents,
    };
    const split = computeSplit(draft);
    return { body: { ...draft, reconcile: forceReconcile || reconcile }, split };
  }

  const preview = useMemo(() => {
    if (step !== "confirm") return null;
    try {
      return buildBody();
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Revisa el reparto.";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, description, merchant, note, date, total, payerId, participantIds, lines, splitMode, adjustmentMode, manual, reconcile]);

  async function save(forceReconcile = false) {
    setPending(true);
    setError("");
    try {
      const built = buildBody(forceReconcile);
      if (typeof built === "string") throw new Error(built);
      const key = forceReconcile ? crypto.randomUUID() : idempotencyKey;
      const saved = await api.saveExpense(built.body, editing ? crypto.randomUUID() : key, id);
      setIdempotencyKey(crypto.randomUUID());
      navigate(`/gastos/${saved.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "conciliacion") {
        setReconcile(true);
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "No se ha podido guardar.");
      }
    } finally {
      setPending(false);
    }
  }

  if (!loaded) return <p className="text-sm text-muted">{error || "Cargando…"}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{editing ? "Editar gasto" : "Añadir gasto"}</h1>
      {error && <Banner tone="error">{error}</Banner>}
      {step === "choice" && (
        <div className="space-y-3">
          <label className="flex h-12 cursor-pointer items-center justify-center rounded-full bg-accent text-base font-semibold text-white">
            {pending ? "Leyendo ticket…" : "Escanear ticket"}
            <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={pending} onChange={(event) => onFile(event.target.files?.[0])} />
          </label>
          <label className="flex h-12 cursor-pointer items-center justify-center rounded-full border border-ink bg-white text-base font-semibold">
            Elegir una imagen
            <input className="sr-only" type="file" accept="image/*" disabled={pending} onChange={(event) => onFile(event.target.files?.[0])} />
          </label>
          <SecondaryButton type="button" onClick={() => setStep("details")}>Introducir gasto manualmente</SecondaryButton>
          <p className="text-sm text-muted">La foto se envía a Gemini para leerla y no se guarda en Barbogasto. En la cuota gratuita, Google puede usar ese contenido para mejorar sus productos.</p>
        </div>
      )}
      {step === "details" && (
        <div className="space-y-4">
          {warnings.length > 0 && <Banner>{warnings[0]}</Banner>}
          <Field label="Descripción">
            <input className={controlClass} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Establecimiento">
            <input className={controlClass} value={merchant} onChange={(event) => setMerchant(event.target.value)} />
          </Field>
          <Field label="Importe total">
            <input className={controlClass} inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Fecha">
            <input className={controlClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Nota">
            <input className={controlClass} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {lines.map((line) => (
            <div key={line.key} className="space-y-2 rounded-2xl bg-card p-3">
              <input className={controlClass} value={line.name} aria-label="Producto" onChange={(event) => updateLine(line.key, { name: event.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={controlClass} inputMode="decimal" aria-label="Cantidad" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
                <input className={controlClass} inputMode="decimal" aria-label="Importe" value={line.line} onChange={(event) => updateLine(line.key, { line: event.target.value })} />
              </div>
              <button className="text-sm font-semibold text-clay" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Quitar línea</button>
            </div>
          ))}
          <button
            className="text-sm font-semibold text-pine"
            type="button"
            onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), name: "", quantity: "1", unitPrice: "", line: "", kind: "item", participantIds: [], needsReview: false }])}
          >
            Añadir línea
          </button>
          <PrimaryButton type="button" onClick={() => setStep("people")}>Continuar</PrimaryButton>
        </div>
      )}
      {step === "people" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">¿Entre quiénes repartimos este gasto?</h2>
          <Field label="Quién ha pagado">
            <select className={controlClass} value={payerId} onChange={(event) => setPayerId(event.target.value)}>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {members.map((member) => {
              const selected = participantIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  className={`h-12 rounded-xl font-medium ${selected ? "bg-pine text-white" : "bg-card"}`}
                  onClick={() => toggleParticipant(member.id)}
                >
                  {member.name}
                </button>
              );
            })}
          </div>
          <PrimaryButton type="button" onClick={() => setStep("confirm")}>Continuar</PrimaryButton>
          <SecondaryButton type="button" onClick={() => setStep("details")}>Volver</SecondaryButton>
        </div>
      )}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`h-12 rounded-xl font-medium ${splitMode === "equal" ? "bg-pine text-white" : "bg-card"}`} onClick={() => setSplitMode("equal")}>A partes iguales</button>
            <button type="button" className={`h-12 rounded-xl font-medium ${splitMode === "items" ? "bg-pine text-white" : "bg-card"}`} onClick={() => setSplitMode("items")}>Por productos</button>
          </div>
          {splitMode === "items" && lines.map((line) => (
            <div key={line.key} className="rounded-2xl bg-card p-3">
              <p className="font-medium">{line.name || "Línea"} · {line.line || "0,00"} €</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {participantIds.map((personId) => {
                  const member = members.find((item) => item.id === personId);
                  const selected = (line.participantIds.length ? line.participantIds : participantIds).includes(personId);
                  return (
                    <button
                      key={personId}
                      type="button"
                      className={`rounded-full px-3 py-1 text-sm ${selected ? "bg-pine text-white" : "bg-paper"}`}
                      onClick={() => {
                        const current = line.participantIds.length ? line.participantIds : [...participantIds];
                        const next = current.includes(personId) ? current.filter((item) => item !== personId) : [...current, personId];
                        updateLine(line.key, { participantIds: next });
                      }}
                    >
                      {member?.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {splitMode === "items" && (
            <div className="flex gap-2">
              <button type="button" className={`h-10 flex-1 rounded-xl text-sm ${adjustmentMode === "proportional" ? "bg-ink text-white" : "bg-card"}`} onClick={() => setAdjustmentMode("proportional")}>Impuestos proporcionales</button>
              <button type="button" className={`h-10 flex-1 rounded-xl text-sm ${adjustmentMode === "manual" ? "bg-ink text-white" : "bg-card"}`} onClick={() => setAdjustmentMode("manual")}>Ajuste manual</button>
            </div>
          )}
          {splitMode === "items" && adjustmentMode === "manual" && participantIds.map((personId) => (
            <Field key={personId} label={`Ajuste de ${members.find((member) => member.id === personId)?.name}`}>
              <input className={controlClass} inputMode="decimal" value={manual[personId] ?? "0,00"} onChange={(event) => setManual((current) => ({ ...current, [personId]: event.target.value }))} />
            </Field>
          ))}
          {preview && typeof preview !== "string" ? (
            <ul className="space-y-2">
              {preview.split.shares.map((share) => (
                <li key={share.userId} className="flex justify-between rounded-2xl bg-card px-4 py-3">
                  <span>{members.find((member) => member.id === share.userId)?.name}</span>
                  <span className="font-semibold">{formatCents(share.shareCents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Banner tone="error">{typeof preview === "string" ? preview : "Revisa el reparto."}</Banner>
          )}
          {reconcile && <Banner tone="error">Confirma para recalcular los saldos. Los pagos ya anotados se conservan.</Banner>}
          <PrimaryButton type="button" disabled={pending || typeof preview === "string"} onClick={() => save(reconcile)}>{pending ? "Guardando…" : "Guardar gasto"}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => setStep("people")}>Volver</SecondaryButton>
        </div>
      )}
    </div>
  );

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
}
