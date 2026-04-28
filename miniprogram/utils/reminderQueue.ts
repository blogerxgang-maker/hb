// miniprogram/utils/reminderQueue.ts
//
// 提醒指令队列：
//  - 顺序下发（前一条 ack 或超时后再发下一条）
//  - 按 deviceType 等待对应回调；常灭屏走 screenKillUpdate 事件
//  - 自动重试（默认 1 次）
//  - 失败汇总返回，便于 UI 展示
//
// 调用方需先确保 BLE 已连接（bleManager.isConnected() === true）。
// 队列与连接状态独立；如果在执行过程中检测到断开，会立即终止当前 batch。
//
// 注意：避免使用 TS-only 语法（type 别名 / interface / 参数类型注解 / 泛型 / as），
// 以兼容某些 IDE 真机调试时 Babel 没启用 TS preset 的解析路径。
// @ts-nocheck

import { veepooFeature } from "../miniprogram_dist/index";
import { getBleManager } from "./bleManager";

const ACK_TIMEOUT_MS = 1500;
const DEFAULT_RETRY = 1;
const SEND_GAP_MS = 80;

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

export class ReminderQueue {
  constructor() {
    this.running = false;
  }

  // 计算需要下发的差异指令
  // current: { reminders: { [type]: { on, startTime, endTime, intervalTime } }, screenKillOn }
  // target:  { reminders: { [type]: { on, startTime, endTime, intervalTime } }, screenKillOn }
  static computeDiff(current, target) {
    const cmds = [];
    const tReminders = (target && target.reminders) || {};
    const cReminders = (current && current.reminders) || {};

    Object.keys(tReminders).forEach(function (key) {
      const t = tReminders[key];
      const c = cReminders[key];
      if (
        !c ||
        c.on !== t.on ||
        c.startTime !== t.startTime ||
        c.endTime !== t.endTime ||
        c.intervalTime !== t.intervalTime
      ) {
        cmds.push({ kind: "reminder", type: key, state: t });
      }
    });

    if (
      target &&
      target.screenKillOn !== null &&
      typeof target.screenKillOn !== "undefined" &&
      target.screenKillOn !== current.screenKillOn
    ) {
      cmds.push({ kind: "screenKill", on: target.screenKillOn });
    }

    return cmds;
  }

  // 顺序执行命令；返回结果汇总 { total, success, failed: [{command, error}] }
  run(commands) {
    if (this.running) {
      return Promise.reject(new Error("ReminderQueue 正在执行中"));
    }
    this.running = true;
    const self = this;
    const result = {
      total: commands.length,
      success: 0,
      failed: [],
    };

    function step(i) {
      if (i >= commands.length) {
        self.running = false;
        return Promise.resolve(result);
      }
      const cmd = commands[i];
      const bm = getBleManager();
      if (!bm.isConnected()) {
        result.failed.push({ command: cmd, error: "设备已断开连接" });
        // 断开就不再继续，避免后续指令全部失败造成噪音
        self.running = false;
        return Promise.resolve(result);
      }
      return self.runOne(cmd, DEFAULT_RETRY).then(function (ok) {
        if (ok.ok) result.success++;
        else
          result.failed.push({
            command: cmd,
            error: ok.error || "下发失败",
          });
        return sleep(SEND_GAP_MS).then(function () {
          return step(i + 1);
        });
      });
    }

    return step(0).catch(function (e) {
      self.running = false;
      throw e;
    });
  }

  runOne(cmd, retry) {
    const self = this;
    function attempt(n) {
      return self.sendAndWait(cmd).then(
        function () {
          return { ok: true };
        },
        function (err) {
          if (n >= retry) {
            return {
              ok: false,
              error: err && (err.message || String(err)),
            };
          }
          return sleep(150).then(function () {
            return attempt(n + 1);
          });
        }
      );
    }
    return attempt(0);
  }

  sendAndWait(cmd) {
    return new Promise(function (resolve, reject) {
      const bm = getBleManager();
      let off = function () {};
      const timer = setTimeout(function () {
        off();
        reject(new Error("ack_timeout"));
      }, ACK_TIMEOUT_MS);

      if (cmd.kind === "reminder") {
        off = bm.on("reminderUpdate", function (content) {
          if (!content) return;
          let t = content.deviceType || content.type;
          // 设备返回的 deviceType 可能是 URL 编码字符串，简单 decode
          if (typeof t === "string" && t.indexOf("%") >= 0) {
            try {
              t = decodeURIComponent(t);
            } catch (e) {
              // ignore
            }
          }
          if (t === cmd.type) {
            clearTimeout(timer);
            off();
            resolve();
          }
        });
        try {
          veepooFeature.veepooSendHealthToastFeatureDataManager({
            switch: cmd.state.on ? "start" : "stop",
            startTime: cmd.state.startTime,
            endTime: cmd.state.endTime,
            intervalTime: String(cmd.state.intervalTime),
            deviceControl: "setup",
            deviceType: cmd.type,
          });
        } catch (e) {
          clearTimeout(timer);
          off();
          reject(e);
        }
      } else if (cmd.kind === "screenKill") {
        off = bm.on("screenKillUpdate", function () {
          clearTimeout(timer);
          off();
          resolve();
        });
        try {
          veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
            control: cmd.on ? 1 : 2,
          });
        } catch (e) {
          clearTimeout(timer);
          off();
          reject(e);
        }
      } else {
        clearTimeout(timer);
        reject(new Error("unsupported command"));
      }
    });
  }
}

// 触发一次设备状态读取（提醒 + 常灭屏）。回调由 bleManager 的事件总线分发。
export function syncDeviceStateAfterConnect() {
  try {
    veepooFeature.veepooSendHealthToastFeatureDataManager({
      deviceControl: "read",
    });
  } catch (e) {
    console.warn("[reminderQueue] 读取提醒失败:", e);
  }

  // 读取常灭屏 (control: 3 = 读取)
  setTimeout(function () {
    try {
      veepooFeature.veepooSetupZT163ScreenKillFunctionManager({ control: 3 });
    } catch (e) {
      console.warn("[reminderQueue] 读取常灭屏失败:", e);
    }
  }, 400);
}
