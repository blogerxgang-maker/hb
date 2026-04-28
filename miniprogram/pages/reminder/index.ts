// pages/reminder/index.ts
//
// 提醒下发 + 常灭屏 设置页（核心页之一）。
//
// 状态同步：所有 UI 状态都以 bleManager 的事件回调为准；连接成功后会通过
// syncDeviceStateAfterConnect 触发一次设备读取。
//
// 下发流程：基于 ReminderQueue 的指令队列，先 diff 再下发，支持 ack 等待 + 重试。

import { veepooFeature } from "../../miniprogram_dist/index";
import { getBleManager } from "../../utils/bleManager";
import {
  ReminderQueue,
  ReminderState,
  ReminderType,
  syncDeviceStateAfterConnect,
} from "../../utils/reminderQueue";

// 震动模式定义；保持与原版一致
const MODE_LIST: Array<{
  id: string;
  name: string;
  desc: string;
  type: ReminderType;
  type2?: ReminderType;
}> = [
  {
    id: "single_soft",
    name: "单次柔和",
    desc: "下发【看书提醒】",
    type: "看书",
  },
  {
    id: "single_strong",
    name: "单次强度",
    desc: "下发【吃药提醒】",
    type: "吃药",
  },
  {
    id: "double_soft",
    name: "双次柔和",
    desc: "下发【看书提醒】+【出行提醒】",
    type: "看书",
    type2: "出行",
  },
  {
    id: "soft_strong",
    name: "一柔一强",
    desc: "下发【看书提醒】+【洗手提醒】",
    type: "看书",
    type2: "洗手",
  },
  {
    id: "double_strong",
    name: "双次强度",
    desc: "下发【吃药提醒】+【洗手提醒】",
    type: "吃药",
    type2: "洗手",
  },
];

const ALL_REMINDER_TYPES: ReminderType[] = [
  "看书",
  "吃药",
  "出行",
  "洗手",
  // 旧版本中下发过的类型也加入清空范围，避免设备残留
  "久坐",
  "喝水",
  "远眺",
  "运动",
];

const bm = getBleManager();
const queue = new ReminderQueue();

Page({
  data: {
    isConnected: false,
    syncing: false,
    isSaving: false,
    canSave: false,

    startTime: "08:00",
    endTime: "22:00",
    timeError: false,
    selectedMode: "single_soft",
    modeList: MODE_LIST,
    intervalTime: 30,

    alwaysOff: false,
    alwaysOffText: "已关闭",
  },

  // 内部缓存：来自设备回调的最新状态，作为 diff 基线
  _currentReminders: {} as Partial<Record<ReminderType, ReminderState>>,
  _currentScreenKill: null as boolean | null,

  // 防抖收集设备回调
  _reminderUpdateTimer: null as any,

  // 事件取消句柄
  _offConnected: null as null | (() => void),
  _offDisconnected: null as null | (() => void),
  _offReminder: null as null | (() => void),
  _offScreenKill: null as null | (() => void),

  onLoad() {
    this.bindManagerEvents();
  },

  onShow() {
    const connected = bm.isConnected();
    this.setData({
      isConnected: connected,
      canSave: connected && !this.data.timeError,
    });
    if (connected) {
      this.startSync();
    }
  },

  onUnload() {
    if (this._offConnected) this._offConnected();
    if (this._offDisconnected) this._offDisconnected();
    if (this._offReminder) this._offReminder();
    if (this._offScreenKill) this._offScreenKill();
    if (this._reminderUpdateTimer) clearTimeout(this._reminderUpdateTimer);
  },

  // ---------- 事件订阅 ----------

  bindManagerEvents() {
    this._offConnected = bm.on("connected", () => {
      this.setData({ isConnected: true, canSave: !this.data.timeError });
      this.startSync();
    });
    this._offDisconnected = bm.on("disconnected", () => {
      this.setData({
        isConnected: false,
        canSave: false,
        syncing: false,
      });
    });
    this._offReminder = bm.on("reminderUpdate", (content: any) => {
      this.handleReminderCallback(content);
    });
    this._offScreenKill = bm.on("screenKillUpdate", (content: any) => {
      this.handleScreenKillCallback(content);
    });
  },

  startSync() {
    this._currentReminders = {};
    this._currentScreenKill = null;
    this.setData({ syncing: true });
    syncDeviceStateAfterConnect();
    // 即使设备回调有缺失，也在 2.5s 后结束 syncing 占位态，避免一直 loading
    setTimeout(() => {
      if (this.data.syncing) this.setData({ syncing: false });
    }, 2500);
  },

  // ---------- 回调处理 ----------

  handleReminderCallback(content: any) {
    if (!content) return;
    const rawType = content.deviceType || content.type || "";
    let type = rawType;
    if (typeof rawType === "string" && rawType.indexOf("%") >= 0) {
      try {
        type = decodeURIComponent(rawType);
      } catch (e) {
        // 保持原值
      }
    }
    if (!type) return;

    const isOn =
      content.deviceControl === "start" ||
      content.deviceControl === true ||
      content.switch === "start" ||
      content.switch === true;

    const interval = parseInt(String(content.intervalTime || "30"), 10);
    this._currentReminders[type as ReminderType] = {
      on: !!isOn,
      startTime: content.startTime || "08:00",
      endTime: content.endTime || "22:00",
      intervalTime: isNaN(interval) ? 30 : interval,
    };

    // 防抖一次性更新 UI
    if (this._reminderUpdateTimer) clearTimeout(this._reminderUpdateTimer);
    this._reminderUpdateTimer = setTimeout(() => {
      this.applyCurrentRemindersToUI();
      this.setData({ syncing: false });
    }, 400);
  },

  handleScreenKillCallback(content: any) {
    if (!content) return;
    const isOn =
      content.status === 1 || content.control === 1 || content.switch === true;
    this._currentScreenKill = !!isOn;
    this.setData({
      alwaysOff: !!isOn,
      alwaysOffText: isOn ? "已开启" : "已关闭",
    });
  },

  /**
   * 把 _currentReminders 反映到 UI（震动模式 / 时间 / 间隔）
   */
  applyCurrentRemindersToUI() {
    const map = this._currentReminders;
    const isActive = (t: ReminderType) => !!(map[t] && map[t]!.on);

    const bookActive = isActive("看书");
    const medicineActive = isActive("吃药");
    const travelActive = isActive("出行");
    const washActive = isActive("洗手");

    let matchedMode = this.data.selectedMode;
    if (bookActive && travelActive) matchedMode = "double_soft";
    else if (bookActive && washActive) matchedMode = "soft_strong";
    else if (medicineActive && washActive) matchedMode = "double_strong";
    else if (bookActive) matchedMode = "single_soft";
    else if (medicineActive) matchedMode = "single_strong";

    let intervalTime = this.data.intervalTime;
    let startTime = this.data.startTime;
    let endTime = this.data.endTime;
    const baseline = bookActive
      ? map["看书"]
      : medicineActive
      ? map["吃药"]
      : null;
    if (baseline) {
      intervalTime = baseline.intervalTime || 30;
      startTime = baseline.startTime || startTime;
      endTime = baseline.endTime || endTime;
    }

    this.setData({
      selectedMode: matchedMode,
      intervalTime,
      startTime,
      endTime,
    });
    this.validateTime();
  },

  // ---------- 表单交互 ----------

  onStartTimeChange(e: any) {
    this.setData({ startTime: e.detail.value });
    this.validateTime();
  },

  onEndTimeChange(e: any) {
    this.setData({ endTime: e.detail.value });
    this.validateTime();
  },

  validateTime() {
    const { startTime, endTime } = this.data;
    const [sh, sm] = startTime.split(":").map((s) => parseInt(s, 10));
    const [eh, em] = endTime.split(":").map((s) => parseInt(s, 10));
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const timeError = startMin >= endMin;
    this.setData({
      timeError,
      canSave: !timeError && this.data.isConnected,
    });
  },

  onModeSelect(e: any) {
    const modeId = e.currentTarget.dataset.mode;
    if (MODE_LIST.find((m) => m.id === modeId)) {
      this.setData({ selectedMode: modeId });
    }
  },

  onIntervalChanging(e: any) {
    this.setData({ intervalTime: e.detail.value });
  },

  onIntervalChange(e: any) {
    this.setData({ intervalTime: e.detail.value });
  },

  onIntervalInput(e: any) {
    const val = e.detail.value;
    if (val === "" || val === "0") return;
    const num = parseInt(val, 10);
    if (!isNaN(num)) this.setData({ intervalTime: num });
  },

  onIntervalInputBlur(e: any) {
    let val = parseInt(e.detail.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 180) val = 180;
    this.setData({ intervalTime: val });
  },

  onIntervalInputTap() {
    // no-op
  },

  /**
   * 常灭屏开关变化
   */
  onAlwaysOffChange(e: any) {
    if (!this.data.isConnected) {
      wx.showToast({ title: "请先连接设备", icon: "none" });
      // 把视觉状态还原成最近一次设备值
      this.setData({
        alwaysOff: !!this._currentScreenKill,
        alwaysOffText: this._currentScreenKill ? "已开启" : "已关闭",
      });
      return;
    }
    const value = !!e.detail.value;
    // 视觉先标灰为「设置中」，但不切换 alwaysOff，等待回调
    wx.showLoading({ title: value ? "开启中…" : "关闭中…", mask: true });

    queue
      .run([{ kind: "screenKill", on: value }])
      .then((result) => {
        wx.hideLoading();
        if (result.success === 1) {
          // 成功：UI 由 screenKillUpdate 回调更新
          wx.showToast({
            title: value ? "已开启常灭屏" : "已关闭常灭屏",
            icon: "success",
          });
        } else {
          wx.showToast({
            title: "设置失败，请重试",
            icon: "none",
          });
          // 还原 UI
          this.setData({
            alwaysOff: !!this._currentScreenKill,
            alwaysOffText: this._currentScreenKill ? "已开启" : "已关闭",
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: "设置失败：" + (err && err.message), icon: "none" });
        this.setData({
          alwaysOff: !!this._currentScreenKill,
          alwaysOffText: this._currentScreenKill ? "已开启" : "已关闭",
        });
      });
  },

  /**
   * 保存提醒设置（只下发实际有变化的指令）
   */
  saveSettings() {
    if (!this.data.isConnected) {
      wx.showModal({
        title: "设备未连接",
        content: "保存提醒设置需要先连接设备。",
        confirmText: "去连接",
        confirmColor: "#4DB6AC",
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: "/pages/connect/index" });
          }
        },
      });
      return;
    }
    if (this.data.timeError) {
      wx.showToast({ title: "请调整时间范围", icon: "none" });
      return;
    }
    if (this.data.isSaving) return;

    const mode = MODE_LIST.find((m) => m.id === this.data.selectedMode);
    if (!mode) {
      wx.showToast({ title: "未选择震动模式", icon: "none" });
      return;
    }

    // 构造 4 类核心提醒的目标状态：mode 对应的 type/type2 开启，其他 3 类关闭
    const activeTypes = new Set<ReminderType>();
    activeTypes.add(mode.type);
    if (mode.type2) activeTypes.add(mode.type2);

    const baseState: ReminderState = {
      on: false,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      intervalTime: this.data.intervalTime,
    };

    const target: Record<string, ReminderState> = {};
    ALL_REMINDER_TYPES.forEach((t) => {
      target[t] = { ...baseState, on: activeTypes.has(t) };
    });

    const diff = ReminderQueue.computeDiff(
      {
        reminders: this._currentReminders,
        screenKillOn: this._currentScreenKill,
      },
      {
        reminders: target,
        // 不在保存按钮里改常灭屏；保持当前值（null 表示不下发）
        screenKillOn: null,
      }
    );

    if (diff.length === 0) {
      wx.showToast({ title: "已经是最新状态", icon: "success" });
      return;
    }

    this.setData({ isSaving: true, canSave: false });
    queue
      .run(diff)
      .then((result) => {
        this.setData({ isSaving: false, canSave: !this.data.timeError });

        // 下发成功后，乐观更新本地基线：失败的指令不更新
        const failedSet = new Set(
          result.failed.map((f) => JSON.stringify(f.command))
        );
        diff.forEach((cmd) => {
          if (failedSet.has(JSON.stringify(cmd))) return;
          if (cmd.kind === "reminder") {
            this._currentReminders[cmd.type] = { ...cmd.state };
          }
        });

        if (result.failed.length === 0) {
          wx.showToast({ title: "保存成功", icon: "success" });
        } else {
          const failedTypes = result.failed
            .map((f) =>
              f.command.kind === "reminder" ? f.command.type : "常灭屏"
            )
            .join("、");
          wx.showModal({
            title: "部分项下发失败",
            content: `失败：${failedTypes}\n请检查设备连接后重试。`,
            showCancel: false,
            confirmColor: "#4DB6AC",
          });
        }
      })
      .catch((err) => {
        this.setData({ isSaving: false, canSave: !this.data.timeError });
        wx.showToast({ title: "保存失败：" + (err && err.message), icon: "none" });
      });
  },

  /**
   * 关闭 4 类核心提醒
   */
  closeSelectedReminders() {
    if (!this.data.isConnected) {
      wx.showToast({ title: "请先连接设备", icon: "none" });
      return;
    }
    if (this.data.isSaving) return;

    const baseState: ReminderState = {
      on: false,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      intervalTime: this.data.intervalTime,
    };

    const types: ReminderType[] = ["看书", "吃药", "出行", "洗手"];
    const target: Record<string, ReminderState> = {};
    types.forEach((t) => (target[t] = { ...baseState }));

    const diff = ReminderQueue.computeDiff(
      {
        reminders: this._currentReminders,
        screenKillOn: this._currentScreenKill,
      },
      { reminders: target, screenKillOn: null }
    );

    if (diff.length === 0) {
      wx.showToast({ title: "提醒已是关闭状态", icon: "success" });
      return;
    }

    this.setData({ isSaving: true, canSave: false });
    queue
      .run(diff)
      .then((result) => {
        this.setData({ isSaving: false, canSave: !this.data.timeError });
        if (result.failed.length === 0) {
          wx.showToast({ title: "已关闭提醒", icon: "success" });
          types.forEach((t) => (this._currentReminders[t] = { ...baseState }));
        } else {
          wx.showToast({ title: "部分关闭失败，请重试", icon: "none" });
        }
      })
      .catch((err) => {
        this.setData({ isSaving: false, canSave: !this.data.timeError });
        wx.showToast({ title: "关闭失败：" + (err && err.message), icon: "none" });
      });
  },

  /**
   * 主动重新读取设备状态（暴露给 UI 的「同步」按钮，可选）
   */
  refreshFromDevice() {
    if (!this.data.isConnected) return;
    this.startSync();
  },

  // 兼容：保留 veepooFeature 引用，避免被 ts 当成未使用
  _ensureSdkRef() {
    return veepooFeature;
  },
});
