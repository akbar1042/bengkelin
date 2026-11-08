const mysql = require('mysql2/promise');

const db = mysql.createPool({
    host: "localhost",
    timezone: "Z",
    user: "root",
    password: process.env.DB_PASSWORD ?? process.env.DB_PROCCESS ?? "",
    database: "bengkel",
    waitForConnections: true,
    connectionLimit: 10
});

db.pool.on("connection", connection => connection.query("SET time_zone = '+00:00'"));
module.exports = db;
