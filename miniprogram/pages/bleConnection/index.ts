// pages/bleConnection/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'

Page({

  /**
   * 页面的初始数据
   */
  data: {
    bleList: [] as any[],
    isIOS: false,
    isScanning: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    let self = this;
    wx.getSystemInfo({
      success: function (res) {
        if (res.platform == "ios") {
          self.setData({
            isIOS: true
          })
        }
      }
    });
    // 注册断开监听
    this.BLEConnectionStateChange();
    this.veepooSDKGetSetting()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },
  
  onHide() {
    this.StopSearchBleManager()
  },

  onUnload() {
    this.StopSearchBleManager()
  },

  /**
   * 获取蓝牙错误友好提示
   */
  getBleErrorMessage(err: any) {
    const errCode = err.errCode || err.code;
    const errMsg = err.errMsg || "";

    switch (errCode) {
      case 10001: return "手机蓝牙未开启，请在系统设置中打开蓝牙";
      case 10012: return "连接超时，请确保设备未被其他手机连接";
      default:
        if (errMsg.indexOf("location") !== -1) return "请开启手机定位服务（GPS）";
        if (errMsg.indexOf("auth") !== -1) return "请授予微信蓝牙权限";
        return `操作失败(${errCode || "未知错误"})`;
    }
  },

  veepooSDKGetSetting() {
    let self = this;
    let deviceList: any[] = [];
    
    this.setData({ isScanning: true });

    // 获取手机设置状态
    veepooBle.veepooWeiXinSDKStartScanDeviceAndReceiveScanningDevice(function (res: any) {
      console.log('扫描回调 res=>', res)
      
      // 错误处理
      if (res && res.errCode) {
        console.error('扫描出错:', res);
        self.setData({ isScanning: false });
        wx.showModal({
          title: '扫描失败',
          content: self.getBleErrorMessage(res),
          showCancel: false
        });
        return;
      }

      if (res && res[0]) {
        const device = res[0];
        // 去重逻辑
        const existIndex = deviceList.findIndex((d: any) => d.deviceId === device.deviceId);
        if (existIndex === -1) {
          deviceList.push(device);
        } else {
          deviceList[existIndex] = device;
        }

        // 排序并更新
        self.setData({
          bleList: deviceList.sort((a: any, b: any) => (b.RSSI || 0) - (a.RSSI || 0))
        })
      }
    })
  },

  connectionDevice(e: any) {
    let self = this;
    let deviceId = e.currentTarget.dataset.deviceid;
    let device = self.data.bleList.find((item: any) => item.deviceId == deviceId);

    if (!device) return;

    wx.showLoading({
      title: '连接中',
      mask: true
    })
    this.StopSearchBleManager()
    
    wx.setStorageSync('bleInfo', device)
    // 连接
    veepooBle.veepooWeiXinSDKConnectionDevice(device, function (result: any) {
      wx.hideLoading()
      console.log("连接的result=>", result)
      if (!result.connection) {
        wx.showToast({
          title: '连接失败',
          icon: 'none'
        })
      }
    })
  },

  connectBle(e: any) {
    let self = this;
    let deviceId = e.currentTarget.dataset.deviceid;
    let device = self.data.bleList.find((item: any) => item.deviceId == deviceId);

    if (!device) return;

    wx.showLoading({
      title: '连接中',
      mask: true
    })
    
    this.StopSearchBleManager()
    wx.setStorageSync('bleInfo', device)
    wx.setStorageSync('deviceChipStatus', false) // 重置状态

    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(device, function (result: any) {
      console.log("连接结果 result=>", result)
      if (result.connection) {
        // 获取当前服务，订阅监听
        self.notifyMonitorValueChange();
        
        // 蓝牙密码核准
        setTimeout(() => {
          veepooFeature.veepooBlePasswordCheckManager();
        }, 500);

        let checkCount = 0;
        let times = setInterval(() => {
          let deviceChipStatus = wx.getStorageSync('deviceChipStatus')
          checkCount++;

          console.log("轮询验证状态 checkCount:", checkCount, "status:", deviceChipStatus)
          
          if (deviceChipStatus) {
            clearInterval(times)
            wx.hideLoading()
            wx.redirectTo({
              url: '/pages/index/index'
            })
          } else if (checkCount > 15) { // 15秒超时
            clearInterval(times)
            wx.hideLoading()
            wx.showModal({
              title: '验证超时',
              content: '设备已连接但密钥验证超时，请重试或靠近设备',
              showCancel: false
            })
          }
        }, 1000)
      } else {
        const errCode = result.errCode || result.code;
        if (!errCode || errCode === 0) {
          console.log("收到非连接状态更新，继续等待...", result);
          return;
        }
        wx.hideLoading()
        wx.showModal({
          title: '连接失败',
          content: self.getBleErrorMessage(result),
          showCancel: false
        })
      }
    })
  },
  
  connectBle2() {
    let self = this;
    let item = wx.getStorageSync('bleInfo')
    if (!item) {
      wx.showToast({ title: '无设备信息', icon: 'none' });
      return;
    }

    wx.showLoading({
      title: '重连中',
      mask: true
    })
    this.StopSearchBleManager()
    wx.setStorageSync('deviceChipStatus', false) // 重置状态

    veepooBle.veepooWeiXinSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result: any) {
      console.log("重连结果 result=>", result)
      if (result.connection) {
        // 获取当前服务，订阅监听
        self.notifyMonitorValueChange();

        if (item.name == 'DFULang') {
          wx.hideLoading()
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/index/index' })
          }, 1000);
          return
        }

        // 蓝牙密码核准
        veepooFeature.veepooBlePasswordCheckManager();

        let checkCount = 0;
        let times = setInterval(() => {
          let deviceChipStatus = wx.getStorageSync('deviceChipStatus')
          checkCount++;
          
          if (deviceChipStatus) {
            clearInterval(times)
            wx.hideLoading()
            wx.redirectTo({
              url: '/pages/index/index'
            })
          } else if (checkCount > 15) { // 15秒超时
            clearInterval(times)
            wx.hideLoading()
            wx.showModal({
              title: '验证超时',
              content: '重连成功但验证超时，请重试',
              showCancel: false
            })
          }
        }, 1000)
      } else {
        const errCode = result.errCode || result.code;
        if (!errCode || errCode === 0) {
          console.log("收到重连状态更新，继续等待...", result);
          return;
        }
        wx.hideLoading()
        wx.showModal({
          title: '重连失败',
          content: self.getBleErrorMessage(result),
          showCancel: false
        })
      }
    })
  },

  // 监听订阅 notifyMonitorValueChange
  notifyMonitorValueChange() {
    let self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      console.log("监听蓝牙回调:", e);
      // 如果是密码核准成功，设置状态
      if (e && e.type === 1) {
        wx.setStorageSync('deviceChipStatus', true)
      }
      self.bleDataParses(e)
    })
  },

  // 蓝牙断开监听
  BLEConnectionStateChange() {
    veepooBle.veepooWeiXinSDKBLEConnectionStateChangeManager(function (e: any) {
      console.log("蓝牙断开回调=>", e)
      if (e && !e.connected) {
        wx.setStorageSync('connectionStatus', false)
        wx.showToast({
          title: '设备已断开',
          icon: 'none'
        })
      }
    })
  },

  // 停止蓝牙搜索
  StopSearchBleManager() {
    this.setData({ isScanning: false });
    veepooBle.veepooWeiXinSDKStopSearchBleManager(function (e: any) {
      console.log("停止蓝牙搜索=>", e)
    })
  },

  // 蓝牙数据解析
  bleDataParses(value: any) {
    console.log("解析数据 content=>", value)
  }
})