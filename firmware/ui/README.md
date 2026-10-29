# 观距界面

`app.js` 和 `app.css` 由 ESPHome 内嵌并从设备提供，不依赖 CDN、外网或 Mac 常驻。网页在执行 JavaScript 后动态添加标题、viewport 和 iOS 网页应用元数据；首次 HTML 解析时这些标签尚不存在，添加到主屏幕的名称、图标和全屏效果需要在实际 iOS 设备上验证。图标改为设备端真实180×180 PNG：显式链接 `/apple-touch-icon-v1.png`，同时提供 `/apple-touch-icon.png` 和 precomposed 默认发现路径；不再依赖 data URL SVG。已有T主屏幕图标需要移除后，在Safari加载新版页面并重新添加；iPhone最终采纳效果仍需真机确认。

使用真实且可见的 `<input type="checkbox" switch>`；通过 `HTMLInputElement.prototype` 的 `switch` 属性检测原生支持。支持时保留原生外观和触感，不支持时在同一输入控件上绘制胶囊开关。WebKit 的 IDL 将该属性与开关功能设置绑定；实际 iOS Safari 外观与触感仍须真机验证。自动功能开关代表用户意图，`Trial Monitoring` 才表示实际正在监测。没有有效数据时显示未知；不将雷达残留距离当作人的当前距离。设备详情展示诊断状态，供排查使用。

更新与电视控制依赖设备端实际状态；自动重连与回前台只同步状态；右上刷新按钮重新加载整个网页，开关和恢复操作等待设备回读。自动息屏恢复时间为雷达延时、应用计时和通信时间之和，现场需校准。安全区通过 CSS env() 适配，浏览器和主屏幕模式的效果需要实机检查。

状态派生和心跳超时边界可用 `node firmware/ui/state.test.cjs` 检查；请求正文超时与响应乱序可用 `node firmware/ui/network.test.cjs` 检查。这些测试不代替浏览器、设备或 iOS 真机验证。

参数页面读取 `/settings` 中最后验证并保存的值；草稿只在页面内保留，版本变化时提示重新加载。提交后需等设备回读并保存，收到接受响应不代表已生效。参数更新时监测会暂停，失败或结果不明时以设备状态为准。旧固件返回 404 时提示更新，主页不假设默认距离。参数协议测试可运行 `node firmware/ui/settings.test.cjs`。
