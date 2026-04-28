// pages/connect/index.ts
//
// 注意：避免使用 TS-only 语法（type 别名 / interface / 参数类型注解 / 泛型 / as），
// 以兼容某些 IDE 真机调试时 Babel 没启用 TS preset 的解析路径。
// @ts-nocheck

import { getBleManager } from "../../utils/bleManager";

const bm = getBleManager();

Page({
  data: {
    // 连接状态: 'disconnected' | 'scanning' | 'connecting' | 'connected'
    connectionStatus: "disconnected",
    statusTitle: "未连接",
    statusSubtitle: "未连接任何设备",
    bleList: [],
    isRefreshing: false,
    connectedDevice: null,
  },

  _offConnected: null,
  _offDisconnected: null,
  _offReconnecting: null,

  onLoad: function () {
    this.bindManagerEvents();
    this.refreshFromManager();
  },

  onShow: function () {
    this.refreshFromManager();
  },

  onHide: function () {
    if (this.data.connectionStatus === "scanning") {
      this.stopScan();
    }
  },

  onUnload: function () {
    if (this.data.connectionStatus === "scanning") {
      this.stopScan();
    }
    if (this._offConnected) this._offConnected();
    if (this._offDisconnected) this._offDisconnected();
    if (this._offReconnecting) this._offReconnecting();
  },

  // 订阅全局蓝牙管理器事件
  bindManagerEvents: function () {
    const self = this;
    this._offConnected = bm.on("connected", function (device) {
      self.setData({
        connectionStatus: "connected",
        statusTitle: "已连接",
        statusSubtitle:
          (device.name || device.deviceName || "设备") +
          " [" +
          device.deviceId +
          "]",
        connectedDevice: device,
      });
      wx.hideLoading();
      wx.showToast({ title: "连接成功", icon: "success" });
    });

    this._offDisconnected = bm.on("disconnected", function (info) {
      self.setData({
        connectionStatus: "disconnected",
        statusTitle: "未连接",
        statusSubtitle:
          info && info.reason === "manual" ? "已断开设备连接" : "设备已断开",
        connectedDevice: null,
      });
      wx.hideLoading();
      if (info && info.reason === "ble_lost") {
        wx.showToast({ title: "设备已断开", icon: "none" });
      }
    });

    this._offReconnecting = bm.on("reconnecting", function (info) {
      self.setData({
        connectionStatus: "connecting",
        statusTitle: "重连中",
        statusSubtitle:
          info && info.attempt
            ? "第 " + info.attempt + " 次尝试…"
            : "正在尝试自动重连…",
      });
    });
  },

  // 根据 bleManager 当前状态刷新 UI
  refreshFromManager: function () {
    if (bm.isConnected()) {
      const device = bm.getCurrentDevice() || wx.getStorageSync("bleInfo");
      this.setData({
        connectionStatus: "connected",
        statusTitle: "已连接",
        statusSubtitle:
          ((device && (device.name || device.deviceName)) || "设备") +
          " [" +
          (device && device.deviceId) +
          "]",
        connectedDevice: device,
      });
      return;
    }
    // 未连接时如果本地有上次连接信息，bleManager 已自动触发 reconnect。
    const bleInfo = wx.getStorageSync("bleInfo");
    if (bleInfo && bleInfo.deviceId) {
      this.setData({
        connectionStatus: "connecting",
        statusTitle: "重连中",
        statusSubtitle: "正在尝试自动重连…",
      });
    } else {
      this.setData({
        connectionStatus: "disconnected",
        statusTitle: "未连接",
        statusSubtitle: "未连接任何设备",
        connectedDevice: null,
      });
    }
  },

  // 蓝牙错误友好提示
  getBleErrorMessage: function (err) {
    const errCode = err && (err.errCode || err.code);
    const errMsg = (err && err.errMsg) || "";

    switch (errCode) {
      case 10000:
        return "蓝牙未初始化，请尝试重启小程序";
      case 10001:
        return "手机蓝牙未开启，请在系统设置中打开蓝牙后再试";
      case 10002:
        return "未找到蓝牙设备，请确保设备在附近且电量充足";
      case 10003:
        return "连接失败，请尝试重启设备蓝牙或靠近设备";
      case 10004:
        return "设备服务发现失败，请尝试重新连接";
      case 10006:
        return "当前蓝牙已断开，请检查设备是否在范围内";
      case 10009:
        return "手机系统版本过低，不支持蓝牙低功耗功能";
      case 10012:
        return "连接超时，请确保设备未被其他手机连接";
      case 10013:
        return "无效的设备 ID，请尝试重新扫描";
      case "AUTH_TIMEOUT":
        return "设备密钥校验超时，请确保设备未被锁定后重试";
      default:
        if (errMsg.indexOf("location") !== -1) {
          return "请开启手机定位服务（GPS），并授予微信定位权限";
        }
        if (
          errMsg.indexOf("auth") !== -1 ||
          errMsg.indexOf("authorize") !== -1
        ) {
          return "请在手机设置中授予微信蓝牙权限";
        }
        return "操作失败(" + (errCode || "未知错误") + ")，请检查设备状态并重试";
    }
  },

  showErrorTip: function (err) {
    const message = this.getBleErrorMessage(err);
    wx.showModal({
      title: "提示",
      content: message,
      showCancel: false,
      confirmText: "我知道了",
      confirmColor: "#4DB6AC",
    });
  },

  // 开始扫描
  startScan: function () {
    const self = this;
    this.setData({
      connectionStatus: "scanning",
      statusTitle: "正在扫描",
      statusSubtitle: "正在搜索周围的蓝牙设备…",
      bleList: [],
    });

    bm.startScan(function (devices, err) {
      if (err) {
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "扫描失败",
          statusSubtitle: self.getBleErrorMessage(err),
        });
        self.showErrorTip(err);
        return;
      }
      self.setData({ bleList: devices });
    });
  },

  // 停止扫描
  stopScan: function () {
    const self = this;
    bm.stopScan(function () {
      if (self.data.connectionStatus === "scanning") {
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "未连接",
          statusSubtitle: "未连接任何设备",
        });
      }
    });
  },

  // 下拉刷新：重启扫描
  onRefresh: function () {
    const self = this;
    this.setData({ isRefreshing: true });
    bm.stopScan(function () {
      self.setData({ bleList: [] });
      self.startScan();
      setTimeout(function () {
        self.setData({ isRefreshing: false });
      }, 1000);
    });
  },

  // 点击设备进行连接
  onDeviceClick: function (e) {
    const self = this;
    const deviceId = e.currentTarget.dataset.deviceid;
    let device = this.data.bleList.find(function (d) {
      return d.deviceId === deviceId;
    });

    if (!device) {
      const bleInfo = wx.getStorageSync("bleInfo");
      if (bleInfo && bleInfo.deviceId === deviceId) device = bleInfo;
    }
    if (!device) {
      wx.showToast({ title: "设备信息丢失，请重新扫描", icon: "none" });
      return;
    }

    bm.stopScan();

    wx.showLoading({ title: "连接中...", mask: true });
    this.setData({
      connectionStatus: "connecting",
      statusTitle: "连接中",
      statusSubtitle:
        "正在连接 " + (device.name || device.deviceName || "设备") + "…",
    });

    bm.connect(device, function (ok, err) {
      // connect 成功的 UI 更新由 connected 事件统一处理
      if (!ok) {
        wx.hideLoading();
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "连接失败",
          statusSubtitle: self.getBleErrorMessage(err || {}),
        });
        self.showErrorTip(err || { errMsg: "连接失败" });
      }
    });
  },

  // 主动断开
  disconnect: function () {
    const self = this;
    wx.showModal({
      title: "提示",
      content: "确定要断开设备连接吗？",
      success: function (res) {
        if (res.confirm) {
          bm.disconnect();
          self.setData({ bleList: [] });
          wx.showToast({ title: "已断开连接", icon: "success" });
        }
      },
    });
  },
});
