const DEFAULT_STATE = {
  settings: { price: 2622, startMonth: '2026-11', duration: 14, monthlyTarget: 12, feeA: 32, feeB: 29, monthTargets: {} },
  visits: []
};

function validMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) return false;
  const parts = value.split('-').map(Number);
  const leap = parts[0] % 4 === 0 && (parts[0] % 100 !== 0 || parts[0] % 400 === 0);
  return parts[2] >= 1 && parts[2] <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][parts[1] - 1];
}

function addMonths(key, count) {
  const parts = key.split('-').map(Number);
  const index = parts[0] * 12 + parts[1] - 1 + count;
  return String(Math.floor(index / 12)).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
}

function monthKeys(settings) {
  return Array.from({ length: Math.max(1, Number(settings.duration) || 14) }, (_, index) => addMonths(settings.startMonth, index));
}

function targetForMonth(settings, key) {
  const value = (settings.monthTargets || {})[key];
  return Number.isFinite(Number(value)) ? Number(value) : Number(settings.monthlyTarget) || 0;
}

function monthLabel(key) { return key.slice(0, 4) + '年' + Number(key.slice(5)) + '月'; }
function numeric(value) { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
function progress(actual, target) { return target ? Math.min(100, Math.round(actual / target * 100)) : 0; }

function summarize(state, today) {
  const settings = state.settings;
  const keys = monthKeys(settings);
  const activeMonth = keys.indexOf(today.slice(0, 7)) >= 0 ? today.slice(0, 7) : keys[0];
  const total = state.visits.length;
  const price = numeric(settings.price);
  const months = keys.map((key, index) => {
    const actual = state.visits.filter(visit => visit.date.slice(0, 7) === key).length;
    const target = targetForMonth(settings, key);
    return { key, label: monthLabel(key), index: index + 1, actual, target, percent: progress(actual, target), current: key === activeMonth,
      status: target === 0 ? '休整月' : actual >= target ? '已达标' : actual ? '进行中' : '待打卡' };
  });
  const current = months.find(month => month.current);
  const thresholds = ['feeA', 'feeB'].map(key => {
    const fee = numeric(settings[key]);
    const count = fee > 0 ? Math.ceil(price / fee) : 0;
    return { key, fee, count, remaining: Math.max(0, count - total), percent: count ? progress(total, count) : 100,
      caption: total >= count ? '已达到这条回本线' : '还差 ' + (count - total) + ' 次' };
  });
  const ordered = state.visits.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const visits = ordered.map(visit => {
    const sameDay = state.visits.filter(item => item.date === visit.date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Object.assign({}, visit, { label: Number(visit.date.slice(5, 7)) + '月' + Number(visit.date.slice(8)) + '日到场',
      monthLabel: monthLabel(visit.date.slice(0, 7)), sameDayCount: sameDay.length, sameDayIndex: sameDay.findIndex(item => item.id === visit.id) + 1 });
  });
  return {
    total, price, averageCost: total ? (price / total).toFixed(2) : '0.00',
    period: settings.duration + ' 个月年卡 · ' + keys[0].replace('-', '.') + '—' + keys[keys.length - 1].replace('-', '.'),
    activeMonth, monthLabel: current.label, monthTotal: current.actual, monthTarget: current.target, monthPercent: current.percent,
    monthLeft: current.target === 0 ? '本月暂不设目标' : current.actual >= current.target ? '本月目标已达成，继续保持' : '还差 ' + (current.target - current.actual) + ' 次达标',
    monthNote: current.target > 0 && current.actual >= current.target ? '目标完成啦，之后每一次都是额外收获。' : '按自己的节奏来，完成目标就很棒。',
    valueStatus: total >= thresholds[1].count ? '超过 ¥' + thresholds[1].fee + '/次回本线' : total >= thresholds[0].count ? '达到 ¥' + thresholds[0].fee + '/次回本线' : '正在积累',
    thresholds, months, visits
  };
}

function makeVisit(date, id, createdAt) {
  if (!validDate(date)) throw new Error('日期无效，请使用 YYYY-MM-DD 格式的真实日期');
  const visitId = id == null || id === '' ? Date.now() + '-' + Math.random().toString(36).slice(2, 9) : String(id);
  const timestamp = createdAt == null || createdAt === '' ? date + 'T12:00:00' : createdAt;
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('打卡创建时间无效');
  return { id: visitId, date, createdAt: timestamp };
}

function normalizeBackup(input) {
  let data = input;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (error) { throw new Error('备份不是有效的 JSON 文件'); }
  }
  if (!data || typeof data !== 'object' || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) || !Array.isArray(data.visits)) throw new Error('备份必须包含 settings 和 visits');
  ['price', 'startMonth', 'duration', 'monthlyTarget', 'feeA', 'feeB'].forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(data.settings, key)) throw new Error('备份缺少年卡设置 ' + key);
  });
  const settings = Object.assign({}, data.settings);
  if (!validMonth(settings.startMonth)) throw new Error('年卡开始月份无效');
  ['price', 'duration', 'monthlyTarget', 'feeA', 'feeB'].forEach(key => {
    const value = settings[key];
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('年卡设置 ' + key + ' 必须为非负数字');
    settings[key] = Number(value);
  });
  if (!Number.isInteger(settings.duration) || settings.duration < 1 || settings.duration > 1200) throw new Error('年卡时长须为 1 至 1200 的整数');
  if (Number(settings.startMonth.slice(0, 4)) * 12 + Number(settings.startMonth.slice(5)) - 1 + settings.duration - 1 >= 10000 * 12) throw new Error('年卡结束月份超出有效范围');
  const targets = settings.monthTargets == null ? {} : settings.monthTargets;
  if (typeof targets !== 'object' || Array.isArray(targets)) throw new Error('每月目标格式不正确');
  settings.monthTargets = {};
  Object.keys(targets).forEach(key => {
    const value = targets[key];
    if (!validMonth(key) || (typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('每月目标必须包含有效月份和非负数字');
    settings.monthTargets[key] = Number(value);
  });
  const ids = new Set();
  const visits = data.visits.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('第 ' + (index + 1) + ' 条打卡格式不正确');
    const visit = makeVisit(item.date, item.id, item.createdAt);
    if (ids.has(visit.id)) throw new Error('备份包含重复的打卡 ID');
    ids.add(visit.id);
    return visit;
  });
  return { settings, visits };
}

module.exports = { DEFAULT_STATE, monthKeys, targetForMonth, summarize, makeVisit, normalizeBackup };
