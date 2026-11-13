const db = require("../db");
(async () => {
  try {
    const [cols] = await db.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workshop_revisions' AND COLUMN_NAME='version'",
    );
    if (!cols.length)
      await db.query(
        "ALTER TABLE workshop_revisions ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1",
      );
    console.log("Versi revisi siap.");
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
