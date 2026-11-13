const assert = require("node:assert/strict"),
  db = require("../db"),
  app = require("../login"),
  bcrypt = require("bcrypt"),
  sharp = require("sharp");
const {
  propose,
  reviewRevision,
} = require("../kunciGarasi/services/revisions");
const { withTransaction } = require("../kunciGarasi/services/transaction");
const {
  decodeImage,
  removePhotos,
} = require("../kunciGarasi/services/partner-media");
const { validateRegistration } = require("../kunciGarasi/lib/partner-input");
(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port,
    ids = [],
    cookies = [],
    password = "Six-fixes-9384!",
    ip =
      "198.18." +
      Math.floor(Math.random() * 256) +
      "." +
      Math.floor(Math.random() * 256);
  let wid,
    photos = [];
  const request = async (path, method = "GET", body, index = 0) => {
    if (path.endsWith("/review") && body && !body.reviewVersion) {
      const response = await fetch(base + "/api/admin/partners", {
        headers: { cookie: cookies[index] },
      });
      const pending = await response.json();
      body = {
        ...body,
        reviewVersion:
          pending.data?.find((w) => w.id === Number(path.split("/").at(-2)))
            ?.reviewVersion || "stale",
      };
    }
    const response = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": ip,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookies[index] ? { cookie: cookies[index] } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    for (let i = 0; i < 3; i++) {
      const email = "six-" + Date.now() + "-" + i + "@example.test";
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
      name: "TEST six original",
      address: "Alamat uji",
      phone: "08123456789",
      lat: -7.37,
      lng: 112.75,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1, 2, 3], open: "08:00", close: "17:00" },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "2026-11-07",
    });
    const [w] = await db.execute(
      "INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,status) VALUES (?,?,?,?,?,?,?,'approved')",
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
    const valid = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "#445566" },
    })
      .png()
      .toBuffer();
    const output = await decodeImage(valid);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.orientation, undefined);
    for (const broken of [
      Buffer.from([255, 216, 255]),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      valid.subarray(0, 35),
      Buffer.from("<svg></svg>"),
    ])
      await assert.rejects(
        () => decodeImage(broken),
        (e) => e.status === 400,
      );
    const data = new FormData();
    data.append(
      "workshopPhotos",
      new Blob([valid], { type: "image/png" }),
      "shop.png",
    );
    data.append(
      "towPhoto",
      new Blob([valid], { type: "image/png" }),
      "tow.png",
    );
    assert.equal(
      (
        await request(
          "/api/owner/workshops/" + wid + "/photos",
          "POST",
          data,
          1,
        )
      ).status,
      200,
    );
    let [revs] = await db.execute(
      "SELECT proposal FROM workshop_revisions WHERE workshop_id=?",
      [wid],
    );
    photos = (
      typeof revs[0].proposal === "string"
        ? JSON.parse(revs[0].proposal)
        : revs[0].proposal
    ).photos;
    assert(photos.some((p) => p.kind === "tow"));
    assert.equal(
      (
        await request(
          "/api/owner/workshops/" + wid,
          "PUT",
          { ...input, pickup: true },
          1,
        )
      ).status,
      200,
    );
    const detail = (await request("/api/customer/partners/" + wid)).data
      .workshop;
    assert.equal(detail.pickup, false);
    assert.equal(
      (
        await request(
          "/api/admin/partners/" + wid + "/review",
          "POST",
          { status: "approved", note: "Foto derek dan revisi diperiksa" },
          2,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/customer/partners/" + wid)).data.workshop.pickup,
      true,
    );
    const trials = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        request("/api/support/tickets", "POST", {
          message: "Tiket paralel " + n,
        }),
      ),
    );
    assert.equal(trials.filter((r) => r.status === 201).length, 5);
    assert.equal(trials.filter((r) => r.status === 429).length, 5);
    const ticket = trials.find((r) => r.status === 201).data.id;
    assert.equal(
      (
        await request(
          "/api/admin/support-tickets/" + ticket,
          "PATCH",
          { reply: "Sudah diperiksa" },
          2,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/admin/support-tickets/" + ticket,
          "PATCH",
          { reply: "Duplikat" },
          2,
        )
      ).status,
      409,
    );
    const notifications = (
      await request("/api/notifications")
    ).data.data.filter((n) => n.title === "Balasan tiket bantuan");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].order_id, null);
    assert.equal(
      (
        await request("/api/notifications", "GET", undefined, 1)
      ).data.data.filter((n) => n.title === "Balasan tiket bantuan").length,
      0,
    );
    let calls = 0,
      rollbacks = 0,
      released = 0;
    const fake = {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {
          rollbacks++;
        },
        release: () => {
          released++;
        },
      }),
    };
    assert.equal(
      await withTransaction(fake, async () => {
        if (++calls === 1)
          throw Object.assign(Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
        return "ok";
      }),
      "ok",
    );
    assert.equal(calls, 2);
    assert.equal(rollbacks, 1);
    assert.equal(released, 2);
    await propose(db, wid, ids[1], { ...input, photos: undefined });
    const concurrent = await Promise.allSettled([
      propose(db, wid, ids[1], { ...input, name: "TEST six revised" }),
      reviewRevision(db, wid, ids[2], {
        status: "approved",
        note: "Uji serentak",
        googlePlaceId: null,
        reviewVersion: "stale-concurrent-test",
      }),
    ]);
    assert(
      concurrent.every(
        (r) => r.status === "fulfilled" || r.reason?.status === 409,
      ),
    );
    await propose(db, wid, ids[1], {
      ...input,
      name: "TEST must not reactivate",
    });
    assert.equal(
      (
        await request(
          "/api/account",
          "DELETE",
          { password, confirmation: "HAPUS AKUN" },
          1,
        )
      ).status,
      200,
    );
    const [cancelled] = await db.execute(
      "SELECT status FROM workshop_revisions WHERE workshop_id=?",
      [wid],
    );
    assert.equal(cancelled[0].status, "rejected");
    assert.equal(
      (
        await request(
          "/api/admin/partners/" + wid + "/review",
          "POST",
          { status: "approved", note: "Coba revisi lama" },
          2,
        )
      ).status,
      409,
    );
    const [still] = await db.execute(
      "SELECT status FROM partner_workshops WHERE id=?",
      [wid],
    );
    assert.equal(still[0].status, "rejected");
    assert(
      !(
        await request("/api/admin/partners", "GET", undefined, 2)
      ).data.data.some((w) => w.id === wid),
    );
    console.log(
      "PASS enam revisi: akun nonaktif tidak direaktivasi, foto derek pending dikenali, lock seragam/retry, notifikasi balasan tunggal, batas tiket paralel, decode gambar utuh dan normalisasi metadata.",
    );
  } finally {
    if (wid) {
      await db.execute("DELETE FROM partner_workshops WHERE id=?", [wid]);
    }
    await removePhotos(photos);
    for (const id of ids) {
      await db.execute("DELETE FROM support_tickets WHERE user_id=?", [id]);
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
