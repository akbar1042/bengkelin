const testIP =
  "198.18." +
  Math.floor(Math.random() * 256) +
  "." +
  Math.floor(Math.random() * 256);
const assert = require("node:assert/strict"),
  db = require("../db"),
  app = require("../login");
const { regionLabel } = require("../kunciGarasi/routes/location");
const { removePhotos } = require("../kunciGarasi/services/partner-media");
(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let userId,
    photos = [];
  const email = "feature-test-" + Date.now() + "@example.test",
    password = "Test-password-9384!";
  const post = (origin, url, data, cookie) =>
    fetch(origin + url, {
      method: "POST",
      headers: {
        "X-Forwarded-For": testIP,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(data),
      redirect: "manual",
    });
  try {
    for (const route of [
      "/",
      "/registrasi-mitra.html",
      "/partner-terms.html",
      "/partner-privacy.html",
    ])
      assert.equal((await fetch(base + route)).status, 200, route);
    for (const route of ["/ai.html", "/search.html", "/landing.html"])
      assert.equal(
        (await fetch(base + route, { redirect: "manual" })).headers.get(
          "location",
        ),
        "/login.html",
      );
    const input = {
      name: "TEST ONLY",
      address: "Alamat pengujian",
      phone: "08123456789",
      lat: -7.37,
      lng: 112.75,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1, 2], open: "08:00", close: "17:00" },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "2026-11-07",
    };
    const submit = async (accepted) => {
      const data = new FormData();
      data.append(
        "data",
        JSON.stringify({ ...input, termsAccepted: accepted }),
      );
      data.append("account", JSON.stringify({ email, password }));
      data.append(
        "workshopPhotos",
        new Blob(
          [
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwCU1zCU1jgFAAG2oD/ST9ke8AAAAASUVORK5CYII=",
              "base64",
            ),
          ],
          { type: "image/png" },
        ),
        "shop.png",
      );
      return fetch(base + "/api/mitra-register", {
        method: "POST",
        body: data,
      });
    };
    assert.equal((await submit(false)).status, 400);
    const registered = await submit(true);
    assert.equal(registered.status, 201, await registered.text());
    const [rows] = await db.execute("SELECT id FROM users WHERE email=?", [
      email,
    ]);
    userId = rows[0].id;
    const login = await post(base, "/api/login", { email, password });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).redirect, "/landing.html");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const customerHome = await fetch(base + "/landing.html", {
      headers: { cookie },
    });
    assert.equal(customerHome.status, 200);
    const landingText = await customerHome.text();
    assert.match(landingText, /data-landing-logout/);
    assert.match(landingText, /vehicleType=motor/);
    assert.match(landingText, /vehicleType=mobil/);
    assert.doesNotMatch(
      landingText,
      /href="\/(?:login|registrasi|estimate)\.html"|data-requires-login/,
    );
    const rootWithSession = await fetch(base + "/", {
      headers: { cookie },
      redirect: "manual",
    });
    assert.equal(rootWithSession.headers.get("location"), "/landing.html");
    assert.equal(
      (await fetch(base + "/estimate.html", { headers: { cookie } })).status,
      404,
    );
    assert.equal((await post(base, "/api/estimate", {}, cookie)).status, 404);
    const aiPage = await (
      await fetch(base + "/ai.html", { headers: { cookie } })
    ).text();
    assert.match(aiPage, /chatVehicle/);
    assert.doesNotMatch(aiPage, /aiLocation|region-name\.js/);
    const mine = await (
      await fetch(base + "/api/partners/mine", { headers: { cookie } })
    ).json();
    assert.deepEqual(mine.data[0].vehicleTypes, ["motor"]);
    photos = mine.data[0].photos;
    assert.equal(photos.length, 1);
    assert.equal(mine.data[0].status, "pending");
    assert.equal(
      (await fetch(base + photos[0].url, { headers: { cookie } })).status,
      200,
    );
    for (const route of [
      "/forgot-password.html",
      "/reset-password.html",
      "/password-reset.js",
    ])
      assert.equal((await fetch(base + route)).status, 404, route);
    for (const route of ["/api/forgot-password", "/api/reset-password"])
      assert.equal(
        (await post(base, route, { email, password })).status,
        404,
        route,
      );
    for (const route of [
      "/login.html",
      "/login-mitra.html",
      "/registrasi.html",
    ]) {
      const page = await fetch(base + route);
      assert.equal(page.status, 200, route);
      assert.doesNotMatch(
        await page.text(),
        /lupa password|forgot-password|login google|google — belum tersedia/i,
        route,
      );
    }
    assert.equal(
      (await fetch(base + "/help.html", { redirect: "manual" })).headers.get(
        "location",
      ),
      "/login.html",
    );
    assert.equal(
      (await fetch(base + "/help.html", { headers: { cookie } })).status,
      200,
    );
    for (const route of [
      "/login.html",
      "/login-mitra.html",
      "/registrasi.html",
      "/registrasi-mitra.html",
      "/home.html",
    ]) {
      const blocked = await fetch(base + route, {
        headers: { cookie },
        redirect: "manual",
      });
      assert.equal(blocked.headers.get("location"), "/landing.html", route);
    }
    assert.equal(
      (
        await post(
          base,
          "/api/account/password",
          { currentPassword: password, password: "New-password-9938!" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await fetch(base + "/api/me", { headers: { cookie } })).status,
      401,
    );
    assert.equal(
      (
        await post(base, "/api/login", {
          email,
          password: "New-password-9938!",
        })
      ).status,
      200,
    );
    assert.equal(
      regionLabel([
        {
          address_components: [
            {
              long_name: "Kecamatan Sedati",
              types: ["administrative_area_level_3"],
            },
            {
              long_name: "Kabupaten Sidoarjo",
              types: ["administrative_area_level_2"],
            },
          ],
        },
      ]),
      "Sedati, Sidoarjo",
    );
    console.log(
      "PASS fitur: route publik/proteksi, syarat wajib, upload dan kategori mitra, route pemulihan dihapus, ganti password dan pencabutan sesi, nama wilayah, landing pelanggan dan penghapusan estimasi.",
    );
  } finally {
    if (!userId) {
      const [rows] = await db.execute("SELECT id FROM users WHERE email=?", [
        email,
      ]);
      userId = rows[0]?.id;
    }
    if (userId) {
      await db.execute("DELETE FROM partner_workshops WHERE owner_user_id=?", [
        userId,
      ]);
      await db.execute("DELETE FROM users WHERE id=?", [userId]);
    }
    await removePhotos(photos);
    await new Promise((r) => server.close(r));
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
