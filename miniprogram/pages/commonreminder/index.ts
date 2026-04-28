// pages/commonReminder/index.ts
import { veepooBle, veepooFeature } from "../../miniprogram_dist/index";

Page({
  /**
   * 页面的初始数据
   */
  data: {
    intervalOptions: ["30", "45", "60", "90", "120", "180"],
    reminders: [
      { type: "久坐", name: "久坐提醒", icon: "sedentary", switch: false, intervalIndex: 0 },
      { type: "喝水", name: "喝水提醒", icon: "water", switch: false, intervalIndex: 0 },
      { type: "远眺", name: "远眺提醒", icon: "eye", switch: false, intervalIndex: 2 },
      { type: "运动", name: "运动提醒", icon: "exercise", switch: false, intervalIndex: 2 }
    ] as any[],
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.notifyMonitorValueChange();
    this.readCurrentSettings();
  },

  /**
   * 读取当前设置
   */
  readCurrentSettings() {
    const types = ["久坐", "喝水", "远眺", "运动"];
    types.forEach((type, index) => {
      setTimeout(() => {
        veepooFeature.veepooSendHealthToastFeatureDataManager({
          deviceControl: "read",
          deviceType: type
        });
      }, index * 300);
    });
  },

  /**
   * 监听蓝牙回调
   */
  notifyMonitorValueChange() {
    const self = this;
    veepooBle.veepooWeiXinSDKNotifyMonitorValueChange(function (e: any) {
      if (!e || e.type !== 23) return;
      
      const content = e.content;
      console.log("常用提醒监听到回调:", e);
      
      const reminders = self.data.reminders.map((item: any) => {
        if (content.deviceType === item.type) {
          const intervalStr = String(content.intervalTime);
          const intervalIndex = self.data.intervalOptions.indexOf(intervalStr);
          return {
            ...item,
            switch: content.deviceControl === "start" || content.deviceControl === true,
            intervalIndex: intervalIndex > -1 ? intervalIndex : item.intervalIndex
          };
        }
        return item;
      });

      self.setData({ reminders });
    });
  },

  /**
   * 开关切换
   */
  onSwitchChange(e: any) {
    const type = e.currentTarget.dataset.type;
    const value = e.detail.value;
    this.updateReminder(type, { switch: value });
  },

  /**
   * 间隔变化
   */
  onIntervalChange(e: any) {
    const type = e.currentTarget.dataset.type;
    const index = e.detail.value;
    this.updateReminder(type, { intervalIndex: index });
  },

  /**
   * 更新提醒设置并下发
   */
  updateReminder(type: string, changes: any) {
    const reminders = this.data.reminders.map((item: any) => {
      if (item.type === type) {
        const newItem = { ...item, ...changes };
        this.sendSetupCommand(newItem);
        return newItem;
      }
      return item;
    });

    this.setData({ reminders });
  },

  /**
   * 下发设置指令
   */
  sendSetupCommand(item: any) {
    const data = {
      switch: item.switch ? "start" : "stop",
      startTime: "00:00",
      endTime: "23:59",
      intervalTime: this.data.intervalOptions[item.intervalIndex],
      deviceControl: "setup",
      deviceType: item.type
    };

    console.log(`下发设置 [${item.name}]:`, data);
    veepooFeature.veepooSendHealthToastFeatureDataManager(data);
    
    wx.showToast({
      title: "已同步到设备",
      icon: "success",
      duration: 1000
    });
  }
});
