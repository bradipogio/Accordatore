const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");

function makeElement() {
  const classes = new Set();
  const attributes = new Map();

  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    dataset: {},
    style: {
      setProperty() {},
    },
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
    append() {},
    addEventListener() {},
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 900, height: 620 };
    },
    getContext() {
      return {
        setTransform() {},
        clearRect() {},
        fillRect() {},
        fill() {},
        arc() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillText() {},
        setLineDash() {},
      };
    },
  };
}

function createHarness() {
  const nodes = {
    "#startButton": makeElement(),
    "#tuningSelect": makeElement(),
    "#skinSelect": makeElement(),
    "#referencePitch": makeElement(),
    "#signalRow": makeElement(),
    "#statusDot": makeElement(),
    "#statusText": makeElement(),
    "#signalFill": makeElement(),
    "#signalMeter": makeElement(),
    "#signalText": makeElement(),
    "#intonationCanvas": makeElement(),
    ".headstock-stage": makeElement(),
    "#noteName": makeElement(),
    "#noteCue": makeElement(),
    "#frequencyValue": makeElement(),
    "#stringList": makeElement(),
    "#micButtonLabel": makeElement(),
    "#autoModeButton": makeElement(),
    "#targetHint": makeElement(),
    "#readoutLabel": makeElement(),
  };

  nodes["#tuningSelect"].value = "guitar";
  nodes["#skinSelect"].value = "brutal";
  nodes["#referencePitch"].value = "440";

  const context = {
    console,
    Float32Array,
    Math,
    Number,
    Array,
    String,
    Boolean,
    Set,
    document: {
      documentElement: makeElement(),
      querySelector(selector) {
        return nodes[selector] || makeElement();
      },
      createElement() {
        return makeElement();
      },
      addEventListener() {},
    },
    window: {
      devicePixelRatio: 1,
      addEventListener() {},
    },
    navigator: {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    ResizeObserver: class ResizeObserver {
      observe() {}
    },
    getComputedStyle() {
      return {
        getPropertyValue() {
          return "";
        },
      };
    },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };

  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: "app.js" });

  return { context, nodes };
}

function generateSine(
  frequency,
  sampleRate = 44100,
  size = 8192,
  amplitude = 0.35,
  noiseAmplitude = 0.004,
) {
  const buffer = new Float32Array(size);
  let seed = 12345;

  for (let index = 0; index < size; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const noise = ((seed / 2147483647) * 2 - 1) * noiseAmplitude;
    buffer[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude + noise;
  }

  return buffer;
}

function generateHarmonicString(
  frequency,
  sampleRate = 44100,
  size = 8192,
  level = 1,
  noiseAmplitude = 0.006,
) {
  const buffer = new Float32Array(size);
  const partials = [
    { multiple: 1, amplitude: 0.16 },
    { multiple: 2, amplitude: 0.34 },
    { multiple: 3, amplitude: 0.22 },
    { multiple: 4, amplitude: 0.1 },
    { multiple: 5, amplitude: 0.06 },
  ];
  let seed = 54321;

  for (let index = 0; index < size; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const time = index / sampleRate;
    const envelope = Math.exp(-time * 2.8);
    const noise = ((seed / 2147483647) * 2 - 1) * noiseAmplitude;
    buffer[index] =
      partials.reduce(
        (sum, partial) =>
          sum +
          partial.amplitude *
            Math.sin((2 * Math.PI * frequency * partial.multiple * index) / sampleRate),
        0,
      ) *
        envelope *
        level +
      noise;
  }

  return buffer;
}

function generateNoise(sampleRate = 44100, size = 8192) {
  const buffer = new Float32Array(size);
  let seed = 9999;

  for (let index = 0; index < size; index += 1) {
    seed = (seed * 16807) % 2147483647;
    buffer[index] = ((seed / 2147483647) * 2 - 1) * 0.06;
  }

  return buffer;
}

function expectPitch(context, frequency, range, tolerance = 0.8, options = {}) {
  const {
    sampleRate = 44100,
    size = 8192,
    amplitude = 0.35,
    noiseAmplitude = 0.004,
  } = options;
  const result = context.autoCorrelate(
    generateSine(frequency, sampleRate, size, amplitude, noiseAmplitude),
    sampleRate,
    range,
  );
  assert.ok(result.frequency, `Expected ${frequency} Hz to be detected`);
  assert.ok(
    Math.abs(result.frequency - frequency) <= tolerance,
    `Expected ${frequency} Hz, got ${result.frequency} Hz`,
  );
}

function expectStringPitch(context, frequency, range, tolerance = 0.9, options = {}) {
  const {
    sampleRate = 44100,
    size = 8192,
    level = 1,
    noiseAmplitude = 0.006,
  } = options;
  const result = context.autoCorrelate(
    generateHarmonicString(frequency, sampleRate, size, level, noiseAmplitude),
    sampleRate,
    range,
  );
  assert.ok(result.frequency, `Expected string-like ${frequency} Hz to be detected`);
  assert.ok(
    Math.abs(result.frequency - frequency) <= tolerance,
    `Expected string-like ${frequency} Hz, got ${result.frequency}`,
  );
}

function expectCents(context, targetFrequency, cents, range, options = {}) {
  const inputFrequency = targetFrequency * 2 ** (cents / 1200);
  const { sampleRate = 48000, size = 4096 } = options;
  const result = context.autoCorrelate(
    generateSine(inputFrequency, sampleRate, size),
    sampleRate,
    range,
  );
  assert.ok(result.frequency, `Expected ${cents} cents from ${targetFrequency} Hz to be detected`);
  const detectedCents = 1200 * Math.log2(result.frequency / targetFrequency);
  assert.ok(
    Math.abs(detectedCents - cents) <= 1.5,
    `Expected ${cents} cents, got ${detectedCents.toFixed(2)} cents`,
  );
}

function detectFrame(context, frequency, timestamp, rms = 0.08, clarity = 0.98) {
  const stableFrequency = context.stabilizeFrequency(frequency, clarity, rms);
  context.updateReadout(stableFrequency, timestamp, rms);
}

const { context, nodes } = createHarness();

assert.equal(
  context.autoCorrelate(generateNoise(), 44100, { minFrequency: 55, maxFrequency: 420 })
    .frequency,
  null,
);
assert.equal(
  context.autoCorrelate(generateNoise(48000, 4096), 48000, {
    minFrequency: 55,
    maxFrequency: 420,
  }).frequency,
  null,
);

assert.equal(context.getCentsSmoothing(20, 0), 0.62);
assert.equal(context.getCentsSmoothing(4, 0), 0.32);

expectPitch(context, 35, { minFrequency: 30, maxFrequency: 150 }, 0.5);
expectPitch(context, 41.2, { minFrequency: 35, maxFrequency: 135 }, 0.5);
expectPitch(context, 82.41, { minFrequency: 62, maxFrequency: 420 }, 0.5);
expectPitch(context, 110, { minFrequency: 62, maxFrequency: 420 }, 0.5);
expectPitch(context, 440, { minFrequency: 220, maxFrequency: 520 }, 0.8);
expectStringPitch(context, 41.2, { minFrequency: 30, maxFrequency: 150 }, 0.7);
expectStringPitch(context, 82.41, { minFrequency: 55, maxFrequency: 420 }, 0.7);
expectStringPitch(context, 110, { minFrequency: 55, maxFrequency: 420 }, 0.7);
expectStringPitch(context, 196, { minFrequency: 55, maxFrequency: 420 }, 0.8);
expectStringPitch(context, 41.2, { minFrequency: 30, maxFrequency: 150 }, 0.8, {
  size: 4096,
});
expectStringPitch(context, 82.41, { minFrequency: 55, maxFrequency: 420 }, 0.8, {
  size: 4096,
});
expectStringPitch(context, 41.2, { minFrequency: 30, maxFrequency: 150 }, 0.9, {
  sampleRate: 48000,
  size: 4096,
});
expectStringPitch(context, 82.41, { minFrequency: 55, maxFrequency: 420 }, 0.9, {
  sampleRate: 48000,
  size: 4096,
});
expectStringPitch(context, 110, { minFrequency: 55, maxFrequency: 420 }, 1, {
  sampleRate: 48000,
  size: 4096,
  level: 0.08,
  noiseAmplitude: 0.0008,
});
expectPitch(context, 440, { minFrequency: 220, maxFrequency: 520 }, 1, {
  sampleRate: 48000,
  size: 4096,
  amplitude: 0.015,
  noiseAmplitude: 0.0006,
});
expectCents(context, 82.41, -25, { minFrequency: 55, maxFrequency: 420 });
expectCents(context, 82.41, 17, { minFrequency: 55, maxFrequency: 420 });
expectCents(context, 110, 4, { minFrequency: 55, maxFrequency: 420 });

nodes["#tuningSelect"].value = "bass";
assert.equal(context.findTargetNote(41.2, 440).name, "E1");

nodes["#tuningSelect"].value = "guitar";
assert.equal(context.findTargetNote(82.41, 440).name, "E2");
assert.equal(context.findTargetNote(110, 440).name, "A2");

context.selectManualTarget("A2");
assert.equal(context.findTargetNote(82.41, 440).name, "A2");
assert.equal(nodes["#autoModeButton"].getAttribute("aria-pressed"), "false");
assert.equal(nodes["#readoutLabel"].textContent, "Corda selezionata");
context.enableAutomaticTarget();
assert.equal(context.findTargetNote(82.41, 440).name, "E2");
assert.equal(nodes["#autoModeButton"].getAttribute("aria-pressed"), "true");

nodes["#tuningSelect"].value = "chromatic";
assert.equal(context.findTargetNote(440, 440).name, "A4");

nodes["#tuningSelect"].value = "guitar";
context.resetReadout();
detectFrame(context, 82.41, 0, 0.12);
detectFrame(context, 82.41, 300, 0.12);
assert.equal(nodes["#noteName"].textContent, "Mi2");
detectFrame(context, 110, 370, 0.07);
assert.equal(nodes["#noteName"].textContent, "La2");
detectFrame(context, 110, 650, 0.07);
assert.equal(nodes["#noteName"].textContent, "La2");

context.refreshPresetUi();
assert.equal(nodes["#noteName"].textContent, "—");
assert.equal(nodes["#signalText"].textContent, "In attesa di segnale");

nodes["#tuningSelect"].value = "chromatic";
context.refreshPresetUi(true);
detectFrame(context, 430, 0, 0.12);
detectFrame(context, 430, 200, 0.12);
assert.equal(nodes["#noteName"].textContent, "La4");
assert.equal(nodes["#signalText"].textContent, "Nota troppo bassa");

context.holdLastReadout(1401, 0);
assert.equal(nodes["#noteName"].textContent, "—");
assert.equal(nodes["#signalText"].textContent, "Suona una corda");

context.refreshPresetUi(true);
detectFrame(context, 450, 0, 0.12);
detectFrame(context, 450, 200, 0.12);
assert.equal(nodes["#noteName"].textContent, "La4");
assert.equal(nodes["#signalText"].textContent, "Nota troppo alta");

console.log("audio-engine: ok");
