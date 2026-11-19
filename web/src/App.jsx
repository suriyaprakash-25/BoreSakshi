import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./auth.jsx";
import { OperatorDataProvider } from "./operatorData.jsx";
import { AdminDataProvider } from "./adminData.jsx";
import FarmerScreen from "./screens/FarmerScreen.jsx";
import OperatorLog from "./screens/OperatorLog.jsx";
import LedgerScreen from "./screens/LedgerScreen.jsx";
import LandingScreen from "./screens/LandingScreen.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";
import ResetPasswordScreen from "./screens/ResetPasswordScreen.jsx";
import LegalScreen from "./screens/LegalScreen.jsx";
import { LanguageProvider } from "./i18n.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import History from "./screens/History.jsx";
import AdminDashboard from "./screens/admin/AdminDashboard.jsx";
import OperatorsList from "./screens/admin/OperatorsList.jsx";
import OperatorDetail from "./screens/admin/OperatorDetail.jsx";
import FlaggedLogs from "./screens/admin/FlaggedLogs.jsx";
import AllLogs from "./screens/admin/AllLogs.jsx";
import AdminMap from "./screens/admin/AdminMap.jsx";
import ReviewQueue from "./screens/admin/ReviewQueue.jsx";
import RequireOperator from "./components/RequireOperator.jsx";
import RequireAdmin from "./components/RequireAdmin.jsx";
import HelpBot from "./components/HelpBot.jsx";
import { HelpProvider } from "./helpContext.jsx";

export default function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        containerStyle={{ bottom: 96 }}
        toastOptions={{
          style: {
            background: "var(--card-glass)",
            color: "var(--ink)",
            backdropFilter: "blur(10px)",
            border: "1px solid var(--line)",
          },
        }}
      />
      <LanguageProvider>
      <AuthProvider>
        <OperatorDataProvider>
          <AdminDataProvider>
            <HelpProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingScreen />} />
                <Route path="/map" element={<FarmerScreen />} />
                <Route path="/ledger" element={<LedgerScreen />} />
                <Route path="/signin" element={<AuthScreen mode="signin" />} />
                <Route path="/signup" element={<AuthScreen mode="signup" />} />
                <Route path="/reset-password" element={<ResetPasswordScreen />} />
                <Route path="/privacy" element={<LegalScreen page="privacy" />} />
                <Route path="/terms" element={<LegalScreen page="terms" />} />

                <Route path="/dashboard" element={<RequireOperator><Dashboard /></RequireOperator>} />
                <Route path="/log" element={<RequireOperator><OperatorLog /></RequireOperator>} />
                <Route path="/history" element={<RequireOperator><History /></RequireOperator>} />

                <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
                <Route path="/admin/review" element={<RequireAdmin><ReviewQueue /></RequireAdmin>} />
                <Route path="/admin/operators" element={<RequireAdmin><OperatorsList /></RequireAdmin>} />
                <Route path="/admin/operators/:id" element={<RequireAdmin><OperatorDetail /></RequireAdmin>} />
                <Route path="/admin/logs" element={<RequireAdmin><AllLogs /></RequireAdmin>} />
                <Route path="/admin/flagged" element={<RequireAdmin><FlaggedLogs /></RequireAdmin>} />
                <Route path="/admin/map" element={<RequireAdmin><AdminMap /></RequireAdmin>} />
              </Routes>
              <HelpBot />
            </BrowserRouter>
            </HelpProvider>
          </AdminDataProvider>
        </OperatorDataProvider>
      </AuthProvider>
      </LanguageProvider>
    </>
  );
}
