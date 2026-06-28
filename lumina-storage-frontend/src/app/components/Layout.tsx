import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MyProfileDialog } from "./MyProfileDialog";

export function Layout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const activeItem = (() => {
    if (location.pathname.startsWith("/dashboard")) return "dashboard";
    if (location.pathname.startsWith("/chat")) return "chat";
    // /templates/extract/:docId is a Generator sub-flow (draft review)
    if (
      location.pathname.startsWith("/generator") ||
      location.pathname.startsWith("/templates")
    )
      return "generator";
    if (location.pathname.startsWith("/review")) return "review";
    if (location.pathname.startsWith("/candidate-evaluation"))
      return "candidate-evaluation";
    if (location.pathname.startsWith("/users")) return "users-roles";
    if (location.pathname.startsWith("/settings")) return "settings";
    if (location.pathname.startsWith("/tasks")) return "tasks";
    if (location.pathname.startsWith("/starred")) return "starred";
    if (location.pathname.startsWith("/trash")) return "trash";
    return "documents";
  })();

  const handleMenuItemClick = (itemId: string) => {
    setIsSidebarOpen(false);
    switch (itemId) {
      case "dashboard":
        navigate("/dashboard");
        break;
      case "documents":
        navigate("/");
        break;
      case "chat":
        navigate("/chat");
        break;
      case "generator":
        navigate("/generator");
        break;
      case "review":
        navigate("/review");
        break;
      case "candidate-evaluation":
        navigate("/candidate-evaluation");
        break;
      case "users-roles":
        navigate("/users");
        break;
      case "settings":
        navigate("/settings");
        break;
      case "tasks":
        navigate("/tasks");
        break;
      case "starred":
        navigate("/starred");
        break;
      case "trash":
        navigate("/trash");
        break;
      default:
        navigate("/");
        break;
    }
  };

  const handleLogout = () => {
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Desktop sidebar - always visible */}
      <Sidebar
        activeItem={activeItem}
        onMenuItemClick={handleMenuItemClick}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onExpandedChange={setIsSidebarExpanded}
        onLogout={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onLogout={handleLogout}
          onMenuClick={() => setIsSidebarOpen(true)}
          onSettingsClick={() => navigate("/settings")}
          onProfileClick={() => setShowProfileDialog(true)}
          isSidebarExpanded={isSidebarExpanded}
        />

        <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>

      <MyProfileDialog
        open={showProfileDialog}
        onClose={() => setShowProfileDialog(false)}
      />
    </div>
  );
}
