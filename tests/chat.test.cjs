const assert = require("node:assert/strict");
const express = require("express");
const { createChatRouter } = require("../chat-routes");

(async () => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";

  let mode = "normal",
    calls = 0;

  const fakeFetch = async (url, options = {}) => {
    calls++;
    assert.ok(String(url).includes(":generateContent"));
    assert.equal(options.headers["x-goog-api-key"], "test-gemini-key");
    const body = JSON.parse(options.body);
    const lastText = body.contents.at(-1).parts[0].text.toLowerCase();

    if (mode === "bad") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "broken-json" }] } }],
        }),
      };
    }
    if (mode === "missing") {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (mode === "slow") {
      await new Promise((r) => setTimeout(r, 200));
    }

    const isBrakeDanger =
      lastText.includes("rem") && lastText.includes("blong");
    const isFuelDanger = lastText.includes("bensin bocor");
    const isAC = lastText.includes("ac mobil");

    const reply = {
      jawaban: isBrakeDanger
        ? "Jangan kendarai kendaraan. Rem blong sangat berbahaya, segera menepi di tempat aman."
        : isFuelDanger
          ? "Matikan mesin segera karena kebocoran bensin berisiko kebakaran."
          : isAC
            ? "Periksa freon, kompresor, dan kondensor AC di bengkel."
            : "Periksa kondisi aki, relay starter, dan dinamo starter di bengkel.",
      kemungkinan_penyebab: ["Komponen perlu diperiksa mekanik"],
      kategori_layanan: isAC ? ["AC"] : ["Aki", "Starter"],
      tingkat_urgensi:
        isBrakeDanger || isFuelDanger ? "darurat" : "perlu_pemeriksaan",
      catatan: "Lakukan pemeriksaan fisik oleh mekanik bengkel.",
    };

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
      }),
    };
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.sessionID = req.headers["x-test-session"] || "one";
    next();
  });
  app.use(createChatRouter({ fetchImpl: fakeFetch }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (message, session = "one") =>
    fetch(base + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-session": session,
      },
      body: JSON.stringify({ message }),
    });

  try {
    assert.equal((await post("")).status, 400);
    assert.equal((await post("x".repeat(1501))).status, 400);
    assert.equal(calls, 0);

    let r = await post("Motor sulit distarter");
    assert.equal(r.status, 200);
    let data = await r.json();
    assert.equal(data.bengkel, undefined);
    assert.equal(data.metode_pemilihan, "gemini_ai");
    assert.ok(data.jawaban.length > 0);

    data = await (await fetch(base + "/api/chat")).json();
    assert.equal(data.messages.length, 2);
    data = await (
      await fetch(base + "/api/chat", { headers: { "x-test-session": "two" } })
    ).json();
    assert.equal(data.messages.length, 0);

    data = await (await post("remnya blong")).json();
    assert.equal(data.tingkat_urgensi, "darurat");

    // Once hazard is triggered in session, urgency stays darurat until reset
    data = await (await post("Bagaimana kalau pelan-pelan saja?")).json();
    assert.equal(data.tingkat_urgensi, "darurat");

    await fetch(base + "/api/chat", { method: "DELETE" });
    mode = "bad";
    assert.equal((await post("tes")).status, 502);
    mode = "missing";
    assert.equal((await post("tes")).status, 503);

    mode = "slow";
    const first = post("keluhan pertama");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await post("keluhan kedua paralel")).status, 429);
    assert.equal(
      (await fetch(base + "/api/chat", { method: "DELETE" })).status,
      429,
    );
    await first;
    assert.equal(
      (await fetch(base + "/api/chat", { method: "DELETE" })).status,
      200,
    );

    console.log(
      "PASS chat Gemini: validasi, isolasi sesi, bahaya darurat, error handling, dan proteksi sesi aktif.",
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
