const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(file, exports) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const init = "window.addEventListener('DOMContentLoaded', () => app.init());";
  assert.ok(script.includes(init));
  const context = vm.createContext({ window: { addEventListener() {} } });
  vm.runInContext(script.replace(init, `globalThis.testExports = ${exports};`), context);
  return context.testExports;
}

test('scheduler reads both current and next before advancing current', () => {
  const { SchedulerModel, SchedulerState, SnapshotRecorder, TaskNode } =
    loadPage('c/TaskScheduler.html', '{ SchedulerModel, SchedulerState, SnapshotRecorder, TaskNode }');
  for (const method of ['size', 'printScheduler', 'clear']) {
    const model = new SchedulerModel();
    model.state = new SchedulerState([new TaskNode(1, 'a', 1), new TaskNode(2, 'b', 1)]);
    const recorder = new SnapshotRecorder(model.state);
    model[method](recorder);
    const reads = recorder.snapshots.filter(s => s.text.startsWith('p_current->p_next is going'));
    assert.equal(reads.length, 2, method);
    for (const read of reads) {
      const index = recorder.snapshots.indexOf(read);
      const [source, selected, written, cleared] = recorder.snapshots.slice(index, index + 4);
      const current = source.ptrs.find(p => p.label === 'p_current');
      assert.ok(source.greenPtrs.includes('p_current'), method);
      assert.ok(source.greenNext.includes(current.target), method);
      assert.ok(selected.greenPtrs.includes('p_current') && selected.greenNext.includes(current.target), method);
      assert.ok(selected.flashPtrs.includes('p_current'), method);
      assert.ok(written.redPtrs.includes('p_current') && written.greenNext.includes(current.target), method);
      assert.equal(cleared.redPtrs.length + cleared.greenPtrs.length + cleared.greenNext.length, 0, method);
    }
  }
});

test('finder reads previous.next before updating current, including a null next', () => {
  const { app } = loadPage('SortedLinkedSet.html', '{ app }');
  app.viz = { base: () => ({ y: 210 }) };
  const nodes = app.baseNodes([10, 20], [1, 2]);
  const result = app.runFinder(30, nodes, 2, 1);
  const reads = result.snaps.filter(s => s.text === 'Finder.previous.next is read to advance Finder.current.');
  assert.equal(reads.length, 2);
  for (const read of reads) {
    const index = result.snaps.indexOf(read);
    const [source, selected, written, cleared] = result.snaps.slice(index, index + 4);
    const previous = source.finder.previous;
    const next = nodes.find(n => n.id === previous).next;
    assert.ok(source.greenRefs.includes('finder:previous') && source.greenRefs.includes('next:' + previous));
    assert.equal(source.finder.current, previous);
    assert.ok(selected.flashFinderCur);
    assert.ok(selected.greenRefs.includes('finder:previous') && selected.greenRefs.includes('next:' + previous));
    assert.equal(written.finder.current, next);
    assert.ok(written.redRefs.includes('finder:current'));
    assert.ok(written.greenRefs.includes('finder:previous') && written.greenRefs.includes('next:' + previous));
    assert.ok(!cleared.greenRefs && !cleared.redRefs && !cleared.flashFinderCur);
  }
  assert.equal(result.cur, null);
});
