const tracker = require('../utils/tracker');
const CACHE_PREFIX = 'tracker-cache-v1:';
const LAST_OWNER_KEY = 'tracker-cache-last-owner-v1';
const PENDING_ADD_PREFIX = 'tracker-pending-add-v1:';
let currentOwner = null;
let online = false;
let activeRequests = 0;
let session = 0;

function cachedState() {
  if (!currentOwner) return null;
  try {
    const value = wx.getStorageSync(CACHE_PREFIX + currentOwner);
    return value ? tracker.normalizeBackup(value) : null;
  } catch (error) { return null; }
}

function lastCachedState() {
  try {
    const owner = wx.getStorageSync(LAST_OWNER_KEY);
    if (typeof owner !== 'string' || !owner) return null;
    const value = wx.getStorageSync(CACHE_PREFIX + owner);
    return value ? tracker.normalizeBackup(value) : null;
  } catch (error) { return null; }
}

function pendingAddKey(owner) { return PENDING_ADD_PREFIX + owner; }

function clearPendingAdd(owner, id) {
  try {
    const key = pendingAddKey(owner);
    const pending = wx.getStorageSync(key);
    if (pending && pending.id === id) wx.removeStorageSync(key);
    return true;
  } catch (error) { return false; }
}

async function request(action, payload) {
  if (!getApp().globalData.cloudReady) throw new Error('请先在 app.js 中配置云环境 ID');
  if (action !== 'load' && !online) throw new Error('当前为离线只读模式，请联网后重试');
  if (action !== 'load' && activeRequests) throw new Error('正在同步，请稍候');
  const requestSession = session;
  activeRequests++;
  let responseReceived = false;
  try {
    const response = await wx.cloud.callFunction({ name: 'tracker', data: Object.assign({ action }, payload || {}) });
    responseReceived = true;
    if (session !== requestSession) throw new Error('会话已变更，请重新同步');
    const result = response.result;
    if (!result || typeof result.owner !== 'string' || !result.owner) {
      if (action === 'load') throw new Error('云端返回数据无效');
      const uncertainError = new Error('操作结果暂未确认，正在重新同步，请勿重复操作');
      uncertainError.uncertain = true;
      throw uncertainError;
    }
    let state;
    try {
      if (currentOwner && currentOwner !== result.owner) throw new Error('云端账号已变更，请重新同步');
      if (!result.state) throw new Error('云端返回数据无效');
      state = tracker.normalizeBackup(result.state);
    } catch (error) {
      if (!result.committed || action === 'load') throw error;
      const committedError = new Error('操作已保存，正在重新同步，请勿重复操作');
      committedError.committed = true;
      throw committedError;
    }
    currentOwner = result.owner;
    online = true;
    try {
      wx.setStorageSync(CACHE_PREFIX + currentOwner, state);
      wx.setStorageSync(LAST_OWNER_KEY, currentOwner);
    } catch (error) { /* Cloud state is still authoritative. */ }
    return state;
  } catch (error) {
    if (session === requestSession) {
      online = false;
      if (action !== 'load' && !responseReceived) {
        const uncertainError = new Error('操作结果暂未确认，正在重新同步，请勿重复操作');
        uncertainError.uncertain = true;
        throw uncertainError;
      }
    }
    throw error;
  } finally { activeRequests--; }
}

module.exports = {
  load: async () => {
    let state = await request('load');
    const owner = currentOwner;
    let pending;
    try { pending = wx.getStorageSync(pendingAddKey(owner)); } catch (error) { pending = null; }
    if (!pending || typeof pending.id !== 'string') return state;
    if (state.visits.some(visit => visit.id === pending.id)) {
      clearPendingAdd(owner, pending.id);
      return state;
    }
    // The earlier request may still be finishing after a timeout. Re-submit
    // the same id; the cloud mutation treats matching ids idempotently.
    state = await request('addVisit', { visit: pending });
    clearPendingAdd(owner, pending.id);
    return state;
  },
  saveSettings: settings => request('saveSettings', { settings }),
  addVisit: async visit => {
    if (!currentOwner || !online) throw new Error('请先同步并确认当前微信账号');
    if (activeRequests) throw new Error('正在同步，请稍候');
    const key = pendingAddKey(currentOwner);
    let operation = visit;
    try {
      let pending = wx.getStorageSync(key);
      const current = getApp().globalData.state;
      if (pending && current && current.visits.some(item => item.id === pending.id)) {
        clearPendingAdd(currentOwner, pending.id);
        pending = null;
      }
      if (pending) {
        if (pending.date !== visit.date) throw new Error('上一次打卡结果尚未确认，请先同步后再操作');
        operation = pending;
      }
      wx.setStorageSync(key, operation);
    } catch (error) {
      if (error.message === '上一次打卡结果尚未确认，请先同步后再操作') throw error;
      throw new Error('无法在本机暂存打卡请求，请检查设备存储空间后重试');
    }
    const state = await request('addVisit', { visit: operation });
    clearPendingAdd(currentOwner, operation.id);
    return state;
  },
  updateVisit: (id, date) => request('updateVisit', { id, date }),
  deleteVisit: id => request('deleteVisit', { id }),
  replaceAll: state => request('replaceAll', { state }),
  cachedState,
  lastCachedState,
  beginSession: () => { session++; currentOwner = null; online = false; },
  isOnline: () => online
};
