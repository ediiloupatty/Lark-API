-- Optimization: Composite index untuk query getNotifications & unread_count
-- Query pattern: WHERE user_id = $1 AND tenant_id = $2 [AND is_read = false]
CREATE INDEX IF NOT EXISTS idx_notifications_user_tenant_read
ON notifications (user_id, tenant_id, is_read);
