import { Navigate } from "react-router";
import { useAuthStore } from "@/app/stores/authStore";

export function LoginRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);

  if (accessToken) {
    return (
      <Navigate to={mustChangePassword ? "/change-password" : "/"} replace />
    );
  }

  return <>{children}</>;
}
