const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const tracker = require('./tracker');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const settingKeys = ['price', 'startMonth', 'duration', 'monthlyTarget', 'feeA', 'feeB', 'monthTargets'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
const missing = error => error.errCode === -502005 || error.code === 'DATABASE_DOCUMENT_NOT_EXIST';

function cleanState(input) {
  if (!input || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings) || !Array.isArray(input.visits)) throw new Error('数据格式不正确');
  const settings = {};
  settingKeys.forEach(key => { if (Object.prototype.hasOwnProperty.call(input.settings, key)) settings[key] = input.settings[key]; });
  const visits = input.visits.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || typeof item.createdAt !== 'string' || !item.createdAt) throw new Error('打卡记录格式不正确');
    return { id: item.id, date: item.date, createdAt: item.createdAt };
  });
  return tracker.normalizeBackup({ settings, visits });
}

async function readDocument(ref) {
  try { return (await ref.get()).data; } catch (error) { if (missing(error)) return null; throw error; }
}
function visitId(owner, generation, id) { return digest(JSON.stringify([owner, generation, id])); }
function newGeneration() { return crypto.randomBytes(16).toString('hex'); }
async function readVisits(owner, generation) {
  const visits = [];
  for (let offset = 0;; offset += 100) {
    const result = await db.collection('visits').where({ owner, generation }).orderBy('_id', 'asc').skip(offset).limit(100).get();
    visits.push(...result.data.map(item => item.visit));
    if (result.data.length < 100) return visits;
  }
}
async function clearGeneration(owner, generation) {
  // Cleanup is best-effort; a generation is invisible as soon as its pointer changes.
  for (;;) {
    const result = await db.collection('visits').where({ owner, generation }).limit(100).get();
    if (!result.data.length) return;
    for (const item of result.data) await db.collection('visits').doc(item._id).remove();
  }
}

exports.main = async event => {
  const owner = cloud.getWXContext().OPENID;
  if (!owner) throw new Error('无法确认微信身份');
  const action = event && event.action;
  if (!['load', 'saveSettings', 'addVisit', 'updateVisit', 'deleteVisit', 'replaceAll'].includes(action)) throw new Error('未知操作');
  const settingsId = digest(owner);
  const settingsRef = db.collection('userSettings').doc(settingsId);
  const replacement = action === 'replaceAll' ? cleanState(event.state) : null;
  const settings = action === 'saveSettings' ? cleanState({ settings: event.settings, visits: [] }).settings : null;
  const added = action === 'addVisit' ? cleanState({ settings: tracker.DEFAULT_STATE.settings, visits: [event.visit] }).visits[0] : null;
  if ((action === 'updateVisit' || action === 'deleteVisit') && (typeof event.id !== 'string' || !event.id || event.id.length > 200)) throw new Error('打卡 ID 无效');
  if (action === 'updateVisit') tracker.makeVisit(event.date, event.id, '2000-01-01T12:00:00Z');

  // Initialize once, with conflict protection for simultaneous first requests.
  await db.runTransaction(async tx => {
    const ref = tx.collection('userSettings').doc(settingsId);
    const doc = await readDocument(ref);
    if (doc && doc.owner !== owner) throw new Error('数据身份不匹配');
    if (!doc) await ref.set({ data: { owner, settings: cleanState(tracker.DEFAULT_STATE).settings, generation: newGeneration(), revision: 0 } });
  });

  if (action === 'replaceAll') {
    const before = await readDocument(settingsRef);
    if (!before || before.owner !== owner) throw new Error('数据身份不匹配');
    const generation = newGeneration();
    try {
      for (const visit of replacement.visits) {
        await db.collection('visits').doc(visitId(owner, generation, visit.id)).set({ data: { owner, generation, visit } });
      }
      await db.runTransaction(async tx => {
        const ref = tx.collection('userSettings').doc(settingsId);
        const current = await readDocument(ref);
        if (!current || current.owner !== owner || current.revision !== before.revision || current.generation !== before.generation) throw new Error('云端数据已更新，请重新同步后导入');
        await ref.set({ data: { owner, settings: replacement.settings, generation, revision: current.revision + 1 } });
      });
    } catch (error) {
      // A failed response may follow a committed pointer switch. Keep staged
      // documents rather than risk deleting the now-active generation.
      throw error;
    }
    try { await clearGeneration(owner, before.generation); } catch (error) { console.error('old generation cleanup failed', error); }
  } else if (action !== 'load') {
    await db.runTransaction(async tx => {
      const ref = tx.collection('userSettings').doc(settingsId);
      const current = await readDocument(ref);
      if (!current || current.owner !== owner) throw new Error('数据身份不匹配');
      if (settings) current.settings = settings;
      if (added || action === 'updateVisit' || action === 'deleteVisit') {
        const id = added ? added.id : event.id;
        const visitRef = tx.collection('visits').doc(visitId(owner, current.generation, id));
        const existing = await readDocument(visitRef);
        if (added && existing && (existing.owner !== owner || existing.generation !== current.generation || !existing.visit || existing.visit.id !== added.id || existing.visit.date !== added.date || existing.visit.createdAt !== added.createdAt)) throw new Error('打卡 ID 已用于另一条记录');
        if (!added && (!existing || existing.owner !== owner || existing.generation !== current.generation)) throw new Error('打卡记录不存在');
        if (action === 'deleteVisit') await visitRef.remove();
        else if (!(added && existing)) {
          const visit = added || tracker.makeVisit(event.date, id, existing.visit.createdAt);
          await visitRef.set({ data: { owner, generation: current.generation, visit } });
        }
      }
      await ref.set({ data: { owner, settings: current.settings, generation: current.generation, revision: current.revision + 1 } });
    });
  }

  // A write is committed before this snapshot is read. Report that separately
  // so clients do not mistake a refresh failure for a failed mutation.
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await readDocument(settingsRef);
      if (!before || before.owner !== owner) throw new Error('数据身份不匹配');
      const visits = await readVisits(owner, before.generation);
      const after = await readDocument(settingsRef);
      if (after && after.owner === owner && after.revision === before.revision && after.generation === before.generation) {
        return { owner, state: cleanState({ settings: before.settings, visits }), committed: action !== 'load' };
      }
    }
    throw new Error('云端数据正在更新，请重试');
  } catch (error) {
    if (action === 'load') throw error;
    console.error('mutation committed but refresh failed', error);
    return { owner, committed: true, refreshFailed: true };
  }
};
