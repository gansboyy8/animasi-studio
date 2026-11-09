"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("./server");

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

test("health reports AI disabled without a key and does not call the provider", async () => {
  let calls = 0;
  await withServer({ env: {}, fetchImpl: async () => { calls += 1; throw new Error("unexpected provider call"); } }, async (base) => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.keyConfigured, false);
    assert.equal(health.video.ready, false);
    assert.equal(health.sfx.ready, false);
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "Animasi pendek" })
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Tidak ada permintaan atau biaya/);
    assert.equal(calls, 0);
  });
});

test("API rejects cross-origin requests that could trigger paid generation", async () => {
  let calls = 0;
  await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl: async () => { calls += 1; return jsonResponse({}); } }, async (base) => {
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ type: "video", prompt: "Do not send" })
    });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });
});

test("fal.ai jobs submit and poll asynchronously without exposing the API key", async () => {
  const calls = [];
  let statusPoll = 0;
  const env = {
    FAL_KEY: "test-secret",
    FAL_VIDEO_MODEL_ID: "fal-ai/veo3",
    FAL_SFX_MODEL_ID: "fal-ai/elevenlabs/sound-effects"
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") {
      const input = JSON.parse(options.body);
      assert.equal(input.text, "Suara langkah kaki di taman malam.");
      assert.equal(input.enable_safety_checker, true);
      return jsonResponse({
        request_id: "provider-job-1",
        status_url: "https://queue.fal.run/fal-ai/elevenlabs/requests/provider-job-1/status",
        response_url: "https://queue.fal.run/fal-ai/elevenlabs/requests/provider-job-1"
      }, 200);
    }
    if (String(url).endsWith("/status")) {
      statusPoll += 1;
      return jsonResponse(statusPoll === 1
        ? { status: "IN_PROGRESS" }
        : { status: "COMPLETED" });
    }
    return jsonResponse({ audio: { url: "https://v3.fal.media/files/sfx.mp3" } });
  };

  await withServer({ env, fetchImpl }, async (base) => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.keyConfigured, true);
    assert.equal(health.video.ready, true);
    assert.equal(health.sfx.ready, true);
    const submission = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sfx", prompt: "Suara langkah kaki di taman malam." })
    });
    assert.equal(submission.status, 202);
    const job = await submission.json();
    assert.equal(job.status, "IN_QUEUE");
    assert.equal(JSON.stringify(job).includes("test-secret"), false);

    const pending = await fetch(`${base}/api/generations/${job.id}`).then((response) => response.json());
    assert.equal(pending.status, "IN_PROGRESS");
    const complete = await fetch(`${base}/api/generations/${job.id}`).then((response) => response.json());
    assert.equal(complete.status, "COMPLETED");
    assert.deepEqual(complete.result.urls, ["https://v3.fal.media/files/sfx.mp3"]);
    assert.ok(calls.every(({ options }) => options.headers.Authorization === "Key test-secret"));
    assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/elevenlabs/sound-effects");
  });
});

test("video generation uses the configured Veo-compatible prompt fields and returns video media", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") {
      const input = JSON.parse(options.body);
      assert.equal(input.prompt, "A storybook cat explores a moonlit garden.");
      assert.equal(input.duration, "8s");
      assert.equal(input.aspect_ratio, "16:9");
      assert.equal(input.resolution, "720p");
      assert.equal(input.generate_audio, false);
      return jsonResponse({
        request_id: "video-job-1",
        status_url: "https://queue.fal.run/fal-ai/veo3/requests/video-job-1/status",
        response_url: "https://queue.fal.run/fal-ai/veo3/requests/video-job-1"
      });
    }
    if (String(url).endsWith("/status")) return jsonResponse({ status: "COMPLETED" });
    return jsonResponse({ video: { url: "https://v3.fal.media/files/clip.mp4" } });
  };
  await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl }, async (base) => {
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "A storybook cat explores a moonlit garden." })
    });
    assert.equal(response.status, 202);
    const job = await response.json();
    const complete = await fetch(`${base}/api/generations/${job.id}`).then((result) => result.json());
    assert.equal(complete.status, "COMPLETED");
    assert.deepEqual(complete.result.urls, ["https://v3.fal.media/files/clip.mp4"]);
    assert.ok(calls.every(({ options }) => options.headers.Authorization === "Key test-secret"));
  });
});

test("temporary provider polling errors keep the job open so it can recover", async () => {
  let statusCalls = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === "POST") {
      return jsonResponse({
        request_id: "recovering-job",
        status_url: "https://queue.fal.run/fal-ai/veo3/requests/recovering-job/status",
        response_url: "https://queue.fal.run/fal-ai/veo3/requests/recovering-job"
      });
    }
    if (String(url).endsWith("/status")) {
      statusCalls += 1;
      if (statusCalls === 1) return jsonResponse({ detail: "Temporary provider outage." }, 503);
      return jsonResponse({ status: "IN_PROGRESS" });
    }
    return jsonResponse({});
  };
  await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl }, async (base) => {
    const submission = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "Video test" })
    });
    const job = await submission.json();
    const outage = await fetch(`${base}/api/generations/${job.id}`);
    assert.equal(outage.status, 502);
    assert.equal((await outage.json()).job.status, "IN_QUEUE");
    const retry = await fetch(`${base}/api/generations/${job.id}`);
    assert.equal((await retry.json()).status, "IN_PROGRESS");
  });
});

test("invalid generation input is rejected before contacting the provider", async () => {
  let calls = 0;
  await withServer({ env: { FAL_KEY: "configured" }, fetchImpl: async () => { calls += 1; return jsonResponse({}); } }, async (base) => {
    for (const payload of [
      { type: "image", prompt: "not supported" },
      { type: "video", prompt: " " },
      { type: "sfx", prompt: "x".repeat(6001) }
    ]) {
      const response = await fetch(`${base}/api/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
});

test("provider submission errors are returned plainly without pretending a job succeeded", async () => {
  await withServer({
    env: { FAL_KEY: "test-secret" },
    fetchImpl: async () => jsonResponse({ detail: "Model input ditolak." }, 422)
  }, async (base) => {
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sfx", prompt: "Efek daun tertiup angin." })
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Model input ditolak/);
  });
});

test("health surfaces invalid JSON model configuration without crashing", async () => {
  await withServer({ env: { FAL_VIDEO_INPUT_JSON: "not-json" } }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.video.ready, false);
    assert.match(health.configurationError, /JSON yang valid/);
  });
});
