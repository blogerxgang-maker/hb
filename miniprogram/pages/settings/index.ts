// pages/settings/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'

Page({
  /**
   * 页面的初始数据
   */
  data: {
    isConnected: false,
    
    // 抬腕亮屏
    raiseWrist: false,
    raiseWristText: '已关闭',
    raiseWristStatus: 'off',
    raiseWristStartTime: '22:00',
    raiseWristEndTime: '08:00',
    raiseWristLevel: 5,
    showRaiseWristModal: false,
    selectedRaiseWristStartTime: '22:00',
    selectedRaiseWristEndTime: '08:00',
    selectedRaiseWristLevel: 5,
    raiseWristLevelOptions: [1, 2, 3, 4, 5],
    
    // 常灭屏
    alwaysOff: false,
    alwaysOffText: '已关闭',
    alwaysOffStatus: 'off',
    
    // 息屏时间
    screenTime: 5,
    showScreenTimeModal: false,
    selectedScreenTime: 5,
    screenTimeOptions: [3, 5, 10, 15, 20, 30],
    
    // 表盘
    currentDial: 0,
    showDialModal: false,
    selectedDial: 0,
    dialOptions: [0, 1, 2, 3, 4, 5, 6]
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 检查连接状态
    this.checkConnectionStatus();
    // 设置蓝牙数据监听
    this.notifyMonitorValueChange();
    // 读取设备设置
    if (wx.getStorageSync('connectionStatus')) {
      this.readDeviceSettings();
    }
  },

  /**
   * 检查连接状态
   */
  checkConnectionStatus() {
    const connectionStatus = wx.getStorageSync('connectionStatus');
    this.setData({
      isConnected: !!connectionStatus
    });
  },

  /**
   * 读取设备设置
   */
  readDeviceSettings() {
    // 读取抬腕亮屏设置
    const data = {
      switch: 'read',
      startTime: '00:00',
      endTime: '23:59',
      deviceLevel: 5
    };
    veepooFeature.veepooSendTurnWristBrightScreenDataManger(data);
    
    // 读取息屏时间
    setTimeout(() => {
      veepooFeature.veepooSendLightUpTimeDataManager({
        switch: 'read',
        duration: 0
      });
    }, 500);

    // 读取常灭屏状态
    setTimeout(() => {
      veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
        control: 3  // 3=读取
      });
    }, 1000);
  },

  /**
   * 抬腕亮屏开关变化
   */
  onRaiseWristChange(e: any) {
    if (!this.data.isConnected) return;
    
    const value = e.detail.value;
    const data = {
      switch: value ? 'start' : 'stop',
      startTime: this.data.raiseWristStartTime,
      endTime: this.data.raiseWristEndTime,
      deviceLevel: this.data.raiseWristLevel
    };
    
    veepooFeature.veepooSendTurnWristBrightScreenDataManger(data);
    
    this.setData({
      raiseWrist: value,
      raiseWristText: value ? '已开启' : '已关闭',
      raiseWristStatus: value ? 'on' : 'off'
    });
  },

  /**
   * 抬腕亮屏时段设置
   */
  onRaiseWristTimeClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '设置抬腕亮屏时段需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }

    this.setData({
      showRaiseWristModal: true,
      selectedRaiseWristStartTime: this.data.raiseWristStartTime,
      selectedRaiseWristEndTime: this.data.raiseWristEndTime,
      selectedRaiseWristLevel: this.data.raiseWristLevel
    });
  },

  onRaiseWristStartChange(e: any) {
    this.setData({
      selectedRaiseWristStartTime: e.detail.value
    });
  },

  onRaiseWristEndChange(e: any) {
    this.setData({
      selectedRaiseWristEndTime: e.detail.value
    });
  },

  onRaiseWristLevelSelect(e: any) {
    this.setData({
      selectedRaiseWristLevel: e.currentTarget.dataset.level
    });
  },

  closeRaiseWristModal() {
    this.setData({
      showRaiseWristModal: false
    });
  },

  confirmRaiseWristTime() {
    const startTime = this.data.selectedRaiseWristStartTime;
    const endTime = this.data.selectedRaiseWristEndTime;
    const deviceLevel = this.data.selectedRaiseWristLevel;

    veepooFeature.veepooSendTurnWristBrightScreenDataManger({
      switch: this.data.raiseWrist ? 'start' : 'stop',
      startTime,
      endTime,
      deviceLevel
    });

    this.setData({
      raiseWristStartTime: startTime,
      raiseWristEndTime: endTime,
      raiseWristLevel: deviceLevel,
      showRaiseWristModal: false
    });
  },

  /**
   * 常灭屏开关变化
   */
  onAlwaysOffChange(e: any) {
    if (!this.data.isConnected) {
      wx.showToast({
        title: '请先连接设备',
        icon: 'none'
      });
      return;
    }
    
    const value = e.detail.value;
    
    // 调用常灭屏设置接口
    veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
      control: value ? 1 : 2  // 1=开启, 2=关闭
    });
    
    this.setData({
      alwaysOff: value,
      alwaysOffText: value ? '已开启' : '已关闭',
      alwaysOffStatus: value ? 'on' : 'off'
    });
    
    wx.showToast({
      title: value ? '已开启常灭屏' : '已关闭常灭屏',
      icon: 'success'
    });
  },

  /**
   * 息屏时间点击
   */
  onScreenTimeClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '设置息屏时间需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    this.setData({
      showScreenTimeModal: true,
      selectedScreenTime: this.data.screenTime
    });
  },

  /**
   * 息屏时间选择
   */
  onScreenTimeSelect(e: any) {
    this.setData({
      selectedScreenTime: e.currentTarget.dataset.time
    });
  },

  /**
   * 关闭息屏时间弹窗
   */
  closeScreenTimeModal() {
    this.setData({
      showScreenTimeModal: false
    });
  },

  /**
   * 确认息屏时间
   */
  confirmScreenTime() {
    const time = this.data.selectedScreenTime;
    
    veepooFeature.veepooSendLightUpTimeDataManager({
      switch: 'setup',
      duration: time
    });
    
    this.setData({
      screenTime: time,
      showScreenTimeModal: false
    });
    
    wx.showToast({
      title: '设置成功',
      icon: 'success'
    });
  },

  /**
   * 健康设置点击
   */
  onHealthSettingsClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '健康设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.navigateTo({
      url: '/pages/switchSetup/index'
    });
  },

  /**
   * 寻找设备点击
   */
  onFindDeviceClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '寻找设备需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    veepooFeature.veepooSendPhoneLookBraceletDataManager({
      switch: 'start'
    });
    
    wx.showToast({
      title: '正在寻找设备…',
      icon: 'none',
      duration: 3000
    });
    
    // 3秒后自动停止
    setTimeout(() => {
      veepooFeature.veepooSendPhoneLookBraceletDataManager({
        switch: 'stop'
      });
    }, 3000);
  },

  /**
   * 事件提醒点击
   */
  onEventReminderClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '事件提醒设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.navigateTo({
      url: '/pages/ANCSToast/index'
    });
  },

  /**
   * 闹钟设置点击
   */
  onAlarmClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '闹钟设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.navigateTo({
      url: '/pages/alarmClock/index'
    });
  },

  /**
   * 常用提醒点击
   */
  onCommonReminderClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '常用提醒设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.navigateTo({
      url: '/pages/commonreminder/index'
    });
  },

  /**
   * 表盘设置点击
   */
  onDialClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '表盘设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    this.setData({
      showDialModal: true,
      selectedDial: this.data.currentDial
    });
  },

  /**
   * 表盘选择
   */
  onDialSelect(e: any) {
    this.setData({
      selectedDial: e.currentTarget.dataset.dial
    });
  },

  /**
   * 关闭表盘弹窗
   */
  closeDialModal() {
    this.setData({
      showDialModal: false
    });
  },

  /**
   * 确认表盘
   */
  confirmDial() {
    const dial = this.data.selectedDial;
    
    // 调用UI风格设置接口
    veepooFeature.veepooSendSetUIStyleDataManager({ type: dial });
    
    this.setData({
      currentDial: dial,
      showDialModal: false
    });
    
    wx.showToast({
      title: '表盘设置成功',
      icon: 'success'
    });
  },

  /**
   * 阻止弹窗关闭
   */
  preventClose() {
    // 阻止事件冒泡
  },

  /**
   * 恢复出厂设置点击
   */
  onFactoryResetClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '恢复出厂设置需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.showModal({
      title: '恢复出厂设置',
      content: '确定要恢复出厂设置吗？该操作将清除设备所有数据，且不可恢复。',
      confirmColor: '#C62828',
      success: (res) => {
        if (res.confirm) {
          veepooFeature.veepooSendResettingTheDeviceDataManager();
          wx.showToast({
            title: '已发送指令',
            icon: 'success'
          });
        }
      }
    });
  },

  /**
   * 复位点击
   */
  onResetClick() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '复位设备需要连接蓝牙设备。请前往连接页面。',
        confirmText: '去连接',
        confirmColor: '#4DB6AC',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/connect/index'
            });
          }
        }
      });
      return;
    }
    
    wx.showModal({
      title: '复位',
      content: '确定要复位设备吗？',
      confirmColor: '#C62828',
      success: (res) => {
        if (res.confirm) {
          veepooFeature.veepooSendResetDataManager();
          wx.showToast({
            title: '已发送指令',
            icon: 'success'
          });
        }
      }
    });
  },

  /**
   * 监听蓝牙数据返回
   */
  notifyMonitorValueChange() {
    const self = this;
    
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function(e: any) {
      console.log('设置页蓝牙回调:', e);
      if (!e) return;

      // 抬腕亮屏数据 (type = 25)
      if (e.type === 25) {
        const content = e.content;
        console.log('[Debug] 抬腕亮屏回调:', content);
        // 兼容不同的返回状态: start/open/true
        const switchValue = content.deviceSwitch || content.deviceControl || content.deviceStatus || content.switch;
        const isOn = switchValue === 'start' || switchValue === 'open' || switchValue === true || switchValue === 1;
        const startTime = content.startTime || self.data.raiseWristStartTime;
        const endTime = content.endTime || self.data.raiseWristEndTime;
        const level = content.deviceLevel || content.defaultLevel || self.data.raiseWristLevel;
        self.setData({
          raiseWrist: isOn,
          raiseWristText: isOn ? '已开启' : '已关闭',
          raiseWristStatus: isOn ? 'on' : 'off',
          raiseWristStartTime: startTime,
          raiseWristEndTime: endTime,
          raiseWristLevel: level
        });
      }

      // 常灭屏数据回调 (根据SDK返回的type处理)
      // 注意：需要根据实际SDK回调的type值调整
      if (e.name === 'ZT163ScreenKillFunction' || e.type === 'screenKill') {
        const content = e.content || e;
        console.log('[Debug] 常灭屏回调:', content);
        const isOn = content.status === 1 || content.control === 1 || content.switch === true;
        self.setData({
          alwaysOff: isOn,
          alwaysOffText: isOn ? '已开启' : '已关闭',
          alwaysOffStatus: isOn ? 'on' : 'off'
        });
      }
    });
  }
});
