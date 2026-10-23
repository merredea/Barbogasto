import { normalizeTicket, type TicketDraft } from "../../shared/ticket";
import type { Env } from "../env";
import { ApiError } from "./http";

const PROMPT = `Lee esta fotografía de un ticket o factura y responde solo JSON.
No inventes datos. Si un campo no se lee con seguridad, usa null y marca el booleano *Confident correspondiente como false.
Los importes van en céntimos enteros: 12,50 euros son 1250. Nunca uses decimales.
quantityMillis es la cantidad por 1000 (una unidad = 1000). Si no aparece, null.
date es YYYY-MM-DD o null. currency es el código ISO de 3 letras o null.
items incluye solo productos: ni el total, ni el desglose de IVA u otros impuestos.
lineCents es el importe final de la línea tal como se paga, con el IVA ya incluido cuando el ticket lo incluye (lo habitual en España).
totalCents es el importe total final del ticket, lo que se paga.
taxRatePercent es el tipo de IVA de la línea si el ticket lo muestra junto a ella (0, 4, 10 o 21); null si no se ve.
taxCents es solo informativo: la app nunca lo suma como una línea aparte. En tickets con IVA incluido en los precios (lo habitual en España) usa null aunque el ticket muestre un desglose de IVA; en facturas con base imponible + IVA, indica el IVA total.
discountCents y tipCents son importes positivos en céntimos, o null si no aparecen.
unreadable es una lista corta de lo que no has podido leer.
Si la imagen no es un ticket, deja los valores a null.

Formato:
{
  "merchant": string | null,
  "merchantConfident": boolean,
  "date": string | null,
  "dateConfident": boolean,
  "currency": string | null,
  "currencyConfident": boolean,
  "items": [{ "name": string, "quantityMillis": number | null, "unitPriceCents": number | null, "lineCents": number | null, "taxRatePercent": number | null, "confident": boolean }],
  "subtotalCents": number | null,
  "taxCents": number | null,
  "discountCents": number | null,
  "tipCents": number | null,
  "totalCents": number | null,
  "totalConfident": boolean,
  "unreadable": string[]
}`;

export async function readTicket(env: Env, bytes: Uint8Array, mime: string): Promise<TicketDraft> {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, "ia_no_disponible", "La lectura de tickets no está configurada. Puedes introducir el gasto manualmente.");
  }
  const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  let base64 = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    base64 += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  base64 = btoa(base64);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT }, { inlineData: { mimeType: mime, data: base64 } }],
        },
      ],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
    }),
  });
  base64 = "";
  if (!response.ok) {
    console.error(`gemini ${response.status}`);
    throw new ApiError(503, "ia_no_disponible", "No se ha podido leer el ticket. Puedes introducir el gasto manualmente.");
  }
  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  try {
    return normalizeTicket(JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/```$/, "")));
  } catch {
    throw new ApiError(503, "ia_no_disponible", "La respuesta del ticket no se ha podido interpretar. Puedes introducirlo manualmente.");
  }
}
