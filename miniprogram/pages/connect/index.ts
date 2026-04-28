// pages/connect/index.ts
import { veepooBle, veepooFeature } from "../../miniprogram_dist/index";

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 连接状态: 'disconnected' | 'scanning' | 'connected'
    connectionStatus: "disconnected",
    statusTitle: "未连接",
    statusSubtitle: "未连接任何设备",
    bleList: [] as any[],
    isRefreshing: false,
    connectedDevice: null as any,
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    // 检查是否已有连接的设备
    this.checkConnectedDevice();
    // 监听蓝牙连接状态变化
    this.listenBleConnectionState();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次显示页面时检查连接状态
    this.checkConnectedDevice();
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    // 离开页面时停止扫描
    if (this.data.connectionStatus === "scanning") {
      this.stopScan();
    }
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 页面销毁时停止扫描
    if (this.data.connectionStatus === "scanning") {
      this.stopScan();
    }
  },

  /**
   * 检查已连接的设备
   */
  checkConnectedDevice() {
    const self = this;
    const bleInfo = wx.getStorageSync("bleInfo");

    if (bleInfo && bleInfo.deviceId) {
      wx.getConnectedBluetoothDevices({
        services: ["FFFF", "FEE7", "0001", "180D"],
        success(res) {
          const isConnected = res.devices.some(
            (device) => device.deviceId === bleInfo.deviceId
          );
          if (isConnected) {
            self.setData({
              connectionStatus: "connected",
              statusTitle: "已连接",
              statusSubtitle: `${
                bleInfo.name || bleInfo.deviceName || "设备"
              } [${bleInfo.deviceId}]`,
              connectedDevice: bleInfo,
            });
            // 同步连接状态到全局
            wx.setStorageSync("connectionStatus", true);
            // 确认连接后启动监听
            self.notifyMonitorValueChange();
          } else {
            // 如果本地有记录但未连接，尝试自动重连
            console.log("检测到上次连接设备，尝试自动重连...");
            self.onDeviceClick({
              currentTarget: { dataset: { deviceid: bleInfo.deviceId } },
            } as any);
          }
        },
        fail() {
          self.setData({
            connectionStatus: "disconnected",
            statusTitle: "未连接",
            statusSubtitle: "未连接任何设备",
            connectedDevice: null,
          });
          wx.setStorageSync("connectionStatus", false);
        },
      });
    } else {
      self.setData({
        connectionStatus: "disconnected",
        statusTitle: "未连接",
        statusSubtitle: "未连接任何设备",
        connectedDevice: null,
      });
      wx.setStorageSync("connectionStatus", false);
    }
  },

  /**
   * 监听蓝牙连接状态变化
   */
  listenBleConnectionState() {
    const self = this;
    wx.onBLEConnectionStateChange(function (res) {
      console.log("蓝牙连接状态变化:", res);
      if (!res.connected) {
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "未连接",
          statusSubtitle: "设备已断开连接",
          connectedDevice: null,
        });
        wx.setStorageSync("connectionStatus", false);
        wx.setStorageSync("VPDevice", null);
        wx.showToast({
          title: "设备已断开",
          icon: "none",
        });
      }
    });
  },

  /**
   * 获取蓝牙错误友好提示
   */
  getBleErrorMessage(err: any) {
    const errCode = err.errCode || err.code;
    const errMsg = err.errMsg || "";

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
        return "无效的设备ID，请尝试重新扫描";
      default:
        if (errMsg.indexOf("location") !== -1) {
          return "请开启手机定位服务（GPS），并授予微信定位权限";
        }
        if (errMsg.indexOf("auth") !== -1 || errMsg.indexOf("authorize") !== -1) {
          return "请在手机设置中授予微信蓝牙权限";
        }
        return `操作失败(${errCode || "未知错误"})，请检查设备状态并重试`;
    }
  },

  /**
   * 显示错误提示弹窗
   */
  showErrorTip(err: any) {
    const message = this.getBleErrorMessage(err);
    wx.showModal({
      title: "提示",
      content: message,
      showCancel: false,
      confirmText: "我知道了",
      confirmColor: "#4DB6AC",
    });
  },

  /**
   * 开始扫描
   */
  startScan() {
    const self = this;

    self.setData({
      connectionStatus: "scanning",
      statusTitle: "正在扫描",
      statusSubtitle: "正在搜索周围的蓝牙设备…",
      bleList: [],
    });

    const deviceList: any[] = [];

    // iOS 兼容性处理：获取系统已连接的设备
    wx.getConnectedBluetoothDevices({
      services: ["FFFF", "FEE7", "0001", "180D"],
      success(res) {
        console.log("获取到系统已连接设备:", res.devices);
        res.devices.forEach((device) => {
          const existIndex = deviceList.findIndex(
            (d) => d.deviceId === device.deviceId
          );
          if (existIndex === -1) {
            deviceList.push(device);
          }
        });
        self.setData({
          bleList: deviceList,
        });
      },
    });

    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(function (
      res: any
    ) {
      console.log("扫描到设备:", res);
      
      // 检查是否返回了错误对象
      if (res && res.errCode) {
        console.error("扫描出错:", res);
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "扫描失败",
          statusSubtitle: self.getBleErrorMessage(res),
        });
        self.showErrorTip(res);
        return;
      }

      if (res && res[0]) {
        const device = res[0];
        // 检查是否已存在
        const existIndex = deviceList.findIndex(
          (d) => d.deviceId === device.deviceId
        );
        if (existIndex === -1) {
          deviceList.push(device);
        } else {
          deviceList[existIndex] = device;
        }
        // 按信号强度排序
        deviceList.sort(
          (a, b) => (b.RSSI || b.rssi || 0) - (a.RSSI || a.rssi || 0)
        );
        self.setData({
          bleList: deviceList,
        });
      }
    });
  },

  /**
   * 停止扫描
   */
  stopScan() {
    const self = this;

    veepooBle.veepooWeiXinSDKStopSearchBleManager(function (e: any) {
      console.log("停止扫描:", e);
      if (self.data.connectionStatus === "scanning") {
        self.setData({
          connectionStatus: "disconnected",
          statusTitle: "未连接",
          statusSubtitle: "未连接任何设备",
        });
      }
    });
  },

  /**
   * 下拉刷新
   */
  onRefresh() {
    const self = this;
    self.setData({ isRefreshing: true });

    // 停止当前扫描
    veepooBle.veepooWeiXinSDKStopSearchBleManager(function () {
      // 清空列表并重新开始扫描
      self.setData({ bleList: [] });
      self.startScan();

      setTimeout(() => {
        self.setData({ isRefreshing: false });
      }, 1000);
    });
  },

  /**
   * 点击设备进行连接
   */
  onDeviceClick(e: any) {
    const self = this;
    const deviceId = e.currentTarget.dataset.deviceid;
    let device = this.data.bleList.find((d) => d.deviceId === deviceId);

    console.log("点击连接设备:", deviceId, device);

    if (!device) {
      // 如果列表中没找到（可能是自动重连），尝试从缓存获取
      const bleInfo = wx.getStorageSync("bleInfo");
      if (bleInfo && bleInfo.deviceId === deviceId) {
        device = bleInfo;
      }
    }

    if (!device) {
      console.error("未找到设备对象:", deviceId);
      wx.showToast({
        title: "设备信息丢失，请重新扫描",
        icon: "none"
      });
      return;
    }

    // 停止扫描
    this.stopScan();

    wx.showLoading({
      title: "连接中...",
      mask: true,
    });

    self.setData({
      connectionStatus: "disconnected",
      statusTitle: "连接中",
      statusSubtitle: `正在连接 ${
        device.name || device.deviceName || "设备"
      }...`,
    });

    // 保存设备信息
    wx.setStorageSync("bleInfo", device);
    wx.setStorageSync("bleDate", device);
    wx.setStorageSync("deviceChipStatus", false); // 重置验证状态

    // 连接设备
    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(
      device,
      function (result: any) {
        console.log("连接结果:", result);

        if (result.connection) {
          // 连接成功，设置监听
          self.notifyMonitorValueChange();

          // 延迟执行密钥验证
          setTimeout(() => {
            veepooFeature.veepooBlePasswordCheckManager();
          }, 500);

          // 等待密钥验证完成
          let checkCount = 0;
          const checkInterval = setInterval(() => {
            const deviceChipStatus = wx.getStorageSync("deviceChipStatus");
            checkCount++;

            if (deviceChipStatus || checkCount > 30) { // 增加到15秒超时
              clearInterval(checkInterval);
              wx.hideLoading();

              if (deviceChipStatus) {
                self.setData({
                  connectionStatus: "connected",
                  statusTitle: "已连接",
                  statusSubtitle: `${
                    device.name || device.deviceName || "设备"
                  } [${device.deviceId}]`,
                  connectedDevice: device,
                });
                wx.setStorageSync("connectionStatus", true);

                wx.showToast({
                  title: "连接成功",
                  icon: "success",
                });
              } else {
                // 密钥验证超时或失败
                self.setData({
                  connectionStatus: "disconnected",
                  statusTitle: "验证失败",
                  statusSubtitle: "设备密钥验证未通过，请重试",
                });
                wx.setStorageSync("connectionStatus", false);
                wx.showModal({
                  title: "连接提示",
                  content: "设备已连接但密钥验证未通过，请确保设备未被锁定或尝试重新连接。",
                  showCancel: false,
                  confirmColor: "#4DB6AC"
                });
              }
            }
          }, 500);
        } else {
          const errCode = result.errCode || result.code;
          const errorMsg = self.getBleErrorMessage(result);
          
          // 如果没有具体的错误码，可能只是连接过程中的状态更新，不立即弹窗
          if (!errCode || errCode === 0) {
            console.log("收到非连接状态更新，继续等待...", result);
            self.setData({
              statusSubtitle: errorMsg
            });
            return;
          }

          wx.hideLoading();
          self.setData({
            connectionStatus: "disconnected",
            statusTitle: "连接失败",
            statusSubtitle: errorMsg,
          });
          self.showErrorTip(result);
        }
      }
    );
  },

  /**
   * 断开连接
   */
  disconnect() {
    const self = this;

    wx.showModal({
      title: "提示",
      content: "确定要断开设备连接吗？",
      success(res) {
        if (res.confirm) {
          veepooFeature.veepooSendDisconnectBluetoothDataManager();

          self.setData({
            connectionStatus: "disconnected",
            statusTitle: "未连接",
            statusSubtitle: "已断开设备连接",
            connectedDevice: null,
            bleList: [],
          });

          wx.setStorageSync("connectionStatus", false);
          wx.setStorageSync("VPDevice", null);
          wx.setStorageSync("bleInfo", null);
          wx.setStorageSync("deviceChipStatus", null);

          wx.showToast({
            title: "已断开连接",
            icon: "success",
          });
        }
      },
    });
  },

  /**
   * 监听蓝牙数据返回
   */
  notifyMonitorValueChange() {
    const self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      console.log("连接页蓝牙回调:", e);
      if (!e) return;

      // 密钥验证回调
      if (e.type === 1) {
        const device: any = self.data.connectedDevice || {};
        device.VPDeviceVersion = e.content?.VPDeviceVersion;
        device.VPDeviceMAC = e.content?.VPDeviceMAC;
        wx.setStorageSync("VPDevice", device);
        if (device.VPDeviceMAC) {
          wx.setStorageSync("connectedMac", device.VPDeviceMAC);
        }
        wx.setStorageSync("deviceChipStatus", true);
      }
    });
  },
});
