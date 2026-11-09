"use strict";

const MIN_MINUTES = 1;
const MAX_MINUTES = 10;
const MAX_CLIP_SECONDS = 8;
const WORDS_PER_MINUTE = 130;

function validateDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw new RangeError(`Durasi harus bilangan bulat ${MIN_MINUTES}–${MAX_MINUTES} menit.`);
  }
  return minutes;
}

function buildClipPlan(value) {
  const minutes = validateDurationMinutes(value);
  let secondsRemaining = minutes * 60;
  const durations = [];
  while (secondsRemaining > MAX_CLIP_SECONDS) {
    if (secondsRemaining === 10) {
      durations.push(6, 4);
      secondsRemaining = 0;
    } else {
      durations.push(MAX_CLIP_SECONDS);
      secondsRemaining -= MAX_CLIP_SECONDS;
    }
  }
  if (secondsRemaining) {
    if (![4, 6, 8].includes(secondsRemaining)) {
      throw new Error("Durasi tidak dapat dibagi menjadi klip 4, 6, atau 8 detik.");
    }
    durations.push(secondsRemaining);
  }
  return {
    minutes,
    totalSeconds: minutes * 60,
    targetWords: minutes * WORDS_PER_MINUTE,
    clipSeconds: durations
  };
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

const storyPlan = {
  MIN_MINUTES,
  MAX_MINUTES,
  MAX_CLIP_SECONDS,
  WORDS_PER_MINUTE,
  buildClipPlan,
  validateDurationMinutes,
  wordCount
};

if (typeof module !== "undefined" && module.exports) module.exports = storyPlan;
if (typeof window !== "undefined") window.AnimasiStoryPlan = storyPlan;
