import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex h-12 w-full items-center justify-center rounded-full bg-accent text-base font-semibold text-white disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex h-12 w-full items-center justify-center rounded-full border border-ink bg-white text-base font-semibold disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export const controlClass = "h-14 w-full rounded-2xl border border-line bg-white px-4 outline-none focus:border-ink";

export function Banner({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  const color = tone === "error" ? "bg-red-50 text-clay" : "bg-moss text-pine";
  return <div className={`rounded-2xl px-4 py-3 text-sm ${color}`}>{children}</div>;
}

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <p className="splash-mark text-2xl font-semibold text-pine">Barbogasto</p>
    </div>
  );
}

export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Cargando">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-[68px]" />
      ))}
    </div>
  );
}
