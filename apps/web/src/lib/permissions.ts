/**
 * usePermissions — client-side RBAC helper.
 *
 * Reads the user's role from localStorage and exposes boolean flags
 * that components can use to conditionally render edit/delete buttons.
 *
 * Role hierarchy (ascending power):
 *   read_only < rep < manager < admin < super_admin
 */

import { useMemo } from "react";
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

export function usePermissions() {
  const user = typeof window !== "undefined" ? getStoredUser() : null;
  const role = user?.role ?? "read_only";
  const rank = rankOf(role);

  return useMemo(() => ({
    role,
    /** Can create/edit CRM records (rep+) */
    canWrite:       rank >= ROLE_RANK.rep,
    /** Can delete CRM records (manager+) */
    canDelete:      rank >= ROLE_RANK.manager,
    /** Can manage users and settings (admin+) */
    canManageUsers: rank >= ROLE_RANK.admin,
    /** Can access super-admin org management */
    isSuperAdmin:   rank >= ROLE_RANK.super_admin,
    isAdmin:        rank >= ROLE_RANK.admin,
    isManager:      rank >= ROLE_RANK.manager,
  }), [role, rank]);
}
