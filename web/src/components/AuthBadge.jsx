// AuthBadge.jsx — header auth state. Signed in → operator name + Sign out.
// Signed out → a Sign in link. Rendered globally in AppHeader.
import { Link } from "react-router-dom";
import { HardHat, LogOut, LogIn } from "lucide-react";
import { useAuth } from "../auth.jsx";

export default function AuthBadge() {
  const { operator, signOut } = useAuth();

  if (operator) {
    return (
      <div className="auth-badge">
        <span className="auth-name" title={operator.name}>
          <HardHat size={15} strokeWidth={2.2} />
          <span className="auth-name-text">{operator.name}</span>
        </span>
        <button type="button" className="auth-signout" onClick={signOut} title="Sign out">
          <LogOut size={15} strokeWidth={2.2} />
          <span className="auth-signout-text">Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <Link to="/signin" className="auth-signin">
      <LogIn size={15} strokeWidth={2.2} />
      <span>Sign in</span>
    </Link>
  );
}
