// pages/healthData/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'

Page({
  /**
   * 页面的初始数据
   */
  data: {
    isConnected: false,
    isSyncing: false,
    syncStatusText: '点击同步获取最新数据',
    syncFooterText: '上次同步：--',
    
    // 运动数据
    sportData: {
      step: 0,
      calorie: 0,
      distance: 0
    },
    
    // 睡眠数据
    sleepData: {
      totalTime: '--',
      deepTime: '--',
      lightTime: '--'
    },
    
    // 生理数据
    physioData: {
      heartRate: '--',
      bloodOxygen: '--',
      bloodPressure: '--',
      bloodGlucose: '--'
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 检查连接状态
    this.checkConnectionStatus();
    // 设置蓝牙数据监听
    this.notifyMonitorValueChange();
  },

  /**
   * 检查连接状态
   */
  checkConnectionStatus() {
    const connectionStatus = wx.getStorageSync('connectionStatus');
    this.setData({
      isConnected: !!connectionStatus
    });
    
    if (!connectionStatus) {
      this.setData({
        syncStatusText: '未连接设备，无法同步'
      });
    }
  },

  /**
   * 同步数据
   */
  syncData() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '同步数据需要连接蓝牙设备。请确保蓝牙已开启并前往连接页面。',
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

    if (this.data.isSyncing) {
      return;
    }

    this.setData({
      isSyncing: true,
      syncStatusText: '正在同步当前计步…'
    });

    // 第一步：读取今日步数
    this.readStepData();
  },

  /**
   * 读取步数数据
   */
  readStepData() {
    const self = this;
    
    self.setData({
      syncStatusText: '正在同步计步数据…'
    });

    const data = { day: 0 }; // 0 代表今天
    veepooFeature.veepooReadStepCalorieDistanceManager(data);

    // 延迟读取睡眠数据
    setTimeout(() => {
      self.readSleepData();
    }, 1500);
  },

  /**
   * 读取睡眠数据
   */
  readSleepData() {
    const self = this;
    
    self.setData({
      syncStatusText: '正在同步睡眠数据…'
    });

    const data = { day: 1 }; // 1 代表昨天（睡眠数据通常是昨晚的）
    veepooFeature.veepooSendReadPreciseSleepManager(data);

    // 延迟读取日常数据
    setTimeout(() => {
      self.readDailyData();
    }, 2000);
  },

  /**
   * 读取日常数据（包含心率、血氧、血压等）
   */
  readDailyData() {
    const self = this;
    
    self.setData({
      syncStatusText: '正在同步生理数据…'
    });

    const data = { 
      day: 0, 
      packages: 1 
    };
    veepooFeature.veepooSendReadDailyDataManager(data);

    // 延迟完成同步
    setTimeout(() => {
      self.finishSync();
    }, 3000);
  },

  /**
   * 完成同步
   */
  finishSync() {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    this.setData({
      isSyncing: false,
      syncStatusText: '数据同步完成',
      syncFooterText: `上次同步：今天 ${timeStr}`
    });

    wx.showToast({
      title: '健康数据同步完成',
      icon: 'success'
    });
  },

  /**
   * 格式化睡眠时长
   */
  formatSleepTime(minutes: number): string {
    if (!minutes || minutes <= 0) return '--';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h${mins > 0 ? mins + 'm' : ''}`;
    }
    return `${mins}m`;
  },

  /**
   * 监听蓝牙数据返回
   */
  notifyMonitorValueChange() {
    const self = this;
    
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function(e: any) {
      console.log('健康数据页蓝牙回调:', e);
      if (!e) return;

      try {
        const content = e.content;
        if (!content) return;

        // 步数、卡路里、距离数据 (type = 9)
        if (e.type === 9) {
          self.setData({
            'sportData.step': content.step || 0,
            'sportData.calorie': content.calorie || 0,
            'sportData.distance': content.distance || 0
          });
        }

        // 精准睡眠数据 (type = 4)
        if (e.type === 4 || e.name === '精准睡眠数据') {
          self.setData({
            'sleepData.totalTime': self.formatSleepTime(content.sleepTotalTime),
            'sleepData.deepTime': self.formatSleepTime(content.deepSleepTime),
            'sleepData.lightTime': self.formatSleepTime(content.lightSleepTime)
          });
        }

        // 日常数据 (type = 5)
        if (e.type === 5) {
          // 心率数据
          if (content.heartReat && Array.isArray(content.heartReat) && content.heartReat.length > 0) {
            const validHeartRates = content.heartReat.filter((v: number) => v > 0);
            if (validHeartRates.length > 0) {
              const avgHeartRate = Math.round(validHeartRates.reduce((a: number, b: number) => a + b, 0) / validHeartRates.length);
              self.setData({
                'physioData.heartRate': avgHeartRate
              });
            }
          }

          // 血氧数据
          if (content.bloodOxygen?.oxygens && Array.isArray(content.bloodOxygen.oxygens) && content.bloodOxygen.oxygens.length > 0) {
            const validOxygens = content.bloodOxygen.oxygens.filter((v: number) => v > 0);
            if (validOxygens.length > 0) {
              const avgOxygen = Math.round(validOxygens.reduce((a: number, b: number) => a + b, 0) / validOxygens.length);
              self.setData({
                'physioData.bloodOxygen': avgOxygen
              });
            }
          }

          // 血压数据
          if (content.bloodPressure) {
            const bp = content.bloodPressure;
            if (bp.high && bp.low) {
              self.setData({
                'physioData.bloodPressure': `${bp.high}/${bp.low}`
              });
            }
          }

          // 血糖数据
          if (content.bloodGlucose) {
            const bg = typeof content.bloodGlucose === 'object' 
              ? content.bloodGlucose.bloodGlucose 
              : content.bloodGlucose;
            if (bg && bg > 0) {
              self.setData({
                'physioData.bloodGlucose': bg.toFixed(1)
              });
            }
          }
        }
      } catch (err) {
        console.error('解析健康数据出错:', err);
      }
    });
  }
});
