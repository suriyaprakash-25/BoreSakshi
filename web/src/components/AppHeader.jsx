// AppHeader.jsx — one header for every screen.
// Brand (home) + a segmented nav with a clear active state, plus an optional
// right-hand slot for screen-specific controls (farmer metrics, operator lang).
// Operator-only tabs (Dashboard / Log / History) appear once signed in; Map and
// Ledger are always public.
import { NavLink, Link } from "react-router-dom";
import { Droplets, LayoutDashboard, MapPin, ClipboardList, Scale, History, Users, Flag } from "lucide-react";
import AuthBadge from "./AuthBadge.jsx";
import { useAuth } from "../auth.jsx";

const PUBLIC_TABS = [
  { to: "/", end: true, label: "Map", icon: MapPin },
  { to: "/ledger", label: "Ledger", icon: Scale },
];
const OPERATOR_TABS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/log", label: "Log", icon: ClipboardList },
  { to: "/history", label: "History", icon: History },
];
// admins get a distinct nav instead of the rig-operator one
const ADMIN_TABS = [
  { to: "/admin", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/admin/operators", label: "Operators", icon: Users },
  { to: "/admin/logs", label: "Logs", icon: ClipboardList },
  { to: "/admin/flagged", label: "Flagged", icon: Flag },
  { to: "/admin/map", label: "Wells", icon: MapPin },
];

export default function AppHeader({ subtitle = "Know before you drill", children }) {
  const { operator } = useAuth();

  // admin → admin nav; operator → Dashboard·Map·Log·Ledger·History; anon → Map·Ledger
  const tabs = operator?.role === "admin"
    ? ADMIN_TABS
    : operator
      ? [OPERATOR_TABS[0], PUBLIC_TABS[0], OPERATOR_TABS[1], PUBLIC_TABS[1], OPERATOR_TABS[2]]
      : PUBLIC_TABS;

  return (
    <header className="topbar">
      <Link to="/welcome" className="brand" aria-label="BoreSakshi home">
        <span className="brand-mark"><Droplets size={20} strokeWidth={2.2} /></span>
        <span className="brand-text">
          <span className="brand-name">BoreSakshi</span>
          <span className="brand-tag">{subtitle}</span>
        </span>
      </Link>

      <nav className="nav" aria-label="Primary">
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => "nav-tab" + (isActive ? " active" : "")}
          >
            <Icon size={17} strokeWidth={2.2} />
            <span className="nav-tab-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topbar-slot">
        {children}
        <AuthBadge />
      </div>
    </header>
  );
}
