import { veepooJLBle } from "./jieli_sdk/bleInit"
const vpJLBle = new veepooJLBle();

// 全局注入分享逻辑
const originalPage = Page;
// @ts-ignore
Page = (options: any) => {
  // 注入转发功能
  const originalOnShareAppMessage = options.onShareAppMessage;
  options.onShareAppMessage = function (res: any) {
    if (originalOnShareAppMessage) {
      return originalOnShareAppMessage.call(this, res);
    }
    return {
      title: '让心回来',
      imageUrl: '/image/share.jpg',
      path: this.route ? `/${this.route}` : '/pages/connect/index'
    };
  };

  // 注入分享到朋友圈功能
  const originalOnShareTimeline = options.onShareTimeline;
  options.onShareTimeline = function () {
    if (originalOnShareTimeline) {
      return originalOnShareTimeline.call(this);
    }
    return {
      title: '让心回来',
      query: '', // 可以根据需要传递参数
      imageUrl: '/image/share.jpg'
    };
  };

  return originalPage(options);
};

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 补丁：修复 SDK 内部 uint8ArrayToString 在处理非 UTF-8 字节时抛出 URIError 的问题
    const originalDecode = decodeURIComponent;
    (globalThis as any).decodeURIComponent = function (s: string) {
      try {
        return originalDecode(s);
      } catch (e) {
        return s; // 解码失败时返回原始字符串，防止崩溃，不再打印警告减少噪音
      }
    };

    // 初始化连接状态为 false，等待连接页面确认真实连接后才设为 true
    wx.setStorageSync('connectionStatus', false)
    vpJLBle.init();
  },
})

