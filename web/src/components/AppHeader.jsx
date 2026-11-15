// AppHeader.jsx — one header for every screen.
import { NavLink, Link } from "react-router-dom";
import { Droplets, LayoutDashboard, MapPin, ClipboardList, Scale, History, Users, Flag, ShieldCheck } from "lucide-react";
import AuthBadge from "./AuthBadge.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import LanguageToggle from "./LanguageToggle.jsx";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";

const PUBLIC_TABS = [
  { to: "/map", end: true, labelKey: "nav.map", icon: MapPin },
  { to: "/ledger", labelKey: "nav.ledger", icon: Scale },
];
const OPERATOR_TABS = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/log", labelKey: "nav.log", icon: ClipboardList },
  { to: "/history", labelKey: "nav.history", icon: History },
];
const ADMIN_TABS = [
  { to: "/admin", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/admin/review", label: "Review", icon: ShieldCheck },
  { to: "/admin/operators", label: "Operators", icon: Users },
  { to: "/admin/logs", label: "Logs", icon: ClipboardList },
  { to: "/admin/flagged", label: "Flagged", icon: Flag },
  { to: "/admin/map", label: "Wells", icon: MapPin },
];

export default function AppHeader({ subtitle, children }) {
  const { operator } = useAuth();
  const { t } = useI18n();
  const tabs = operator?.role === "admin"
    ? ADMIN_TABS
    : operator
      ? [OPERATOR_TABS[0], PUBLIC_TABS[0], OPERATOR_TABS[1], PUBLIC_TABS[1], OPERATOR_TABS[2]]
      : PUBLIC_TABS;
  const homePath = operator?.role === "admin" ? "/admin" : operator ? "/dashboard" : "/";

  return (
    <header className="topbar">
      <Link
        to={homePath}
        className="brand"
        aria-label="BoreSakshi home"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        <span className="brand-mark">
          <img src="/logo.png" alt="BoreSakshi Logo" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", borderRadius: "inherit", transform: "scale(2.5)" }} />
        </span>
        <span className="brand-text">
          <span className="brand-name">BoreSakshi</span>
          <span className="brand-tag">{subtitle ?? t("brand.tagline")}</span>
        </span>
      </Link>

      <nav className="nav" aria-label="Primary">
        {tabs.map(({ to, end, label, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => "nav-tab" + (isActive ? " active" : "")}
          >
            <Icon size={17} strokeWidth={2.2} />
            <span className="nav-tab-label">{labelKey ? t(labelKey) : label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topbar-slot">
        {children}
        <LanguageToggle />
        <ThemeToggle />
        <AuthBadge />
      </div>
    </header>
  );
}
