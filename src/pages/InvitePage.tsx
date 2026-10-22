import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { Banner, Splash } from "../components/ui";
import { RegisterPage } from "./RegisterPage";
import { useSession } from "../session";

export function InvitePage() {
  const { token = "" } = useParams();
  const { me } = useSession();
  const [preview, setPreview] = useState<{ groupName: string; inviterName: string } | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api.previewInvite(token).then(setPreview).catch((caught) => {
      setPreview(null);
      setError(caught instanceof ApiError ? caught.message : "Invitación no válida.");
    });
  }, [token]);

  if (me) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center bg-paper px-5">
        <Banner>Ya estás en el grupo.</Banner>
        <Link className="mt-6 text-center font-semibold text-pine" to="/">Ir al inicio</Link>
      </div>
    );
  }
  if (preview === undefined) return <Splash />;
  if (!preview) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center bg-paper px-5">
        <Banner tone="error">{error}</Banner>
        <Link className="mt-6 text-center font-semibold text-pine" to="/login">Entrar</Link>
      </div>
    );
  }
  return (
    <div>
      <p className="bg-moss px-5 py-3 text-center text-sm text-pine">{preview.inviterName} te invita a {preview.groupName}</p>
      <RegisterPage inviteToken={token} />
    </div>
  );
}
