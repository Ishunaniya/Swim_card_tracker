const test = require('node:test');
const assert = require('node:assert/strict');
const tracker = require('../miniprogram/utils/tracker');

function installCloudMock({ commitBeforeFailure, failFirst = true, delayFirstAdd = false, failRemoveOnce = false }) {
  const store = new Map();
  const remote = tracker.normalizeBackup(tracker.DEFAULT_STATE);
  const appState = { globalData: { cloudReady: true, state: null } };
  let failed = false;
  let removeFailed = false;
  let releaseAdd;
  let signalAddStarted;
  const addStarted = new Promise(resolve => { signalAddStarted = resolve; });
  const addGate = new Promise(resolve => { releaseAdd = resolve; });
  global.getApp = () => appState;
  global.wx = {
    getStorageSync: key => store.get(key),
    setStorageSync: (key, value) => store.set(key, value),
    removeStorageSync: key => {
      if (failRemoveOnce && !removeFailed) { removeFailed = true; throw new Error('simulated storage cleanup failure'); }
      store.delete(key);
    },
    cloud: {
      callFunction: async ({ data }) => {
        if (data.action === 'load') return { result: { owner: 'owner-a', state: structuredClone(remote) } };
        if (data.action === 'addVisit') {
          const visit = data.visit;
          if (!failed && delayFirstAdd) {
            failed = true;
            signalAddStarted();
            await addGate;
          }
          if (!remote.visits.some(item => item.id === visit.id)) remote.visits.push(visit);
          if (!failed && failFirst) {
            failed = true;
            if (!commitBeforeFailure) remote.visits.pop();
            throw new Error('simulated lost response');
          }
          return { result: { owner: 'owner-a', state: structuredClone(remote), committed: true } };
        }
        throw new Error('unexpected cloud action: ' + data.action);
      }
    }
  };
  return { remote, store, appState, addStarted, releaseAdd };
}

test('backup rejects missing core settings instead of defaulting them', () => {
  assert.throws(() => tracker.normalizeBackup({ settings: {}, visits: [] }), /缺少年卡设置/);
  assert.equal(tracker.normalizeBackup({ ...tracker.DEFAULT_STATE }).settings.duration, 14);
});

for (const commitBeforeFailure of [false, true]) {
  test(`uncertain check-in retries the same id without duplicate visits (commit=${commitBeforeFailure})`, async () => {
    const { remote } = installCloudMock({ commitBeforeFailure });
    const cloudData = require('../miniprogram/services/cloud-data');
    cloudData.beginSession();
    await cloudData.load();
    const visit = { id: 'stable-operation-id', date: '2026-11-03', createdAt: '2026-11-03T09:00:00.000Z' };
    await assert.rejects(cloudData.addVisit(visit), /结果暂未确认/);
    const reconciled = await cloudData.load();
    assert.equal(reconciled.visits.filter(item => item.id === visit.id).length, 1);
    assert.equal(remote.visits.length, 1);
  });
}

test('separate same-day check-ins remain separate visits after successful saves', async () => {
  const { remote } = installCloudMock({ commitBeforeFailure: false, failFirst: false });
  const cloudData = require('../miniprogram/services/cloud-data');
  cloudData.beginSession();
  await cloudData.load();
  const first = { id: 'same-day-1', date: '2026-11-03', createdAt: '2026-11-03T09:00:00.000Z' };
  const second = { id: 'same-day-2', date: '2026-11-03', createdAt: '2026-11-03T18:00:00.000Z' };
  await cloudData.addVisit(first);
  await cloudData.addVisit(second);
  assert.equal(remote.visits.filter(item => item.date === first.date).length, 2);
});

test('a second date cannot overwrite a pending in-flight check-in', async () => {
  const { remote, addStarted, releaseAdd } = installCloudMock({ commitBeforeFailure: false, failFirst: false, delayFirstAdd: true });
  const cloudData = require('../miniprogram/services/cloud-data');
  cloudData.beginSession();
  await cloudData.load();
  const first = { id: 'pending-date-a', date: '2026-11-03', createdAt: '2026-11-03T09:00:00.000Z' };
  const second = { id: 'pending-date-b', date: '2026-11-04', createdAt: '2026-11-04T09:00:00.000Z' };
  const firstRequest = cloudData.addVisit(first);
  await addStarted;
  await assert.rejects(cloudData.addVisit(second), /正在同步/);
  releaseAdd();
  const state = await firstRequest;
  global.getApp().globalData.state = state;
  assert.deepEqual(remote.visits.map(item => item.id), [first.id]);
  assert.equal(state.visits.some(item => item.id === second.id), false);
});

test('a failed local pending cleanup does not suppress the next intentional same-day visit', async () => {
  const { remote } = installCloudMock({ commitBeforeFailure: false, failFirst: false, failRemoveOnce: true });
  const cloudData = require('../miniprogram/services/cloud-data');
  cloudData.beginSession();
  await cloudData.load();
  const first = { id: 'cleanup-day-1', date: '2026-11-03', createdAt: '2026-11-03T09:00:00.000Z' };
  const second = { id: 'cleanup-day-2', date: '2026-11-03', createdAt: '2026-11-03T18:00:00.000Z' };
  const firstState = await cloudData.addVisit(first);
  global.getApp().globalData.state = firstState;
  const secondState = await cloudData.addVisit(second);
  assert.equal(remote.visits.length, 2);
  assert.equal(secondState.visits.length, 2);
});
