const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function createPlayback() {
  const elements = new Map();
  for (const id of ['chkInstant', 'btnPause', 'btnBack', 'btnNext', 'btnSkip', 'stepState', 'stepModeLabel', 'step-counter', 'status-text']) {
    elements.set(id, { checked: false, disabled: false, textContent: '', classList: { toggle() {} } });
  }
  const operation = { id: 'operation', disabled: false };
  const document = {
    getElementById: id => elements.get(id),
    querySelectorAll: () => [operation]
  };
  let cleared = 0;
  const context = vm.createContext({
    document,
    window: { app: { history: [], clearInputs: () => cleared++ } },
    requestAnimationFrame: () => 1,
    Math
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../array-playback.js'), 'utf8'), context);

  class Engine {
    constructor() {
      this.sn = [];
      this.idx = -1;
      this.state = 'IDLE';
      this.autoFit = false;
      this.paused = false;
      this.stepMode = false;
      this.speedFactor = 1;
      this.singleStepTarget = null;
      this.cam = { x: 0, targetX: 0, y: 0, targetY: 0, scale: 1, targetScale: 1 };
      this.cv = {};
    }
    wheel() {}
    down() {}
    move() {}
    up() {}
    touchStart() {}
    touchMove() {}
    layout() {}
    fit() {}
    current() { return this.sn[this.idx]; }
    draw() {}
  }
  context.installArrayPlayback(Engine);
  return { engine: new Engine(), elements, operation, cleared: () => cleared };
}

test('step mode skips visual-only states and permits stepping back and skipping', () => {
  const { engine, operation, cleared } = createPlayback();
  engine.enqueue([{ text: 'start' }]);
  engine.setStepMode(true);
  engine.enqueue([
    { text: 'start' },
    { text: 'first', pause: true },
    { visualOnly: true },
    { text: 'second', pause: true }
  ]);
  assert.equal(operation.disabled, true);
  engine.update(1);
  assert.equal(engine.state, 'STEP_WAIT');
  engine.stepForward();
  engine.update(1);
  assert.equal(engine.idx, 2);
  assert.equal(engine.state, 'MORPH');
  engine.update(1);
  assert.equal(engine.state, 'STEP_WAIT');
  engine.stepBackward();
  assert.equal(engine.idx, 1);
  assert.equal(engine.state, 'IDLE');
  assert.equal(engine.paused, true);
  engine.skipToEnd();
  assert.equal(engine.idx, 3);
  assert.equal(operation.disabled, false);
  assert.equal(cleared(), 1);
});

test('instant playback reaches the final snapshot and clears input once', () => {
  const { engine, elements, operation, cleared } = createPlayback();
  elements.get('chkInstant').checked = true;
  engine.enqueue([{ text: 'start' }, { text: 'done' }]);
  assert.equal(engine.idx, 1);
  assert.equal(engine.state, 'IDLE');
  assert.equal(operation.disabled, false);
  assert.equal(elements.get('status-text').textContent, 'done');
  assert.equal(cleared(), 1);
});
