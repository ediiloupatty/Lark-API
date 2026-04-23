"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = void 0;
const writeAuditLog = async (db, entry) => {
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
    }
    catch (err) {
        console.error(`[AuditHelper] Failed to write audit log:`, err.message);
    }
};
exports.writeAuditLog = writeAuditLog;
