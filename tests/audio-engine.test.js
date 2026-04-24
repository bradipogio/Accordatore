const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");

function makeElement() {
  const classes = new Set();

  return {
    value: "",
    textContent: "",
    innerHTML: "",
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
    setAttribute() {},
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
    "#signalText": makeElement(),
    "#intonationCanvas": makeElement(),
    ".headstock-stage": makeElement(),
    "#noteName": makeElement(),
    "#noteCue": makeElement(),
    "#frequencyValue": makeElement(),
    "#stringList": makeElement(),
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

function generateSine(frequency, sampleRate = 44100, size = 8192) {
  const buffer = new Float32Array(size);
  let seed = 12345;

  for (let index = 0; index < size; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const noise = ((seed / 2147483647) * 2 - 1) * 0.004;
    buffer[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.35 + noise;
  }

  return buffer;
}

function expectPitch(context, frequency, range, tolerance = 0.8) {
  const result = context.autoCorrelate(generateSine(frequency), 44100, range);
  assert.ok(result.frequency, `Expected ${frequency} Hz to be detected`);
  assert.ok(
    Math.abs(result.frequency - frequency) <= tolerance,
    `Expected ${frequency} Hz, got ${result.frequency} Hz`,
  );
}

const { context, nodes } = createHarness();

expectPitch(context, 41.2, { minFrequency: 35, maxFrequency: 135 }, 0.5);
expectPitch(context, 82.41, { minFrequency: 62, maxFrequency: 420 }, 0.5);
expectPitch(context, 110, { minFrequency: 62, maxFrequency: 420 }, 0.5);
expectPitch(context, 440, { minFrequency: 220, maxFrequency: 520 }, 0.8);

nodes["#tuningSelect"].value = "bass";
assert.equal(context.findTargetNote(41.2, 440).name, "E1");

nodes["#tuningSelect"].value = "guitar";
assert.equal(context.findTargetNote(82.41, 440).name, "E2");
assert.equal(context.findTargetNote(110, 440).name, "A2");

nodes["#tuningSelect"].value = "chromatic";
assert.equal(context.findTargetNote(440, 440).name, "A4");

console.log("audio-engine: ok");
