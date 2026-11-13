const { bad } = require("../lib/workshop-utils");
const { withTransaction } = require("./transaction");

async function createTicket(database, userId, message) {
  return withTransaction(database, async (connection) => {
    const [users] = await connection.execute(
      "SELECT id FROM users WHERE id=? AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    if (!users.length) throw bad("Akun tidak tersedia.", 401);
    const [open] = await connection.execute(
      "SELECT COUNT(*) AS n FROM support_tickets WHERE user_id=? AND status='open'",
      [userId],
    );
    if (Number(open[0].n) >= 5) throw bad("Maksimal 5 tiket terbuka.", 429);
    const [result] = await connection.execute(
      "INSERT INTO support_tickets(user_id,message) VALUES (?,?)",
      [userId, message.trim()],
    );
    return result.insertId;
  });
}

async function listTickets(database, { ownerId, status, before }) {
  const admin = ownerId === undefined;
  const conditions = [];
  const params = [];
  if (!admin) {
    conditions.push("t.user_id=?");
    params.push(ownerId);
  }
  if (status) {
    conditions.push("t.status=?");
    params.push(status);
  }
  if (before) {
    conditions.push("t.id<?");
    params.push(before);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const limit = status ? 50 : admin ? 300 : 100;
  const account = admin ? ",t.user_id,u.email AS customer_email" : "";
  const join = admin ? "JOIN users u ON u.id=t.user_id" : "";
  const [rows] = await database.execute(
    `SELECT t.id,t.message,t.status,t.admin_reply,t.created_at${account}
     FROM support_tickets t ${join} ${where} ORDER BY t.id DESC LIMIT ?`,
    [...params, limit + 1],
  );
  const data = rows.slice(0, limit);
  return { data, nextBefore: rows.length > limit ? data.at(-1).id : null };
}

async function getTicket(database, id, ownerId) {
  const [rows] = await database.execute(
    `SELECT t.id,t.message,t.status,t.admin_reply,t.created_at,t.updated_at,
            m.id AS message_id,m.sender_role,m.message AS content,m.created_at AS sent_at
     FROM support_tickets t LEFT JOIN support_ticket_messages m ON m.ticket_id=t.id
     WHERE t.id=?${ownerId === undefined ? "" : " AND t.user_id=?"} ORDER BY m.id`,
    ownerId === undefined ? [id] : [id, ownerId],
  );
  if (!rows.length) throw bad("Tiket tidak ditemukan.", 404);
  const { message_id, sender_role, content, sent_at, ...ticket } = rows[0];
  const messages = [
    {
      role: "customer",
      content: ticket.message,
      created_at: ticket.created_at,
    },
  ];
  for (const row of rows) {
    if (row.message_id !== null) {
      messages.push({
        role: row.sender_role,
        content: row.content,
        created_at: row.sent_at,
      });
    }
  }
  if (ticket.admin_reply) {
    messages.push({
      role: "admin",
      content: ticket.admin_reply,
      created_at: ticket.updated_at,
    });
  }
  return { id: ticket.id, status: ticket.status, messages };
}

async function updateTicket(database, id, { ownerId, message, close = false }) {
  return withTransaction(database, async (connection) => {
    const [lookup] = await connection.execute(
      "SELECT user_id FROM support_tickets WHERE id=?",
      [id],
    );
    const customerId = lookup[0]?.user_id;
    if (!customerId || (ownerId !== undefined && ownerId !== customerId)) {
      throw bad("Tiket tidak ditemukan.", 404);
    }

    // Lock the account first, in the same order as ticket creation.
    await connection.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [
      customerId,
    ]);
    const [rows] = await connection.execute(
      "SELECT status FROM support_tickets WHERE id=? FOR UPDATE",
      [id],
    );
    if (!rows.length) throw bad("Tiket tidak ditemukan.", 404);
    if (rows[0].status !== "open")
      throw bad("Tiket sudah ditutup. Muat ulang daftar tiket.", 409);

    if (close) {
      await connection.execute(
        "UPDATE support_tickets SET status='closed',admin_reply=? WHERE id=?",
        [message ?? null, id],
      );
    } else {
      await connection.execute(
        "INSERT INTO support_ticket_messages(ticket_id,sender_role,message) VALUES (?,?,?)",
        [id, ownerId === undefined ? "admin" : "customer", message],
      );
    }
    if (message && ownerId === undefined) {
      await connection.execute(
        "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,NULL,'Balasan tiket bantuan',?)",
        [
          customerId,
          "Admin membalas tiket #" +
            id +
            ". Buka Customer Service untuk membaca balasan.",
        ],
      );
    }
  });
}

module.exports = { createTicket, listTickets, getTicket, updateTicket };
