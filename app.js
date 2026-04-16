const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const tunings = {
  chromatic: {
    label: "Cromatico",
    notes: [],
  },
  guitar: {
    label: "Chitarra",
    notes: [
      { name: "E2", frequency: 82.41 },
      { name: "A2", frequency: 110 },
      { name: "D3", frequency: 146.83 },
      { name: "G3", frequency: 196 },
      { name: "B3", frequency: 246.94 },
      { name: "E4", frequency: 329.63 },
    ],
  },
  bass: {
    label: "Basso",
    notes: [
      { name: "E1", frequency: 41.2 },
      { name: "A1", frequency: 55 },
      { name: "D2", frequency: 73.42 },
      { name: "G2", frequency: 98 },
    ],
  },
  ukulele: {
    label: "Ukulele",
    notes: [
      { name: "G4", frequency: 392 },
      { name: "C4", frequency: 261.63 },
      { name: "E4", frequency: 329.63 },
      { name: "A4", frequency: 440 },
    ],
  },
};

const elements = {
  startButton: document.querySelector("#startButton"),
  testToneButton: document.querySelector("#testToneButton"),
  tuningSelect: document.querySelector("#tuningSelect"),
  referencePitch: document.querySelector("#referencePitch"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  needle: document.querySelector("#needle"),
  noteName: document.querySelector("#noteName"),
  centsValue: document.querySelector("#centsValue"),
  frequencyValue: document.querySelector("#frequencyValue"),
  tuningMessage: document.querySelector("#tuningMessage"),
  stringList: document.querySelector("#stringList"),
};

const state = {
  audioContext: null,
  analyser: null,
  mediaStream: null,
  source: null,
  oscillator: null,
  gain: null,
  buffer: null,
  rafId: null,
  lastUpdate: 0,
  listening: false,
  testToneOn: false,
};

refreshPresetUi();

elements.startButton.addEventListener("click", toggleMicrophone);
elements.testToneButton.addEventListener("click", toggleTestTone);
elements.tuningSelect.addEventListener("change", refreshPresetUi);
elements.referencePitch.addEventListener("change", () => {
  normalizeReferencePitch();
  refreshPresetUi();
});

async function toggleMicrophone() {
  if (state.listening) {
    stopListening();
    return;
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia unavailable");
    }

    setStatus("Richiesta accesso al microfono...", "idle");
    await ensureAudioContext();
    stopTestTone();

    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    state.source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.source.connect(state.analyser);
    state.listening = true;
    elements.startButton.textContent = "Ferma microfono";
    setStatus("Microfono attivo. Suona una corda singola.", "live");
    scheduleAnalysis();
  } catch (error) {
    stopListening();
    const message =
      error.name === "NotAllowedError"
        ? "Permesso microfono negato."
        : "Microfono non disponibile in questo browser.";
    setStatus(message, "error");
  }
}

async function toggleTestTone() {
  try {
    await ensureAudioContext();
  } catch (error) {
    setStatus("Audio non disponibile in questo browser.", "error");
    return;
  }

  if (state.testToneOn) {
    stopTestTone();
    return;
  }

  stopListening();

  state.oscillator = state.audioContext.createOscillator();
  state.gain = state.audioContext.createGain();
  const testNote = getTestNote();
  state.oscillator.type = "sine";
  state.oscillator.frequency.value = testNote.frequency;
  state.gain.gain.value = 0.08;
  state.oscillator.connect(state.gain);
  state.gain.connect(state.audioContext.destination);
  state.gain.connect(state.analyser);
  state.oscillator.start();
  state.testToneOn = true;
  elements.testToneButton.textContent = `Ferma ${testNote.name}`;
  setStatus("Tono di prova attivo.", "live");
  scheduleAnalysis();
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContext();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 4096;
    state.analyser.smoothingTimeConstant = 0;
    state.buffer = new Float32Array(state.analyser.fftSize);
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

function scheduleAnalysis() {
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(analyze);
}

function analyze(timestamp) {
  state.rafId = requestAnimationFrame(analyze);

  if (timestamp - state.lastUpdate < 45) {
    return;
  }

  state.lastUpdate = timestamp;
  state.analyser.getFloatTimeDomainData(state.buffer);

  const frequency = autoCorrelate(state.buffer, state.audioContext.sampleRate);
  if (!frequency) {
    showIdleReadout("Segnale troppo basso");
    return;
  }

  updateReadout(frequency);
}

function updateReadout(frequency) {
  const referencePitch = Number(elements.referencePitch.value) || 440;
  const target = findTargetNote(frequency, referencePitch);
  const cents = 1200 * Math.log2(frequency / target.frequency);
  const clampedCents = clamp(cents, -50, 50);
  const rotation = (clampedCents / 50) * 58;

  elements.needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
  elements.noteName.textContent = target.name;
  elements.frequencyValue.textContent = `${frequency.toFixed(1)} Hz`;

  const absoluteCents = Math.abs(cents);
  elements.tuningMessage.classList.remove("is-flat", "is-sharp", "is-tuned");

  if (absoluteCents <= 5) {
    elements.centsValue.textContent = "Intonata";
    elements.tuningMessage.textContent = "Accordata";
    elements.tuningMessage.classList.add("is-tuned");
  } else if (cents < 0) {
    elements.centsValue.textContent = `${Math.round(Math.abs(cents))} cent sotto`;
    elements.tuningMessage.textContent = "Tendi la corda";
    elements.tuningMessage.classList.add("is-flat");
  } else {
    elements.centsValue.textContent = `${Math.round(cents)} cent sopra`;
    elements.tuningMessage.textContent = "Allenta la corda";
    elements.tuningMessage.classList.add("is-sharp");
  }
}

function findTargetNote(frequency, referencePitch) {
  const selectedTuning = tunings[elements.tuningSelect.value];

  if (selectedTuning.notes.length) {
    const presetNotes = getScaledPresetNotes(selectedTuning.notes, referencePitch);
    return presetNotes.reduce((closest, note) => {
      const closestDistance = Math.abs(1200 * Math.log2(frequency / closest.frequency));
      const noteDistance = Math.abs(1200 * Math.log2(frequency / note.frequency));
      return noteDistance < closestDistance ? note : closest;
    });
  }

  const midi = Math.round(69 + 12 * Math.log2(frequency / referencePitch));
  const name = `${noteNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const noteFrequency = referencePitch * 2 ** ((midi - 69) / 12);
  return { name, frequency: noteFrequency };
}

function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  let rms = 0;

  for (let index = 0; index < size; index += 1) {
    rms += buffer[index] * buffer[index];
  }

  rms = Math.sqrt(rms / size);
  if (rms < 0.012) {
    return null;
  }

  let start = 0;
  let end = size - 1;
  const edgeThreshold = 0.18;

  for (let index = 0; index < size / 2; index += 1) {
    if (Math.abs(buffer[index]) < edgeThreshold) {
      start = index;
      break;
    }
  }

  for (let index = 1; index < size / 2; index += 1) {
    if (Math.abs(buffer[size - index]) < edgeThreshold) {
      end = size - index;
      break;
    }
  }

  const samples = buffer.slice(start, end);
  const sampleCount = samples.length;
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.floor(sampleRate / 40), sampleCount - 1);
  const correlations = new Float32Array(maxLag + 1);

  for (let lag = 0; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let index = 0; index < sampleCount - lag; index += 1) {
      correlation += samples[index] * samples[index + lag];
    }
    correlations[lag] = correlation;
  }

  let lag = 1;
  while (lag < maxLag - 1 && correlations[lag] > correlations[lag + 1]) {
    lag += 1;
  }

  let bestLag = lag;
  let bestCorrelation = -Infinity;

  for (let index = Math.max(lag, minLag); index <= maxLag; index += 1) {
    if (correlations[index] > bestCorrelation) {
      bestCorrelation = correlations[index];
      bestLag = index;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.01) {
    return null;
  }

  const previous = correlations[bestLag - 1] || 0;
  const current = correlations[bestLag];
  const next = correlations[bestLag + 1] || 0;
  const divisor = previous + next - 2 * current;
  const offset = divisor ? (previous - next) / (2 * divisor) : 0;
  const refinedLag = bestLag + offset;
  const pitch = sampleRate / refinedLag;

  if (!Number.isFinite(pitch) || pitch < 40 || pitch > 1200) {
    return null;
  }

  return pitch;
}

function refreshPresetUi() {
  renderStringList();
  updateTestToneButton();

  if (state.oscillator) {
    state.oscillator.frequency.value = getTestNote().frequency;
  }
}

function renderStringList() {
  const selectedTuning = tunings[elements.tuningSelect.value];
  elements.stringList.innerHTML = "";

  const notes =
    selectedTuning.notes.length > 0
      ? getScaledPresetNotes(selectedTuning.notes, getReferencePitch())
      : [
          { name: "C", frequency: null },
          { name: "D", frequency: null },
          { name: "E", frequency: null },
          { name: "F", frequency: null },
          { name: "G", frequency: null },
          { name: "A", frequency: null },
          { name: "B", frequency: null },
        ];

  notes.forEach((note) => {
    const pill = document.createElement("div");
    pill.className = "string-pill";

    const name = document.createElement("strong");
    name.textContent = note.name;

    const frequency = document.createElement("span");
    frequency.textContent = note.frequency ? `${note.frequency.toFixed(2)} Hz` : "Tutte le ottave";

    pill.append(name, frequency);
    elements.stringList.append(pill);
  });
}

function getScaledPresetNotes(notes, referencePitch) {
  const ratio = referencePitch / 440;
  return notes.map((note) => ({
    ...note,
    frequency: note.frequency * ratio,
  }));
}

function getTestNote() {
  const selectedTuning = tunings[elements.tuningSelect.value];
  const referencePitch = getReferencePitch();

  if (!selectedTuning.notes.length) {
    return { name: `La ${referencePitch}`, frequency: referencePitch };
  }

  const scaledNotes = getScaledPresetNotes(selectedTuning.notes, referencePitch);
  return scaledNotes.find((note) => note.name.startsWith("A")) || scaledNotes[0];
}

function updateTestToneButton() {
  const testNote = getTestNote();
  elements.testToneButton.textContent = state.testToneOn
    ? `Ferma ${testNote.name}`
    : `Prova ${testNote.name}`;
}

function normalizeReferencePitch() {
  const value = Number(elements.referencePitch.value);
  if (!Number.isFinite(value) || value < 400 || value > 480) {
    elements.referencePitch.value = 440;
  }
}

function getReferencePitch() {
  return Number(elements.referencePitch.value) || 440;
}

function showIdleReadout(message) {
  elements.needle.style.transform = "translateX(-50%) rotate(0deg)";
  elements.noteName.textContent = "--";
  elements.centsValue.textContent = message;
  elements.frequencyValue.textContent = "-- Hz";
  elements.tuningMessage.textContent = "Suona una corda singola";
  elements.tuningMessage.classList.remove("is-flat", "is-sharp", "is-tuned");
}

function stopListening() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }

  if (state.source) {
    state.source.disconnect();
  }

  state.mediaStream = null;
  state.source = null;
  state.listening = false;
  elements.startButton.textContent = "Avvia microfono";

  if (!state.testToneOn) {
    cancelAnimationFrame(state.rafId);
    setStatus("Pronto. Concedi il microfono per iniziare.", "idle");
    showIdleReadout("In attesa di segnale");
  }
}

function stopTestTone() {
  if (state.oscillator) {
    state.oscillator.stop();
    state.oscillator.disconnect();
  }

  if (state.gain) {
    state.gain.disconnect();
  }

  state.oscillator = null;
  state.gain = null;
  state.testToneOn = false;
  updateTestToneButton();

  if (!state.listening) {
    cancelAnimationFrame(state.rafId);
    setStatus("Pronto. Concedi il microfono per iniziare.", "idle");
    showIdleReadout("In attesa di segnale");
  }
}

function setStatus(message, type) {
  elements.statusText.textContent = message;
  elements.statusDot.classList.toggle("is-live", type === "live");
  elements.statusDot.classList.toggle("is-error", type === "error");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
