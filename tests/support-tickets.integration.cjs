process.env.NODE_ENV = "test";
process.env.SESSION_COOKIE_SECURE = "false";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcrypt");
const db = require("../db");
const app = require("../login");

async function run() {
  const server = app.listen(0, "127.0.0.1");
  const users = [];
  const cookies = [];
  const stamp = randomUUID();
  const password = "Support-test-" + stamp;
  const testIP =
    "198.18." +
    parseInt(stamp.slice(0, 2), 16) +
    "." +
    parseInt(stamp.slice(2, 4), 16);
  let base;

  async function request(path, { user, method = "GET", body } = {}) {
    const response = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": testIP,
        ...(user === undefined ? {} : { Cookie: cookies[user] }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const content = response.headers.get("content-type");
    const data = content?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  try {
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
    const hash = await bcrypt.hash(password, 4);
    for (const role of ["customer", "customer", "admin"]) {
      const email = stamp + "-" + users.length + "@example.test";
      const [created] = await db.execute(
        "INSERT INTO users(email,password_hash,role) VALUES (?,?,?)",
        [email, hash, role],
      );
      users.push(created.insertId);
      const login = await request("/api/login", {
        method: "POST",
        body: { email, password },
      });
      assert.equal(login.status, 200);
      assert.ok(login.cookie);
      cookies.push(login.cookie);
    }

    const customer = "/api/support/tickets";
    const admin = "/api/admin/support-tickets";
    assert.equal((await request(customer)).status, 401);
    assert.equal((await request("/support.html", { user: 0 })).status, 200);
    assert.equal(
      (await request("/support-admin.html", { user: 0 })).status,
      403,
    );
    assert.equal(
      (await request("/support-admin.html", { user: 2 })).status,
      200,
    );
    assert.equal((await request(admin, { user: 0 })).status, 403);

    const created = await request(customer, {
      user: 0,
      method: "POST",
      body: { message: "Bantuan pesanan" },
    });
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.ok(
      (await request(admin + "?status=open", { user: 2 })).data.data.some(
        (ticket) => ticket.id === id,
      ),
    );
    assert.equal((await request(customer + "/" + id, { user: 1 })).status, 404);
    const send = (basePath, user, message) =>
      request(basePath + "/" + id + "/messages", {
        user,
        method: "POST",
        body: { message },
      });
    assert.equal((await send(customer, 1, "Bukan pemilik")).status, 404);
    assert.equal((await send(admin, 0, "Bukan admin")).status, 403);
    assert.equal((await send(admin, 2, "   ")).status, 400);
    assert.equal((await send(admin, 2, "Apa nomor pesanannya?")).status, 201);
    assert.equal((await send(customer, 0, "Pesanan 42")).status, 201);
    assert.equal((await send(admin, 2, "Sudah saya cek.")).status, 201);

    const thread = await request(customer + "/" + id, { user: 0 });
    assert.equal(thread.data.status, "open");
    assert.deepEqual(
      thread.data.messages.map(({ role, content }) => [role, content]),
      [
        ["customer", "Bantuan pesanan"],
        ["admin", "Apa nomor pesanannya?"],
        ["customer", "Pesanan 42"],
        ["admin", "Sudah saya cek."],
      ],
    );
    const notification = await request("/api/notifications", { user: 0 });
    assert.equal(
      notification.data.data.filter(
        (item) => item.title === "Balasan tiket bantuan",
      ).length,
      2,
    );
    assert.equal(
      (await request("/api/notifications", { user: 1 })).data.data.length,
      0,
    );

    const close = () =>
      request(admin + "/" + id, {
        user: 2,
        method: "PATCH",
        body: { status: "closed" },
      });
    assert.deepEqual(
      (await Promise.all([close(), close()]))
        .map((response) => response.status)
        .sort(),
      [200, 409],
    );
    assert.equal((await send(customer, 0, "Tiket sudah selesai")).status, 409);
    assert.equal((await send(admin, 2, "Tiket sudah selesai")).status, 409);
    const closed = await request(customer + "?status=closed", { user: 0 });
    assert.ok(closed.data.data.some((ticket) => ticket.id === id));
    assert.equal(
      (await request(customer + "/" + id, { user: 0 })).data.messages.length,
      4,
    );

    const [legacy] = await db.execute(
      "INSERT INTO support_tickets(user_id,message,status,admin_reply) VALUES (?,?,'closed',?)",
      [users[0], "Pertanyaan lama", "Balasan lama"],
    );
    const history = await request(customer + "/" + legacy.insertId, {
      user: 0,
    });
    assert.deepEqual(
      history.data.messages.map((message) => message.content),
      ["Pertanyaan lama", "Balasan lama"],
    );

    console.log(
      "PASS tiket bantuan: akses admin dan pemilik, chat dua arah, notifikasi, penutupan paralel, riwayat lama.",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const userId of users) {
      await db.execute("DELETE FROM support_tickets WHERE user_id=?", [userId]);
      await db.execute(
        "DELETE FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",
        [userId],
      );
      await db.execute("DELETE FROM users WHERE id=?", [userId]);
    }
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
