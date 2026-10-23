import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Splash } from "./components/ui";
import { BalancesPage } from "./pages/BalancesPage";
import { ExpenseDetailPage } from "./pages/ExpenseDetailPage";
import { ExpenseFormPage } from "./pages/ExpenseFormPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useSession } from "./session";

export function App() {
  const { me, loading } = useSession();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (loading) return <Splash />;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/" replace /> : <div className="page-enter"><LoginPage /></div>} />
      <Route path="/registro" element={me ? <Navigate to="/" replace /> : <div className="page-enter"><RegisterPage /></div>} />
      <Route path="/invitar/:token" element={<div className="page-enter"><InvitePage /></div>} />
      <Route element={me ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/gastos" element={<ExpensesPage />} />
        <Route path="/gastos/nuevo" element={<ExpenseFormPage />} />
        <Route path="/gastos/:id" element={<ExpenseDetailPage />} />
        <Route path="/gastos/:id/editar" element={<ExpenseFormPage />} />
        <Route path="/saldos" element={<BalancesPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={me ? "/" : "/login"} replace />} />
    </Routes>
  );
}
