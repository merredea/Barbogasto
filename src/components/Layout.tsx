import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

const items = [
  { to: "/", label: "Inicio", icon: HomeIcon, active: (path: string) => path === "/" },
  { to: "/saldos", label: "Saldos", icon: ScaleIcon, active: (path: string) => path === "/saldos" },
  { to: "/gastos", label: "Historial", icon: ListIcon, active: (path: string) => path === "/gastos" || /^\/gastos\/[^/]+$/.test(path) },
] as const;

export function Layout() {
  const { pathname } = useLocation();
  const adding = pathname === "/gastos/nuevo" || pathname.endsWith("/editar");
  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-white">
      <main key={pathname} className="page-enter px-5 pb-32 pt-8">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20">
        <div className="relative mx-auto max-w-md border-t border-[#ebebeb] bg-white pb-[env(safe-area-inset-bottom)]">
          {!adding && (
            <Link
              to="/gastos/nuevo"
              aria-label="Añadir gasto"
              className="absolute bottom-[calc(100%+10px)] left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_16px_rgba(255,56,92,0.35)]"
            >
              <PlusIcon />
            </Link>
          )}
          <div className="flex">
            {items.map((item) => (
              <Tab key={item.to} item={item} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}

function Tab({ item, pathname }: { item: (typeof items)[number]; pathname: string }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/" || item.to === "/gastos"}
      className={`flex flex-1 flex-col items-center gap-1 px-1 py-3 text-center text-xs font-medium leading-tight ${item.active(pathname) ? "text-ink" : "text-muted"}`}
    >
      <Icon />
      {item.label}
    </NavLink>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7h12M8 12h12M8 17h12" />
      <path d="M4 7h.01M4 12h.01M4 17h.01" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v18M5 8h14M7 8l-3 6h6L7 8zm10 0-3 6h6l-3-6z" />
    </svg>
  );
}
