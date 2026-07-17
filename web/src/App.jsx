import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { OperatorDataProvider } from "./operatorData.jsx";
import { AdminDataProvider } from "./adminData.jsx";
import FarmerScreen from "./screens/FarmerScreen.jsx";
import OperatorLog from "./screens/OperatorLog.jsx";
import LedgerScreen from "./screens/LedgerScreen.jsx";
import LandingScreen from "./screens/LandingScreen.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import History from "./screens/History.jsx";
import AdminDashboard from "./screens/admin/AdminDashboard.jsx";
import OperatorsList from "./screens/admin/OperatorsList.jsx";
import OperatorDetail from "./screens/admin/OperatorDetail.jsx";
import FlaggedLogs from "./screens/admin/FlaggedLogs.jsx";
import AllLogs from "./screens/admin/AllLogs.jsx";
import AdminMap from "./screens/admin/AdminMap.jsx";
import RequireOperator from "./components/RequireOperator.jsx";
import RequireAdmin from "./components/RequireAdmin.jsx";

// One app, several audiences:
//   /          landing page
//   /map       farmer prediction map (OPEN — no login)
//   /ledger    public accountability ledger                 /signin /signup  auth
//   /dashboard /log /history   operator-only (RequireOperator)
//   /admin/*   admin-only (RequireAdmin) — distinct nav, platform oversight
export default function App() {
  return (
    <AuthProvider>
      <OperatorDataProvider>
        <AdminDataProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingScreen />} />
              <Route path="/map" element={<FarmerScreen />} />
              <Route path="/ledger" element={<LedgerScreen />} />
              <Route path="/signin" element={<AuthScreen mode="signin" />} />
              <Route path="/signup" element={<AuthScreen mode="signup" />} />

              <Route path="/dashboard" element={<RequireOperator><Dashboard /></RequireOperator>} />
              <Route path="/log" element={<RequireOperator><OperatorLog /></RequireOperator>} />
              <Route path="/history" element={<RequireOperator><History /></RequireOperator>} />

              <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/admin/operators" element={<RequireAdmin><OperatorsList /></RequireAdmin>} />
              <Route path="/admin/operators/:id" element={<RequireAdmin><OperatorDetail /></RequireAdmin>} />
              <Route path="/admin/logs" element={<RequireAdmin><AllLogs /></RequireAdmin>} />
              <Route path="/admin/flagged" element={<RequireAdmin><FlaggedLogs /></RequireAdmin>} />
              <Route path="/admin/map" element={<RequireAdmin><AdminMap /></RequireAdmin>} />
            </Routes>
          </BrowserRouter>
        </AdminDataProvider>
      </OperatorDataProvider>
    </AuthProvider>
  );
}
