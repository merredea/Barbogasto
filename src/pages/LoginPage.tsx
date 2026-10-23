import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { Banner, Field, PrimaryButton, controlClass } from "../components/ui";
import { useSession } from "../session";

export function LoginPage() {
  const navigate = useNavigate();
  const { setMe } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      setMe(await api.login(email, password));
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se ha podido entrar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="Entra en Barbogastos" subtitle="Los gastos solo los ve quien tiene cuenta.">
      <form className="space-y-4" onSubmit={submit}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label="Email">
          <input className={controlClass} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input className={controlClass} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <PrimaryButton type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        ¿Primera vez? <Link className="font-semibold text-pine" to="/registro">Crear cuenta</Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center bg-paper px-5 py-10">
      <p className="text-sm font-semibold text-accent">Barbogasto</p>
      <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
