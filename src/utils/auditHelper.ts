import { PrismaClient } from '@prisma/client';

export interface AuditLogEntry {
  tenant_id?: number | null;
  outlet_id?: number | null;
  actor_user_id?: number | null;
  entity_type?: string;
  entity_id?: string | number | null;
  action: string;
  metadata?: any;
}

export const writeAuditLog = async (db: PrismaClient, entry: AuditLogEntry): Promise<void> => {
  try {
    await db.audit_logs.create({
      data: {
        tenant_id: entry.tenant_id ?? null,
        outlet_id: entry.outlet_id ?? null,
        actor_user_id: entry.actor_user_id ?? null,
        entity_type: entry.entity_type ?? 'unknown',
        entity_id: entry.entity_id ? parseInt(entry.entity_id.toString()) : null,
        action: entry.action,
        metadata: entry.metadata ?? null,
      }
    });
  } catch (err: any) {
    console.error(`[AuditHelper] Failed to write audit log:`, err.message);
  }
};
