const STORAGE_KEY = "swim-card-tracker-v1";
const defaults = {
  settings: { price: 2622, startMonth: "2026-11", duration: 14, monthlyTarget: 12, feeA: 32, feeB: 29, monthTargets: {} },
  visits: []
};

let state = loadState();
let toastTimer;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || !Array.isArray(parsed.visits) || !parsed.settings) return structuredClone(defaults);
    return {
      settings: { ...defaults.settings, ...parsed.settings, monthTargets: parsed.settings.monthTargets || {} },
      visits: parsed.visits.filter(item => item && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)).map(item => ({ id: String(item.id || makeId()), date: item.date, createdAt: item.createdAt || `${item.date}T12:00:00` }))
    };
  } catch { return structuredClone(defaults); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function localDateString(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function monthKey(date) { return date.slice(0, 7); }
function monthDate(key) { const [year, month] = key.split("-").map(Number); return new Date(year, month - 1, 1); }
function addMonths(key, count) { const date = monthDate(key); date.setMonth(date.getMonth() + count); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(key, format = "long") {
  const [year, month] = key.split("-");
  return format === "short" ? `${year}.${month}` : `${year}年${Number(month)}月`;
}
function prettyDate(date) { const [y, m, d] = date.split("-"); return `${Number(m)}月${Number(d)}日`; }
function countForMonth(key) { return state.visits.filter(item => monthKey(item.date) === key).length; }
function monthKeys() { return Array.from({ length: Math.max(1, Number(state.settings.duration) || 14) }, (_, i) => addMonths(state.settings.startMonth, i)); }
function targetForMonth(key) { const value = state.settings.monthTargets[key]; return Number.isFinite(Number(value)) ? Number(value) : Number(state.settings.monthlyTarget) || 0; }
function safeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function ceilThreshold(price, fee) { return fee > 0 ? Math.ceil(price / fee) : 0; }

function render() {
  const visits = [...state.visits].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const total = visits.length;
  const todayMonth = monthKey(localDateString());
  const keys = monthKeys();
  const activeMonth = keys.includes(todayMonth) ? todayMonth : keys[0];
  const monthTotal = countForMonth(activeMonth);
  const target = targetForMonth(activeMonth);
  const price = Math.max(0, safeNumber(state.settings.price));
  const feeA = Math.max(0, safeNumber(state.settings.feeA));
  const feeB = Math.max(0, safeNumber(state.settings.feeB));
  const thresholdA = ceilThreshold(price, feeA);
  const thresholdB = ceilThreshold(price, feeB);
  const endMonth = addMonths(state.settings.startMonth, Math.max(1, Number(state.settings.duration)) - 1);

  document.getElementById("card-period").textContent = `${state.settings.duration} 个月年卡 · ${monthLabel(state.settings.startMonth, "short")}—${monthLabel(endMonth, "short")}`;
  document.getElementById("total-visits").textContent = total;
  document.getElementById("average-cost").textContent = `平均每次 ¥${total ? (price / total).toFixed(2) : "0.00"}`;
  document.getElementById("month-visits").textContent = monthTotal;
  document.getElementById("month-target-foot").textContent = `目标 ${target} 次`;
  document.getElementById("current-month-label").textContent = monthLabel(activeMonth);
  document.getElementById("month-progress-main").innerHTML = `${monthTotal} <span>/ ${target} 次</span>`;
  document.getElementById("month-left").textContent = target === 0 ? "本月暂不设目标" : monthTotal >= target ? "本月目标已达成，继续保持" : `还差 ${target - monthTotal} 次达标`;
  const monthPercent = target === 0 ? 0 : Math.min(100, Math.round(monthTotal / target * 100));
  document.getElementById("month-percent").textContent = `${monthPercent}%`;
  document.getElementById("month-progress-bar").style.width = `${monthPercent}%`;
  document.getElementById("month-plan-note").textContent = target > 0 && monthTotal >= target ? "目标完成啦，之后每一次都是额外收获。" : "按自己的节奏来，完成目标就很棒。";
  document.getElementById("price-inline").textContent = price.toLocaleString("zh-CN");
  document.getElementById("threshold-count-32").textContent = `${thresholdA} 次`;
  document.getElementById("threshold-count-29").textContent = `${thresholdB} 次`;
  const pctA = thresholdA ? Math.min(100, Math.round(total / thresholdA * 100)) : 100;
  const pctB = thresholdB ? Math.min(100, Math.round(total / thresholdB * 100)) : 100;
  document.getElementById("threshold-bar-32").style.width = `${pctA}%`;
  document.getElementById("threshold-bar-29").style.width = `${pctB}%`;
  document.getElementById("threshold-caption-32").textContent = total >= thresholdA ? "已达到这条回本线" : `还差 ${thresholdA - total} 次`;
  document.getElementById("threshold-caption-29").textContent = total >= thresholdB ? "已达到这条回本线" : `还差 ${thresholdB - total} 次`;
  const status = document.getElementById("value-status");
  status.textContent = total >= thresholdB ? `超过 ¥${feeB}/次回本线` : total >= thresholdA ? `达到 ¥${feeA}/次回本线` : "正在积累";
  renderMonths(keys, activeMonth);
  renderVisits(visits);
}

function renderMonths(keys, activeMonth) {
  const host = document.getElementById("month-list");
  host.innerHTML = keys.map((key, index) => {
    const actual = countForMonth(key);
    const target = targetForMonth(key);
    const progress = target ? Math.min(100, Math.round(actual / target * 100)) : 0;
    const isCurrent = key === activeMonth;
    const status = target === 0 ? "休整月" : actual >= target ? "已达标" : actual ? "进行中" : "待打卡";
    const statusClass = target === 0 ? "break" : actual >= target && target > 0 ? "done" : "";
    return `<article class="month-row ${isCurrent ? "current" : ""}" id="month-${key}">
      <div class="month-name">${monthLabel(key)}${isCurrent ? '<span class="month-sub">当前月份</span>' : `<span class="month-sub">第 ${index + 1} 个月</span>`}</div>
      <div class="month-count"><strong>${actual}</strong> 次 <span class="goal-caption">/ 目标</span> <input class="goal-input" aria-label="${monthLabel(key)}月目标次数" type="number" min="0" max="99" value="${target}" data-target-month="${key}"></div>
      <span class="row-status ${statusClass}">${status}</span>
      <div class="mini-track" aria-label="目标进度 ${progress}%"><span style="width:${progress}%"></span></div>
    </article>`;
  }).join("");
  host.querySelectorAll("[data-target-month]").forEach(input => input.addEventListener("change", event => {
    const key = event.currentTarget.dataset.targetMonth;
    state.settings.monthTargets[key] = Math.max(0, safeNumber(event.currentTarget.value));
    saveState();
    showToast(`${monthLabel(key)}目标已更新`);
  }));
}

function renderVisits(visits) {
  const host = document.getElementById("record-list");
  const empty = document.getElementById("empty-state");
  empty.hidden = visits.length > 0;
  host.innerHTML = visits.map(item => {
    const sameDayCount = state.visits.filter(visit => visit.date === item.date).length;
    return `<article class="record-item" data-record-id="${escapeAttr(item.id)}">
      <span class="record-date-icon" aria-hidden="true">✓</span>
      <div class="record-meta"><strong>${prettyDate(item.date)}到场</strong><span>${monthLabel(monthKey(item.date))}${sameDayCount > 1 ? ` · 当天第 ${sameDayIndex(item)} 次` : ""}</span></div>
      <span class="record-count-tag">+1 次</span>
      <div class="record-actions"><button type="button" class="edit-record" data-id="${escapeAttr(item.id)}">改日期</button><button type="button" class="delete-record" data-id="${escapeAttr(item.id)}">删除</button></div>
    </article>`;
  }).join("");
  host.querySelectorAll(".edit-record").forEach(button => button.addEventListener("click", () => editVisit(button.dataset.id)));
  host.querySelectorAll(".delete-record").forEach(button => button.addEventListener("click", () => deleteVisit(button.dataset.id)));
}

function sameDayIndex(item) {
  return state.visits.filter(visit => visit.date === item.date).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).findIndex(visit => visit.id === item.id) + 1;
}
function escapeAttr(value) { return String(value).replace(/[&"'<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[char]); }
function addVisit(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  state.visits.push({ id: makeId(), date, createdAt: new Date().toISOString() });
  saveState();
  showToast(`${prettyDate(date)}已记录，到场 +1`);
}
function editVisit(id) {
  const item = state.visits.find(visit => visit.id === id);
  if (!item) return;
  const next = window.prompt("修改到场日期（格式：YYYY-MM-DD）", item.date);
  if (next === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || Number.isNaN(new Date(`${next}T12:00:00`).getTime())) { showToast("日期格式不正确"); return; }
  item.date = next;
  saveState();
  showToast("记录日期已修改");
}
function deleteVisit(id) {
  const item = state.visits.find(visit => visit.id === id);
  if (!item || !window.confirm(`删除 ${prettyDate(item.date)} 的这次打卡？`)) return;
  state.visits = state.visits.filter(visit => visit.id !== id);
  saveState();
  showToast("已删除这条记录");
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

document.getElementById("checkin-today").addEventListener("click", () => addVisit(localDateString()));
document.getElementById("date-add-open").addEventListener("click", () => {
  const form = document.getElementById("date-entry");
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById("visit-date").value = localDateString();
});
document.getElementById("date-add-cancel").addEventListener("click", () => { document.getElementById("date-entry").hidden = true; });
document.getElementById("date-entry").addEventListener("submit", event => {
  event.preventDefault();
  addVisit(document.getElementById("visit-date").value);
  event.currentTarget.hidden = true;
});
document.getElementById("jump-current").addEventListener("click", () => {
  const key = monthKey(localDateString());
  document.getElementById(`month-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});

const settingsDialog = document.getElementById("settings-dialog");
document.getElementById("settings-open").addEventListener("click", () => {
  document.getElementById("setting-price").value = state.settings.price;
  document.getElementById("setting-start").value = state.settings.startMonth;
  document.getElementById("setting-duration").value = state.settings.duration;
  document.getElementById("setting-target").value = state.settings.monthlyTarget;
  document.getElementById("setting-fee-32").value = state.settings.feeA;
  document.getElementById("setting-fee-29").value = state.settings.feeB;
  settingsDialog.showModal();
});
document.getElementById("settings-form").addEventListener("submit", event => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const previousStart = state.settings.startMonth;
  const newStart = document.getElementById("setting-start").value;
  if (newStart !== previousStart && Object.keys(state.settings.monthTargets).length) {
    const shifted = {};
    Object.entries(state.settings.monthTargets).forEach(([key, value]) => {
      const index = monthKeys().indexOf(key);
      if (index >= 0) shifted[addMonths(newStart, index)] = value;
    });
    state.settings.monthTargets = shifted;
  }
  state.settings.price = safeNumber(document.getElementById("setting-price").value, defaults.settings.price);
  state.settings.startMonth = newStart;
  state.settings.duration = Math.max(1, safeNumber(document.getElementById("setting-duration").value, 14));
  state.settings.monthlyTarget = Math.max(0, safeNumber(document.getElementById("setting-target").value, 12));
  state.settings.feeA = Math.max(1, safeNumber(document.getElementById("setting-fee-32").value, 32));
  state.settings.feeB = Math.max(1, safeNumber(document.getElementById("setting-fee-29").value, 29));
  saveState();
  settingsDialog.close();
  showToast("年卡设置已保存");
});

document.getElementById("export-data").addEventListener("click", () => {
  const backup = { app: "年卡打卡", version: 1, exportedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `年卡打卡备份-${localDateString()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("备份文件已导出");
});
document.getElementById("import-open").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", async event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming.settings || !Array.isArray(incoming.visits)) throw new Error("文件格式不正确");
    if (!window.confirm(`将导入 ${incoming.visits.length} 条记录并替换本机现有数据，继续吗？建议先导出当前备份。`)) return;
    state = {
      settings: { ...defaults.settings, ...incoming.settings, monthTargets: incoming.settings.monthTargets || {} },
      visits: incoming.visits.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date)).map(item => ({ id: String(item.id || makeId()), date: item.date, createdAt: item.createdAt || `${item.date}T12:00:00` }))
    };
    saveState();
    showToast("备份已导入");
  } catch (error) { showToast(error.message || "无法读取备份文件"); }
  finally { event.currentTarget.value = ""; }
});

render();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
}
