"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServer, buildScriptRequest, parseGeneratedScript, localSettings, readWorkflow, collectComfyMedia } = require("./server");
const { buildClipPlan, validateDurationMinutes } = require("./lib/story-plan");

const fixtureDir = path.join(__dirname, ".test-workflows");
const videoWorkflowPath = path.join(fixtureDir, "video-api.json");
const sfxWorkflowPath = path.join(fixtureDir, "sfx-api.json");
const localEnv = {
  OLLAMA_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "qwen2.5:3b",
  COMFYUI_URL: "http://127.0.0.1:8188",
  COMFYUI_VIDEO_WORKFLOW: ".test-workflows/video-api.json",
  COMFYUI_SFX_WORKFLOW: ".test-workflows/sfx-api.json"
};

test.before(() => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const workflow = {
    "1": {
      inputs: {
        prompt: "{{prompt}}",
        duration_seconds: "{{duration_seconds}}",
        seed: "{{seed}}"
      },
      class_type: "MockNode"
    }
  };
  fs.writeFileSync(videoWorkflowPath, JSON.stringify(workflow));
  fs.writeFileSync(sfxWorkflowPath, JSON.stringify(workflow));
});

test.after(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function makeScriptOutput(minutes = 1) {
  const plan = buildClipPlan(minutes);
  return {
    title: "Momo dan taman",
    synopsis: "Momo menolong taman malam.",
    script: Array(plan.targetWords).fill("Momo").join(" "),
    scenes: plan.clipSeconds.map((_duration, index) => ({
      title: `Adegan ${index + 1}`,
      location: "Taman malam",
      narration: "Momo mencari cahaya.",
      visualPrompt: "Kucing orisinal berjalan di taman malam.",
      sfxPrompt: "Angin malam dan langkah kaki."
    }))
  };
}

async function waitForJob(base, id) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${base}/api/generations/${id}`);
    const job = await response.json();
    if (job.status === "COMPLETED" || job.status === "FAILED") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Job lokal tidak selesai dalam waktu tes.");
}

test("duration planner covers limits with exact 4/6/8 second clips", () => {
  for (const minutes of [1, 10]) {
    const plan = buildClipPlan(minutes);
    assert.equal(plan.totalSeconds, minutes * 60);
    assert.equal(plan.clipSeconds.reduce((sum, duration) => sum + duration, 0), minutes * 60);
    assert.ok(plan.clipSeconds.every((duration) => [4, 6, 8].includes(duration)));
    assert.equal(plan.targetWords, minutes * 130);
  }
  assert.equal(buildClipPlan(1).clipSeconds.length, 8);
  assert.equal(buildClipPlan(10).clipSeconds.length, 75);
  for (const invalid of [0, -1, 1.5, 11, "abc"]) assert.throws(() => validateDurationMinutes(invalid), RangeError);
});

test("script prompts/parser preserve duration-aware scenes", () => {
  const { plan, systemPrompt } = buildScriptRequest("Seekor kucing menemukan taman ajaib.", 1, "clay");
  assert.match(systemPrompt, /130 Indonesian words for 1 minutes/);
  assert.match(systemPrompt, /exactly 8 scenes/);
  const parsed = parseGeneratedScript({ output: JSON.stringify(makeScriptOutput()) }, plan);
  assert.equal(parsed.wordCount, 130);
  assert.equal(parsed.scenes.length, 8);
  assert.deepEqual(parsed.scenes.map((scene) => scene.duration), plan.clipSeconds);
  assert.throws(() => parseGeneratedScript({ output: "not JSON" }, plan), /JSON/);
  assert.throws(() => parseGeneratedScript({ output: JSON.stringify({ ...makeScriptOutput(), scenes: [] }) }, plan), /tepat 8 adegan/);
});

test("local service URLs reject non-loopback hosts and cloud model names", () => {
  assert.throws(() => localSettings({ ...localEnv, OLLAMA_URL: "https://example.com" }), /localhost/);
  assert.throws(() => localSettings({ ...localEnv, COMFYUI_URL: "http://192.168.1.5:8188" }), /localhost/);
  assert.throws(() => localSettings({ ...localEnv, OLLAMA_MODEL: "gpt-oss:20b-cloud" }), /model lokal/);
});

test("workflow placeholders are inserted safely and media outputs are type filtered", () => {
  const workflow = readWorkflow(localEnv.COMFYUI_VIDEO_WORKFLOW, "video workflow", {
    prompt: "cat \"scene\"",
    duration_seconds: 6,
    seed: 123
  });
  assert.equal(workflow["1"].inputs.prompt, 'cat "scene"');
  assert.equal(workflow["1"].inputs.duration_seconds, 6);
  assert.equal(workflow["1"].inputs.seed, 123);
  const media = collectComfyMedia({
    "comfy-job": {
      outputs: {
        "1": {
          videos: [{ filename: "clip.mp4", subfolder: "studio", type: "output" }],
          images: [{ filename: "preview.png", subfolder: "", type: "output" }]
        }
      }
    }
  }, "video", "comfy-job");
  assert.equal(media.length, 1);
  assert.equal(media[0].filename, "clip.mp4");
  assert.throws(() => readWorkflow("../../outside.json", "workflow", { prompt: "p", duration_seconds: 4, seed: 1 }), /folder proyek/);
});

test("health reports local service and workflow readiness without cloud calls", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/api/tags")) return jsonResponse({ models: [{ name: "qwen2.5:3b" }] });
    if (String(url).endsWith("/system_stats")) return jsonResponse({ devices: [] });
    throw new Error(`unexpected URL ${url}`);
  };
  await withServer({ env: { ...localEnv, FAL_KEY: "intentionally-ignored" }, fetchImpl }, async (base) => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.provider, "local");
    assert.equal(health.noCloud, true);
    assert.equal(health.script.ready, true);
    assert.equal(health.video.ready, true);
    assert.equal(health.sfx.ready, true);
    assert.ok(calls.every((url) => url.startsWith("http://127.0.0.1:")));
  });
});

test("local health explains missing model and rejects invalid service URLs without fetching", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({ models: [] }); };
  await withServer({ env: { ...localEnv, OLLAMA_MODEL: "missing:1b", COMFYUI_URL: "http://192.168.1.5:8188" }, fetchImpl }, async (base) => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.match(health.configurationError, /localhost/);
    assert.equal(health.script.ready, false);
    assert.equal(calls, 0);
  });
  await withServer({ env: { ...localEnv, OLLAMA_MODEL: "missing:1b" }, fetchImpl }, async (base) => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.ollama.ready, true);
    assert.equal(health.script.ready, false);
    assert.match(health.script.model, /belum ditemukan/);
  });
});

test("Ollama script job uses local chat API and returns duration-aware story", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/chat")) {
      const request = JSON.parse(options.body);
      assert.equal(request.model, "qwen2.5:3b");
      assert.equal(request.stream, false);
      assert.equal(request.format, "json");
      assert.match(request.messages[0].content, /exactly 8 scenes/);
      return jsonResponse({ message: { content: JSON.stringify(makeScriptOutput()) } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  await withServer({ env: { ...localEnv, FAL_KEY: "unused" }, fetchImpl }, async (base) => {
    const response = await fetch(`${base}/api/scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "Seekor kucing menemukan taman ajaib.", durationMinutes: 1, style: "clay" })
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    const completed = await waitForJob(base, created.id);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.provider, "ollama");
    assert.equal(completed.result.script.durationMinutes, 1);
    assert.equal(completed.result.script.scenes.length, 8);
    assert.ok(calls.every(({ url }) => url.startsWith("http://127.0.0.1:")));
  });
});

test("ComfyUI workflow jobs submit locally, poll outputs, and proxy generated media", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = new URL(String(url));
    calls.push({ url: parsedUrl, options });
    if (parsedUrl.pathname === "/prompt" && options.method === "POST") {
      const request = JSON.parse(options.body);
      assert.equal(request.prompt["1"].inputs.prompt, "A storybook scene");
      assert.equal(request.prompt["1"].inputs.duration_seconds, 6);
      return jsonResponse({ prompt_id: "comfy-video-1" });
    }
    if (parsedUrl.pathname === "/history/comfy-video-1") {
      return jsonResponse({
        "comfy-video-1": {
          status: { status_str: "success", completed: true },
          outputs: { "1": { videos: [{ filename: "clip.mp4", subfolder: "animasi", type: "output" }] } }
        }
      });
    }
    if (parsedUrl.pathname === "/view") {
      assert.equal(parsedUrl.searchParams.get("filename"), "clip.mp4");
      return new Response(Buffer.from("mock local video"), { headers: { "Content-Type": "video/mp4" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  await withServer({ env: localEnv, fetchImpl }, async (base) => {
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "A storybook scene", durationSeconds: 6 })
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    const completed = await waitForJob(base, created.id);
    assert.equal(completed.status, "COMPLETED");
    const mediaResponse = await fetch(`${base}${completed.result.urls[0]}`);
    assert.equal(mediaResponse.headers.get("content-type"), "video/mp4");
    assert.equal(await mediaResponse.text(), "mock local video");
    assert.ok(calls.every(({ url }) => url.hostname === "127.0.0.1"));
  });
});

test("ComfyUI audio workflow returns local SFX playback URL", async () => {
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = new URL(String(url));
    if (parsedUrl.pathname === "/prompt" && options.method === "POST") {
      const request = JSON.parse(options.body);
      assert.equal(request.prompt["1"].inputs.prompt, "A soft night breeze");
      assert.equal(request.prompt["1"].inputs.duration_seconds, 4);
      return jsonResponse({ prompt_id: "comfy-sfx-1" });
    }
    if (parsedUrl.pathname === "/history/comfy-sfx-1") {
      return jsonResponse({
        "comfy-sfx-1": {
          status: { status_str: "success", completed: true },
          outputs: { "1": { audio: [{ filename: "ambience.wav", subfolder: "animasi", type: "output" }] } }
        }
      });
    }
    if (parsedUrl.pathname === "/view") {
      assert.equal(parsedUrl.searchParams.get("filename"), "ambience.wav");
      return new Response(Buffer.from("mock local audio"), { headers: { "Content-Type": "audio/wav" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  await withServer({ env: localEnv, fetchImpl }, async (base) => {
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sfx", prompt: "A soft night breeze", durationSeconds: 4 })
    });
    const created = await response.json();
    const completed = await waitForJob(base, created.id);
    assert.equal(completed.status, "COMPLETED");
    const mediaResponse = await fetch(`${base}${completed.result.urls[0]}`);
    assert.equal(mediaResponse.headers.get("content-type"), "audio/wav");
    assert.equal(await mediaResponse.text(), "mock local audio");
  });
});

test("invalid inputs and cross-origin requests fail before contacting local services", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected local request"); };
  await withServer({ env: localEnv, fetchImpl }, async (base) => {
    const invalid = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "bad duration", durationSeconds: 5 })
    });
    assert.equal(invalid.status, 400);
    const crossOrigin = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ type: "video", prompt: "do not submit", durationSeconds: 4 })
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(calls, 0);
  });
});
