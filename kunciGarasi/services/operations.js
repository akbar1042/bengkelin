const db = require("../../db");
let current;
let schemaReady = false;

async function ensureOrderWorkflowColumns(database = db) {
  if (schemaReady) return;
  const columns = [
    ["payment_method", "ENUM('cod','qris') NOT NULL DEFAULT 'cod'"],
    ["payment_status", "ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid'"],
    ["customer_completed_at", "DATETIME NULL"],
    ["partner_completed_at", "DATETIME NULL"],
    ["need_towing", "TINYINT(1) NOT NULL DEFAULT 0"],
    [
      "towing_status",
      "ENUM('none','requested','on_the_way','arrived') NOT NULL DEFAULT 'none'",
    ],
  ];
  for (const [name, definition] of columns) {
    const [rows] = await database.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND COLUMN_NAME=?",
      [name],
    );
    if (!rows.length) {
      await database.query(
        `ALTER TABLE service_orders ADD COLUMN ${name} ${definition}`,
      );
    }
  }
  schemaReady = true;
}

async function maintain(database = db) {
  if (current) return current;
  current = (async () => {
    await ensureOrderWorkflowColumns(database);
    const c = await database.getConnection();
    try {
      await c.beginTransaction();
      const [orders] = await c.query(
        "SELECT id,customer_id FROM service_orders WHERE status='waiting' AND (scheduled_at<=UTC_TIMESTAMP() OR created_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 24 HOUR)) FOR UPDATE",
      );
      for (const order of orders) {
        await c.execute(
          "UPDATE service_orders SET status='cancelled',cancellation_reason='Tidak dikonfirmasi sampai batas waktu' WHERE id=?",
          [order.id],
        );
        await c.execute(
          "INSERT INTO service_order_events(order_id,actor_id,status,note,actor_type) VALUES (?,?,'cancelled','Otomatis kedaluwarsa: jadwal terlewati atau 24 jam tanpa konfirmasi','system')",
          [order.id, order.customer_id],
        );
      }

      const [autoCompleted] = await c.query(
        `SELECT id, customer_id FROM service_orders
                 WHERE status='processing'
                   AND (
                     (customer_completed_at IS NOT NULL AND partner_completed_at IS NULL AND customer_completed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR))
                     OR
                     (partner_completed_at IS NOT NULL AND customer_completed_at IS NULL AND partner_completed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR))
                     OR
                     (
                       customer_completed_at IS NULL AND partner_completed_at IS NULL
                       AND (
                         ((payment_status='paid' OR (cost_version>0 AND accepted_cost_version=cost_version)) AND COALESCE(cost_accepted_at, updated_at) <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR))
                         OR
                         (scheduled_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR) AND updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR))
                       )
                     )
                   )
                 FOR UPDATE`,
      );
      for (const order of autoCompleted) {
        await c.execute(
          "UPDATE service_orders SET status='completed', payment_status='paid', customer_completed_at=COALESCE(customer_completed_at, UTC_TIMESTAMP()), partner_completed_at=COALESCE(partner_completed_at, UTC_TIMESTAMP()) WHERE id=?",
          [order.id],
        );
        await c.execute(
          "INSERT INTO service_order_events(order_id,actor_id,status,note,actor_type) VALUES (?,?,'completed','Otomatis diselesaikan sistem karena melewati batas waktu konfirmasi 24 jam','system')",
          [order.id, order.customer_id],
        );
      }

      await c.query(
        "DELETE FROM app_sessions WHERE expires_at<=UTC_TIMESTAMP()",
      );
      await c.query(
        "DELETE FROM auth_limits WHERE expires_at<=UTC_TIMESTAMP()",
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  })();
  try {
    return await current;
  } finally {
    current = null;
  }
}
module.exports = { maintain, ensureOrderWorkflowColumns };
