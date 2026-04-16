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
  tuningSelect: document.querySelector("#tuningSelect"),
  skinSelect: document.querySelector("#skinSelect"),
  referencePitch: document.querySelector("#referencePitch"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  signalFill: document.querySelector("#signalFill"),
  signalText: document.querySelector("#signalText"),
  intonationCanvas: document.querySelector("#intonationCanvas"),
  noteName: document.querySelector("#noteName"),
  frequencyValue: document.querySelector("#frequencyValue"),
  tuningMessage: document.querySelector("#tuningMessage"),
  stringList: document.querySelector("#stringList"),
};

const analysisConfig = {
  updateIntervalMs: 70,
  minRms: 0.0016,
  minClarity: 0.22,
  quietMinClarity: 0.36,
  quietRms: 0.006,
  inputGain: 3.5,
  signalMeterFullScale: 0.08,
  holdMs: 3200,
  centsSmoothing: 0.22,
  frequencySmoothing: 0.3,
  maxHistoryPoints: 96,
};

const state = {
  audioContext: null,
  analyser: null,
  mediaStream: null,
  source: null,
  inputGain: null,
  buffer: null,
  rafId: null,
  lastUpdate: 0,
  lastSignalAt: 0,
  smoothedCents: null,
  smoothedFrequency: null,
  graphHistory: [],
  hasReading: false,
  listening: false,
};

const graph = {
  context: elements.intonationCanvas.getContext("2d"),
  pixelRatio: 1,
  resizeObserver: null,
};

setupGraphCanvas();
refreshPresetUi();
restoreTheme();
registerServiceWorker();

elements.startButton.addEventListener("click", toggleMicrophone);
elements.tuningSelect.addEventListener("change", refreshPresetUi);
elements.skinSelect.addEventListener("change", () => {
  applyTheme(elements.skinSelect.value);
});
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

    state.mediaStream = await getMicrophoneStream();

    state.source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.inputGain = state.audioContext.createGain();
    state.inputGain.gain.value = analysisConfig.inputGain;
    state.source.connect(state.inputGain);
    state.inputGain.connect(state.analyser);
    state.listening = true;
    elements.startButton.textContent = "Ferma microfono";
    setStatus("Microfono attivo.", "live");
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

async function getMicrophoneStream() {
  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (error) {
    if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }

    throw error;
  }
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContext();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 8192;
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

  if (timestamp - state.lastUpdate < analysisConfig.updateIntervalMs) {
    return;
  }

  state.lastUpdate = timestamp;
  state.analyser.getFloatTimeDomainData(state.buffer);

  const result = autoCorrelate(state.buffer, state.audioContext.sampleRate);
  updateSignalMeter(result.rms);

  if (!result.frequency) {
    pushGraphPoint(null);
    holdLastReadout(timestamp, result.rms);
    return;
  }

  state.lastSignalAt = timestamp;
  updateReadout(result.frequency);
}

function updateReadout(frequency) {
  const referencePitch = Number(elements.referencePitch.value) || 440;
  const target = findTargetNote(frequency, referencePitch);
  const cents = 1200 * Math.log2(frequency / target.frequency);
  const clampedCents = clamp(cents, -50, 50);
  const displayCents = state.hasReading
    ? state.smoothedCents + (clampedCents - state.smoothedCents) * analysisConfig.centsSmoothing
    : clampedCents;
  const displayFrequency = state.smoothedFrequency
    ? state.smoothedFrequency + (frequency - state.smoothedFrequency) * analysisConfig.frequencySmoothing
    : frequency;

  elements.noteName.textContent = target.name;
  elements.frequencyValue.textContent = `${displayFrequency.toFixed(1)} Hz`;
  state.smoothedCents = displayCents;
  state.smoothedFrequency = displayFrequency;
  state.hasReading = true;
  pushGraphPoint({ cents: displayCents });
  highlightDetectedString(target.name);

  const absoluteCents = Math.abs(cents);
  elements.tuningMessage.classList.remove("is-flat", "is-sharp", "is-tuned");

  if (absoluteCents <= 5) {
    elements.tuningMessage.textContent = "Accordata";
    elements.tuningMessage.classList.add("is-tuned");
  } else if (cents < 0) {
    elements.tuningMessage.textContent = "Tendi la corda";
    elements.tuningMessage.classList.add("is-flat");
  } else {
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
  if (rms < analysisConfig.minRms) {
    return { frequency: null, rms, clarity: 0 };
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

  if (bestLag <= 0 || correlations[0] <= 0) {
    return { frequency: null, rms, clarity: 0 };
  }

  const clarity = bestCorrelation / correlations[0];
  const minClarity =
    rms < analysisConfig.quietRms ? analysisConfig.quietMinClarity : analysisConfig.minClarity;

  if (clarity < minClarity) {
    return { frequency: null, rms, clarity };
  }

  const previous = correlations[bestLag - 1] || 0;
  const current = correlations[bestLag];
  const next = correlations[bestLag + 1] || 0;
  const divisor = previous + next - 2 * current;
  const offset = divisor ? (previous - next) / (2 * divisor) : 0;
  const refinedLag = bestLag + offset;
  const pitch = sampleRate / refinedLag;

  if (!Number.isFinite(pitch) || pitch < 40 || pitch > 1200) {
    return { frequency: null, rms, clarity };
  }

  return { frequency: pitch, rms, clarity };
}

function refreshPresetUi() {
  renderStringList();
  clearDetectedString();
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
    pill.dataset.note = note.name;

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

function normalizeReferencePitch() {
  const value = Number(elements.referencePitch.value);
  if (!Number.isFinite(value) || value < 400 || value > 480) {
    elements.referencePitch.value = 440;
  }
}

function getReferencePitch() {
  return Number(elements.referencePitch.value) || 440;
}

function setupGraphCanvas() {
  resizeGraphCanvas();
  drawGraph();

  if ("ResizeObserver" in window) {
    graph.resizeObserver = new ResizeObserver(() => {
      resizeGraphCanvas();
      drawGraph();
    });
    graph.resizeObserver.observe(elements.intonationCanvas);
    return;
  }

  window.addEventListener("resize", () => {
    resizeGraphCanvas();
    drawGraph();
  });
}

function resizeGraphCanvas() {
  const rect = elements.intonationCanvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(240, Math.round(rect.height));
  graph.pixelRatio = window.devicePixelRatio || 1;
  elements.intonationCanvas.width = Math.round(width * graph.pixelRatio);
  elements.intonationCanvas.height = Math.round(height * graph.pixelRatio);
  graph.context.setTransform(graph.pixelRatio, 0, 0, graph.pixelRatio, 0, 0);
}

function pushGraphPoint(cents) {
  state.graphHistory.push(cents ? { cents: clamp(cents.cents, -50, 50) } : null);

  if (state.graphHistory.length > analysisConfig.maxHistoryPoints) {
    state.graphHistory.shift();
  }

  drawGraph();
}

function drawGraph() {
  const canvas = elements.intonationCanvas;
  const context = graph.context;
  const width = canvas.width / graph.pixelRatio;
  const height = canvas.height / graph.pixelRatio;
  const padding = 24;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;
  const colors = getCanvasColors();

  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.paper;
  context.fillRect(0, 0, width, height);

  drawTunedBand(context, padding, graphWidth, graphHeight, colors);
  drawGridLines(context, padding, graphWidth, graphHeight, colors);
  drawCursorGuide(context, padding, graphWidth, graphHeight, colors);
  drawHistoryLine(context, padding, graphWidth, graphHeight, colors);
}

function drawTunedBand(context, padding, graphWidth, graphHeight, colors) {
  const centerX = centsToX(0, padding, graphWidth);
  const bandHalfWidth = (5 / 50) * (graphWidth / 2);
  context.fillStyle = colors.greenSoft;
  context.fillRect(centerX - bandHalfWidth, padding, bandHalfWidth * 2, graphHeight);
}

function drawGridLines(context, padding, graphWidth, graphHeight, colors) {
  const marks = [-50, -25, 0, 25, 50];

  marks.forEach((mark) => {
    const x = centsToX(mark, padding, graphWidth);
    context.beginPath();
    context.lineWidth = mark === 0 ? 4 : 2;
    context.strokeStyle = mark === 0 ? colors.green : colors.grid;
    context.setLineDash([]);
    context.moveTo(x, padding);
    context.lineTo(x, padding + graphHeight);
    context.stroke();

    if (mark !== 0) {
      context.fillStyle = colors.ink;
      context.font = "800 10px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(`${mark > 0 ? "+" : ""}${mark}`, x, padding + 6);
    }
  });

  context.setLineDash([]);
  context.fillStyle = colors.ink;
  context.font = "900 11px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText("OK", centsToX(0, padding, graphWidth), padding + graphHeight - 6);
}

function drawCursorGuide(context, padding, graphWidth, graphHeight, colors) {
  const y = getCursorY(padding, graphHeight);

  context.setLineDash([]);
  context.beginPath();
  context.lineWidth = 3;
  context.strokeStyle = colors.pink;
  context.moveTo(padding, y);
  context.lineTo(padding + graphWidth, y);
  context.stroke();
}

function drawHistoryLine(context, padding, graphWidth, graphHeight, colors) {
  const history = state.graphHistory;

  if (!history.length) {
    return;
  }

  const cursorY = getCursorY(padding, graphHeight);
  const spacing = (graphHeight / 2) / Math.max(analysisConfig.maxHistoryPoints - 1, 1);
  let drawing = false;

  context.beginPath();
  history.forEach((point, index) => {
    const y = cursorY + spacing * (history.length - 1 - index);

    if (y > padding + graphHeight) {
      drawing = false;
      return;
    }

    if (!point) {
      drawing = false;
      return;
    }

    const x = centsToX(point.cents, padding, graphWidth);

    if (!drawing) {
      context.moveTo(x, y);
      drawing = true;
    } else {
      context.lineTo(x, y);
    }
  });

  context.setLineDash([]);
  context.lineWidth = 5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = colors.ink;
  context.stroke();

  const current = history[history.length - 1];
  if (!current) {
    return;
  }

  const latestX = centsToX(current.cents, padding, graphWidth);
  const latestY = cursorY;
  const label = formatCentsLabel(current.cents);

  context.beginPath();
  context.fillStyle =
    Math.abs(current.cents) <= 5 ? colors.green : current.cents > 0 ? colors.amber : colors.coral;
  context.strokeStyle = colors.ink;
  context.lineWidth = 4;
  context.arc(latestX, latestY, 17, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = colors.ink;
  context.font = "900 11px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, latestX, latestY);
}

function centsToX(cents, padding, graphWidth) {
  return padding + ((cents + 50) / 100) * graphWidth;
}

function getCursorY(padding, graphHeight) {
  return padding + graphHeight / 2;
}

function formatCentsLabel(cents) {
  if (Math.abs(cents) <= 5) {
    return "0";
  }

  return `${cents > 0 ? "+" : ""}${Math.round(cents)}`;
}

function getCanvasColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    amber: styles.getPropertyValue("--amber").trim() || "#ffb800",
    coral: styles.getPropertyValue("--coral").trim() || "#ff5a4f",
    green: styles.getPropertyValue("--green").trim() || "#2ee66b",
    greenSoft: "rgba(46, 230, 107, 0.22)",
    grid: styles.getPropertyValue("--grid").trim() || "rgba(17, 17, 17, 0.22)",
    ink: styles.getPropertyValue("--ink").trim() || "#111111",
    paper: styles.getPropertyValue("--panel").trim() || "#ffffff",
    pink: styles.getPropertyValue("--pink").trim() || "#ff7ac8",
  };
}

function restoreTheme() {
  const savedTheme = readSavedTheme();
  elements.skinSelect.value = ["brutal", "neon", "pixel"].includes(savedTheme) ? savedTheme : "brutal";
  applyTheme(elements.skinSelect.value);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const themeColor = {
    brutal: "#ffe94f",
    neon: "#09080f",
    pixel: "#b7f7d0",
  }[theme] || "#ffe94f";

  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
  saveTheme(theme);
  drawGraph();
}

function readSavedTheme() {
  try {
    return localStorage.getItem("accordatore-theme") || "brutal";
  } catch (error) {
    return "brutal";
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem("accordatore-theme", theme);
  } catch (error) {
    // Theme changes can still work for the current session.
  }
}

function updateSignalMeter(rms) {
  const level = clamp((rms / analysisConfig.signalMeterFullScale) * 100, 0, 100);
  elements.signalFill.style.width = `${level}%`;

  if (rms < analysisConfig.minRms) {
    elements.signalText.textContent = state.hasReading ? "Ultima lettura" : "Basso";
    return;
  }

  if (level > 78) {
    elements.signalText.textContent = "Forte";
  } else if (level > 28) {
    elements.signalText.textContent = "Buono";
  } else {
    elements.signalText.textContent = "Debole";
  }
}

function highlightDetectedString(noteName) {
  const noteBase = getNoteBase(noteName);
  const pills = elements.stringList.querySelectorAll(".string-pill");
  const hasExactMatch = Array.from(pills).some((pill) => pill.dataset.note === noteName);

  pills.forEach((pill) => {
    const matches = hasExactMatch ? pill.dataset.note === noteName : getNoteBase(pill.dataset.note || "") === noteBase;
    pill.classList.toggle("is-detected", matches);
  });
}

function clearDetectedString() {
  elements.stringList
    .querySelectorAll(".string-pill.is-detected")
    .forEach((pill) => pill.classList.remove("is-detected"));
}

function getNoteBase(noteName) {
  return noteName.replace(/\d/g, "");
}

function holdLastReadout(timestamp, rms) {
  if (!state.hasReading) {
    showIdleReadout(rms < analysisConfig.minRms ? "Suona piu vicino al microfono" : "Cerco la nota");
    return;
  }

  const elapsed = timestamp - state.lastSignalAt;
  if (elapsed < analysisConfig.holdMs) {
    elements.tuningMessage.textContent =
      rms < analysisConfig.minRms ? "Ultima lettura" : "Segnale instabile";
    return;
  }

  elements.tuningMessage.classList.remove("is-flat", "is-sharp", "is-tuned");
  elements.tuningMessage.textContent = "Ultima nota";
  clearDetectedString();
}

function showIdleReadout(message) {
  elements.noteName.textContent = "--";
  elements.frequencyValue.textContent = "-- Hz";
  elements.tuningMessage.textContent = message;
  elements.tuningMessage.classList.remove("is-flat", "is-sharp", "is-tuned");
  clearDetectedString();
}

function resetReadout() {
  state.lastSignalAt = 0;
  state.smoothedCents = null;
  state.smoothedFrequency = null;
  state.graphHistory = [];
  state.hasReading = false;
  elements.signalFill.style.width = "0%";
  elements.signalText.textContent = "In attesa";
  showIdleReadout("In attesa di segnale");
  drawGraph();
}

function stopListening() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }

  if (state.source) {
    state.source.disconnect();
  }

  if (state.inputGain) {
    state.inputGain.disconnect();
  }

  state.mediaStream = null;
  state.source = null;
  state.inputGain = null;
  state.listening = false;
  elements.startButton.textContent = "Avvia microfono";

  cancelAnimationFrame(state.rafId);
  setStatus("Pronto. Concedi il microfono per iniziare.", "idle");
  resetReadout();
}

function setStatus(message, type) {
  elements.statusText.textContent = message;
  elements.statusDot.classList.toggle("is-live", type === "live");
  elements.statusDot.classList.toggle("is-error", type === "error");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Standalone mode still works without offline caching.
    });
  });
}
