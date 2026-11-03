const tracker = require('../../utils/tracker');
const cloudData = require('../../services/cloud-data');

function todayString() {
  const date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

Page({
  data: { summary: null, today: '', entryOpen: false, entryDate: '', settingsOpen: false, draft: {}, unverifiedOffline: false, cloudStatus: '正在连接云端…' },

  onLoad() {
    this.session = 0;
  },

  async onShow() {
    const session = ++this.session;
    cloudData.beginSession();
    this.state = null;
    this.setData({ summary: null, entryOpen: false, settingsOpen: false, unverifiedOffline: false, cloudStatus: '正在连接云端…' });
    try {
      const state = await cloudData.load();
      if (session !== this.session) return;
      this.commitState(state);
      this.setData({ cloudStatus: '' });
    } catch (error) {
      if (session !== this.session) return;
      this.setData({ cloudStatus: getApp().globalData.cloudReady ? '云端连接失败，无法确认当前账号' : '请在 app.js 配置云环境 ID，并部署 tracker 云函数' });
      this.showError(error);
      if (cloudData.lastCachedState()) {
        wx.showModal({
          title: '查看离线缓存？',
          content: '无法验证当前微信账号。缓存可能属于之前使用过的微信账号；继续将以只读方式显示该缓存。',
          confirmText: '查看缓存',
          cancelText: '取消',
          success: result => {
            if (!result.confirm || session !== this.session) return;
            const cached = cloudData.lastCachedState();
            if (!cached) return;
            this.commitState(cached);
            this.setData({ unverifiedOffline: true, cloudStatus: '离线只读 · 账号未验证，显示的是本机缓存' });
          }
        });
      }
    }
  },

  onHide() {
    this.session++;
    cloudData.beginSession();
    this.state = null;
    getApp().globalData.state = null;
    this.setData({ summary: null, entryOpen: false, settingsOpen: false, unverifiedOffline: false });
  },

  refreshState(nextState) {
    this.state = nextState;
    this.setData({ today: todayString(), summary: tracker.summarize(nextState, todayString()) });
  },

  commitState(nextState) {
    getApp().globalData.state = nextState;
    this.refreshState(nextState);
  },

  async showError(error) {
    if (error.committed || error.uncertain) {
      const session = this.session;
      this.setData({ cloudStatus: error.committed ? '操作已保存，正在重新同步…' : '操作结果暂未确认，正在重新同步…' });
      wx.showToast({ title: error.message, icon: 'none', duration: 3000 });
      try {
        const state = await cloudData.load();
        if (session !== this.session) return;
        this.commitState(state);
        this.setData({ cloudStatus: '', entryOpen: false, settingsOpen: false });
      } catch (refreshError) {
        if (session !== this.session) return;
        this.setData({ cloudStatus: error.committed ? '操作已保存，同步失败 · 请重新进入页面同步后再操作' : '操作结果未确认 · 请重新进入页面同步后再操作' });
      }
      return;
    }
    if (this.state && !this.data.unverifiedOffline && getApp().globalData.cloudReady && !cloudData.isOnline()) {
      this.setData({ cloudStatus: cloudData.cachedState() ? '离线只读 · 显示上次同步的数据' : '云端连接失败 · 暂无可用缓存' });
    }
    wx.showToast({ title: error.message || '操作未完成', icon: 'none' });
  },

  async addVisit(date) {
    const session = this.session;
    try {
      const visit = tracker.makeVisit(date, null, new Date().toISOString());
      const state = await cloudData.addVisit(visit);
      if (session !== this.session) return;
      this.commitState(state);
      this.setData({ entryOpen: false });
    } catch (error) { if (session === this.session) this.showError(error); }
  },

  checkInToday() { this.addVisit(todayString()); },
  openDateEntry() { this.setData({ entryOpen: true, entryDate: todayString() }); },
  cancelDateEntry() { this.setData({ entryOpen: false }); },
  chooseEntryDate(event) { this.setData({ entryDate: event.detail.value }); },
  submitDateEntry() { this.addVisit(this.data.entryDate); },

  editVisit(event) {
    const session = this.session;
    const id = event.currentTarget.dataset.id;
    const item = this.state.visits.find(visit => visit.id === id);
    if (!item) return;
    wx.showModal({
      title: '修改到场日期', editable: true, content: item.date, placeholderText: 'YYYY-MM-DD',
      success: async result => {
        if (!result.confirm || session !== this.session) return;
        try {
          const edited = tracker.makeVisit((result.content || '').trim(), id, item.createdAt);
          const state = await cloudData.updateVisit(id, edited.date);
          if (session === this.session) this.commitState(state);
        } catch (error) { if (session === this.session) this.showError(error); }
      }
    });
  },

  deleteVisit(event) {
    const session = this.session;
    const id = event.currentTarget.dataset.id;
    const item = this.state.visits.find(visit => visit.id === id);
    if (!item) return;
    wx.showModal({
      title: '删除打卡', content: '删除 ' + item.date + ' 的这次打卡？', confirmText: '删除', confirmColor: '#b3493d',
      success: async result => {
        if (!result.confirm || session !== this.session) return;
        try {
          const state = await cloudData.deleteVisit(id);
          if (session === this.session) this.commitState(state);
        } catch (error) { if (session === this.session) this.showError(error); }
      }
    });
  },

  async changeMonthTarget(event) {
    const session = this.session;
    const key = event.currentTarget.dataset.month;
    const value = event.detail.value;
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      this.showError(new Error('月目标须为非负数字'));
      this.refreshState(this.state);
      return;
    }
    const settings = Object.assign({}, this.state.settings, { monthTargets: Object.assign({}, this.state.settings.monthTargets, { [key]: Number(value) }) });
    try {
      const state = await cloudData.saveSettings(settings);
      if (session === this.session) this.commitState(state);
    } catch (error) { if (session === this.session) { this.refreshState(this.state); this.showError(error); } }
  },

  jumpCurrent() {
    wx.pageScrollTo({ selector: '#month-' + this.data.summary.activeMonth, duration: 250 });
  },

  openSettings() {
    this.setData({ settingsOpen: true, draft: Object.assign({}, this.state.settings) });
  },
  closeSettings() { this.setData({ settingsOpen: false }); },
  stopPropagation() {},
  changeSetting(event) { this.setData({ ['draft.' + event.currentTarget.dataset.field]: event.detail.value }); },
  chooseStartMonth(event) { this.setData({ 'draft.startMonth': event.detail.value }); },

  async saveSettings() {
    const session = this.session;
    try {
      const draft = Object.assign({}, this.data.draft);
      if (Number(draft.feeA) < 1 || Number(draft.feeB) < 1) throw new Error('单次票价须至少为 1 元');
      if (draft.startMonth !== this.state.settings.startMonth) {
        const previousKeys = tracker.monthKeys(this.state.settings);
        const nextKeys = tracker.monthKeys(Object.assign({}, this.state.settings, { startMonth: draft.startMonth }));
        draft.monthTargets = {};
        Object.keys(this.state.settings.monthTargets).forEach(key => {
          const index = previousKeys.indexOf(key);
          if (index >= 0) draft.monthTargets[nextKeys[index]] = this.state.settings.monthTargets[key];
        });
      }
      const nextState = tracker.normalizeBackup({ settings: draft, visits: this.state.visits });
      const state = await cloudData.saveSettings(nextState.settings);
      if (session !== this.session) return;
      this.commitState(state);
      this.setData({ settingsOpen: false });
    } catch (error) { if (session === this.session) this.showError(error); }
  },

  exportBackup() {
    if (!this.state) return;
    const session = this.session;
    const backup = {
      app: '年卡打卡',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.state.settings,
      visits: this.state.visits
    };
    const filePath = wx.env.USER_DATA_PATH + '/年卡打卡备份-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json';
    const files = wx.getFileSystemManager();
    const cleanup = () => files.unlink({ filePath, fail: () => {} });
    files.writeFile({
      filePath,
      data: JSON.stringify(backup, null, 2),
      encoding: 'utf8',
      success: () => {
        if (session !== this.session) { cleanup(); return; }
        wx.shareFileMessage({
          filePath,
          success: () => { cleanup(); if (session === this.session) wx.showToast({ title: '备份已准备好', icon: 'success' }); },
          fail: error => { cleanup(); if (session !== this.session || (error.errMsg && error.errMsg.indexOf('cancel') >= 0)) return; this.showError(new Error('分享备份失败，请重试')); }
        });
      },
      fail: () => { if (session === this.session) this.showError(new Error('无法创建备份文件')); }
    });
  },

  importBackup() {
    if (!this.state || this.data.unverifiedOffline || !cloudData.isOnline()) {
      this.showError(new Error('请先联网并确认当前微信账号后再导入'));
      return;
    }
    const importSession = this.session;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: result => {
        if (importSession !== this.session) return;
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.path) { this.showError(new Error('没有选择有效的 JSON 文件')); return; }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: async read => {
            if (importSession !== this.session) return;
            let normalized;
            try { normalized = tracker.normalizeBackup(read.data); }
            catch (error) { this.showError(error); return; }
            wx.showModal({
              title: '确认替换云端数据？',
              content: '文件中有 ' + normalized.visits.length + ' 条打卡记录。确认后将替换当前已登录微信账号的全部云端年卡设置和打卡记录，此操作无法撤销。取消不会产生任何更改。',
              confirmText: '替换数据',
              confirmColor: '#b3493d',
              success: async confirmation => {
                if (importSession !== this.session) return;
                if (!confirmation.confirm) return;
                if (this.data.unverifiedOffline || !cloudData.isOnline()) {
                  this.showError(new Error('当前账号无法验证，请联网并重新同步后再导入'));
                  return;
                }
                if (importSession !== this.session) return;
                try {
                  const resolved = await cloudData.replaceAll(normalized);
                  if (importSession !== this.session) return;
                  this.commitState(resolved);
                  wx.showToast({ title: '云端数据已替换', icon: 'success' });
                } catch (error) { if (importSession === this.session) this.showError(error); }
              }
            });
          },
          fail: () => { if (importSession === this.session) this.showError(new Error('无法读取所选文件')); }
        });
      },
      fail: error => { if (importSession === this.session && (!error.errMsg || error.errMsg.indexOf('cancel') < 0)) this.showError(new Error('选择文件失败')); }
    });
  }
});
