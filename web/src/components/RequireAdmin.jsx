// RequireAdmin.jsx — gate for admin-only screens. A non-admin can never reach an
// admin URL directly: signed-out → /signin; a plain operator → their dashboard.
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function RequireAdmin({ children }) {
  const { operator, sessionReady } = useAuth();
  if (!sessionReady) return null;
  const location = useLocation();
  if (!operator) return <Navigate to="/signin" state={{ from: location }} replace />;
  if (operator.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}
