import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, type Me } from "./lib/api";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  setMe: (me: Me | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api.me().then(setMe).catch(() => setMe(null));
  }, []);
  return (
    <SessionContext.Provider value={{ me: me ?? null, loading: me === undefined, setMe }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("sesión");
  return value;
}
