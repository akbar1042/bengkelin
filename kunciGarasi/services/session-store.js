const session = require("express-session"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
class MysqlSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
  }
  get(sid, callback) {
    this.database
      .execute(
        "SELECT data FROM app_sessions WHERE sid=? AND expires_at>UTC_TIMESTAMP()",
        [sid],
      )
      .then(([rows]) =>
        callback(null, rows[0] ? JSON.parse(rows[0].data) : null),
      )
      .catch(callback);
  }
  set(sid, value, callback = () => {}) {
    const expires = new Date(value.cookie?.expires || Date.now() + 86400000);
    this.database
      .execute(
        "INSERT INTO app_sessions(sid,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)",
        [sid, JSON.stringify(value), expires],
      )
      .then(() => callback())
      .catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.database
      .execute("DELETE FROM app_sessions WHERE sid=?", [sid])
      .then(() => callback())
      .catch(callback);
  }
  touch(sid, value, callback = () => {}) {
    this.database
      .execute("UPDATE app_sessions SET expires_at=? WHERE sid=?", [
        new Date(value.cookie?.expires || Date.now() + 86400000),
        sid,
      ])
      .then(() => callback())
      .catch(callback);
  }
}
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production")
    throw Error("SESSION_SECRET wajib diisi untuk production.");
  const file = path.join(__dirname, "../../data/session-secret");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, crypto.randomBytes(48).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return fs.readFileSync(file, "utf8");
}
module.exports = { MysqlSessionStore, sessionSecret };
