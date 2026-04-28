// pages/reminder/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'

// 震动模式定义
const MODE_LIST = [
  { id: 'single_soft', name: '单次柔和', desc: '单次柔和：下发【读书提醒】', type: '看书' },
  { id: 'single_strong', name: '单次强度', desc: '单次强度：下发【吃药提醒】', type: '吃药' },
  { id: 'double_soft', name: '双次柔和', desc: '双次柔和：先下发【读书提醒】，4秒后下发【出行提醒】', type: '看书', type2: '出行', delay: 4000 },
  { id: 'soft_strong', name: '一柔一强', desc: '一柔一强：先下发【读书提醒】，4秒后下发【洗手提醒】', type: '看书', type2: '洗手', delay: 4000 },
  { id: 'double_strong', name: '双次强度', desc: '双次强度：先下发【吃药提醒】，5秒后下发【洗手提醒】', type: '吃药', type2: '洗手', delay: 5000 }
];

Page({
  /**
   * 页面的初始数据
   */
  data: {
    isConnected: false,
    startTime: '08:00',
    endTime: '22:00',
    timeError: false,
    selectedMode: 'single_soft',
    modeList: MODE_LIST,
    // 隐藏模式描述文字，不显示给用户
    modeDescription: '',
    intervalTime: 30,
    isSaving: false,
    canSave: true
  },

  // 内部变量，用于合并多批次回调
  _tempReminderMap: null as any,
  _commitTimer: null as any,

  // 手动 UTF-8 解码器，处理截断的序列，兼容不支持 TextDecoder 的环境
  utf8Decode(bytes: Uint8Array): string {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      let c = bytes[i++];
      if (c < 128) {
        out += String.fromCharCode(c);
      } else if (c > 191 && c < 224) {
        if (i >= bytes.length) break;
        let c2 = bytes[i++];
        out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      } else if (c > 223 && c < 240) {
        if (i + 1 >= bytes.length) break;
        let c2 = bytes[i++];
        let c3 = bytes[i++];
        out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      } else if (c > 239 && c < 248) {
        if (i + 2 >= bytes.length) break;
        let c2 = bytes[i++];
        let c3 = bytes[i++];
        let c4 = bytes[i++];
        let u = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63);
        u -= 0x10000;
        out += String.fromCharCode(0xD800 | (u >> 10));
        out += String.fromCharCode(0xDC00 | (u & 0x3FF));
      }
    }
    return out;
  },

  // 解码提醒名称 - 处理 SDK 返回的 URL 编码字符串
  decodeReminderName(name: any): string {
    if (!name || name === null) return '';
    if (typeof name === 'string') {
      if (name.includes('%')) {
        try {
          return decodeURIComponent(name);
        } catch (e) {
          try {
            const bytes: number[] = [];
            for (let i = 0; i < name.length; i++) {
              if (name[i] === '%' && i + 2 < name.length) {
                const hex = name.substring(i + 1, i + 3);
                const byte = parseInt(hex, 16);
                if (!isNaN(byte)) {
                  bytes.push(byte);
                  i += 2;
                  continue;
                }
              }
              bytes.push(name.charCodeAt(i));
            }
            return this.utf8Decode(new Uint8Array(bytes));
          } catch (e2) {
            console.warn('提醒名称深度解码失败:', name, e2);
            return name;
          }
        }
      }
      return name;
    }
    return String(name);
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    this._tempReminderMap = new Map();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 检查连接状态
    this.checkConnectionStatus();
    // 设置蓝牙数据监听
    this.notifyMonitorValueChange();
    // 读取当前设置
    this.readCurrentSettings();
  },

  /**
   * 检查连接状态
   */
  checkConnectionStatus() {
    const connectionStatus = wx.getStorageSync('connectionStatus');
    this.setData({
      isConnected: !!connectionStatus,
      canSave: !!connectionStatus
    });
  },

  /**
   * 读取当前设置
   */
  readCurrentSettings() {
    if (!this.data.isConnected) return;
    
    // 清空缓存，准备接收新数据
    if (this._tempReminderMap) this._tempReminderMap.clear();
    if (this._commitTimer) clearTimeout(this._commitTimer);

    const data = {
      deviceControl: 'read'
    };
    veepooFeature.veepooSendHealthToastFeatureDataManager(data);
  },



  /**
   * 关闭选定的提醒（读书、吃药、洗手、出行）
   */
  closeSelectedReminders() {
    if (!this.data.isConnected) {
      wx.showToast({
        title: '请先连接设备',
        icon: 'none'
      });
      return;
    }

    this.setData({ isSaving: true, canSave: false });

    // 只关闭这4种提醒类型
    const typesToClose = ['看书', '吃药', '洗手', '出行'];
    let index = 0;

    const closeNext = () => {
      if (index >= typesToClose.length) {
        this.setData({ isSaving: false, canSave: true });
        wx.showToast({
          title: '已关闭提醒',
          icon: 'success'
        });
        return;
      }

      const data = {
        switch: 'stop',
        startTime: this.data.startTime,
        endTime: this.data.endTime,
        intervalTime: String(this.data.intervalTime),
        deviceControl: 'setup',
        deviceType: typesToClose[index]
      };

      veepooFeature.veepooSendHealthToastFeatureDataManager(data);
      index++;
      setTimeout(closeNext, 200);
    };

    closeNext();
  },

  /**
   * 开始时间变化
   */
  onStartTimeChange(e: any) {
    const startTime = e.detail.value;
    this.setData({ startTime });
    this.validateTime();
  },

  /**
   * 结束时间变化
   */
  onEndTimeChange(e: any) {
    const endTime = e.detail.value;
    this.setData({ endTime });
    this.validateTime();
  },

  /**
   * 验证时间范围
   */
  validateTime() {
    const { startTime, endTime } = this.data;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    const timeError = startMinutes >= endMinutes;
    this.setData({ 
      timeError,
      canSave: !timeError && this.data.isConnected
    });
  },

  /**
   * 震动模式选择
   */
  onModeSelect(e: any) {
    const modeId = e.currentTarget.dataset.mode;
    const mode = MODE_LIST.find(m => m.id === modeId);
    
    if (mode) {
      this.setData({
        selectedMode: modeId
        // 不更新 modeDescription，保持隐藏
      });
    }
  },

  /**
   * 滑块拖动中实时更新
   */
  onIntervalChanging(e: any) {
    this.setData({
      intervalTime: e.detail.value
    });
  },

  /**
   * 滑块松手确认
   */
  onIntervalChange(e: any) {
    this.setData({
      intervalTime: e.detail.value
    });
  },

  /**
   * 输入框实时输入
   */
  onIntervalInput(e: any) {
    const val = e.detail.value;
    // 允许输入过程中为空或部分数字，不立即校正
    if (val === '' || val === '0') return;
    const num = parseInt(val);
    if (!isNaN(num)) {
      this.setData({
        intervalTime: num
      });
    }
  },

  /**
   * 输入框失焦时校正范围
   */
  onIntervalInputBlur(e: any) {
    let val = parseInt(e.detail.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 180) val = 180;
    this.setData({
      intervalTime: val
    });
  },

  /**
   * 点击输入区域
   */
  onIntervalInputTap() {
    // 空实现，仅用于事件冒泡处理
  },

  /**
   * 保存设置
   */
  saveSettings() {
    const self = this;
    
    if (!this.data.isConnected) {
      wx.showModal({
        title: '设备未连接',
        content: '保存提醒设置需要连接蓝牙设备。请前往连接页面。',
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

    if (this.data.timeError) {
      wx.showToast({
        title: '请调整时间范围',
        icon: 'none'
      });
      return;
    }

    if (this.data.isSaving) {
      return;
    }

    this.setData({
      isSaving: true,
      canSave: false
    });

    // 保存流程：先关闭所有提醒，然后设置新的提醒
    this.closeAllReminders().then(() => {
      self.setReminder();
    });
  },

  /**
   * 关闭所有提醒
   */
  closeAllReminders(): Promise<void> {
    return new Promise((resolve) => {
      const reminderTypes = ['久坐', '喝水', '远眺', '运动', '吃药', '看书', '出行', '洗手'];
      let index = 0;
      
      const closeNext = () => {
        if (index >= reminderTypes.length) {
          resolve();
          return;
        }
        
        const data = {
          switch: 'stop',
          startTime: this.data.startTime,
          endTime: this.data.endTime,
          intervalTime: String(this.data.intervalTime),
          deviceControl: 'setup',
          deviceType: reminderTypes[index]
        };
        
        veepooFeature.veepooSendHealthToastFeatureDataManager(data);
        index++;
        
        setTimeout(closeNext, 200);
      };
      
      closeNext();
    });
  },

  /**
   * 设置提醒
   */
  setReminder() {
    const self = this;
    const mode = MODE_LIST.find(m => m.id === this.data.selectedMode);
    
    if (!mode) {
      this.finishSave();
      return;
    }

    // 设置第一个提醒
    const data1 = {
      switch: 'start',
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      intervalTime: String(this.data.intervalTime),
      deviceControl: 'setup',
      deviceType: mode.type
    };
    
    veepooFeature.veepooSendHealthToastFeatureDataManager(data1);

    // 如果是双次模式，延迟设置第二个提醒
    if (mode.type2 && mode.delay) {
      setTimeout(() => {
        const data2 = {
          switch: 'start',
          startTime: self.data.startTime,
          endTime: self.data.endTime,
          intervalTime: String(self.data.intervalTime),
          deviceControl: 'setup',
          deviceType: mode.type2
        };
        
        veepooFeature.veepooSendHealthToastFeatureDataManager(data2);
        
        setTimeout(() => {
          self.finishSave();
        }, 500);
      }, mode.delay);
    } else {
      setTimeout(() => {
        self.finishSave();
      }, 500);
    }
  },

  /**
   * 完成保存
   */
  finishSave() {
    this.setData({
      isSaving: false,
      canSave: true
    });

    wx.showToast({
      title: '已保存',
      icon: 'success'
    });
  },

  /**
   * 监听蓝牙数据返回
   */
  notifyMonitorValueChange() {
    const self = this;
    
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function(e: any) {
      console.log('自觉提醒页蓝牙回调:', e);
      if (!e) return;

      // 健康提醒数据 (type = 23)
      if (e.type === 23) {
        const content = e.content;
        if (!content) return;

        // 解码提醒类型名称
        const type = self.decodeReminderName(content.deviceType || content.type || '');
        if (!type) {
          console.warn('收到无类型的提醒数据:', content);
          return;
        }

        // 存入临时 Map
        if (self._tempReminderMap) {
          self._tempReminderMap.set(type, {
            ...content,
            deviceType: type // 使用解码后的名称
          });
        }

        // 开启提交定时器（防抖）
        if (self._commitTimer) clearTimeout(self._commitTimer);
        self._commitTimer = setTimeout(() => {
          self.commitReminders();
        }, 500);
      }
    });
  },

  /**
   * 提交并更新 UI 状态
   */
  commitReminders() {
    const reminders: any[] = Array.from(this._tempReminderMap.values());
    if (reminders.length === 0) return;

    console.log('开始合并提醒数据:', reminders);

    // 构建提醒状态映射：只关心 看书/吃药/出行/洗手 四种类型
    const reminderMap: Record<string, any> = {};
    reminders.forEach((r: any) => {
      reminderMap[r.deviceType] = r;
    });

    const isActive = (type: string) => {
      const r = reminderMap[type];
      return r && (r.deviceControl === true || r.deviceControl === 'start' || r.switch === 'start');
    };

    const bookActive = isActive('看书');
    const medicineActive = isActive('吃药');
    const travelActive = isActive('出行');
    const washActive = isActive('洗手');

    console.log('提醒状态 - 看书:', bookActive, '吃药:', medicineActive, '出行:', travelActive, '洗手:', washActive);

    // 根据开启的状态组合匹配震动模式
    let matchedMode = 'single_soft'; // 默认第一个模式

    if (bookActive && travelActive) {
      matchedMode = 'double_soft';       // 双次柔和：看书 + 出行
    } else if (bookActive && washActive) {
      matchedMode = 'soft_strong';       // 一柔一强：看书 + 洗手
    } else if (medicineActive && washActive) {
      matchedMode = 'double_strong';     // 双次强度：吃药 + 洗手
    } else if (bookActive) {
      matchedMode = 'single_soft';       // 单次柔和：仅看书
    } else if (medicineActive) {
      matchedMode = 'single_strong';     // 单次强度：仅吃药
    }
    // 其他情况（全关或不匹配）默认 single_soft

    // 间隔时间优先级：看书 > 吃药 > 默认30
    let intervalTime = 30;
    if (bookActive && reminderMap['看书']?.intervalTime) {
      intervalTime = parseInt(reminderMap['看书'].intervalTime) || 30;
    } else if (medicineActive && reminderMap['吃药']?.intervalTime) {
      intervalTime = parseInt(reminderMap['吃药'].intervalTime) || 30;
    }

    // 开始/结束时间优先级：看书 > 吃药 > 默认值
    let startTime = '08:00';
    let endTime = '22:00';
    if (bookActive && reminderMap['看书']) {
      startTime = reminderMap['看书'].startTime || startTime;
      endTime = reminderMap['看书'].endTime || endTime;
    } else if (medicineActive && reminderMap['吃药']) {
      startTime = reminderMap['吃药'].startTime || startTime;
      endTime = reminderMap['吃药'].endTime || endTime;
    }

    console.log('匹配结果 - 模式:', matchedMode, '间隔:', intervalTime, '时间:', startTime, '-', endTime);

    this.setData({
      startTime,
      endTime,
      intervalTime,
      selectedMode: matchedMode
    });
    this.validateTime();
  }
});
