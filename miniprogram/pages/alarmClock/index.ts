// pages/alarmClock/index.ts
import { veepooBle, veepooFeature } from '../../miniprogram_dist/index'

Page({
  /**
   * 页面的初始数据
   */
  data: {
    connectedMac: '',
    alarmList: [] as any[],
    syncStatus: '未同步',
    showModal: false,
    isEdit: false,
    editingAlarm: {} as any,
    weekDays: [
      { label: '一', key: 'Monday' },
      { label: '二', key: 'Tuesday' },
      { label: '三', key: 'Wednesday' },
      { label: '四', key: 'Thursday' },
      { label: '五', key: 'Friday' },
      { label: '六', key: 'Saturday' },
      { label: '日', key: 'Sunday' }
    ]
  },

  // 内部变量，用于合并多批次回调
  _tempAlarmMap: null as any,
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
        if (i >= bytes.length) {
          out += '?';
          break;
        }
        let c2 = bytes[i++];
        out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      } else if (c > 223 && c < 240) {
        if (i + 1 >= bytes.length) {
          out += '?';
          break;
        }
        let c2 = bytes[i++];
        let c3 = bytes[i++];
        out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      } else if (c > 239 && c < 248) {
        if (i + 2 >= bytes.length) {
          out += '?';
          break;
        }
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

  // 统计 UTF-8 字节长度（避免依赖 TextEncoder）
  getUtf8ByteLength(text: string): number {
    const encoded = encodeURIComponent(text);
    let len = 0;
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === '%') {
        len++;
        i += 2;
      } else {
        len++;
      }
    }
    return len;
  },

  // 解码闹钟名称 - 处理 SDK 返回的 URL 编码字符串
  decodeAlarmName(name: any): string {
    if (!name || name === null) return '';
    
    if (name instanceof ArrayBuffer) {
      return this.utf8Decode(new Uint8Array(name));
    }
    if (name instanceof Uint8Array) {
      return this.utf8Decode(name);
    }
    if (Array.isArray(name) && name.every((item) => typeof item === 'number')) {
      return this.utf8Decode(new Uint8Array(name));
    }

    if (typeof name === 'string') {
      // 增加原始数据日志
      console.log('[Debug] 原始闹钟名称:', name);

      let normalized = name;
      if (/%u[0-9a-fA-F]{4}/.test(normalized)) {
        normalized = normalized.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
      }

      if (normalized.includes('%')) {
        let decoded = normalized;
        let prev = '';
        let count = 0;
        try {
          // 尝试循环解码，处理可能的多次编码
          while (decoded.includes('%') && decoded !== prev && count < 3) {
            prev = decoded;
            decoded = decodeURIComponent(decoded);
            count++;
          }
          console.log('[Debug] decodeURIComponent 解码结果:', decoded);
        } catch (e) {
          // ignore and fallback to manual decode below
        }

        if (decoded.includes('%') || decoded === normalized) {
          // 处理解码不完整或解码器容错返回原串的情况
          try {
            const bytes: number[] = [];
            for (let i = 0; i < normalized.length; i++) {
              if (normalized[i] === '%' && i + 2 < normalized.length) {
                const hex = normalized.substring(i + 1, i + 3);
                const byte = parseInt(hex, 16);
                if (!isNaN(byte)) {
                  bytes.push(byte);
                  i += 2;
                  continue;
                }
              }
              bytes.push(normalized.charCodeAt(i));
            }
            
            const manualDecoded = this.utf8Decode(new Uint8Array(bytes));
            console.log('[Debug] 手动 utf8Decode 解码结果:', manualDecoded);
            return manualDecoded || name;
          } catch (e2) {
            console.warn('闹钟名称深度解码失败:', name, e2);
            return name;
          }
        }

        return decoded;
      } else if (normalized !== name) {
        return normalized;
      } else {
        // 检查是否为 "二进制字符串" (UTF-8 bytes interpreted as Latin-1)
        // 特征：包含 128-255 范围的字符，且没有 > 255 的字符 (通常)
        let hasHighByte = false;
        let allLatin1 = true;
        const bytes: number[] = [];
        
        for (let i = 0; i < name.length; i++) {
          const code = name.charCodeAt(i);
          if (code > 255) {
            allLatin1 = false;
            break;
          }
          if (code >= 128) {
            hasHighByte = true;
          }
          bytes.push(code);
        }

        if (allLatin1 && hasHighByte) {
          try {
            const manualDecoded = this.utf8Decode(new Uint8Array(bytes));
            console.log('[Debug] 二进制字符串解码结果:', manualDecoded);
            // 如果解码后的字符串长度变短了，说明确实发生了多字节合并，很可能是正确的
            if (manualDecoded.length < name.length) {
              return manualDecoded;
            }
          } catch (e) {
            console.warn('二进制字符串尝试解码失败:', e);
          }
        }
      }
      return name;
    }
    return String(name);
  },

  onLoad() {
    this._tempAlarmMap = new Map();
  },

  onShow() {
    const mac = wx.getStorageSync('connectedMac');
    this.setData({ connectedMac: mac });
    this.notifyMonitorValueChange();
    this.readAlarms();
  },

  // 读取闹钟
  readAlarms() {
    const self = this;
    const connectionStatus = wx.getStorageSync('connectionStatus');
    if (!connectionStatus) {
      this.setData({ syncStatus: '未连接' });
      return;
    }

    // 清空缓存，准备接收新数据
    if (this._tempAlarmMap) this._tempAlarmMap.clear();
    if (this._commitTimer) clearTimeout(this._commitTimer);

    this.setData({ syncStatus: '正在同步...' });
    console.log("正在调用 veepooSendReadAlarmClockDataManager...");
    veepooFeature.veepooSendReadAlarmClockDataManager();
  },

  // 监听蓝牙回调
  notifyMonitorValueChange() {
    const self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      if (!e) return;
      console.log("闹钟页面监听到回调:", e);
      
      if (e.type === 13) { // 文字闹钟回调
        if (e.name === "读取文字闹钟") {
          const list = e.content || [];
          console.log("收到闹钟批次，数量:", list.length);
          
          // 将闹钟存入 Map 进行合并和去重
          list.forEach((item: any) => {
            // 确保 alarmId 存在（支持 ID 0）
            const id = (item.alarmId !== undefined && item.alarmId !== null) ? item.alarmId : -1;
            if (id !== -1 && self._tempAlarmMap) {
              self._tempAlarmMap.set(id, item);
            }
          });

          // 防抖提交，增加到 1200ms，因为 SDK 回调可能非常慢
          if (self._commitTimer) clearTimeout(self._commitTimer);
          self._commitTimer = setTimeout(() => {
            if (!self._tempAlarmMap) return;
            const allAlarms = Array.from(self._tempAlarmMap.values());
            console.log("合并后总闹钟数量:", allAlarms.length);

            const processedList = allAlarms.map((item: any) => {
              const decodedName = self.decodeAlarmName(item.name);
              const displayName =
                !decodedName || decodedName === '?' ? '文字提醒' : decodedName;
              return {
                ...item,
                name: displayName,
                repeatDesc: self.getRepeatDesc(item.alarmRepeat)
              };
            });

            // 按 ID 排序
            processedList.sort((a, b) => a.alarmId - b.alarmId);

            self.setData({
              alarmList: processedList,
              syncStatus: processedList.length > 0 ? '同步成功' : '暂无闹钟'
            });
          }, 1200);

        } else if (e.name === "设置文字闹钟" || e.name === "删除文字闹钟") {
          wx.showToast({
            title: '操作成功',
            icon: 'success'
          });
          setTimeout(() => {
            self.readAlarms();
          }, 500);
        }
      }
    });
  },

  // 获取重复周期描述
  getRepeatDesc(repeat: any) {
    if (!repeat) return '不重复';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const activeDays = days.filter(d => (repeat as any)[d]);
    
    if (activeDays.length === 7) return '每天';
    if (activeDays.length === 0) return '不重复';
    
    const isWorkday = days.slice(0, 5).every(d => (repeat as any)[d]) && !(repeat as any).Saturday && !(repeat as any).Sunday;
    if (isWorkday) return '工作日';
    
    const isWeekend = !days.slice(0, 5).some(d => (repeat as any)[d]) && (repeat as any).Saturday && (repeat as any).Sunday;
    if (isWeekend) return '周末';
    
    return activeDays.map(d => labels[days.indexOf(d)]).join(' ');
  },

  // 添加闹钟
  onAddAlarm() {
    if (this.data.alarmList.length >= 10) {
      wx.showToast({
        title: '闹钟已满',
        icon: 'none'
      });
      return;
    }

    this.setData({
      isEdit: false,
      showModal: true,
      editingAlarm: {
        alarmId: this.getNextAlarmId(),
        time: '08:00',
        name: '',
        alarmSwitch: true,
        alarmRepeat: {
          Monday: true,
          Tuesday: true,
          Wednesday: true,
          Thursday: true,
          Friday: true,
          Saturday: true,
          Sunday: true
        }
      }
    });
  },

  // 获取下一个可用的闹钟ID
  getNextAlarmId() {
    const ids = this.data.alarmList.map(a => a.alarmId);
    for (let i = 0; i <= 10; i++) {
      if (!ids.includes(i)) return i;
    }
    return 1;
  },

  // 编辑闹钟
  onEditAlarm(e: any) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      isEdit: true,
      showModal: true,
      editingAlarm: JSON.parse(JSON.stringify(item))
    });
  },

  // 切换闹钟开关
  onToggleAlarm(e: any) {
    const connectionStatus = wx.getStorageSync('connectionStatus');
    if (!connectionStatus) {
      wx.showToast({
        title: '请先连接设备',
        icon: 'none'
      });
      return;
    }

    const item = e.currentTarget.dataset.item;
    const newValue = !item.alarmSwitch;
    
    const data = {
      alarmId: item.alarmId,
      switch: newValue,
      time: item.time,
      alarmRepeat: item.alarmRepeat,
      name: item.name
    };
    
    this.setData({ syncStatus: '正在处理...' });
    veepooFeature.veepooSendSetAlarmClockDataManager(data);
  },

  // 删除闹钟
  onDeleteAlarm(e: any) {
    const connectionStatus = wx.getStorageSync('connectionStatus');
    if (!connectionStatus) {
      wx.showToast({
        title: '请先连接设备',
        icon: 'none'
      });
      return;
    }

    const item = e.currentTarget.dataset.item;
    const self = this;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个闹钟吗？',
      success(res) {
        if (res.confirm) {
          self.setData({ syncStatus: '正在处理...' });
          veepooFeature.veepooSendDeleteAlarmClockDataManager({
            alarmId: item.alarmId,
            switch: item.alarmSwitch,
            time: item.time,
            alarmRepeat: item.alarmRepeat
          });
        }
      }
    });
  },

  // 弹窗事件处理
  onTimeChange(e: any) {
    this.setData({
      'editingAlarm.time': e.detail.value
    });
  },

  onNameInput(e: any) {
    this.setData({
      'editingAlarm.name': e.detail.value
    });
  },

  onToggleRepeat(e: any) {
    const key = e.currentTarget.dataset.key;
    const current = (this.data.editingAlarm.alarmRepeat as any)[key];
    this.setData({
      [`editingAlarm.alarmRepeat.${key}`]: !current
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onConfirmSave() {
    const alarm = this.data.editingAlarm;
    if (!alarm.name.trim()) {
      wx.showToast({
        title: '请输入闹钟标签',
        icon: 'none'
      });
      return;
    }

    // 校验 UTF-8 字节长度（设备限制通常为 36 字节）
    const byteLength = this.getUtf8ByteLength(alarm.name);
    if (byteLength > 36) {
      wx.showToast({
        title: '标签内容过长，请精简',
        icon: 'none'
      });
      return;
    }

    const connectionStatus = wx.getStorageSync('connectionStatus');
    if (!connectionStatus) {
      wx.showModal({
        title: '设备未连接',
        content: '保存闹钟需要连接蓝牙设备。请前往连接页面。',
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

    const data = {
      alarmId: alarm.alarmId,
      switch: alarm.alarmSwitch,
      time: alarm.time,
      alarmRepeat: alarm.alarmRepeat,
      name: alarm.name
    };

    console.log("保存闹钟，数据:", JSON.stringify(data));

    this.setData({ 
      syncStatus: '正在处理...',
      showModal: false
    });
    veepooFeature.veepooSendSetAlarmClockDataManager(data);
  },

  preventTouchMove() {}
})
