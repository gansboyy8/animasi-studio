"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, buildScriptRequest, parseGeneratedScript } = require("./server");
const { buildClipPlan, validateDurationMinutes } = require("./lib/story-plan");

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
    assert.equal(health.script.ready, false);
    const response = await fetch(`${base}/api/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "video", prompt: "Animasi pendek" })
    });

    test("duration planner covers the supported limits with exact 4/6/8 second clips", () => {
      for (const minutes of [1, 10]) {
        const plan = buildClipPlan(minutes);
        assert.equal(plan.totalSeconds, minutes * 60);
        assert.equal(plan.clipSeconds.reduce((sum, duration) => sum + duration, 0), minutes * 60);
        assert.ok(plan.clipSeconds.every((duration) => [4, 6, 8].includes(duration)));
        assert.equal(plan.targetWords, minutes * 130);
      }
      assert.equal(buildClipPlan(1).clipSeconds.length, 8);
      assert.equal(buildClipPlan(10).clipSeconds.length, 75);
      for (const invalid of [0, -1, 1.5, 11, "abc"]) {
        assert.throws(() => validateDurationMinutes(invalid), RangeError);
      }
    });

    test("script prompts and parser enforce duration-aware output and valid clip counts", () => {
      const { plan, systemPrompt } = buildScriptRequest("Seekor kucing menemukan taman ajaib.", 1, "clay");
      assert.equal(plan.totalSeconds, 60);
      assert.match(systemPrompt, /130 Indonesian words for 1 minutes/);
      assert.match(systemPrompt, /exactly 8 scenes/);
      assert.match(systemPrompt, /8s.*8s.*8s.*8s.*8s.*8s.*8s.*4s/);
      const output = {
        title: "Momo dan taman",
        synopsis: "Momo menolong taman malam.",
        script: Array(130).fill("Momo").join(" "),
        scenes: plan.clipSeconds.map((duration, index) => ({
          title: `Adegan ${index + 1}`,
          location: "Taman malam",
          narration: "Momo mencari cahaya.",
          visualPrompt: "Kucing orisinal berjalan di taman malam.",
          sfxPrompt: "Angin malam dan langkah kaki."
        }))
      };
      const parsed = parseGeneratedScript({ output: JSON.stringify(output) }, plan);
      assert.equal(parsed.wordCount, 130);
      assert.equal(parsed.totalSeconds, 60);
      assert.equal(parsed.scenes.length, 8);
      assert.deepEqual(parsed.scenes.map((scene) => scene.duration), plan.clipSeconds);
      assert.throws(() => parseGeneratedScript({ output: "not JSON" }, plan), /JSON/);
      assert.throws(() => parseGeneratedScript({ output: JSON.stringify({ ...output, scenes: [] }) }, plan), /tepat 8 adegan/);
      assert.throws(() => parseGeneratedScript({ output: JSON.stringify({ ...output, script: "Terlalu pendek." }) }, plan), /di luar kisaran target/);
    });

    test("script generation returns an async job and parses the provider response", async () => {
      const calls = [];
      const generated = {
        title: "Momo dan taman",
        synopsis: "Momo menolong taman malam.",
        script: Array(130).fill("Momo").join(" "),
        scenes: buildClipPlan(1).clipSeconds.map((duration, index) => ({
          title: `Adegan ${index + 1}`,
          location: "Taman malam",
          narration: "Momo mencari cahaya.",
          visualPrompt: "Kucing orisinal berjalan di taman malam.",
          sfxPrompt: "Angin malam dan langkah kaki."
        }))
      };
      const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        if (options.method === "POST") {
          const input = JSON.parse(options.body);
          assert.equal(input.model, "google/gemini-2.5-flash-lite");
          assert.match(input.system_prompt, /exactly 8 scenes/);
          assert.match(input.prompt, /Seekor kucing menemukan taman ajaib/);
          return jsonResponse({
            request_id: "script-job-1",
            status_url: "https://queue.fal.run/fal-ai/any-llm/requests/script-job-1/status",
            response_url: "https://queue.fal.run/fal-ai/any-llm/requests/script-job-1"
          }, 200);
        }
        if (String(url).endsWith("/status")) return jsonResponse({ status: "COMPLETED" });
        return jsonResponse({ output: JSON.stringify(generated) });
      };
      await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl }, async (base) => {
        const response = await fetch(`${base}/api/scripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: "Seekor kucing menemukan taman ajaib.", durationMinutes: 1, style: "clay" })
        });
        assert.equal(response.status, 202);
        const submitted = await response.json();
        assert.equal(submitted.type, "script");
        const complete = await fetch(`${base}/api/generations/${submitted.id}`).then((result) => result.json());
        assert.equal(complete.status, "COMPLETED");
        assert.equal(complete.result.script.durationMinutes, 1);
        assert.equal(complete.result.script.scenes.length, 8);
        assert.equal(JSON.stringify(complete).includes("test-secret"), false);
        assert.equal(calls.length, 3);
      });
    });

    test("script endpoint rejects invalid durations and no-key requests without provider calls", async () => {
      let calls = 0;
      const fetchImpl = async () => { calls += 1; return jsonResponse({}); };
      await withServer({ env: {}, fetchImpl }, async (base) => {
        const noKey = await fetch(`${base}/api/scripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: "Cerita.", durationMinutes: 1 })
        });
        assert.equal(noKey.status, 503);
        assert.match((await noKey.json()).error, /tidak ada permintaan atau biaya/i);
        assert.equal(calls, 0);
      });
      await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl }, async (base) => {
        for (const durationMinutes of [0, 1.5, 11]) {
          const response = await fetch(`${base}/api/scripts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idea: "Cerita.", durationMinutes })
          });
          assert.equal(response.status, 400);
        }
        assert.equal(calls, 0);
      });
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

      test("video clip duration is validated and passed through to Veo", async () => {
        let submittedDuration;
        const fetchImpl = async (url, options) => {
          if (options.method === "POST") {
            submittedDuration = JSON.parse(options.body).duration;
            return jsonResponse({
              request_id: "video-duration-job",
              status_url: "https://queue.fal.run/fal-ai/veo3/requests/video-duration-job/status",
              response_url: "https://queue.fal.run/fal-ai/veo3/requests/video-duration-job"
            });
          }
          return jsonResponse({ status: "IN_PROGRESS" });
        };
        await withServer({ env: { FAL_KEY: "test-secret" }, fetchImpl }, async (base) => {
          for (const durationSeconds of [4, 6]) {
            const response = await fetch(`${base}/api/generations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "video", prompt: "Adegan animasi.", durationSeconds })
            });
            assert.equal(response.status, 202);
            assert.equal(submittedDuration, `${durationSeconds}s`);
          }
          const invalid = await fetch(`${base}/api/generations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "video", prompt: "Adegan animasi.", durationSeconds: 5 })
          });
          assert.equal(invalid.status, 400);
        });
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
      { type: "sfx", prompt: "x".repeat(6001) },
      { type: "video", prompt: "Zero duration.", durationSeconds: 0 },
      { type: "video", prompt: "Null duration.", durationSeconds: null }
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
