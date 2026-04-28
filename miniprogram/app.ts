// app.ts
// 注意：避免使用 TS-only 语法（参数类型注解 / 泛型 / as），
// 以兼容某些 IDE 在根目录 app.ts 上未启用 TS preset 时的 Babel 解析。
// @ts-nocheck

import { veepooJLBle } from "./jieli_sdk/bleInit";
import { getBleManager } from "./utils/bleManager";
import { syncDeviceStateAfterConnect } from "./utils/reminderQueue";

const vpJLBle = new veepooJLBle();

// 全局注入分享逻辑（保留原有行为）
const originalPage = Page;
Page = function (options) {
  const originalOnShareAppMessage = options.onShareAppMessage;
  options.onShareAppMessage = function (res) {
    if (originalOnShareAppMessage) {
      return originalOnShareAppMessage.call(this, res);
    }
    return {
      title: "蓝牙手环",
      imageUrl: "/image/share.jpg",
      path: this.route ? "/" + this.route : "/pages/connect/index",
    };
  };

  const originalOnShareTimeline = options.onShareTimeline;
  options.onShareTimeline = function () {
    if (originalOnShareTimeline) {
      return originalOnShareTimeline.call(this);
    }
    return {
      title: "蓝牙手环",
      query: "",
      imageUrl: "/image/share.jpg",
    };
  };

  return originalPage(options);
};

App({
  globalData: {},
  onLaunch: function () {
    // 修复 SDK 内部 uint8ArrayToString 处理 UTF-8 截断序列时抛 URIError
    const originalDecode = decodeURIComponent;
    globalThis.decodeURIComponent = function (s) {
      try {
        return originalDecode(s);
      } catch (e) {
        return s;
      }
    };

    // 启动时连接状态默认置为未连接，待 bleManager 触发 connected 事件再置 true
    wx.setStorageSync("connectionStatus", false);

    // 杰里 SDK 蓝牙初始化（保留原逻辑，蓝牙底层依赖）
    vpJLBle.init();

    // 全局蓝牙管理器（单例）
    const bleManager = getBleManager();
    this.globalData.bleManager = bleManager;

    // 连接成功后自动同步设备状态（常灭屏 + 提醒开关）
    bleManager.on("connected", function () {
      console.log("[app] 设备已连接，同步状态…");
      syncDeviceStateAfterConnect();
    });

    // 启动时尝试一次自动重连（如果本地有上次连接的设备）
    bleManager.autoReconnectOnLaunch();
  },
});
