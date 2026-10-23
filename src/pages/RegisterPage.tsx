import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "./LoginPage";
import { ApiError, api } from "../lib/api";
import { Banner, Field, PrimaryButton, controlClass } from "../components/ui";
import { useSession } from "../session";

export function RegisterPage({ inviteToken = "" }: { inviteToken?: string }) {
  const [params] = useSearchParams();
  const token = inviteToken || params.get("invitacion") || "";
  const navigate = useNavigate();
  const { setMe } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      setMe(await api.register({ name, email, password, inviteToken: token || undefined }));
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se ha podido crear la cuenta.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title={token ? "Únete a Barbogastos" : "Crear cuenta"} subtitle={token ? "Esta invitación es de un solo uso." : "Entrarás en la comunidad Barbogastos: verás todos los gastos apuntados hasta hoy y podrás añadir los tuyos."}>
      <form className="space-y-4" onSubmit={submit}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label="Nombre">
          <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Email">
          <input className={controlClass} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input className={controlClass} type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <PrimaryButton type="submit" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        ¿Ya tienes cuenta? <Link className="font-semibold text-pine" to="/login">Entrar</Link>
      </p>
    </AuthShell>
  );
}
