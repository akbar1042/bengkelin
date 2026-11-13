const crypto = require("node:crypto"),
  db = require("../../db");
function loginLimit(database = db) {
  return async (req, res, next) => {
    try {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";
      const keys = [
        ["ip:" + req.ip, 50],
        ["account:" + email, 10],
      ];
      for (const [raw, max] of keys) {
        const key = crypto.createHash("sha256").update(raw).digest("hex");
        await database.execute(
          "INSERT INTO auth_limits(bucket_key,attempts,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=UTC_TIMESTAMP(),1,attempts+1),expires_at=IF(expires_at<=UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),expires_at)",
          [key],
        );
        const [rows] = await database.execute(
          "SELECT attempts FROM auth_limits WHERE bucket_key=?",
          [key],
        );
        if (rows[0].attempts > max) {
          res.set("Retry-After", "900");
          return res.status(429).json({
            message: "Terlalu banyak percobaan login. Tunggu 15 menit.",
          });
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
module.exports = { loginLimit };
