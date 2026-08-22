/**
 * Request-shape schemas shared by every graph-core route file (previously each
 * of the five route files declared identical copies).
 */

import { z } from "zod";

export const IdParam     = z.object({ id: z.string().uuid() });
export const TenantQuery = z.object({ tenantId: z.string().min(1) });
