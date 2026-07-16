// RequireOperator.jsx — gate for operator-only screens (Dashboard / Log / History).
// Not signed in → /signin (remembering where they were headed). Admins have their
// own area, so they're bounced to /admin rather than seeing empty operator pages.
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function RequireOperator({ children }) {
  const { operator } = useAuth();
  const location = useLocation();
  if (!operator) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }
  if (operator.role === "admin") {
    return <Navigate to="/admin" replace />;
  }
  return children;
}
