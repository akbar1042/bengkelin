// mengambil lib
const mysql = require("mysql2/promise");

// membuat koneksi
const host = process.env.DB_HOST || "localhost";
const useSsl = process.env.DB_SSL === "true" || host.includes("tidbcloud.com");
const db = mysql.createPool({
  host,
  port: Number(process.env.DB_PORT || 3306),
  timezone: "Z",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? process.env.DB_PROCCESS ?? "",
  database: process.env.DB_NAME || "bengkel",
  ...(useSsl
    ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } }
    : {}),
  waitForConnections: true,
  connectionLimit: 10,
});

// setiap koneksi set time zone utc
db.pool.on("connection", (connection) =>
  connection.query("SET time_zone = '+00:00'"),
);
module.exports = db;
