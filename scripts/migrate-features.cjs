const fs = require("node:fs"),
  path = require("node:path"),
  db = require("../db");
(async () => {
  try {
    const [cols] = await db.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='auth_version'",
    );
    if (!cols.length)
      await db.query(
        "ALTER TABLE users ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0",
      );
    for (const statement of fs
      .readFileSync(
        path.join(__dirname, "../migrations/002-feature-upgrade.sql"),
        "utf8",
      )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
    console.log(
      "Migrasi fitur selesai: detail mitra, persetujuan dan versi sesi. Tidak ada data dihapus.",
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
