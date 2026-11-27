// Playback and camera lifecycle shared by the array-based visualizers.
function installArrayPlayback(Engine) {
  const p = Engine.prototype;
  const inputMethods = ['wheel', 'down', 'move', 'up', 'touchStart', 'touchMove'];
  for (const name of inputMethods) {
    const original = p[name];
    p[name] = function (...args) {
      const result = original.apply(this, args);
      this.requestRender();
      return result;
    };
  }

  Object.assign(p, {
    initializePlayback() {
      this.autoFit = true;
      this.singleStepTarget = null;
      this.rafId = null;
      this.last = null;
      this.needsRender = false;
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.cv.parentElement);
      } else window.addEventListener('resize', () => this.resize());
      this.resize();
    },
    requestRender() {
      this.needsRender = true;
      if (!this.rafId) this.rafId = requestAnimationFrame(t => this.loop(t));
    },
    resize() {
      const rect = this.cv.parentElement.getBoundingClientRect();
      this.viewWidth = rect.width;
      this.viewHeight = rect.height;
      this.dpr = window.devicePixelRatio || 1;
      this.cv.width = Math.max(1, Math.floor(rect.width * this.dpr));
      this.cv.height = Math.max(1, Math.floor(rect.height * this.dpr));
      if (this.sn.length && this.autoFit) this.fit([this.sn[Math.max(this.idx, 0)]]);
      this.requestRender();
    },
    enqueue(snaps, instant = false) {
      if (!snaps.length) return;
      snaps.forEach(s => this.layout(s));
      const firstView = !this.sn.length;
      this.sn = snaps;
      this.idx = 0;
      this.t = 0;
      this.wait = 0;
      this.paused = false;
      this.singleStepTarget = null;
      this.waitingForStep = false;
      if (this.autoFit || firstView) this.fit(snaps);
      if (instant || document.getElementById('chkInstant').checked || snaps.length === 1) {
        this.idx = snaps.length - 1;
        this.state = 'IDLE';
        if (this.autoFit) this.fit([snaps[this.idx]]);
        this.setStatus(snaps[this.idx]);
        if (snaps.length > 1) window.app?.clearInputs();
      } else {
        this.setStatus(snaps[0]);
        if (this.autoFit || firstView) this.state = 'CAMERA';
        else this.startMorphStep();
      }
      this.updateStepControls();
      this.requestRender();
    },
    setStatus(scene) {
      document.getElementById('status-text').textContent =
        scene?.visualOnly && !scene.keepStatus ? '\u00a0' : (scene?.text || 'Ready.');
    },
    startMorphStep() {
      if (this.idx >= this.sn.length - 1) {
        this.state = 'IDLE';
        this.singleStepTarget = null;
        if (this.autoFit) this.fit([this.sn[this.idx]]);
        this.updateStepControls();
        return;
      }
      const next = this.sn[this.idx + 1];
      if (next.fitCamera && this.autoFit) this.fit([next]);
      this.setStatus(next);
      this.t = 0;
      this.state = 'MORPH';
      this.waitingForStep = false;
      this.updateStepControls();
      this.requestRender();
    },
    finish() {
      this.idx++;
      this.t = 0;
      this.waitingForStep = false;
      if (this.idx < this.sn.length - 1) this.startMorphStep();
      else {
        this.state = 'IDLE';
        if (this.autoFit) this.fit([this.sn[this.idx]]);
        this.setStatus(this.sn[this.idx]);
        this.updateStepControls();
        window.app?.clearInputs();
      }
      this.requestRender();
    },
    loop(timestamp) {
      this.rafId = null;
      if (this.last === null) this.last = timestamp;
      const dt = Math.min(Math.max((timestamp - this.last) / 1000, 0), 0.1);
      this.last = timestamp;
      this.needsRender = false;
      this.update(dt);
      this.draw();
      const single = this.paused && this.singleStepTarget !== null && this.state === 'MORPH';
      const animating = this.state !== 'IDLE' && this.state !== 'STEP_WAIT' && (!this.paused || single);
      const scene = this.current();
      const flashing = scene && Object.entries(scene).some(([key, value]) =>
        /^(flash|cross)/.test(key) && (Array.isArray(value) ? value.length > 0 : !!value));
      if (animating || !this.cameraSettled() || flashing || this.needsRender) {
        if (!this.rafId) this.rafId = requestAnimationFrame(t => this.loop(t));
      } else this.last = null;
    },
    cameraSettled() {
      return Math.hypot(this.cam.x - this.cam.targetX, this.cam.y - this.cam.targetY) < 0.25 &&
        Math.abs(this.cam.scale - this.cam.targetScale) < 0.0005;
    },
    update(dt) {
      const f = 1 - Math.exp(-10 * dt);
      this.cam.scale += (this.cam.targetScale - this.cam.scale) * f;
      this.cam.x += (this.cam.targetX - this.cam.x) * f;
      this.cam.y += (this.cam.targetY - this.cam.y) * f;
      if (this.cameraSettled()) {
        this.cam.scale = this.cam.targetScale;
        this.cam.x = this.cam.targetX;
        this.cam.y = this.cam.targetY;
      }
      const single = this.paused && this.singleStepTarget !== null && this.state === 'MORPH';
      if (this.paused && !single) return;
      if (this.state === 'CAMERA') {
        if (Math.hypot(this.cam.x - this.cam.targetX, this.cam.y - this.cam.targetY) < 5 &&
            Math.abs(this.cam.scale - this.cam.targetScale) < 0.01) this.startMorphStep();
      } else if (this.state === 'MORPH') {
        const previous = this.t;
        this.t += 2.5 * this.speedFactor * dt;
        if (previous <= 0.5 && this.t > 0.5) this.updateStepControls();
        if (this.t >= 1) {
          this.t = 1;
          const next = this.sn[this.idx + 1];
          if (single) {
            this.idx = this.singleStepTarget;
            this.singleStepTarget = null;
            this.t = 0;
            this.state = 'IDLE';
            this.setStatus(this.sn[this.idx]);
            this.updateStepControls();
            if (this.idx === this.sn.length - 1) window.app?.clearInputs();
          } else if (this.stepMode && !next.visualOnly) {
            this.state = 'STEP_WAIT';
            this.waitingForStep = true;
            this.updateStepControls();
          } else if (next.pause && !next.visualOnly) {
            this.state = 'WAIT';
            this.wait = 0.68 / this.speedFactor;
          } else this.finish();
        }
      } else if (this.state === 'WAIT') {
        this.wait -= dt;
        if (this.wait <= 0) this.finish();
      }
    },
    togglePause() {
      if (this.state === 'STEP_WAIT') {
        this.paused = false;
        this.finish();
      } else if (this.state !== 'IDLE' || this.idx < this.sn.length - 1) {
        this.paused = !this.paused;
        if (!this.paused) {
          this.singleStepTarget = null;
          if (this.state === 'IDLE') this.startMorphStep();
        }
      }
      this.updateStepControls();
      this.requestRender();
      return this.paused;
    },
    setStepMode(enabled) {
      this.stepMode = !!enabled;
      if (!this.stepMode && this.state === 'STEP_WAIT') {
        this.paused = false;
        this.finish();
      }
      this.updateStepControls();
      this.requestRender();
    },
    nextStep() { this.stepForward(); },
    stepForward() {
      if (this.sn.length <= 1) return;
      if (this.state === 'STEP_WAIT') {
        this.paused = false;
        this.finish();
        return;
      }
      this.paused = true;
      if (this.state === 'CAMERA') {
        this.cam.scale = this.cam.targetScale;
        this.cam.x = this.cam.targetX;
        this.cam.y = this.cam.targetY;
      } else if (this.state === 'WAIT' || (this.state === 'MORPH' && this.t > 0.08)) {
        this.idx = Math.min(this.idx + 1, this.sn.length - 1);
      }
      if (this.idx >= this.sn.length - 1) {
        this.state = 'IDLE';
        this.setStatus(this.sn[this.idx]);
        this.updateStepControls();
        window.app?.clearInputs();
        this.requestRender();
        return;
      }
      if (this.stepMode) {
        this.paused = false;
        this.singleStepTarget = null;
      } else this.singleStepTarget = this.idx + 1;
      this.startMorphStep();
    },
    stepBackward() {
      if (this.sn.length <= 1) return;
      this.paused = true;
      this.singleStepTarget = null;
      if (this.state === 'STEP_WAIT') this.idx = Math.min(this.idx + 1, this.sn.length - 1);
      if (this.state === 'STEP_WAIT' || this.state === 'WAIT' || (this.state === 'MORPH' && this.t > 0.15)) {
        if (this.stepMode && this.idx > 0) {
          this.idx--;
          while (this.idx > 0 && this.sn[this.idx].visualOnly) this.idx--;
        } else if (this.state === 'STEP_WAIT' && this.idx > 0) this.idx--;
      } else if (this.idx > 0) {
        this.idx--;
        if (this.stepMode) while (this.idx > 0 && this.sn[this.idx].visualOnly) this.idx--;
      }
      this.t = 0;
      this.state = 'IDLE';
      this.waitingForStep = false;
      this.setStatus(this.sn[this.idx]);
      this.updateStepControls();
      this.requestRender();
    },
    skipToEnd() {
      if (!this.sn.length) return;
      this.paused = false;
      this.singleStepTarget = null;
      this.waitingForStep = false;
      this.idx = this.sn.length - 1;
      this.t = 0;
      this.state = 'IDLE';
      if (this.autoFit) this.fit([this.sn[this.idx]]);
      this.setStatus(this.sn[this.idx]);
      this.updateStepControls();
      window.app?.clearInputs();
      this.requestRender();
    },
    updateStepControls() {
      const busy = this.state !== 'IDLE' || (this.paused && this.idx < this.sn.length - 1);
      const atEnd = this.idx >= this.sn.length - 1 && this.state === 'IDLE';
      document.querySelectorAll('.controls button').forEach(button => {
        button.disabled = busy || (button.id === 'btnUndo' && !window.app?.history.length);
      });
      document.getElementById('btnPause').disabled = this.sn.length <= 1 || atEnd;
      document.getElementById('btnPause').textContent = this.state === 'STEP_WAIT' ? 'Next' : (this.paused ? 'Resume' : 'Pause');
      document.getElementById('btnBack').disabled = this.sn.length <= 1 || (this.idx === 0 && this.state === 'IDLE');
      document.getElementById('btnNext').disabled = this.sn.length <= 1 || atEnd;
      document.getElementById('btnSkip').disabled = this.sn.length <= 1 || atEnd;
      document.getElementById('stepState').textContent = this.stepMode ? 'On' : 'Off';
      document.getElementById('stepModeLabel').classList.toggle('step-toggle-on', this.stepMode);
      const shown = this.idx + ((this.state === 'WAIT' || this.state === 'STEP_WAIT' || (this.state === 'MORPH' && this.t > 0.5)) ? 2 : 1);
      document.getElementById('step-counter').textContent = this.sn.length > 1 ? `Step: ${Math.min(shown, this.sn.length)}/${this.sn.length}` : 'Step: -';
    },
    draw() {
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.cv.width, this.cv.height);
      c.save();
      c.setTransform(this.dpr * this.cam.scale, 0, 0, this.dpr * this.cam.scale, this.dpr * this.cam.x, this.dpr * this.cam.y);
      const scene = this.current();
      if (scene) this.renderScene(scene);
      c.restore();
    }
  });
}

function setupArrayPlayback(app) {
  const viz = app.viz;
  document.getElementById('btnBack').addEventListener('click', () => viz.stepBackward());
  document.getElementById('btnSkip').addEventListener('click', () => viz.skipToEnd());
  for (const [id, factor] of [['btnZoomOut', 0.8], ['btnZoomIn', 1.25]]) {
    document.getElementById(id).addEventListener('click', () => {
      const x = viz.viewWidth / 2, y = viz.viewHeight / 2;
      const scale = Math.min(5, Math.max(0.2, viz.cam.targetScale * factor));
      const wx = (x - viz.cam.targetX) / viz.cam.targetScale;
      const wy = (y - viz.cam.targetY) / viz.cam.targetScale;
      viz.cam.targetScale = scale;
      viz.cam.targetX = x - wx * scale;
      viz.cam.targetY = y - wy * scale;
      viz.requestRender();
    });
  }
  document.getElementById('btnFitView').addEventListener('click', () => {
    if (viz.sn.length) {
      viz.fit([viz.sn[Math.max(viz.idx, 0)]]);
      viz.requestRender();
    }
  });
  document.getElementById('chkAutoFit').addEventListener('change', e => {
    viz.autoFit = e.target.checked;
    if (viz.autoFit && viz.sn.length) {
      viz.fit([viz.sn[Math.max(viz.idx, 0)]]);
      viz.requestRender();
    }
  });
  document.getElementById('btnToggleLegend').addEventListener('click', e => {
    const collapsed = document.getElementById('legend').classList.toggle('collapsed');
    e.currentTarget.textContent = collapsed ? '+' : '−';
    e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input') &&
        (viz.state !== 'IDLE' || (viz.paused && viz.idx < viz.sn.length - 1))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space' && !document.getElementById('btnPause').disabled) {
      e.preventDefault();
      viz.togglePause();
    } else if (e.key === 'ArrowLeft' && !document.getElementById('btnBack').disabled) viz.stepBackward();
    else if (e.key === 'ArrowRight' && !document.getElementById('btnNext').disabled) viz.stepForward();
  }, true);
  viz.updateStepControls();
}
