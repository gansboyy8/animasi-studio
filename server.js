"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_PROMPT_CHARS = 6000;

function loadDotEnv(filePath = path.join(ROOT, ".env")) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readObjectSetting(value, fallback, name) {
  if (!value) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} harus berisi JSON yang valid.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} harus berupa objek JSON.`);
  }
  return parsed;
}

function modelSettings(env, type) {
  if (type === "video") {
    return {
      model: env.FAL_VIDEO_MODEL_ID || "fal-ai/veo3",
      input: {
        duration: "8s",
        aspect_ratio: "16:9",
        resolution: "720p",
        generate_audio: false,
        ...readObjectSetting(env.FAL_VIDEO_INPUT_JSON, {}, "FAL_VIDEO_INPUT_JSON")
      },
      promptField: "prompt"
    };
  }
  return {
    model: env.FAL_SFX_MODEL_ID || "fal-ai/elevenlabs/sound-effects",
    input: {
      duration_seconds: 4,
      enable_safety_checker: true,
      ...readObjectSetting(env.FAL_SFX_INPUT_JSON, {}, "FAL_SFX_INPUT_JSON")
    },
    promptField: "text"
  };
}

function validModelId(value) {
  return /^[a-z0-9][a-z0-9/_-]{1,159}$/i.test(value);
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Permintaan terlalu besar."), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Isi permintaan harus berupa JSON yang valid."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function providerRequest(url, apiKey, fetchImpl, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Key ${apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      },
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new Error(`Tidak dapat menghubungi fal.ai: ${error.message}`);
  }
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail
      : typeof data.error === "string" ? data.error
        : typeof data.message === "string" ? data.message : `fal.ai mengembalikan HTTP ${response.status}.`;
    const error = new Error(detail.slice(0, 500));
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function collectMediaUrls(value, urls = [], depth = 0) {
  if (!value || depth > 5 || urls.length >= 12) return urls;
  if (typeof value === "string") {
    if (/^https:\/\/[^\s"'<>]+$/i.test(value)) urls.push(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, urls, depth + 1);
    return urls;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/^(url|video_url|audio_url)$/i.test(key) && typeof nested === "string") {
        collectMediaUrls(nested, urls, depth + 1);
      } else if (nested && typeof nested === "object") {
        collectMediaUrls(nested, urls, depth + 1);
      }
    }
  }
  return urls;
}

function createServer({ env = process.env, fetchImpl = globalThis.fetch, jobs = new Map() } = {}) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      return jsonResponse(res, 400, { error: "Path URL tidak valid." });
    }
    if (pathname.startsWith("/api/") && !isLocalApiRequest(req)) {
      return jsonResponse(res, 403, { error: "Permintaan API hanya menerima origin lokal yang sama." });
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const keyReady = Boolean(env.FAL_KEY);
      let video;
      let sfx;
      try {
        video = modelSettings(env, "video");
        sfx = modelSettings(env, "sfx");
      } catch (error) {
        return jsonResponse(res, 200, {
          provider: "fal.ai",
          keyConfigured: keyReady,
          video: { model: env.FAL_VIDEO_MODEL_ID || "fal-ai/veo3", ready: false },
          sfx: { model: env.FAL_SFX_MODEL_ID || "fal-ai/elevenlabs/sound-effects", ready: false },
          configurationError: error.message
        });
      }
      return jsonResponse(res, 200, {
        provider: "fal.ai",
        keyConfigured: keyReady,
        video: { model: video.model, ready: keyReady && validModelId(video.model) },
        sfx: { model: sfx.model, ready: keyReady && validModelId(sfx.model) }
      });
    }

    if (req.method === "POST" && pathname === "/api/generations") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return jsonResponse(res, error.status || 400, { error: error.message });
      }
      const type = body.type;
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (type !== "video" && type !== "sfx") return jsonResponse(res, 400, { error: "Jenis generasi harus video atau sfx." });
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        return jsonResponse(res, 400, { error: `Prompt wajib diisi dan maksimal ${MAX_PROMPT_CHARS} karakter.` });
      }
      if (!env.FAL_KEY) {
        return jsonResponse(res, 503, { error: "Generasi AI belum dikonfigurasi. Isi FAL_KEY di file .env server untuk mengaktifkan fal.ai. Tidak ada permintaan atau biaya yang dibuat." });
      }
      let settings;
      try {
        settings = modelSettings(env, type);
      } catch (error) {
        return jsonResponse(res, 500, { error: error.message });
      }
      if (!validModelId(settings.model)) return jsonResponse(res, 500, { error: `ID model ${type} tidak valid. Periksa konfigurasi server.` });

      try {
        const upstream = await providerRequest(
          `https://queue.fal.run/${settings.model}`,
          env.FAL_KEY,
          fetchImpl,
          {
            method: "POST",
            body: JSON.stringify({ ...settings.input, [settings.promptField]: prompt })
          }
        );
        if (typeof upstream.request_id !== "string" || !upstream.request_id) {
          throw new Error("fal.ai tidak mengembalikan ID antrean.");
        }
        const statusUrl = upstream.status_url;
        const responseUrl = upstream.response_url;
        if (!isQueueUrl(statusUrl) || !isQueueUrl(responseUrl)) {
          throw new Error("fal.ai mengembalikan alamat antrean yang tidak valid.");
        }
        const id = randomUUID();
        const job = {
          id,
          type,
          model: settings.model,
          requestId: upstream.request_id,
          statusUrl,
          responseUrl,
          status: "IN_QUEUE",
          queuePosition: Number.isInteger(upstream.queue_position) ? upstream.queue_position : null,
          createdAt: new Date().toISOString(),
          result: null,
          error: null
        };
        jobs.set(id, job);
        return jsonResponse(res, 202, publicJob(job));
      } catch (error) {
        return jsonResponse(res, 502, { error: `Permintaan ke fal.ai gagal: ${error.message}` });
      }
    }

    const jobMatch = pathname.match(/^\/api\/generations\/([0-9a-f-]{36})$/i);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return jsonResponse(res, 404, { error: "Job tidak ditemukan di server ini. Server mungkin telah dimulai ulang." });
      if (job.status === "COMPLETED" || job.status === "FAILED") return jsonResponse(res, 200, publicJob(job));
      try {
        const status = await providerRequest(job.statusUrl, env.FAL_KEY, fetchImpl);
        job.status = status.status;
        job.queuePosition = Number.isInteger(status.queue_position) ? status.queue_position : null;
        if (status.status === "COMPLETED") {
          if (status.error) {
            job.status = "FAILED";
            job.error = String(status.error).slice(0, 500);
          } else {
            const result = await providerRequest(job.responseUrl, env.FAL_KEY, fetchImpl);
            const urls = collectMediaUrls(result);
            if (!urls.length) {
              job.status = "FAILED";
              job.error = "fal.ai selesai tetapi tidak mengembalikan URL media yang bisa diputar.";
            } else {
              job.status = "COMPLETED";
              job.result = { urls, raw: result };
            }
          }
        } else if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
          job.status = "FAILED";
          job.error = `Status job dari fal.ai tidak dikenali: ${String(status.status || "kosong")}.`;
        }
        return jsonResponse(res, 200, publicJob(job));
      } catch (error) {
        if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          job.status = "FAILED";
          job.error = `fal.ai menolak pemeriksaan job: ${error.message}`;
          return jsonResponse(res, 200, publicJob(job));
        }
        return jsonResponse(res, 502, {
          error: `Status fal.ai sementara tidak dapat diperiksa: ${error.message}`,
          job: publicJob(job)
        });
      }
    }

    if (pathname.startsWith("/api/")) return jsonResponse(res, 404, { error: "Endpoint API tidak ditemukan." });
    if (req.method !== "GET" && req.method !== "HEAD") return jsonResponse(res, 405, { error: "Metode tidak diizinkan." });

    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(ROOT, `.${requested}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) return jsonResponse(res, 403, { error: "Akses ditolak." });
    fs.readFile(filePath, (error, content) => {
      if (error) return jsonResponse(res, 404, { error: "File tidak ditemukan." });
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(req.method === "HEAD" ? undefined : content);
    });
  });
  return server;
}

function isQueueUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).origin === "https://queue.fal.run";
  } catch {
    return false;
  }
}

function isLocalApiRequest(req) {
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== "string") return false;
  let host;
  try {
    host = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.protocol === "http:" && parsedOrigin.host === host.host;
  } catch {
    return false;
  }
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    model: job.model,
    status: job.status,
    queuePosition: job.queuePosition,
    createdAt: job.createdAt,
    result: job.result ? { urls: job.result.urls } : null,
    error: job.error
  };
}

if (require.main === module) {
  loadDotEnv();
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Animasi Studio Gan berjalan di http://${host}:${port}`);
    if (!process.env.FAL_KEY) console.log("Generasi AI belum aktif: FAL_KEY belum diatur; tidak ada biaya yang dapat dibuat.");
  });
}

module.exports = { createServer, loadDotEnv, modelSettings, collectMediaUrls };
