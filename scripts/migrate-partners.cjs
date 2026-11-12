const fs = require("node:fs"),
  path = require("node:path");
const db = require("../db");
(async () => {
  try {
    const [columns] = await db.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'",
    );
    if (!columns.length)
      await db.query(
        "ALTER TABLE users ADD COLUMN role ENUM('customer','admin') NOT NULL DEFAULT 'customer'",
      );
    const text = fs.readFileSync(
      path.join(__dirname, "../migrations/001-partners.sql"),
      "utf8",
    );
    for (const statement of text
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
    console.log("Migrasi role dan mitra selesai tanpa menghapus data.");
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
