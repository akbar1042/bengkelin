const fs = require("fs"),
  path = require("path"),
  db = require("../db");
(async () => {
  try {
    for (const statement of fs
      .readFileSync(
        path.join(__dirname, "../migrations/004-audit-fixes.sql"),
        "utf8",
      )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
    for (const [table, name, type] of [
      [
        "service_orders",
        "duration_minutes",
        "INT UNSIGNED NOT NULL DEFAULT 60",
      ],
      ["service_orders", "cost_version", "INT UNSIGNED NOT NULL DEFAULT 0"],
      [
        "service_orders",
        "accepted_cost_version",
        "INT UNSIGNED NOT NULL DEFAULT 0",
      ],
      ["service_orders", "cost_accepted_at", "DATETIME NULL"],
      [
        "service_order_events",
        "actor_type",
        "ENUM('user','system') NOT NULL DEFAULT 'user'",
      ],
    ]) {
      const [cols] = await db.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
        [table, name],
      );
      if (!cols.length)
        await db.query(
          "ALTER TABLE " + table + " ADD COLUMN " + name + " " + type,
        );
    }
    await db.query("DROP TRIGGER IF EXISTS order_insert_notice");
    await db.query("DROP TRIGGER IF EXISTS order_update_notice");
    await db.query(
      "CREATE TRIGGER order_insert_notice AFTER INSERT ON service_orders FOR EACH ROW INSERT INTO user_notifications(user_id,order_id,title,message) SELECT owner_user_id,NEW.id,'Pesanan baru',CONCAT('Pesanan #',NEW.id,' menunggu konfirmasi Anda.') FROM partner_workshops WHERE id=NEW.workshop_id",
    );
    await db.query(
      "CREATE TRIGGER order_update_notice AFTER UPDATE ON service_orders FOR EACH ROW INSERT INTO user_notifications(user_id,order_id,title,message) SELECT NEW.customer_id,NEW.id,'Perubahan pesanan',CONCAT('Pesanan #',NEW.id,': ',NEW.status,'. Periksa rincian dan persetujuan biaya.') WHERE NEW.status<>OLD.status OR NEW.cost_version<>OLD.cost_version UNION ALL SELECT p.owner_user_id,NEW.id,'Perubahan pesanan',CONCAT('Pesanan #',NEW.id,': ',NEW.status,'. Periksa rincian dan persetujuan biaya.') FROM partner_workshops p WHERE p.id=NEW.workshop_id AND (NEW.status<>OLD.status OR NEW.accepted_cost_version<>OLD.accepted_cost_version)",
    );
    console.log(
      "Migrasi audit selesai: sesi persisten, revisi, notifikasi, persetujuan biaya dan customer service.",
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
