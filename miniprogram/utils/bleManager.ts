// miniprogram/utils/bleManager.ts
//
// 全局蓝牙连接管理器（单例）：
//  1. 扫描 / 连接 / 断开 / 重连
//  2. 在密钥校验完成 (type === 1) 时才认为「已连接」
//  3. 监听 wx.onBLEConnectionStateChange，断开后按指数退避自动重连
//  4. 启动时若本地存在 bleInfo，则尝试静默重连一次
//  5. 简单事件总线：connected / disconnected / reconnecting / scanResult / reminderUpdate / screenKillUpdate / lightUpTimeUpdate
//
// 注意：避免使用 TS-only 语法（type 别名 / interface / 参数类型注解 / 泛型 / as），
// 以兼容某些 IDE 真机调试时 Babel 没启用 TS preset 的解析路径。
// @ts-nocheck

import { veepooBle, veepooFeature } from "../miniprogram_dist/index";

const RECONNECT_INTERVALS_MS = [1000, 2000, 4000];

class BleManager {
  constructor() {
    this.listeners = {};
    this.currentDevice = null;
    this.connecting = false;
    this.connected = false;
    this.authed = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.monitorRegistered = false;
    this.bleStateRegistered = false;
    this.appShowRegistered = false;

    this.registerMonitor();
    this.registerBleStateChange();
    this.registerAppLifecycle();
  }

  // ---------- 公有 API ----------

  isConnected() {
    return this.connected && this.authed;
  }

  getCurrentDevice() {
    return this.currentDevice;
  }

  autoReconnectOnLaunch() {
    const bleInfo = wx.getStorageSync("bleInfo");
    if (!bleInfo || !bleInfo.deviceId) return;

    console.log("[bleManager] 启动自动重连:", bleInfo.deviceId);
    const self = this;
    wx.getConnectedBluetoothDevices({
      services: ["FFFF", "FEE7", "0001", "180D"],
      success: function (res) {
        const found = res.devices.find(function (d) {
          return d.deviceId === bleInfo.deviceId;
        });
        if (found) {
          self.currentDevice = Object.assign({}, bleInfo, found);
          self.connected = true;
          self.emit("reconnecting", self.currentDevice);
          setTimeout(function () {
            try {
              veepooFeature.veepooBlePasswordCheckManager();
            } catch (e) {
              console.warn("[bleManager] 密钥校验调用异常:", e);
            }
          }, 300);
        } else {
          self.connect(bleInfo, function () {
            // 结果通过事件分发
          });
        }
      },
      fail: function () {
        // 蓝牙未开 / 未授权时静默退出
      },
    });
  }

  startScan(cb) {
    const devices = [];

    function pushUnique(device) {
      const idx = devices.findIndex(function (d) {
        return d.deviceId === device.deviceId;
      });
      if (idx === -1) devices.push(device);
      else devices[idx] = Object.assign({}, devices[idx], device);
    }

    wx.getConnectedBluetoothDevices({
      services: ["FFFF", "FEE7", "0001", "180D"],
      success: function (res) {
        res.devices.forEach(pushUnique);
        cb(devices.slice());
      },
    });

    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(function (
      res
    ) {
      if (res && res.errCode) {
        cb(devices.slice(), res);
        return;
      }
      if (res && res[0]) {
        pushUnique(res[0]);
        devices.sort(function (a, b) {
          return (b.RSSI || b.rssi || 0) - (a.RSSI || a.rssi || 0);
        });
        cb(devices.slice());
      }
    });
  }

  stopScan(cb) {
    veepooBle.veepooWeiXinSDKStopSearchBleManager(function () {
      if (cb) cb();
    });
  }

  connect(device, cb) {
    if (!device || !device.deviceId) {
      cb(false, { errMsg: "缺少 deviceId" });
      return;
    }

    if (this.connecting) {
      console.warn("[bleManager] 正在连接中，忽略重复 connect 请求");
      return;
    }

    this.connecting = true;
    this.currentDevice = device;

    wx.setStorageSync("bleInfo", device);
    wx.setStorageSync("bleDate", device);
    wx.setStorageSync("deviceChipStatus", false);

    const self = this;
    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(
      device,
      function (result) {
        if (result && result.connection) {
          self.connected = true;
          setTimeout(function () {
            try {
              veepooFeature.veepooBlePasswordCheckManager();
            } catch (e) {
              console.warn("[bleManager] 密钥校验异常:", e);
            }
          }, 500);

          const start = Date.now();
          const timer = setInterval(function () {
            if (self.authed) {
              clearInterval(timer);
              self.connecting = false;
              self.reconnectAttempt = 0;
              cb(true);
              return;
            }
            if (Date.now() - start > 15000) {
              clearInterval(timer);
              self.connecting = false;
              self.connected = false;
              cb(false, { errMsg: "密钥校验超时", errCode: "AUTH_TIMEOUT" });
            }
          }, 300);
        } else {
          const errCode = result && (result.errCode || result.code);
          if (!errCode) return;

          self.connecting = false;
          self.connected = false;
          self.authed = false;
          cb(false, result);
        }
      }
    );
  }

  disconnect() {
    try {
      veepooFeature.veepooSendDisconnectBluetoothDataManager();
    } catch (e) {
      console.warn("[bleManager] 主动断开异常:", e);
    }
    this.cancelReconnect();
    this.connected = false;
    this.authed = false;
    this.connecting = false;
    this.currentDevice = null;
    wx.setStorageSync("connectionStatus", false);
    wx.setStorageSync("bleInfo", null);
    wx.setStorageSync("VPDevice", null);
    wx.setStorageSync("deviceChipStatus", null);
    this.emit("disconnected", { reason: "manual" });
  }

  on(event, fn) {
    const arr = this.listeners[event] || (this.listeners[event] = []);
    arr.push(fn);
    const self = this;
    return function () {
      self.off(event, fn);
    };
  }

  once(event, fn) {
    const off = this.on(event, function () {
      off();
      fn.apply(null, arguments);
    });
    return off;
  }

  off(event, fn) {
    const arr = this.listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit(event) {
    const arr = this.listeners[event];
    if (!arr) return;
    const args = Array.prototype.slice.call(arguments, 1);
    arr.slice().forEach(function (fn) {
      try {
        fn.apply(null, args);
      } catch (e) {
        console.error("[bleManager] listener 错误:", event, e);
      }
    });
  }

  // ---------- 内部 ----------

  registerMonitor() {
    if (this.monitorRegistered) return;
    this.monitorRegistered = true;
    const self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e) {
      if (!e) return;
      if (e.type === 1) {
        const device = self.currentDevice || {};
        if (e.content) {
          device.VPDeviceVersion = e.content.VPDeviceVersion;
          device.VPDeviceMAC = e.content.VPDeviceMAC;
        }
        self.currentDevice = device;
        wx.setStorageSync("VPDevice", device);
        if (device.VPDeviceMAC) {
          wx.setStorageSync("connectedMac", device.VPDeviceMAC);
        }
        wx.setStorageSync("deviceChipStatus", true);
        wx.setStorageSync("connectionStatus", true);
        self.authed = true;
        self.connected = true;
        self.emit("connected", device);
        return;
      }
      if (e.type === 23) {
        self.emit("reminderUpdate", e.content || {});
        return;
      }
      if (e.type === 25) {
        self.emit("lightUpTimeUpdate", e.content || {});
        return;
      }
      if (e.name === "ZT163ScreenKillFunction" || e.type === "screenKill") {
        self.emit("screenKillUpdate", e.content || e);
        return;
      }
    });
  }

  registerBleStateChange() {
    if (this.bleStateRegistered) return;
    this.bleStateRegistered = true;
    const self = this;
    wx.onBLEConnectionStateChange(function (res) {
      console.log("[bleManager] BLE 连接状态变化:", res);
      const cur = self.currentDevice;
      if (!res.connected) {
        const wasAuthed = self.authed;
        self.connected = false;
        self.authed = false;
        wx.setStorageSync("connectionStatus", false);
        const bleInfo = wx.getStorageSync("bleInfo");
        if (wasAuthed && bleInfo && bleInfo.deviceId) {
          self.emit("disconnected", {
            reason: "ble_lost",
            deviceId: cur && cur.deviceId,
          });
          self.scheduleReconnect();
        } else {
          self.emit("disconnected", {
            reason: "ble_lost",
            deviceId: cur && cur.deviceId,
          });
        }
      }
    });
  }

  registerAppLifecycle() {
    if (this.appShowRegistered) return;
    this.appShowRegistered = true;
    const self = this;
    wx.onAppShow(function () {
      if (!self.isConnected() && !self.connecting) {
        const bleInfo = wx.getStorageSync("bleInfo");
        if (bleInfo && bleInfo.deviceId) {
          self.scheduleReconnect(true);
        }
      }
    });
  }

  scheduleReconnect(immediate) {
    if (this.connecting) return;
    if (this.reconnectAttempt >= RECONNECT_INTERVALS_MS.length) {
      console.warn("[bleManager] 达到最大重连次数，停止重连");
      this.reconnectAttempt = 0;
      return;
    }
    const delay = immediate ? 0 : RECONNECT_INTERVALS_MS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.cancelReconnect();
    this.emit("reconnecting", { attempt: this.reconnectAttempt, delay: delay });
    const self = this;
    this.reconnectTimer = setTimeout(function () {
      const bleInfo = wx.getStorageSync("bleInfo");
      if (!bleInfo || !bleInfo.deviceId) return;
      self.connect(bleInfo, function (ok, err) {
        if (!ok) {
          console.warn("[bleManager] 重连失败，准备下一次:", err);
          self.scheduleReconnect();
        }
      });
    }, delay);
  }

  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

let _instance = null;

export function getBleManager() {
  if (!_instance) {
    _instance = new BleManager();
  }
  return _instance;
}
