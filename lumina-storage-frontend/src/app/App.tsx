import { BrowserRouter, Route, Routes, Navigate } from "react-router";
import "@/app/i18n";
import { Toaster } from "./components/ui/sonner";
import { AuthBootstrap } from "./contexts/AuthBootstrap";
import { BrandingProvider } from "./contexts/BrandingContext";
import { ProtectedRoute } from "./contexts/ProtectedRoute";
import { LoginRoute } from "./contexts/LoginRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { UsersRolesPage } from "./pages/UsersRolesPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { StarredPage } from "./pages/StarredPage";
import { TrashPage } from "./pages/TrashPage";
import { ErrorPage } from "./pages/ErrorPage";
import { TemplateExtractPage } from "./pages/TemplateExtractPage";
import { DocumentGeneratorV1Page } from "./pages/DocumentGeneratorV1Page";
import { DocumentReviewPage } from "./pages/DocumentReviewPage";
import { CandidateEvaluationPage } from "./pages/CandidateEvaluationPage";
import { OpsExcelSplitterPage } from "./pages/OpsExcelSplitterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SSOCallbackPage } from "./pages/SSOCallbackPage";
import { MicrosoftPopupCallbackPage } from "./pages/MicrosoftPopupCallbackPage";
import { LogoutCompletePage } from "./pages/LogoutCompletePage";
import { LogoutBridgePage } from "./pages/LogoutBridgePage";
import { useCentralLogoutWatch } from "./hooks/useCentralLogoutWatch";

function App() {
  useCentralLogoutWatch();

  return (
    <BrowserRouter>
      <AuthBootstrap>
        <BrandingProvider>
          <Toaster richColors position="top-right" />
          <Routes>
            <Route
              path="/login"
              element={
                <LoginRoute>
                  <LoginPage />
                </LoginRoute>
              }
            />

            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />

          {/* SSO callback — nằm ngoài ProtectedRoute và LoginRoute */}
          <Route path="/sso/callback" element={<SSOCallbackPage />} />

          {/* Microsoft MSAL popup callback */}
          <Route path="/auth/microsoft/popup" element={<MicrosoftPopupCallbackPage />} />

          {/* Coordinated global logout pages */}
          <Route path="/logout-callback" element={<LogoutCompletePage />} />
          <Route path="/frontchannel-logout" element={<LogoutCompletePage />} />
          <Route path="/logout-bridge" element={<LogoutBridgePage />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DashboardPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DocumentsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ChatPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/templates/extract/:docId"
              element={
                <ProtectedRoute>
                  <TemplateExtractPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/generator"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DocumentGeneratorV1Page />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Backward-compat: old bookmarks/links to /generator-v1 */}
            <Route
              path="/generator-v1"
              element={<Navigate to="/generator" replace />}
            />

            <Route
              path="/review"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DocumentReviewPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/ops-excel"
              element={
                <ProtectedRoute>
                  <Layout>
                    <OpsExcelSplitterPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users"
              element={
                <ProtectedRoute>
                  <Layout>
                    <UsersRolesPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SettingsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/tasks"
              element={
                <ProtectedRoute>
                  <Layout>
                    <TasksPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/starred"
              element={
                <ProtectedRoute>
                  <Layout>
                    <StarredPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/trash"
              element={
                <ProtectedRoute>
                  <Layout>
                    <TrashPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/candidate-evaluation"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CandidateEvaluationPage />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/error"
              element={
                <ProtectedRoute>
                  <ErrorPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrandingProvider>
      </AuthBootstrap>
    </BrowserRouter>
  );
}

export default App;
