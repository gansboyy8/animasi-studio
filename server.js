"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { randomUUID } = require("node:crypto");
const { buildClipPlan, wordCount } = require("./lib/story-plan");

const ROOT = __dirname;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_PROMPT_CHARS = 6000;
const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

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

function localServiceUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} harus berupa URL lokal yang valid.`);
  }
  if (url.protocol !== "http:" || !ALLOWED_LOCAL_HOSTS.has(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} hanya boleh memakai HTTP localhost/127.0.0.1/[::1] tanpa kredensial.`);
  }
  return url.origin;
}

function localSettings(env) {
  const ollamaModel = env.OLLAMA_MODEL || "qwen2.5:3b";
  if (/(^|[-_:])cloud($|[-_:])/i.test(ollamaModel)) {
    throw new Error("OLLAMA_MODEL harus model lokal, bukan model cloud.");
  }
  return {
    ollamaUrl: localServiceUrl(env.OLLAMA_URL || "http://127.0.0.1:11434", "OLLAMA_URL"),
    ollamaModel,
    comfyUrl: localServiceUrl(env.COMFYUI_URL || "http://127.0.0.1:8188", "COMFYUI_URL"),
    videoWorkflow: env.COMFYUI_VIDEO_WORKFLOW || "",
    sfxWorkflow: env.COMFYUI_SFX_WORKFLOW || ""
  };
}

function workflowPath(configuredPath, name) {
  if (!configuredPath) throw new Error(`${name} belum diatur; workflow ComfyUI belum siap.`);
  const resolved = path.resolve(ROOT, configuredPath);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`${name} harus menunjuk file di dalam folder proyek.`);
  }
  return resolved;
}

function buildScriptRequest(idea, durationMinutes, style) {
  const plan = buildClipPlan(durationMinutes);
  const styleLabels = {
    paper: "paper-cut storybook animation, soft tactile paper texture",
    clay: "warm expressive stop-motion clay animation",
    dream: "colorful expressive 2D dreamlike animation"
  };
  const systemPrompt = [
    "You are a professional Indonesian animated-short-film screenwriter and storyboard artist.",
    "Create an original family-friendly story. Respond with valid JSON only, no Markdown fences and no text outside JSON.",
    "Use this exact JSON shape: {\"title\":\"...\",\"synopsis\":\"...\",\"script\":\"...\",\"scenes\":[{\"title\":\"...\",\"location\":\"...\",\"narration\":\"...\",\"visualPrompt\":\"...\",\"sfxPrompt\":\"...\"}]}",
    `The full spoken script must target approximately ${plan.targetWords} Indonesian words for ${plan.minutes} minutes at about ${plan.targetWords / plan.minutes} words per minute. Include natural narration and character dialogue in the script and scene narration.`,
    `Return exactly ${plan.clipSeconds.length} scenes, one per video clip, in chronological story order. Keep each scene concise and visually filmable. Preserve character design, setting details, and continuity between scene prompts.`,
    "Every visualPrompt must be an original self-contained animation shot description that repeats the key character identity and visual continuity; no copyrighted characters, logos, subtitles, or on-screen text.",
    "Every sfxPrompt must describe the most suitable specific sound effect or ambience for that scene (not music or speech), in natural language.",
    `Clip durations in order are ${plan.clipSeconds.map((seconds) => `${seconds}s`).join(", ")}; the combined video clips must total exactly ${plan.minutes} minutes.`,
    `Animation style direction: ${styleLabels[style] || styleLabels.paper}.`
  ].join(" ");
  const prompt = `Story idea from the user:\n${idea}\n\nCreate the requested script and storyboard. Make the ending satisfying and proportion the story beats across the requested runtime.`;
  return { plan, systemPrompt, prompt };
}

function parseGeneratedScript(result, plan) {
  if (typeof result.output !== "string" || !result.output.trim()) {
    throw new Error("Model lokal tidak mengembalikan teks output.");
  }
  const output = result.output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Output skrip AI bukan objek JSON yang valid.");
  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new Error("Output skrip AI tidak dapat dibaca sebagai JSON.");
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()
    || typeof parsed.synopsis !== "string" || !parsed.synopsis.trim()
    || typeof parsed.script !== "string" || !parsed.script.trim()
    || !Array.isArray(parsed.scenes) || parsed.scenes.length !== plan.clipSeconds.length) {
    throw new Error(`Skrip AI tidak lengkap: dibutuhkan judul, sinopsis, naskah, dan tepat ${plan.clipSeconds.length} adegan.`);
  }
  const count = wordCount(parsed.script);
  const minWords = Math.floor(plan.targetWords * 0.75);
  const maxWords = Math.ceil(plan.targetWords * 1.25);
  if (count < minWords || count > maxWords) {
    throw new Error(`Panjang naskah AI ${count} kata, di luar kisaran target ${minWords}–${maxWords} kata untuk ${plan.minutes} menit. Coba buat ulang.`);
  }
  const scenes = parsed.scenes.map((scene, index) => {
    for (const field of ["title", "location", "narration", "visualPrompt", "sfxPrompt"]) {
      if (typeof scene[field] !== "string" || !scene[field].trim()) {
        throw new Error(`Adegan ${index + 1} belum memiliki ${field}. Coba buat ulang naskah.`);
      }
      const fieldLimit = field === "visualPrompt" ? 1800 : field === "narration" ? 1200 : 800;
      if (scene[field].length > fieldLimit) throw new Error(`Bagian ${field} adegan ${index + 1} terlalu panjang.`);
    }
    return {
      title: scene.title.trim().slice(0, 120),
      location: scene.location.trim().slice(0, 160),
      narration: scene.narration.trim(),
      visual: scene.visualPrompt.trim(),
      sfx: scene.sfxPrompt.trim(),
      duration: plan.clipSeconds[index]
    };
  });
  return {
    title: parsed.title.trim().slice(0, 120),
    synopsis: parsed.synopsis.trim().slice(0, 2000),
    script: parsed.script.trim(),
    wordCount: count,
    targetWords: plan.targetWords,
    estimatedMinutes: Math.round(count / 130 * 10) / 10,
    durationMinutes: plan.minutes,
    totalSeconds: plan.totalSeconds,
    scenes
  };
}

async function localJsonRequest(url, fetchImpl, options = {}, timeoutMs = 30_000) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new Error(`Tidak dapat menghubungi layanan AI lokal: ${error.message}`);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = typeof data.error === "string" ? data.error
      : typeof data.detail === "string" ? data.detail
        : `Layanan AI lokal mengembalikan HTTP ${response.status}.`;
    const error = new Error(detail.slice(0, 500));
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function serviceHealth(url, pathName, fetchImpl) {
  return (await localServiceHealth(url, pathName, fetchImpl)).ready;
}

async function localServiceHealth(url, pathName, fetchImpl) {
  try {
    const data = await localJsonRequest(`${url}${pathName}`, fetchImpl, {}, 2500);
    return { ready: true, data };
  } catch (error) {
    return { ready: false, data: null, error: error.message };
  }
}

function readWorkflow(configuredPath, name, replacements) {
  const file = workflowPath(configuredPath, name);
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${name} tidak bisa dibaca sebagai JSON API workflow: ${error.message}`);
  }
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error(`${name} harus berupa workflow API ComfyUI (objek JSON).`);
  }
  const placeholders = new Set();
  const replace = (value) => {
    if (typeof value === "string") {
      const exactPlaceholder = value.match(/^\{\{(duration_seconds|seed)\}\}$/);
      if (exactPlaceholder) {
        placeholders.add(exactPlaceholder[1]);
        return replacements[exactPlaceholder[1]];
      }
      return value.replace(/\{\{(prompt|duration_seconds|seed)\}\}/g, (_match, key) => {
        placeholders.add(key);
        return String(replacements[key]);
      });
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replace(nested)]));
    }
    return value;
  };
  const resolved = replace(workflow);
  if (!placeholders.has("prompt")) throw new Error(`${name} harus menyertakan placeholder {{prompt}} pada input node.`);
  return resolved;
}

function collectComfyMedia(history, type, jobId) {
  const entry = history[jobId];
  if (!entry) return null;
  if (entry?.status?.status_str === "error") {
    throw new Error("Workflow ComfyUI gagal. Periksa terminal ComfyUI untuk detail node yang bermasalah.");
  }
  const outputs = entry?.outputs;
  if (!outputs || typeof outputs !== "object") return entry?.status?.completed ? [] : null;
  const extensions = type === "video" ? new Set([".mp4", ".webm"]) : new Set([".wav", ".mp3", ".flac", ".ogg"]);
  const media = [];
  for (const output of Object.values(outputs)) {
    if (!output || typeof output !== "object") continue;
    for (const value of Object.values(output)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item.filename !== "string" || typeof item.type !== "string") continue;
        const ext = path.extname(item.filename).toLowerCase();
        if (!extensions.has(ext)) continue;
        if (item.type !== "output" && item.type !== "temp") continue;
        media.push({
          filename: item.filename,
          subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
          type: item.type,
          extension: ext
        });
      }
    }
  }
  const unique = [...new Map(media.map((item) => [`${item.type}/${item.subfolder}/${item.filename}`, item])).values()];
  return unique.length ? unique : [];
}

function createServer({ env = process.env, fetchImpl = globalThis.fetch, jobs = new Map() } = {}) {
  const server = http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return jsonResponse(res, 400, { error: "Path URL tidak valid." });
    }
    if (pathname.startsWith("/api/") && !isLocalApiRequest(req)) {
      return jsonResponse(res, 403, { error: "Permintaan API hanya menerima origin lokal yang sama." });
    }

    let settings;
    let settingsError = null;
    try {
      settings = localSettings(env);
    } catch (error) {
      settings = null;
      settingsError = error.message;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      if (!settings) {
        return jsonResponse(res, 200, {
          provider: "local",
          configurationError: settingsError || "OLLAMA_URL dan COMFYUI_URL wajib berupa URL localhost.",
          ollama: { ready: false },
          comfyui: { ready: false },
          script: { ready: false, model: env.OLLAMA_MODEL || "qwen2.5:3b" },
          video: { ready: false, model: "Periksa konfigurasi URL ComfyUI." },
          sfx: { ready: false, model: "Periksa konfigurasi URL ComfyUI." }
        });
      }
      const [ollama, comfyReady] = await Promise.all([
        localServiceHealth(settings.ollamaUrl, "/api/tags", fetchImpl),
        serviceHealth(settings.comfyUrl, "/system_stats", fetchImpl)
      ]);
      const modelInstalled = Array.isArray(ollama.data?.models)
        && ollama.data.models.some((model) => model.name === settings.ollamaModel || model.model === settings.ollamaModel);
      const videoWorkflowReady = workflowReady(settings.videoWorkflow, "COMFYUI_VIDEO_WORKFLOW");
      const sfxWorkflowReady = workflowReady(settings.sfxWorkflow, "COMFYUI_SFX_WORKFLOW");
      return jsonResponse(res, 200, {
        provider: "local",
        noCloud: true,
        ollama: { ready: ollama.ready, modelReady: modelInstalled, model: settings.ollamaModel, url: settings.ollamaUrl },
        comfyui: { ready: comfyReady, url: settings.comfyUrl },
        script: {
          ready: ollama.ready && modelInstalled,
          model: !ollama.ready ? "Ollama belum berjalan" : modelInstalled ? settings.ollamaModel : `${settings.ollamaModel} belum ditemukan di Ollama`
        },
        video: {
          ready: comfyReady && videoWorkflowReady.ready,
          model: !comfyReady ? "ComfyUI belum berjalan" : videoWorkflowReady.ready ? "ComfyUI local workflow" : videoWorkflowReady.error
        },
        sfx: {
          ready: comfyReady && sfxWorkflowReady.ready,
          model: !comfyReady ? "ComfyUI belum berjalan" : sfxWorkflowReady.ready ? "ComfyUI local workflow" : sfxWorkflowReady.error
        }
      });
    }

    if (req.method === "POST" && pathname === "/api/scripts") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return jsonResponse(res, error.status || 400, { error: error.message });
      }
      const idea = typeof body.idea === "string" ? body.idea.trim() : "";
      if (!idea || idea.length > 1200) return jsonResponse(res, 400, { error: "Ide wajib diisi dan maksimal 1.200 karakter." });
      if (!settings) return jsonResponse(res, 500, { error: "URL Ollama lokal tidak valid. Periksa OLLAMA_URL di .env." });
      let request;
      try {
        request = buildScriptRequest(idea, body.durationMinutes, body.style);
      } catch (error) {
        return jsonResponse(res, 400, { error: error.message });
      }
      const id = randomUUID();
      const job = {
        id, type: "script", provider: "ollama", model: settings.ollamaModel,
        status: "IN_PROGRESS", queuePosition: null, createdAt: new Date().toISOString(),
        result: null, error: null, plan: request.plan
      };
      jobs.set(id, job);
      setImmediate(async () => {
        try {
          const output = await localJsonRequest(`${settings.ollamaUrl}/api/chat`, fetchImpl, {
            method: "POST",
            body: JSON.stringify({
              model: settings.ollamaModel,
              stream: false,
              format: "json",
              options: { temperature: 0.65, num_predict: 16000 },
              messages: [
                { role: "system", content: request.systemPrompt },
                { role: "user", content: request.prompt }
              ]
            })
          }, 10 * 60_000);
          const content = output.message?.content;
          job.result = { script: parseGeneratedScript({ output: content }, request.plan) };
          job.status = "COMPLETED";
        } catch (error) {
          job.status = "FAILED";
          job.error = error.message.slice(0, 500);
        }
      });
      return jsonResponse(res, 202, publicJob(job));
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
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) return jsonResponse(res, 400, { error: `Prompt wajib diisi dan maksimal ${MAX_PROMPT_CHARS} karakter.` });
      const durationSeconds = body.durationSeconds === undefined ? 8 : Number(body.durationSeconds);
      if (!Number.isInteger(durationSeconds) || ![4, 6, 8].includes(durationSeconds)) {
        return jsonResponse(res, 400, { error: "Durasi klip harus 4, 6, atau 8 detik." });
      }
      if (!settings) return jsonResponse(res, 500, { error: "URL ComfyUI lokal tidak valid. Periksa COMFYUI_URL di .env." });
      const workflowEnv = type === "video" ? settings.videoWorkflow : settings.sfxWorkflow;
      const workflowKey = type === "video" ? "COMFYUI_VIDEO_WORKFLOW" : "COMFYUI_SFX_WORKFLOW";
      let workflow;
      try {
        workflow = readWorkflow(workflowEnv, workflowKey, {
          prompt,
          duration_seconds: durationSeconds,
          seed: Math.floor(Math.random() * 2 ** 32)
        });
      } catch (error) {
        return jsonResponse(res, 503, { error: error.message });
      }
      const id = randomUUID();
      try {
        const queued = await localJsonRequest(`${settings.comfyUrl}/prompt`, fetchImpl, {
          method: "POST",
          body: JSON.stringify({ prompt: workflow })
        });
        if (typeof queued.prompt_id !== "string" || !queued.prompt_id) {
          throw new Error("ComfyUI tidak mengembalikan prompt_id. Pastikan workflow API valid.");
        }
        const job = {
          id, type, provider: "comfyui", model: "ComfyUI local workflow",
          comfyPromptId: queued.prompt_id, comfyUrl: settings.comfyUrl,
          status: "IN_QUEUE", queuePosition: null, createdAt: new Date().toISOString(),
          result: null, error: null
        };
        jobs.set(id, job);
        return jsonResponse(res, 202, publicJob(job));
      } catch (error) {
        return jsonResponse(res, 502, { error: `ComfyUI lokal gagal menerima workflow: ${error.message}` });
      }
    }

    const mediaMatch = pathname.match(/^\/api\/generations\/([0-9a-f-]{36})\/media\/(\d+)$/i);
    if (req.method === "GET" && mediaMatch) {
      const job = jobs.get(mediaMatch[1]);
      const asset = job?.result?.media?.[Number(mediaMatch[2])];
      if (!job || job.provider !== "comfyui" || !asset) return jsonResponse(res, 404, { error: "Media lokal tidak ditemukan." });
      const mediaUrl = new URL("/view", job.comfyUrl);
      mediaUrl.searchParams.set("filename", asset.filename);
      mediaUrl.searchParams.set("subfolder", asset.subfolder);
      mediaUrl.searchParams.set("type", asset.type);
      try {
        const media = await fetchImpl(mediaUrl, { signal: AbortSignal.timeout(60_000) });
        if (!media.ok) return jsonResponse(res, 502, { error: `ComfyUI tidak dapat mengirim media (HTTP ${media.status}).` });
        const mime = asset.extension === ".mp4" ? "video/mp4"
          : asset.extension === ".webm" ? "video/webm"
            : asset.extension === ".mp3" ? "audio/mpeg"
              : asset.extension === ".flac" ? "audio/flac"
                : asset.extension === ".ogg" ? "audio/ogg" : "audio/wav";
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff"
        });
        if (req.method === "HEAD") return res.end();
        await pipeline(Readable.fromWeb(media.body), res);
        return;
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        return jsonResponse(res, 502, { error: `Tidak dapat membaca media ComfyUI: ${error.message}` });
      }
    }

    const jobMatch = pathname.match(/^\/api\/generations\/([0-9a-f-]{36})$/i);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return jsonResponse(res, 404, { error: "Job tidak ditemukan di server ini. Server mungkin telah dimulai ulang." });
      if (job.status === "COMPLETED" || job.status === "FAILED") return jsonResponse(res, 200, publicJob(job));
      if (job.provider === "ollama") return jsonResponse(res, 200, publicJob(job));
      try {
        const history = await localJsonRequest(`${job.comfyUrl}/history/${encodeURIComponent(job.comfyPromptId)}`, fetchImpl);
        const media = collectComfyMedia(history, job.type, job.comfyPromptId);
        if (media === null) {
          job.status = "IN_PROGRESS";
          return jsonResponse(res, 200, publicJob(job));
        }
        if (!media.length) {
          job.status = "FAILED";
          job.error = `Workflow ComfyUI selesai tetapi tidak memiliki output ${job.type === "video" ? "MP4/WebM" : "audio"}. Periksa output node pada workflow.`;
        } else {
          job.status = "COMPLETED";
          job.result = {
            media,
            urls: media.map((_asset, index) => `/api/generations/${job.id}/media/${index}`)
          };
        }
        return jsonResponse(res, 200, publicJob(job));
      } catch (error) {
        return jsonResponse(res, 502, { error: `Status ComfyUI sementara tidak dapat diperiksa: ${error.message}`, job: publicJob(job) });
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

function workflowReady(configuredPath, name) {
  try {
    const file = workflowPath(configuredPath, name);
    const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error("bukan objek workflow.");
    if (!JSON.stringify(workflow).includes("{{prompt}}")) throw new Error("workflow harus memiliki placeholder {{prompt}}.");
    return { ready: true };
  } catch (error) {
    return { ready: false, error: error.message };
  }
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

function isLocalApiRequest(req) {
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== "string") return false;
  let host;
  try {
    host = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (!ALLOWED_LOCAL_HOSTS.has(host.hostname)) return false;
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
  const result = job.result
    ? (job.type === "script" ? { script: job.result.script } : { urls: job.result.urls })
    : null;
  return {
    id: job.id,
    type: job.type,
    provider: job.provider,
    model: job.model,
    status: job.status,
    queuePosition: job.queuePosition,
    createdAt: job.createdAt,
    result,
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
    if (process.env.FAL_KEY) console.warn("FAL_KEY diabaikan. Studio hanya mengirim permintaan ke Ollama/ComfyUI localhost.");
  });
}

module.exports = {
  createServer,
  loadDotEnv,
  localSettings,
  buildScriptRequest,
  parseGeneratedScript,
  readWorkflow,
  collectComfyMedia
};
