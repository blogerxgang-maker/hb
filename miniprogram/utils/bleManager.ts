// miniprogram/utils/bleManager.ts
//
// 全局蓝牙连接管理器 - 单例。
// 职责：
//  1. 扫描 / 连接 / 断开 / 重连。
//  2. 在密钥校验完成 (type === 1) 时才认为「已连接」。
//  3. 监听 wx.onBLEConnectionStateChange，断开后按指数退避自动重连。
//  4. 启动自动重连：onLaunch 时若本地存在 bleInfo，则尝试静默重连一次。
//  5. 简单事件总线：connected / disconnected / reconnecting / scanResult / reminderUpdate / screenKillUpdate / lightUpTimeUpdate。
//
// 设计要点：
//  - 所有 BLE 回调都集中在这里订阅一次（veepooBle.veepooWeiXinSDKNotifyMonitorValueChange），
//    页面通过 on(event, fn) 注册，避免不同页面互相覆盖回调或重复绑定。
//  - 「连接成功」仅指物理 BLE 连接；「已认证」（密钥校验通过）才会触发 connected 事件。

import { veepooBle, veepooFeature } from "../miniprogram_dist/index";

type Listener = (...args: any[]) => void;

const RECONNECT_INTERVALS_MS = [1000, 2000, 4000];

class BleManager implements BleManagerLike {
  private listeners: Record<string, Listener[]> = {};
  private currentDevice: any = null;
  private connecting = false;
  private connected = false;
  private authed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: any = null;
  private monitorRegistered = false;
  private bleStateRegistered = false;
  private appShowRegistered = false;

  constructor() {
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
    // 先确认蓝牙系统是否已经持有该连接，若是直接补一次密钥校验。
    wx.getConnectedBluetoothDevices({
      services: ["FFFF", "FEE7", "0001", "180D"],
      success: (res) => {
        const found = res.devices.find(
          (d) => d.deviceId === bleInfo.deviceId
        );
        if (found) {
          // 系统层已连接，直接进入认证 + 状态同步流程
          this.currentDevice = { ...bleInfo, ...found };
          this.connected = true;
          this.emit("reconnecting", this.currentDevice);
          // 触发一次密钥校验，等 type=1 回调到来
          setTimeout(() => {
            try {
              veepooFeature.veepooBlePasswordCheckManager();
            } catch (e) {
              console.warn("[bleManager] 密钥校验调用异常:", e);
            }
          }, 300);
        } else {
          // 系统层未连接，走完整连接流程
          this.connect(bleInfo, () => {
            // 结果通过事件分发，不需要单独处理
          });
        }
      },
      fail: () => {
        // 蓝牙未开 / 未授权时静默退出，等用户手动操作
      },
    });
  }

  startScan(cb: (devices: any[], err?: any) => void) {
    const devices: any[] = [];

    const pushUnique = (device: any) => {
      const idx = devices.findIndex((d) => d.deviceId === device.deviceId);
      if (idx === -1) devices.push(device);
      else devices[idx] = { ...devices[idx], ...device };
    };

    // iOS 兼容：先取一次系统已连接列表
    wx.getConnectedBluetoothDevices({
      services: ["FFFF", "FEE7", "0001", "180D"],
      success: (res) => {
        res.devices.forEach(pushUnique);
        cb(devices.slice());
      },
    });

    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(
      (res: any) => {
        if (res && res.errCode) {
          cb(devices.slice(), res);
          return;
        }
        if (res && res[0]) {
          pushUnique(res[0]);
          // 信号强度排序
          devices.sort(
            (a, b) => (b.RSSI || b.rssi || 0) - (a.RSSI || a.rssi || 0)
          );
          cb(devices.slice());
        }
      }
    );
  }

  stopScan(cb?: () => void) {
    veepooBle.veepooWeiXinSDKStopSearchBleManager(() => {
      if (cb) cb();
    });
  }

  connect(device: any, cb: (ok: boolean, err?: any) => void) {
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

    // 立即写入持久化，便于下次启动重连
    wx.setStorageSync("bleInfo", device);
    wx.setStorageSync("bleDate", device);
    wx.setStorageSync("deviceChipStatus", false);

    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(
      device,
      (result: any) => {
        if (result && result.connection) {
          this.connected = true;
          // 物理连接成功，等待密钥校验
          setTimeout(() => {
            try {
              veepooFeature.veepooBlePasswordCheckManager();
            } catch (e) {
              console.warn("[bleManager] 密钥校验异常:", e);
            }
          }, 500);

          // 等待 type=1 回调；最多 15s
          const start = Date.now();
          const timer = setInterval(() => {
            if (this.authed) {
              clearInterval(timer);
              this.connecting = false;
              this.reconnectAttempt = 0;
              cb(true);
              return;
            }
            if (Date.now() - start > 15000) {
              clearInterval(timer);
              this.connecting = false;
              this.connected = false;
              cb(false, {
                errMsg: "密钥校验超时",
                errCode: "AUTH_TIMEOUT",
              });
            }
          }, 300);
        } else {
          const errCode = result && (result.errCode || result.code);
          // 没有 errCode 时是中间状态推送，忽略，继续等
          if (!errCode) return;

          this.connecting = false;
          this.connected = false;
          this.authed = false;
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

  on(event: BleManagerEvent, fn: Listener) {
    const arr = this.listeners[event] || (this.listeners[event] = []);
    arr.push(fn);
    return () => this.off(event, fn);
  }

  once(event: BleManagerEvent, fn: Listener) {
    const off = this.on(event, (...args: any[]) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(event: BleManagerEvent, fn: Listener) {
    const arr = this.listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit(event: BleManagerEvent, ...args: any[]) {
    const arr = this.listeners[event];
    if (!arr) return;
    // 拷贝一份，避免 fn 在执行过程中修改数组
    arr.slice().forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error("[bleManager] listener 错误:", event, e);
      }
    });
  }

  // ---------- 内部 ----------

  private registerMonitor() {
    if (this.monitorRegistered) return;
    this.monitorRegistered = true;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange((e: any) => {
      if (!e) return;
      // 密钥校验通过
      if (e.type === 1) {
        const device: any = this.currentDevice || {};
        if (e.content) {
          device.VPDeviceVersion = e.content.VPDeviceVersion;
          device.VPDeviceMAC = e.content.VPDeviceMAC;
        }
        this.currentDevice = device;
        wx.setStorageSync("VPDevice", device);
        if (device.VPDeviceMAC) {
          wx.setStorageSync("connectedMac", device.VPDeviceMAC);
        }
        wx.setStorageSync("deviceChipStatus", true);
        wx.setStorageSync("connectionStatus", true);
        this.authed = true;
        this.connected = true;
        this.emit("connected", device);
        return;
      }
      // 提醒数据
      if (e.type === 23) {
        this.emit("reminderUpdate", e.content || {});
        return;
      }
      // 抬腕亮屏
      if (e.type === 25) {
        this.emit("lightUpTimeUpdate", e.content || {});
        return;
      }
      // 常灭屏 (SDK 暂未明确 type，用 name 判断)
      if (e.name === "ZT163ScreenKillFunction" || e.type === "screenKill") {
        this.emit("screenKillUpdate", e.content || e);
        return;
      }
    });
  }

  private registerBleStateChange() {
    if (this.bleStateRegistered) return;
    this.bleStateRegistered = true;
    wx.onBLEConnectionStateChange((res) => {
      console.log("[bleManager] BLE 连接状态变化:", res);
      const cur = this.currentDevice;
      if (!res.connected) {
        const wasAuthed = this.authed;
        this.connected = false;
        this.authed = false;
        wx.setStorageSync("connectionStatus", false);
        // 仅当之前确实建立过连接，且本地仍保留 bleInfo 时才尝试自动重连
        const bleInfo = wx.getStorageSync("bleInfo");
        if (wasAuthed && bleInfo && bleInfo.deviceId) {
          this.emit("disconnected", {
            reason: "ble_lost",
            deviceId: cur && cur.deviceId,
          });
          this.scheduleReconnect();
        } else {
          this.emit("disconnected", {
            reason: "ble_lost",
            deviceId: cur && cur.deviceId,
          });
        }
      }
    });
  }

  private registerAppLifecycle() {
    if (this.appShowRegistered) return;
    this.appShowRegistered = true;
    wx.onAppShow(() => {
      // 切回前台时若已不在连接状态，尝试一次重连
      if (!this.isConnected() && !this.connecting) {
        const bleInfo = wx.getStorageSync("bleInfo");
        if (bleInfo && bleInfo.deviceId) {
          this.scheduleReconnect(true);
        }
      }
    });
  }

  private scheduleReconnect(immediate = false) {
    if (this.connecting) return;
    if (this.reconnectAttempt >= RECONNECT_INTERVALS_MS.length) {
      console.warn("[bleManager] 达到最大重连次数，停止重连");
      this.reconnectAttempt = 0;
      return;
    }
    const delay = immediate ? 0 : RECONNECT_INTERVALS_MS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.cancelReconnect();
    this.emit("reconnecting", { attempt: this.reconnectAttempt, delay });
    this.reconnectTimer = setTimeout(() => {
      const bleInfo = wx.getStorageSync("bleInfo");
      if (!bleInfo || !bleInfo.deviceId) return;
      this.connect(bleInfo, (ok, err) => {
        if (!ok) {
          console.warn("[bleManager] 重连失败，准备下一次:", err);
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

let _instance: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!_instance) {
    _instance = new BleManager();
  }
  return _instance;
}
