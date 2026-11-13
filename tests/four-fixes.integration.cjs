const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  db = require("../db"),
  app = require("../login"),
  bcrypt = require("bcrypt");
const { propose } = require("../kunciGarasi/services/revisions");
const { validateRegistration } = require("../kunciGarasi/lib/partner-input");
(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port,
    ids = [],
    cookies = [],
    password = "Four-fixes-9384!",
    ip =
      "198.19." +
      Math.floor(Math.random() * 256) +
      "." +
      Math.floor(Math.random() * 256);
  let wid;
  const request = async (path, method = "GET", body, index = 0) => {
    const r = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": ip,
        "Content-Type": "application/json",
        ...(cookies[index] ? { cookie: cookies[index] } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    return {
      status: r.status,
      data,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    for (let i = 0; i < 3; i++) {
      const email = "four-" + Date.now() + "-" + i + "@example.test";
      const [u] = await db.execute(
        "INSERT INTO users(email,password_hash,role) VALUES (?,?,?)",
        [email, await bcrypt.hash(password, 4), i === 2 ? "admin" : "customer"],
      );
      ids.push(u.insertId);
      const login = await request("/api/login", "POST", { email, password }, i);
      assert.equal(login.status, 200);
      cookies.push(login.cookie);
    }
    const input = validateRegistration({
      name: "TEST initial",
      address: "Alamat awal",
      phone: "08123456789",
      lat: -7.37,
      lng: 112.75,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1, 2], open: "08:00", close: "17:00" },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "2026-11-07",
    });
    const [w] = await db.execute(
      "INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,status) VALUES (?,?,?,?,?,?,?,'pending')",
      [
        ids[1],
        input.name,
        input.address,
        input.phone,
        input.lat,
        input.lng,
        JSON.stringify(input.services),
      ],
    );
    wid = w.insertId;
    await db.execute(
      "INSERT INTO partner_workshop_details(workshop_id,details,terms_version) VALUES (?,?,?)",
      [wid, JSON.stringify({ ...input, photos: [] }), input.termsVersion],
    );
    const pending = async () => {
      const response = await request(
        "/api/admin/partners",
        "GET",
        undefined,
        2,
      );
      return response.data.data.find((w) => w.id === wid);
    };
    const decide = (version, status = "approved") =>
      request(
        "/api/admin/partners/" + wid + "/review",
        "POST",
        { status, note: "Uji versi revisi", reviewVersion: version },
        2,
      );
    const initial = (await pending()).reviewVersion;
    assert(initial.startsWith("registration:"));
    assert.equal((await decide(undefined)).status, 409);
    assert.equal((await decide(initial)).status, 200);
    assert.equal((await decide(initial, "rejected")).status, 409);
    await propose(db, wid, ids[1], { ...input, name: "TEST revision A" });
    const a = (await pending()).reviewVersion;
    await propose(db, wid, ids[1], {
      ...input,
      name: "TEST revision B",
      address: "Alamat baru B",
    });
    const b = (await pending()).reviewVersion;
    assert.notEqual(a, b);
    assert.equal((await decide(a)).status, 409);
    assert.equal((await decide(b)).status, 200);
    assert.equal((await decide(b, "rejected")).status, 409);
    assert.equal(
      (await request("/api/customer/partners/" + wid)).data.workshop.name,
      "TEST revision B",
    );
    const tow1 = { id: "a".repeat(40) + ".webp", kind: "tow" },
      shop1 = { id: "b".repeat(40) + ".webp", kind: "workshop" };
    await propose(
      db,
      wid,
      ids[1],
      {
        name: "STALE NAME MUST NOT RETURN",
        address: "STALE ADDRESS",
        photos: [shop1, tow1],
      },
      { photosOnly: true },
    );
    let [rows] = await db.execute(
      "SELECT proposal FROM workshop_revisions WHERE workshop_id=?",
      [wid],
    );
    let proposal =
      typeof rows[0].proposal === "string"
        ? JSON.parse(rows[0].proposal)
        : rows[0].proposal;
    assert.equal(proposal.name, "TEST revision B");
    assert.equal(proposal.address, "Alamat baru B");
    const shop2 = { id: "c".repeat(40) + ".webp", kind: "workshop" };
    await propose(db, wid, ids[1], { photos: [shop2] }, { photosOnly: true });
    [rows] = await db.execute(
      "SELECT proposal FROM workshop_revisions WHERE workshop_id=?",
      [wid],
    );
    proposal =
      typeof rows[0].proposal === "string"
        ? JSON.parse(rows[0].proposal)
        : rows[0].proposal;
    assert(proposal.photos.some((p) => p.id === tow1.id));
    assert(proposal.photos.some((p) => p.id === shop2.id));
    await db.execute(
      "INSERT INTO user_notifications(user_id,title,message) VALUES (?,'Unread old','Old')",
      [ids[0]],
    );
    for (let i = 0; i < 100; i++)
      await db.execute(
        "INSERT INTO user_notifications(user_id,title,message,read_at) VALUES (?,'Read recent','Recent',UTC_TIMESTAMP())",
        [ids[0]],
      );
    const notices = (await request("/api/notifications")).data;
    assert.equal(notices.data.length, 100);
    assert.equal(notices.data.filter((n) => !n.read_at).length, 0);
    assert.equal(notices.unreadCount, 1);
    assert(notices.nextBefore);
    const older = (
      await request("/api/notifications?before=" + notices.nextBefore)
    ).data;
    assert.equal(older.data.length, 1);
    assert.equal(older.data[0].title, "Unread old");
    assert.equal(
      (await request("/api/notifications/read-all", "PATCH", {})).status,
      200,
    );
    assert.equal((await request("/api/notifications")).data.unreadCount, 0);
    assert.equal(
      (
        await request(
          "/api/mitra/location-name?lat=invalid&lng=0",
          "GET",
          undefined,
          99,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/location-name?lat=invalid&lng=0",
          "GET",
          undefined,
          99,
        )
      ).status,
      401,
    );
    await db.execute(
      "DELETE FROM partner_workshop_details WHERE workshop_id=?",
      [wid],
    );
    await propose(db, wid, ids[1], {
      ...input,
      name: "TEST legacy details restored",
    });
    const legacy = (await pending()).reviewVersion;
    assert.equal((await decide(legacy)).status, 200);
    const restored = (await request("/api/customer/partners/" + wid)).data
      .workshop;
    assert.deepEqual(restored.vehicleTypes, ["motor"]);
    assert.equal(restored.hours.open, "08:00");
    // Browser lifecycle emulation: back/forward cache must restart a single timer.
    const listeners = {},
      documentEvents = {},
      timers = new Set(),
      created = [];
    let sequence = 0;
    const element = () => ({
        textContent: "",
        append() {},
        after() {},
        setAttribute() {},
        addEventListener() {},
      }),
      nav = element();
    const document = {
      hidden: false,
      getElementById: () => null,
      querySelector: () => nav,
      createElement: () => {
        const n = element();
        created.push(n);
        return n;
      },
      addEventListener: (name, fn) => {
        documentEvents[name] = fn;
      },
    };
    vm.runInNewContext(
      fs.readFileSync(require.resolve("../public/notifications.js"), "utf8"),
      {
        document,
        window: {
          addEventListener: (name, fn) => {
            listeners[name] = fn;
          },
        },
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ data: [], unreadCount: 105 }),
        }),
        setInterval: () => {
          const id = ++sequence;
          timers.add(id);
          return id;
        },
        clearInterval: (id) => timers.delete(id),
      },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(created[0].textContent, "Notifikasi (105)");
    assert.equal(timers.size, 1);
    listeners.pagehide();
    assert.equal(timers.size, 0);
    listeners.pageshow({ persisted: true });
    assert.equal(timers.size, 1);
    listeners.pageshow({ persisted: true });
    assert.equal(timers.size, 1);
    listeners.pagehide();
    assert.equal(timers.size, 0);
    console.log(
      "PASS empat revisi: initial/revision token wajib, stale/replay ditolak, snapshot foto terbaru, foto derek pending dipertahankan, unread seluruh data, timer Back/Forward hidup tanpa duplikasi.",
    );
  } finally {
    if (wid) {
      await db.execute("DELETE FROM partner_workshops WHERE id=?", [wid]);
    }
    for (const id of ids) {
      await db.execute(
        "DELETE FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",
        [id],
      );
      await db.execute("DELETE FROM users WHERE id=?", [id]);
    }
    await new Promise((r) => server.close(r));
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
