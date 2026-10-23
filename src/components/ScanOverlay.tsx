export type ScanStage = "preparing" | "uploading" | "reading";

const STAGE_LABEL: Record<ScanStage, string> = {
  preparing: "Preparando la foto…",
  uploading: "Subiendo la foto…",
  reading: "Gemini está leyendo el ticket…",
};

/** Ticket ilustrado, estilo vectorial y sin valores: solo líneas genéricas. */
function ReceiptArt() {
  const lines: { y: number; width: number }[] = [
    { y: 84, width: 120 },
    { y: 108, width: 152 },
    { y: 132, width: 96 },
    { y: 156, width: 140 },
    { y: 180, width: 112 },
  ];
  return (
    <svg className="scan-art" viewBox="0 0 240 300" role="img" aria-label="Ilustración de un ticket">
      <path
        d="M24 6 h192 v262 l-12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 -12 -10 -12 10 V6 Z"
        fill="#ffffff"
        stroke="#ebebeb"
        strokeWidth="2"
      />
      <circle cx="120" cy="44" r="18" fill="#ffe4e9" />
      <path d="M112 44 l6 6 10 -12" stroke="#ff385c" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {lines.map((line) => (
        <rect key={line.y} x={120 - line.width / 2} y={line.y} width={line.width} height="10" rx="5" fill="#f1f1f1" />
      ))}
      <line x1="44" y1="212" x2="196" y2="212" stroke="#e5e5e5" strokeWidth="2" strokeDasharray="6 6" />
      <rect x="76" y="230" width="88" height="14" rx="7" fill="#ffe4e9" />
    </svg>
  );
}

/**
 * Carga a pantalla completa mientras se escanea un ticket.
 * El porcentaje solo aparece durante la subida, que es la única fase con
 * progreso real (bytes enviados); la lectura con Gemini no lo tiene y se
 * muestra como indeterminada, sin inventar números.
 */
export function ScanOverlay({ stage, progress }: { stage: ScanStage; progress: number | null }) {
  const percent = stage === "uploading" && progress != null ? Math.round(progress * 100) : null;
  return (
    <div className="scan-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="scan-card">
        <div className="scan-art-wrap">
          <ReceiptArt />
          <div className="scan-beam" aria-hidden="true" />
        </div>
        <p className="scan-title">Leyendo tu ticket</p>
        <p className="scan-stage">{STAGE_LABEL[stage]}</p>
        <div className="scan-bar" aria-hidden="true">
          {percent != null ? (
            <div className="scan-bar-fill" style={{ width: `${percent}%` }} />
          ) : (
            <div className="scan-bar-fill scan-bar-indeterminate" />
          )}
        </div>
        <p className="scan-percent">{percent != null ? `${percent} %` : " "}</p>
      </div>
    </div>
  );
}
