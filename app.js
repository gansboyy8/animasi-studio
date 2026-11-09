"use strict";

(() => {
const STORAGE_KEY = "animasi-studio-gan-project-v1";
const { buildClipPlan, wordCount } = window.AnimasiStoryPlan;
const initialProject = {
  idea: "Seekor kucing kecil bernama Momo menemukan pintu rahasia di balik lemari tua. Di balik pintu itu ada taman malam yang kehilangan semua bintangnya. Momo berangkat mencari cahaya bersama kunang-kunang pemberani.",
  script: "Saat sebuah taman malam kehilangan bintang-bintangnya, Momo si kucing mungil mengikuti cahaya kunang-kunang menuju dunia rahasia. Petualangan mereka mengajarkan bahwa cahaya paling berani sering muncul ketika kita saling membantu.",
  synopsis: "Saat sebuah taman malam kehilangan bintang-bintangnya, Momo si kucing mungil mengikuti cahaya kunang-kunang menuju dunia rahasia.",
  title: "Premis & sinopsis",
  durationMinutes: 1,
  scriptGenerated: false,
  scriptJob: null,
  style: "paper",
  sounds: [true, true, false],
  scenes: [
    { title: "Pintu di balik lemari", location: "Kamar Momo · malam", duration: 7, visual: "Kamar mungil bernuansa biru. Pintu kecil berkilau muncul di balik lemari kayu.", narration: "Momo menemukan cahaya aneh yang menyelinap dari balik lemari tua.", sfx: "Ketuk kayu" },
    { title: "Taman tanpa bintang", location: "Taman rahasia · malam", duration: 8, visual: "Taman luas diselimuti langit ungu. Bunga-bunga menunduk tanpa cahaya bintang.", narration: "Di balik pintu, taman malam ternyata kehilangan semua bintangnya.", sfx: "Angin malam" },
    { title: "Teman kunang-kunang", location: "Padang bunga · malam", duration: 8, visual: "Kunang-kunang kecil terbang mengitari Momo, meninggalkan jejak cahaya keemasan.", narration: "Satu kunang-kunang pemberani mengajak Momo menyalakan kembali langit.", sfx: "Kelap-kelip" },
    { title: "Langit menyala lagi", location: "Bukit taman · fajar", duration: 9, visual: "Cahaya-cahaya kecil naik dari taman dan berubah menjadi rasi bintang yang hangat.", narration: "Bersama-sama, mereka menemukan cahaya yang cukup untuk semua.", sfx: "Nada harapan" }
  ]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let project = loadProject();
let activeScene = 0;
let playing = false;
let muted = true;
let playTimer;
let toastTimer;
let scriptJobRunning = false;
let productionRunning = false;
const activePolls = new Map();

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.scenes) && Array.isArray(saved.sounds)) {
      return {
        ...initialProject,
        ...saved,
        synopsis: saved.synopsis || initialProject.synopsis,
        title: saved.title || initialProject.title,
        durationMinutes: saved.durationMinutes || initialProject.durationMinutes,
        scriptGenerated: Boolean(saved.scriptGenerated),
        scriptJob: saved.scriptJob || null,
        scenes: saved.scenes.map((scene) => ({ ...scene, clientId: scene.clientId || createSceneId() }))
      };
    }
  } catch (error) {
    console.warn("Draft lokal tidak dapat dibaca.", error);
  }
  const projectCopy = JSON.parse(JSON.stringify(initialProject));
  projectCopy.scenes = projectCopy.scenes.map((scene) => ({ ...scene, clientId: createSceneId() }));
  return projectCopy;
}

function createSceneId() {
  return globalThis.crypto?.randomUUID?.() || `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveProject() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    $("#save-label").textContent = "Tersimpan";
  } catch (error) {
    $("#save-label").textContent = "Belum tersimpan";
    showToast("Draft tidak dapat disimpan di browser ini.");
    console.error("Draft lokal tidak dapat disimpan.", error);
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function renderScenes() {
  const container = $("#scenes");
  container.innerHTML = "";
  project.scenes.forEach((scene, index) => {
    const card = document.createElement("article");
    card.className = `scene-card${index === activeScene ? " active" : ""}`;
    card.dataset.index = String(index);
    card.innerHTML = `
      <div class="scene-thumb" role="button" tabindex="0" aria-label="Pratinjau adegan ${index + 1}">
        <span class="scene-number">${String(index + 1).padStart(2, "0")}</span><span class="thumb-moon"></span><span class="thumb-cat">🐈</span><span class="scene-time">${Number(scene.duration) || 0}s</span>
      </div>
      <div class="scene-content">
        <div class="scene-title-row"><input class="scene-title" aria-label="Judul adegan ${index + 1}" value="${escapeHTML(scene.title)}"><button class="scene-delete" type="button" aria-label="Hapus adegan ${index + 1}" title="Hapus adegan">×</button></div>
        <p class="scene-location">${escapeHTML(scene.location)}</p>
        <textarea class="scene-visual" aria-label="Deskripsi visual adegan ${index + 1}" rows="2">${escapeHTML(scene.visual)}</textarea>
        <textarea class="scene-narration" aria-label="Narasi adegan ${index + 1}" rows="2">${escapeHTML(scene.narration)}</textarea>
        <div class="scene-foot"><span>${Number(scene.duration) || 0} detik</span><label class="sfx-edit">♫ <input class="scene-sfx" aria-label="Deskripsi SFX adegan ${index + 1}" value="${escapeHTML(scene.sfx)}"></label></div>
      </div>`;
    container.append(card);
  });
  $("#nav-count").textContent = String(project.scenes.length);
  $("#scene-total").textContent = `(${project.scenes.length} adegan)`;
  $("#generate-production").disabled = !project.scriptGenerated || productionRunning || project.scenes.length === 0;
  $("#story-title").textContent = project.title;
  $("#story-synopsis").textContent = project.synopsis;
  $("#duration-minutes").value = String(project.durationMinutes);
  updateDurationSummary();
  updatePreview();
}

function getMinutesFromInput() {
  const parsed = Number($("#duration-minutes").value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new RangeError("Durasi film harus bilangan bulat dari 1 sampai 10 menit.");
  }
  return parsed;
}

function planClipDurations(minutes) {
  return buildClipPlan(minutes).clipSeconds;
}

function updateDurationSummary() {
  const summary = $("#duration-summary");
  try {
    const minutes = getMinutesFromInput();
    const count = planClipDurations(minutes).length;
    summary.textContent = `Target ${minutes} menit · ${count} klip video + ${count} SFX`;
    summary.classList.remove("invalid");
  } catch (error) {
    summary.textContent = error.message;
    summary.classList.add("invalid");
  }
}

function formatTime(seconds) {
  const amount = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(amount / 60)).padStart(2, "0")}:${String(amount % 60).padStart(2, "0")}`;
}

function updatePreview() {
  const total = project.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
  if (!project.scenes.length) {
    $("#preview-title").textContent = "Belum ada adegan";
    $("#caption").textContent = "Tambahkan adegan untuk mulai merangkai cerita.";
    $("#counter").textContent = "00 / 00";
    $("#time").textContent = "00:00";
    $("#duration").textContent = "00:00";
    $("#progress").style.width = "0%";
    const generatedVideo = $("#generated-video");
    generatedVideo.pause();
    generatedVideo.removeAttribute("src");
    generatedVideo.load();
    generatedVideo.hidden = true;
    $("#stage").classList.remove("has-video");
    $("#preview-notice").textContent = "ⓘ  Visual ini adalah ilustrasi pratinjau. Video animasi belum dirender.";
    renderSfxResult(null);
    renderJobStatuses(null);
    return;
  }
  activeScene = Math.min(activeScene, project.scenes.length - 1);
  const scene = project.scenes[activeScene];
  const generatedVideo = $("#generated-video");
  if (scene.videoUrl) {
    generatedVideo.src = scene.videoUrl;
    generatedVideo.hidden = false;
    $("#stage").classList.add("has-video");
    $("#preview-notice").textContent = "Video hasil generasi fal.ai untuk adegan ini. Tautan media provider dapat kedaluwarsa.";
  } else {
    generatedVideo.pause();
    generatedVideo.removeAttribute("src");
    generatedVideo.load();
    generatedVideo.hidden = true;
    $("#stage").classList.remove("has-video");
    $("#preview-notice").textContent = "ⓘ  Visual ini adalah ilustrasi pratinjau. Video animasi belum dirender.";
  }
  const elapsed = project.scenes.slice(0, activeScene).reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  $("#preview-title").textContent = scene.title || `Adegan ${activeScene + 1}`;
  $("#caption").textContent = scene.narration || scene.visual;
  $("#counter").textContent = `${String(activeScene + 1).padStart(2, "0")} / ${String(project.scenes.length).padStart(2, "0")}`;
  $("#time").textContent = formatTime(elapsed);
  $("#duration").textContent = formatTime(total);
  $("#progress").style.width = `${total ? elapsed / total * 100 : 0}%`;
  $("#stage").classList.remove("style-paper", "style-clay", "style-dream");
  $("#stage").classList.add(`style-${project.style}`);
  $$(".scene-card").forEach((card, index) => card.classList.toggle("active", index === activeScene));
  renderSfxResult(scene);
  renderJobStatuses(scene);
}

function renderSfxResult(scene) {
  const container = $("#sfx-result");
  container.querySelector("audio")?.pause();
  container.replaceChildren();
  if (!scene?.sfxUrl) return;
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = scene.sfxUrl;
  audio.setAttribute("aria-label", `Sound effect AI: ${scene.sfx}`);
  const note = document.createElement("small");
  note.textContent = "SFX hasil generasi fal.ai · tautan media dapat kedaluwarsa";
  container.append(audio, note);
}

function jobLabel(job, mediaName) {
  if (!job) return "";
  if (job.status === "IN_QUEUE") {
    return Number.isInteger(job.queuePosition) ? `Antrean ${job.queuePosition} · ${mediaName}` : `Dalam antrean · ${mediaName}`;
  }
  if (job.status === "IN_PROGRESS") return `Sedang dibuat · ${mediaName}`;
  if (job.status === "FAILED") return `Gagal: ${job.error || "periksa konfigurasi dan coba lagi."}`;
  if (job.status === "COMPLETED") return `${mediaName} siap`;
  return "";
}

function renderJobStatuses(scene) {
  if (!scene) {
    $("#video-status").textContent = "Tulis ide dan tambahkan adegan untuk memulai.";
    $("#sfx-status").textContent = "Belum ada adegan aktif.";
    $("#generate-video").disabled = true;
    $("#generate-sfx").disabled = true;
    return;
  }
  $("#video-status").textContent = scene.videoUrl ? "Video AI siap diputar." : (jobLabel(scene.videoJob, "video") || configLabel("video"));
  $("#sfx-status").textContent = scene.sfxUrl ? "SFX AI siap diputar." : (jobLabel(scene.sfxJob, "SFX") || configLabel("sfx"));
  $("#generate-video").disabled = !project.scriptGenerated || Boolean(scene.videoUrl) || Boolean(scene.videoJob && ["IN_QUEUE", "IN_PROGRESS"].includes(scene.videoJob.status));
  $("#generate-sfx").disabled = !project.scriptGenerated || Boolean(scene.sfxUrl) || Boolean(scene.sfxJob && ["IN_QUEUE", "IN_PROGRESS"].includes(scene.sfxJob.status));
  $("#generate-production").disabled = !project.scriptGenerated || productionRunning || project.scenes.length === 0;
}

function setScriptJobRunning(isRunning) {
  scriptJobRunning = isRunning;
  $("#generate").disabled = isRunning;
  $("#regenerate").disabled = isRunning;
}

function configLabel(type) {
  if (!providerConfig) return "Memeriksa konfigurasi server…";
  if (!providerConfig.keyConfigured) return "Belum aktif — server perlu FAL_KEY.";
  const selected = providerConfig[type];
  return selected?.ready ? `Siap · ${selected.model}` : "Model belum dikonfigurasi dengan benar.";
}

let providerConfig = null;
async function checkProviderConfig() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    providerConfig = data;
    renderJobStatuses(project.scenes[activeScene]);
    if (data.configurationError) {
      $("#audio-notice").textContent = `ⓘ  Konfigurasi fal.ai tidak valid: ${data.configurationError}`;
    } else if (!data.keyConfigured) {
      $("#audio-notice").textContent = "ⓘ  AI belum aktif karena FAL_KEY belum diatur pada server. Tidak ada biaya sampai kamu menambahkan kunci dan meminta generasi.";
    } else {
      $("#audio-notice").textContent = `ⓘ  fal.ai aktif · Naskah: ${data.script.model} · Video: ${data.video.model} · SFX: ${data.sfx.model}. Generasi dapat memakai saldo akun fal.ai.`;
    }
  } catch (error) {
    providerConfig = null;
    $("#video-status").textContent = "Server AI tidak terjangkau. Jalankan node server.js.";
    $("#sfx-status").textContent = "Server AI tidak terjangkau.";
    $("#audio-notice").textContent = `ⓘ  Tidak dapat memeriksa server AI: ${error.message}`;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function startGeneration(type) {
  const scene = project.scenes[activeScene];
  if (!scene) {
    showToast("Susun draft dan pilih adegan terlebih dahulu.");
    return;
  }
  const existingJob = type === "video" ? scene.videoJob : scene.sfxJob;
  if (existingJob && ["IN_QUEUE", "IN_PROGRESS"].includes(existingJob.status)) {
    showToast("Generasi untuk adegan ini masih berjalan.");
    return;
  }
  const generateButton = $(`#generate-${type}`);
  if (generateButton.disabled) return;
  generateButton.disabled = true;
  try {
    await submitGenerationForScene(type, scene);
  } catch (error) {
    const property = type === "video" ? "videoJob" : "sfxJob";
    scene[property] = { status: "FAILED", error: error.message };
    saveProject();
    renderJobStatuses(scene);
    showToast(error.message);
  }
  if (scene === project.scenes[activeScene]) renderJobStatuses(scene);
}

async function submitGenerationForScene(type, scene) {
  const durationSeconds = Number(scene.duration);
  const prompt = type === "video"
    ? `${scene.visual}. Naskah adegan: ${scene.narration}. Animasi orisinal, arahan gaya ${project.style}; jaga identitas karakter dan kontinuitas dengan adegan sebelumnya. Tanpa teks, subtitle, logo, atau karakter berhak cipta.`
    : `${scene.sfx}. Buat sound effect/ambience yang paling cocok dan menarik untuk momen ini; jangan tambahkan musik atau ucapan.`;
  if (scene[type === "video" ? "videoJob" : "sfxJob"]?.status === "COMPLETED") return;
  setSceneStatus(type, scene, "Mengirim permintaan ke antrean fal.ai…");
  const response = await fetch("/api/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, prompt, durationSeconds })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Server menolak permintaan (HTTP ${response.status}).`);
  const job = { id: data.id, status: data.status, queuePosition: data.queuePosition };
  if (type === "video") scene.videoJob = job;
  else scene.sfxJob = job;
  saveProject();
  if (scene === project.scenes[activeScene]) renderJobStatuses(scene);
  return pollGeneration(type, scene.clientId, job.id);
}

function setSceneStatus(type, scene, text) {
  if (scene === project.scenes[activeScene]) setJobStatus(type, text);
}

function setJobStatus(type, text) {
  $(`#${type === "video" ? "video" : "sfx"}-status`).textContent = text;
}

function pollGeneration(type, sceneId, jobId) {
  if (activePolls.has(jobId)) return activePolls.get(jobId);
  const pending = pollGenerationLoop(type, sceneId, jobId).finally(() => {
    if (activePolls.get(jobId) === pending) activePolls.delete(jobId);
  });
  activePolls.set(jobId, pending);
  return pending;
}

async function pollGenerationLoop(type, sceneId, jobId) {
  let delayMs = 2000;
  while (true) {
    if (type === "script" && project.scriptJob?.id !== jobId) return;
    await wait(delayMs);
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(jobId)}`);
      const job = await response.json();
      if (!response.ok) {
        const error = new Error(job.error || `HTTP ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      delayMs = 2000;
      if (type === "script") {
        if (project.scriptJob?.id !== jobId) return;
        project.scriptJob = { id: job.id, status: job.status, queuePosition: job.queuePosition, error: job.error };
        if (job.status === "COMPLETED" && job.result?.script) {
          const generated = job.result.script;
          project.title = generated.title;
          project.synopsis = generated.synopsis;
          project.script = generated.script;
          project.durationMinutes = generated.durationMinutes;
          project.scriptGenerated = true;
          project.scriptJob = { id: job.id, status: "COMPLETED" };
          project.scenes = generated.scenes.map((item) => ({ ...item, clientId: createSceneId() }));
          activeScene = 0;
          $("#script").value = project.script;
          $("#script-length").textContent = `${generated.wordCount} kata · target ${generated.targetWords} kata`;
          $("#script-runtime").textContent = `Perkiraan ${generated.estimatedMinutes} menit`;
          $("#script-origin").textContent = `Naskah AI · ${generated.durationMinutes} menit`;
          $("#script-status").textContent = "Naskah AI dan storyboard selesai. Koreksi bila perlu, lalu buat semua klip.";
          renderScenes();
          saveProject();
          setScriptJobRunning(false);
          showToast(`Naskah AI ${generated.durationMinutes} menit selesai · ${project.scenes.length} adegan.`);
          return job;
        }
        if (job.status === "FAILED") {
          $("#script-status").textContent = `Pembuatan naskah gagal: ${job.error}`;
          project.scriptJob.error = job.error;
          saveProject();
          setScriptJobRunning(false);
          showToast(job.error || "Pembuatan naskah AI gagal.");
          return job;
        }
        $("#script-status").textContent = job.status === "IN_QUEUE"
          ? `Naskah AI dalam antrean${Number.isInteger(job.queuePosition) ? ` (${job.queuePosition} di depan)` : ""}…`
          : "AI sedang menulis naskah dan membagi adegan…";
        continue;
      }
      const scene = project.scenes.find((item) => item.clientId === sceneId);
      if (!scene) return;
      const property = type === "video" ? "videoJob" : "sfxJob";
      scene[property] = { id: job.id, status: job.status, queuePosition: job.queuePosition, error: job.error };
      if (job.status === "COMPLETED" && job.result?.urls?.length) {
        if (type === "video") scene.videoUrl = job.result.urls[0];
        else scene.sfxUrl = job.result.urls[0];
        scene[property] = { id: job.id, status: "COMPLETED" };
        saveProject();
        if (scene === project.scenes[activeScene]) updatePreview();
        showToast(`${type === "video" ? "Video" : "SFX"} AI selesai.`);
        return;
      }
      if (job.status === "FAILED") {
        saveProject();
        if (scene === project.scenes[activeScene]) renderJobStatuses(scene);
        showToast(job.error || "Generasi gagal. Coba lagi setelah memeriksa pengaturan provider.");
        return;
      }
      saveProject();
      if (scene === project.scenes[activeScene]) renderJobStatuses(scene);
    } catch (error) {
      if (type === "script") {
        if (error.statusCode === 404) {
          project.scriptJob = { id: jobId, status: "FAILED", error: error.message };
          $("#script-status").textContent = `Pelacakan naskah hilang: ${error.message}`;
          saveProject();
          setScriptJobRunning(false);
          return;
        }
        delayMs = Math.min(Math.round(delayMs * 1.5), 15000);
        $("#script-status").textContent = `Status naskah sementara tidak tersedia; akan mencoba lagi. ${error.message}`;
        continue;
      }
      const scene = project.scenes.find((item) => item.clientId === sceneId);
      if (scene) {
        if (error.statusCode === 404) {
          const property = type === "video" ? "videoJob" : "sfxJob";
          scene[property] = { id: jobId, status: "FAILED", error: error.message };
          saveProject();
          if (scene === project.scenes[activeScene]) renderJobStatuses(scene);
          showToast(`Pelacakan job hilang dari server: ${error.message}`);
          return;
        }
        delayMs = Math.min(Math.round(delayMs * 1.5), 15000);
        if (scene === project.scenes[activeScene]) {
          setJobStatus(type, `Status sementara tidak tersedia: ${error.message}. Akan mencoba lagi; job mungkin masih berjalan.`);
        }
        continue;
      }
      return;
    }
  }
}

function setActiveScene(index) {
  if (!project.scenes.length) return;
  activeScene = (index + project.scenes.length) % project.scenes.length;
  updatePreview();
}

function titleFromIdea(idea) {
  const title = idea.replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return title ? title[0].toLocaleUpperCase("id-ID") + title.slice(1) : "Awal petualangan";
}

function makeDraft() {
  return generateAIScript();
}

async function generateAIScript() {
  const idea = $("#idea").value.trim();
  if (!idea) {
    showToast("Tulis ide cerita dulu sebelum meminta AI membuat naskah.");
    $("#idea").focus();
    return;
  }
  let durationMinutes;
  try {
    durationMinutes = getMinutesFromInput();
  } catch (error) {
    $("#script-status").textContent = error.message;
    showToast(error.message);
    $("#duration-minutes").focus();
    return;
  }
  if (scriptJobRunning) return;
  if (project.scriptJob && ["IN_QUEUE", "IN_PROGRESS"].includes(project.scriptJob.status)) {
    showToast("Pembuatan naskah AI sedang berjalan.");
    return;
  }
  setScriptJobRunning(true);
  $("#script-status").textContent = `Meminta naskah AI ${durationMinutes} menit…`;
  project.idea = idea;
  project.durationMinutes = durationMinutes;
  try {
    const response = await fetch("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, durationMinutes, style: project.style })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server menolak permintaan (HTTP ${response.status}).`);
    if ($("#idea").value.trim() !== idea || Number($("#duration-minutes").value) !== durationMinutes) {
      $("#script-status").textContent = "Ide atau durasi berubah saat permintaan dikirim. Hasil job ini tidak akan diterapkan; job provider mungkin tetap berjalan.";
      setScriptJobRunning(false);
      return;
    }
    project.scriptJob = { id: data.id, status: data.status, queuePosition: data.queuePosition, idea, durationMinutes };
    saveProject();
    $("#script-status").textContent = `Naskah AI masuk antrean${Number.isInteger(data.queuePosition) ? ` (${data.queuePosition} di depan)` : ""}…`;
    void pollGeneration("script", "project", data.id);
  } catch (error) {
    $("#script-status").textContent = error.message;
    showToast(error.message);
    setScriptJobRunning(false);
  }
}

async function generateAllProduction() {
  if (!project.scriptGenerated || !project.scenes.length || productionRunning) return;
  const pending = project.scenes.flatMap((scene) => [
    { type: "video", scene },
    { type: "sfx", scene }
  ]).filter(({ type, scene }) => scene[type === "video" ? "videoUrl" : "sfxUrl"] == null);
  if (!pending.length) {
    showToast("Semua video dan SFX untuk adegan ini sudah dihasilkan.");
    return;
  }
  const sceneSeconds = project.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
  const message = `Ini akan mengirim hingga ${pending.length} permintaan berbayar ke fal.ai untuk ${project.scenes.length} adegan. Total durasi klip saat ini ${formatTime(sceneSeconds)} (target naskah ${project.durationMinutes} menit). Biaya tergantung model dan akun provider; harga tidak dapat dipastikan dari aplikasi. Lanjutkan?`;
  if (!window.confirm(message)) return;
  productionRunning = true;
  $("#generate-production").disabled = true;
  const progress = $("#production-progress");
  progress.hidden = false;
  let completed = 0;
  let failed = 0;
  progress.textContent = `Menyiapkan ${pending.length} permintaan AI…`;
  let next = 0;
  const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (next < pending.length) {
      const task = pending[next];
      next += 1;
      try {
        const jobKey = task.type === "video" ? "videoJob" : "sfxJob";
        const existingJob = task.scene[jobKey];
        const job = existingJob && ["IN_QUEUE", "IN_PROGRESS"].includes(existingJob.status)
          ? await pollGeneration(task.type, task.scene.clientId, existingJob.id)
          : await submitGenerationForScene(task.type, task.scene);
        if (job?.status === "FAILED") failed += 1;
      } catch (error) {
        failed += 1;
        const property = task.type === "video" ? "videoJob" : "sfxJob";
        task.scene[property] = { status: "FAILED", error: error.message };
        if (task.scene === project.scenes[activeScene]) setSceneStatus(task.type, task.scene, error.message);
        saveProject();
      }
      completed += 1;
      progress.textContent = `Progres ${completed}/${pending.length} permintaan · ${failed} gagal${completed === pending.length ? (failed ? ". Periksa status adegan untuk mencoba ulang." : ". Semua klip siap.") : "…"}`;
    }
  });
  await Promise.all(workers);
  productionRunning = false;
  $("#generate-production").disabled = !project.scriptGenerated || project.scenes.length === 0;
}

function togglePlayback() {
  if (!project.scenes.length) {
    showToast("Tambahkan adegan untuk memutar pratinjau.");
    return;
  }
  playing = !playing;
  $("#play").textContent = playing ? "Ⅱ" : "▶";
  if (!playing) {
    window.clearInterval(playTimer);
    return;
  }
  showToast("Memutar urutan storyboard sebagai pratinjau.");
  playTimer = window.setInterval(() => {
    if (activeScene >= project.scenes.length - 1) {
      playing = false;
      $("#play").textContent = "▶";
      window.clearInterval(playTimer);
      setActiveScene(0);
      return;
    }
    setActiveScene(activeScene + 1);
  }, 2300);
}

function playTone(frequency = 660, duration = .18) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    showToast("Pratinjau suara tidak didukung browser ini.");
    return;
  }
  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.07, context.currentTime + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => context.close();
  } catch (error) {
    console.error("Pratinjau efek suara gagal.", error);
    showToast("Efek suara tidak dapat diputar.");
  }
}

function speakScript() {
  if (!("speechSynthesis" in window)) {
    showToast("Fitur narasi bawaan browser tidak tersedia.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(project.scenes[activeScene]?.narration || project.script || "");
  utterance.lang = $("#voice").value === "en" ? "en-US" : "id-ID";
  utterance.rate = .94;
  utterance.onstart = () => showToast("Narasi sintetis browser diputar, bukan suara AI.");
  utterance.onerror = (event) => {
    if (event.error !== "canceled") showToast("Narasi tidak dapat diputar pada perangkat ini.");
  };
  window.speechSynthesis.speak(utterance);
}

function exportProject() {
  const data = {
    product: "Animasi Studio Gan",
    type: "draft-lokal-prototipe",
    note: "Draft lokal. Tidak ada keluaran AI atau video/audio yang dirender.",
    exportedAt: new Date().toISOString(),
    ...project
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "draft-animasi-studio-gan.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Draft berhasil diekspor sebagai file JSON.");
}

$("#idea").value = project.idea;
$("#script").value = project.script;
$("#duration-minutes").value = String(project.durationMinutes);
$("#story-title").textContent = project.title;
$("#story-synopsis").textContent = project.synopsis;
$("#script-origin").textContent = project.scriptGenerated ? "Naskah AI · bisa dikoreksi" : "Contoh lokal — belum dibuat oleh AI";
$("#char-count").textContent = `${project.idea.length.toLocaleString("id-ID")} / 1.200`;
$$(".style-option").forEach((button) => button.classList.toggle("selected", button.dataset.style === project.style));
$$(".sound-row input").forEach((input, index) => { input.checked = Boolean(project.sounds[index]); });
renderScenes();
if (project.scriptJob?.id && ["IN_QUEUE", "IN_PROGRESS"].includes(project.scriptJob.status)) {
  setScriptJobRunning(true);
  $("#script-status").textContent = "Melanjutkan pelacakan naskah AI…";
  void pollGeneration("script", "project", project.scriptJob.id);
} else if (project.scriptGenerated) {
  $("#script-length").textContent = `${wordCount(project.script)} kata`;
  $("#script-runtime").textContent = `Target ${project.durationMinutes} menit`;
  $("#script-status").textContent = "Naskah AI tersimpan. Koreksi sebelum membuat video.";
}

$("#idea").addEventListener("input", (event) => {
  $("#char-count").textContent = `${event.target.value.length.toLocaleString("id-ID")} / 1.200`;
  const idea = event.target.value.trim();
  if (idea !== project.idea) {
    project.idea = idea;
    if (project.scriptGenerated) {
      project.scriptGenerated = false;
      $("#script-status").textContent = "Ide berubah. Buat ulang naskah agar storyboard cocok sebelum produksi.";
      $("#script-origin").textContent = "Ide berubah — naskah perlu dibuat ulang";
    }
    if (project.scriptJob && ["IN_QUEUE", "IN_PROGRESS"].includes(project.scriptJob.status)) {
      project.scriptJob = null;
      setScriptJobRunning(false);
      $("#script-status").textContent = "Ide berubah. Job lama tidak lagi akan ditampilkan; pembuatan provider yang sudah dikirim mungkin tetap berjalan.";
    }
    renderJobStatuses(project.scenes[activeScene]);
    saveProject();
  }
});
$("#duration-minutes").addEventListener("input", () => {
  updateDurationSummary();
  const minutes = Number($("#duration-minutes").value);
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 10) {
    if (minutes !== project.durationMinutes && project.scriptGenerated) {
      project.scriptGenerated = false;
      $("#script-status").textContent = "Target durasi berubah. Buat ulang naskah dan storyboard sebelum produksi.";
      $("#script-origin").textContent = "Durasi berubah — naskah perlu dibuat ulang";
      renderJobStatuses(project.scenes[activeScene]);
    }
    if (project.scriptJob && ["IN_QUEUE", "IN_PROGRESS"].includes(project.scriptJob.status)) {
      project.scriptJob = null;
      setScriptJobRunning(false);
      $("#script-status").textContent = "Durasi berubah. Job naskah lama tidak lagi akan ditampilkan; pembuatan provider yang sudah dikirim mungkin tetap berjalan.";
    }
    project.durationMinutes = minutes;
    saveProject();
  }
});
$("#generate").addEventListener("click", makeDraft);
$("#regenerate").addEventListener("click", makeDraft);
$("#script").addEventListener("input", (event) => {
  project.script = event.target.value;
  saveProject();
});
$("#scenes").addEventListener("input", (event) => {
  const card = event.target.closest(".scene-card");
  if (!card) return;
  const index = Number(card.dataset.index);
  if (event.target.matches(".scene-title")) project.scenes[index].title = event.target.value;
  if (event.target.matches(".scene-visual")) project.scenes[index].visual = event.target.value;
  if (event.target.matches(".scene-narration")) project.scenes[index].narration = event.target.value;
  if (event.target.matches(".scene-sfx")) project.scenes[index].sfx = event.target.value;
  saveProject();
  if (index === activeScene) updatePreview();
});
$("#scenes").addEventListener("click", (event) => {
  const card = event.target.closest(".scene-card");
  if (!card) return;
  const index = Number(card.dataset.index);
  if (event.target.closest(".scene-delete")) {
    project.scenes.splice(index, 1);
    activeScene = Math.max(0, Math.min(activeScene, project.scenes.length - 1));
    renderScenes();
    saveProject();
    showToast("Adegan dihapus dari draft.");
  } else if (event.target.closest(".scene-thumb")) {
    setActiveScene(index);
  }
});
$("#scenes").addEventListener("keydown", (event) => {
  if (event.target.matches(".scene-thumb") && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    setActiveScene(Number(event.target.closest(".scene-card").dataset.index));
  }
});
$("#add-scene").addEventListener("click", () => {
  project.scenes.push({
    clientId: createSceneId(),
    title: `Adegan baru ${project.scenes.length + 1}`,
    location: "Lokasi cerita · waktu",
    duration: 6,
    visual: "Tulis deskripsi visual adegan ini.",
    narration: "Tulis narasi adegan di sini.",
    sfx: "Pilih suasana"
  });
  activeScene = project.scenes.length - 1;
  renderScenes();
  saveProject();
  $("#scenes .scene-title:last-of-type")?.focus();
  showToast("Adegan baru ditambahkan.");
});
$$(".style-option").forEach((button) => button.addEventListener("click", () => {
  project.style = button.dataset.style;
  $$(".style-option").forEach((item) => item.classList.toggle("selected", item === button));
  updatePreview();
  saveProject();
}));
$("#prev").addEventListener("click", () => setActiveScene(activeScene - 1));
$("#next").addEventListener("click", () => setActiveScene(activeScene + 1));
$("#play").addEventListener("click", togglePlayback);
$("#speak").addEventListener("click", speakScript);
$("#generate-video").addEventListener("click", () => startGeneration("video"));
$("#generate-sfx").addEventListener("click", () => startGeneration("sfx"));
$("#generate-production").addEventListener("click", generateAllProduction);
$("#sound").addEventListener("click", () => {
  muted = !muted;
  $("#sound").classList.toggle("muted", muted);
  $("#sound").setAttribute("aria-label", muted ? "Aktifkan suara" : "Matikan suara");
  if (!muted) playTone(680, .24);
});
$$(".sound-row input").forEach((input, index) => input.addEventListener("change", () => {
  project.sounds[index] = input.checked;
  saveProject();
  if (input.checked) playTone([440, 780, 560][index], .15);
  showToast(input.checked ? "Cue suara ditandai aktif dalam draft." : "Cue suara ditandai nonaktif dalam draft.");
}));
$("#export").addEventListener("click", exportProject);
$("#clear").addEventListener("click", () => {
  setScriptJobRunning(false);
  scriptJobRunning = false;
  project = { idea: "", script: "", synopsis: "", title: "Premis & sinopsis", durationMinutes: 1, scriptGenerated: false, scriptJob: null, style: "paper", sounds: [false, false, false], scenes: [] };
  activeScene = 0;
  $("#idea").value = "";
  $("#script").value = "";
  $("#story-title").textContent = project.title;
  $("#story-synopsis").textContent = "";
  $("#script-origin").textContent = "Contoh lokal — belum dibuat oleh AI";
  $("#char-count").textContent = "0 / 1.200";
  $("#script-length").textContent = "Naskah AI menargetkan sekitar 130 kata/menit";
  $("#script-runtime").textContent = "";
  $("#script-status").textContent = "Tulis ide dan durasi, lalu buat naskah AI.";
  $("#duration-minutes").value = "1";
  $("#production-progress").hidden = true;
  $$(".style-option").forEach((button) => button.classList.toggle("selected", button.dataset.style === project.style));
  $$(".sound-row input").forEach((input) => { input.checked = false; });
  updateDurationSummary();
  renderScenes();
  saveProject();
  $("#idea").focus();
  showToast("Draft dikosongkan. Ide baru siap ditulis.");
});
$$("[data-scroll]").forEach((button) => button.addEventListener("click", () => {
  document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
  $("#idea").focus({ preventScroll: true });
}));
$$(".nav").forEach((link) => link.addEventListener("click", () => {
  $$(".nav").forEach((item) => item.classList.toggle("active", item === link));
}));

void checkProviderConfig();
project.scenes.forEach((scene) => {
  if (scene.videoJob?.id && ["IN_QUEUE", "IN_PROGRESS"].includes(scene.videoJob.status)) {
    void pollGeneration("video", scene.clientId, scene.videoJob.id);
  }
  if (scene.sfxJob?.id && ["IN_QUEUE", "IN_PROGRESS"].includes(scene.sfxJob.status)) {
    void pollGeneration("sfx", scene.clientId, scene.sfxJob.id);
  }
});
})();
