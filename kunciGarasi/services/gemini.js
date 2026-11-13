const { modelQueue } = require("./model-queue");

const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];

function getGeminiConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-3.5-flash").trim();
  const baseUrl = (
    process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");
  return { apiKey, model, baseUrl };
}

async function generateStructured({
  systemInstruction,
  history = [],
  userMessage,
  responseSchema,
  temperature = 0.2,
  maxOutputTokens = 2048,
  timeoutMs = 60000,
  fetchImpl = fetch,
}) {
  const { apiKey, model, baseUrl } = getGeminiConfig();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY belum dikonfigurasi di .env.");
    err.status = 503;
    throw err;
  }

  const contents = [];
  for (const m of history) {
    if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
    contents.push({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  const body = {
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    },
  };

  const candidates = [...new Set([model, ...FALLBACK_MODELS])];
  let response;

  try {
    response = await modelQueue.run(async () => {
      let lastRes, lastErr;
      const perAttemptMs =
        fetchImpl === fetch ? Math.min(timeoutMs, 15000) : timeoutMs;
      for (const candidateModel of candidates) {
        const url = `${baseUrl}/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
        try {
          lastRes = await fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(perAttemptMs),
          });
        } catch (e) {
          lastErr = e;
          if (fetchImpl !== fetch) throw e;
          continue;
        }
        if (lastRes.ok) return lastRes;
        // Jika fetch mock pada unit test bukan jaringan nyata atau error autentikasi, hentikan percobaan
        if (fetchImpl !== fetch || ![404, 429, 503].includes(lastRes.status)) {
          return lastRes;
        }
      }
      if (lastRes) return lastRes;
      throw lastErr || new Error("Layanan Gemini AI tidak dapat dihubungi.");
    });
  } catch (error) {
    const err = new Error(
      error.name === "TimeoutError"
        ? "AI melewati batas waktu. Coba keluhan lebih singkat."
        : "Layanan Gemini AI tidak dapat dihubungi.",
    );
    err.status = error.name === "TimeoutError" ? 504 : 503;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(
      response.status === 429
        ? "Kuota Gemini API sedang penuh. Coba lagi sebentar."
        : response.status === 400 || response.status === 403
          ? "Konfigurasi GEMINI_API_KEY atau GEMINI_MODEL tidak valid."
          : "Layanan Gemini AI belum siap.",
    );
    err.status = response.status === 429 ? 429 : 503;
    throw err;
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) {
    const err = new Error("Jawaban AI tidak lengkap. Coba lagi.");
    err.status = 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("Jawaban AI tidak lengkap. Coba lagi.");
    err.status = 502;
    throw err;
  }
}

module.exports = { getGeminiConfig, generateStructured };
