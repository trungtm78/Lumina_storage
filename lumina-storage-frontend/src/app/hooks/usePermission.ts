import { useMemo } from "react";
import { useLocation } from "react-router";
import { useAuthStore } from "@/app/stores/authStore";

/** Map route paths to permission urlpaths */
const ROUTE_TO_PERMISSION: Record<string, string> = {
  "/": "/documents",
  "/chat": "/chat",
  "/users": "/users-roles",
  "/settings": "/settings",
  "/tasks": "/tasks",
  "/starred": "/starred",
  "/trash": "/trash",
};

/**
 * Returns the permission level for the current page (or a given permission urlpath).
 *
 * - 0 → no access (redirect to /error)
 * - 1 → read-only (hide CUD actions)
 * - 2 → full access
 */
export function usePermission(permissionUrlpath?: string) {
  const location = useLocation();
  const profile = useAuthStore((s) => s.profile);

  const level = useMemo(() => {
    if (profile?.role?.is_default) return 2;

    const targetUrlpath =
      permissionUrlpath ?? ROUTE_TO_PERMISSION[location.pathname];
    if (!targetUrlpath) return 0;

    const permissions = profile?.role?.permissions ?? [];
    const match = permissions.find((p) => p.urlpath === targetUrlpath);
    return match?.level ?? 0;
  }, [permissionUrlpath, location.pathname, profile]);

  return {
    level,
    canRead: level >= 1,
    canWrite: level >= 2,
  };
}
