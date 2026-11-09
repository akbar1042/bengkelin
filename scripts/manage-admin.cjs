const db = require("../db");
const action = process.argv[2],
  email = process.argv[3];
(async () => {
  try {
    if (!["grant", "revoke"].includes(action) || !email)
      throw new Error(
        "Gunakan: node scripts/manage-admin.cjs grant|revoke email-akun-terdaftar",
      );
    const [rows] = await db.execute("SELECT id FROM users WHERE email=?", [
      email,
    ]);
    if (!rows.length) throw new Error("Akun belum terdaftar.");
    await db.execute("UPDATE users SET role=? WHERE id=?", [
      action === "grant" ? "admin" : "customer",
      rows[0].id,
    ]);
    console.log(
      action === "grant"
        ? "Role admin diberikan."
        : "Akses admin dicabut. Dashboard mengikuti kepemilikan bengkel yang disetujui.",
    );
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
