import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatSpanishDate } from "../../shared/text";
import { ApiError, api, type Member } from "../lib/api";
import { Banner, PageLoading, SecondaryButton } from "../components/ui";
import { useSession } from "../session";

export function SettingsPage() {
  const { me, setMe } = useSession();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [invites, setInvites] = useState<{ id: string; expires_at: string; used_at: string | null }[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || "standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;

  function load() {
    api.members().then((data) => {
      setMembers(data.members);
      setMembersLoaded(true);
    }).catch(() => setMembersLoaded(true));
    api.invites().then((data) => {
      setInvites(data.invitations);
      setInvitesLoaded(true);
    }).catch(() => setInvitesLoaded(true));
  }
  useEffect(load, []);

  async function invite() {
    setError("");
    try {
      const created = await api.createInvite();
      const url = `${location.origin}/invitar/${created.token}`;
      setLink(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setMessage("Enlace copiado. Caduca en 7 días y solo puede usarse una vez.");
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se ha podido crear la invitación.");
    }
  }

  async function enablePush() {
    setError("");
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setError("Este navegador no puede recibir notificaciones push. Verás el aviso al abrir la aplicación.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("No se ha concedido el permiso.");
      const { publicKey } = await api.pushKey();
      if (!publicKey) throw new Error("Falta la clave pública VAPID en el servidor.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.subscribe(subscription.toJSON());
      if (me) setMe({ ...me, pushEnabled: true });
      setMessage("Recordatorio mensual activado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se han podido activar.");
    }
  }

  async function disablePush() {
    await api.unsubscribe();
    if (me) setMe({ ...me, pushEnabled: false });
    setMessage("Notificaciones desactivadas. El aviso seguirá apareciendo en la aplicación a fin de mes.");
  }

  if (!membersLoaded || !invitesLoaded) {
    return (
      <div className="space-y-5" role="status" aria-label="Cargando">
        <div className="skeleton h-8 w-32" aria-hidden="true" />
        <PageLoading rows={4} />
      </div>
    );
  }

  return (
    <div className="page-enter space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        <p className="text-muted">{me?.name} · {me?.email}</p>
      </header>
      {message && <Banner>{message}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Grupo</h2>
        {members.map((member) => (
          <p key={member.id} className="rounded-2xl bg-card px-4 py-3">{member.name} <span className="text-muted">· {member.role === "owner" ? "creó el grupo" : member.email}</span></p>
        ))}
        <button className="h-12 w-full rounded-full bg-accent font-semibold text-white" type="button" onClick={invite}>Invitar a alguien</button>
        {link && <p className="break-all rounded-2xl bg-card px-4 py-3 text-sm">{link}</p>}
        {invites.filter((inviteRow) => !inviteRow.used_at).map((inviteRow) => (
          <p key={inviteRow.id} className="text-sm text-muted">Invitación abierta hasta {formatSpanishDate(inviteRow.expires_at.slice(0, 10))}</p>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recordatorio de fin de mes</h2>
        {ios && (
          <Banner>
            En iPhone, añade Barbogasto a la pantalla de inicio. Las notificaciones push solo funcionan desde el icono, en iOS 16.4 o posterior, después de conceder el permiso.
            {standalone ? " La aplicación ya está en la pantalla de inicio." : ""}
          </Banner>
        )}
        {me?.pushEnabled ? (
          <SecondaryButton type="button" onClick={disablePush}>Desactivar notificaciones</SecondaryButton>
        ) : (
          <SecondaryButton type="button" onClick={enablePush}>Activar notificaciones</SecondaryButton>
        )}
        <p className="text-sm text-muted">Si el push no está disponible, el aviso aparece en Inicio el último día del mes y durante la semana siguiente.</p>
      </section>
      <SecondaryButton type="button" onClick={() => api.logout().then(() => { setMe(null); navigate("/login"); })}>Cerrar sesión</SecondaryButton>
    </div>
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}
