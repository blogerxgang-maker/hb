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

import { veepooFeature } from "../miniprogram_dist/index";
import { getBleManager } from "./bleManager";

export type ReminderType =
  | "久坐"
  | "喝水"
  | "远眺"
  | "运动"
  | "吃药"
  | "看书"
  | "出行"
  | "洗手";

export interface ReminderState {
  on: boolean;
  startTime: string;
  endTime: string;
  intervalTime: number;
}

export interface ReminderTargetMap {
  // 仅包含本次需要 setup 的类型（其他类型不下发）
  [type: string]: ReminderState;
}

export interface ScreenKillTarget {
  on: boolean;
}

export type QueueCommand =
  | { kind: "reminder"; type: ReminderType; state: ReminderState }
  | { kind: "screenKill"; on: boolean };

export interface QueueResult {
  total: number;
  success: number;
  failed: { command: QueueCommand; error: string }[];
}

const ACK_TIMEOUT_MS = 1500;
const DEFAULT_RETRY = 1;
const SEND_GAP_MS = 80; // 两条指令之间的最小间隔，避免 BLE 写入太密

export class ReminderQueue {
  private running = false;

  /** 计算需要下发的差异指令 */
  static computeDiff(
    current: { reminders: Partial<Record<ReminderType, ReminderState>>; screenKillOn: boolean | null },
    target: { reminders: ReminderTargetMap; screenKillOn: boolean | null }
  ): QueueCommand[] {
    const cmds: QueueCommand[] = [];

    Object.keys(target.reminders).forEach((key) => {
      const t = target.reminders[key];
      const c = current.reminders[key as ReminderType];
      if (
        !c ||
        c.on !== t.on ||
        c.startTime !== t.startTime ||
        c.endTime !== t.endTime ||
        c.intervalTime !== t.intervalTime
      ) {
        cmds.push({ kind: "reminder", type: key as ReminderType, state: t });
      }
    });

    if (
      target.screenKillOn !== null &&
      target.screenKillOn !== current.screenKillOn
    ) {
      cmds.push({ kind: "screenKill", on: target.screenKillOn });
    }

    return cmds;
  }

  /** 顺序执行命令；返回结果汇总 */
  async run(commands: QueueCommand[]): Promise<QueueResult> {
    if (this.running) {
      throw new Error("ReminderQueue 正在执行中");
    }
    this.running = true;
    const result: QueueResult = {
      total: commands.length,
      success: 0,
      failed: [],
    };

    try {
      for (const cmd of commands) {
        const bm = getBleManager();
        if (!bm.isConnected()) {
          result.failed.push({ command: cmd, error: "设备已断开连接" });
          // 断开就不再继续，避免后续指令全部失败造成噪音
          break;
        }
        const ok = await this.runOne(cmd, DEFAULT_RETRY);
        if (ok.ok) result.success++;
        else result.failed.push({ command: cmd, error: ok.error || "下发失败" });
        // 间隔
        await sleep(SEND_GAP_MS);
      }
    } finally {
      this.running = false;
    }
    return result;
  }

  private async runOne(
    cmd: QueueCommand,
    retry: number
  ): Promise<{ ok: boolean; error?: string }> {
    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        await this.sendAndWait(cmd);
        return { ok: true };
      } catch (err: any) {
        if (attempt === retry) {
          return { ok: false, error: err && (err.message || String(err)) };
        }
        // 重试前小等一会
        await sleep(150);
      }
    }
    return { ok: false, error: "未知错误" };
  }

  private sendAndWait(cmd: QueueCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      const bm = getBleManager();
      let off = () => undefined as any;
      const timer = setTimeout(() => {
        off();
        reject(new Error("ack_timeout"));
      }, ACK_TIMEOUT_MS);

      if (cmd.kind === "reminder") {
        off = bm.on("reminderUpdate", (content: any) => {
          if (!content) return;
          const t = content.deviceType || content.type;
          // 设备返回的 deviceType 可能是 URL 编码字符串，简单 decode
          let decoded = t;
          if (typeof t === "string" && t.indexOf("%") >= 0) {
            try {
              decoded = decodeURIComponent(t);
            } catch (e) {
              // ignore
            }
          }
          if (decoded === cmd.type) {
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
        } catch (e: any) {
          clearTimeout(timer);
          off();
          reject(e);
        }
      } else if (cmd.kind === "screenKill") {
        off = bm.on("screenKillUpdate", () => {
          clearTimeout(timer);
          off();
          resolve();
        });
        try {
          veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
            control: cmd.on ? 1 : 2,
          });
        } catch (e: any) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 触发一次设备状态读取（提醒 + 常灭屏）。回调由 bleManager 的事件总线分发。 */
export function syncDeviceStateAfterConnect() {
  // 读取所有提醒
  try {
    veepooFeature.veepooSendHealthToastFeatureDataManager({
      deviceControl: "read",
    });
  } catch (e) {
    console.warn("[reminderQueue] 读取提醒失败:", e);
  }

  // 读取常灭屏 (control: 3 = 读取)
  setTimeout(() => {
    try {
      veepooFeature.veepooSetupZT163ScreenKillFunctionManager({ control: 3 });
    } catch (e) {
      console.warn("[reminderQueue] 读取常灭屏失败:", e);
    }
  }, 400);
}
