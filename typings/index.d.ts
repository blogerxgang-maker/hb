/// <reference path="./types/index.d.ts" />

type BleManagerEvent =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "scanResult"
  | "reminderUpdate"
  | "screenKillUpdate"
  | "lightUpTimeUpdate";

interface BleManagerLike {
  /** 当前是否已连接（密钥校验通过后才视为 true） */
  isConnected(): boolean;
  /** 当前正在连接的设备信息（含 deviceId / name） */
  getCurrentDevice(): any;
  /** 启动后自动尝试用本地 bleInfo 重连一次 */
  autoReconnectOnLaunch(): void;
  /** 开始扫描，cb 收到 device 数组 / 错误对象 */
  startScan(cb: (devices: any[], err?: any) => void): void;
  /** 停止扫描 */
  stopScan(cb?: () => void): void;
  /** 主动连接指定设备 */
  connect(device: any, cb: (ok: boolean, err?: any) => void): void;
  /** 主动断开 */
  disconnect(): void;
  /** 注册事件监听 */
  on(event: BleManagerEvent, fn: (...args: any[]) => void): () => void;
  /** 一次性的事件监听 */
  once(event: BleManagerEvent, fn: (...args: any[]) => void): () => void;
  /** 内部分发事件，业务一般无需调用 */
  emit(event: BleManagerEvent, ...args: any[]): void;
}

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo;
    bleManager?: BleManagerLike;
  };
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback;
}
