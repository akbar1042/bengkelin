// mengambil lib
const mysql = require('mysql2/promise');

// membuat koneksi
const db = mysql.createPool({
    host: "localhost",
    timezone: "Z",
    user: "root",
    password: process.env.DB_PASSWORD ?? process.env.DB_PROCCESS ?? "",
    database: "bengkel",
    waitForConnections: true,
    connectionLimit: 10
});

// setiap koneksi set time zone utc
db.pool.on("connection", connection => connection.query("SET time_zone = '+00:00'"));
module.exports = db;
