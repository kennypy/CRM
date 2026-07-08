/**
 * usePermissions — client-side RBAC helper.
 *
 * Reads the user's role from localStorage and exposes boolean flags
 * that components can use to conditionally render edit/delete buttons.
 *
 * Role hierarchy (ascending power):
 *   read_only < rep < manager < admin < super_admin
 */

import { useMemo, useState, useEffect } from "react";
import { getStoredUser } from "./auth";

export type UserRole = "super_admin" | "admin" | "manager" | "rep" | "read_only";

const ROLE_RANK: Record<UserRole, number> = {
  read_only:   0,
  rep:         1,
  manager:     2,
  admin:       3,
  super_admin: 4,
};

function rankOf(role: string): number {
  return ROLE_RANK[role as UserRole] ?? 0;
}

const DEFAULT_PERMS = {
  role: "read_only" as string,
  canWrite:       false,
  canDelete:      false,
  canManageUsers: false,
  isSuperAdmin:   false,
  isAdmin:        false,
  isManager:      false,
  capabilities:   {} as Record<string, boolean>,
  can:            (_cap: string) => false,
  ready:          false,
};

export function usePermissions() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  return useMemo(() => {
    if (!hydrated) return DEFAULT_PERMS;
    const user = getStoredUser();
    const role = user?.role ?? "read_only";
    const rank = rankOf(role);
    const isAdmin = rank >= ROLE_RANK.admin;
    const capabilities = (user?.capabilities ?? {}) as Record<string, boolean>;
    return {
      role,
      canWrite:       rank >= ROLE_RANK.rep,
      canDelete:      rank >= ROLE_RANK.manager,
      canManageUsers: isAdmin,
      isSuperAdmin:   rank >= ROLE_RANK.super_admin,
      isAdmin,
      isManager:      rank >= ROLE_RANK.manager,
      capabilities,
      // Admins/super_admins implicitly hold every capability; everyone else
      // (incl. managers) needs the flag granted — mirrors the backend rule.
      can: (cap: string) => isAdmin || capabilities[cap] === true,
      ready: true,
    };
  }, [hydrated]);
}
