const tracker = require('./utils/tracker');

// Set this to the cloud environment ID from the WeChat Cloud Development console.
const CLOUD_ENV_ID = '';

App({
  globalData: {
    state: tracker.normalizeBackup(tracker.DEFAULT_STATE),
    cloudReady: false
  },
  onLaunch() {
    if (!CLOUD_ENV_ID || !wx.cloud) return;
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    this.globalData.cloudReady = true;
  }
});
