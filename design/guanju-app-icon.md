# 观距主屏幕图标

使用内置 image_gen 生成，原图 `guanju-app-icon.png`；通过系统sips按iOS技术规格缩放导出 `../firmware/ui/apple-touch-icon.png`（180×180、RGB、无透明通道），不改变设计内容。墨绿色背景、浅色电视与雷达波，外边保持正方形，圆角由iOS系统裁切。

生成用完整提示词：

> Use case: logo-brand. Produce the final iPhone Home Screen app icon for the Chinese smart TV proximity app 观距 (do NOT render any text). A beautiful understated Apple-native utility app emblem. Square full-bleed opaque canvas, no transparency, no pre-rounded outer corners, no phone mockup, no border or surrounding white margin. Deep moss green background #42654e, subtle tasteful matte luminous depth. Centered warm-white thin-but-confident rounded TV outline with elegant two short feet/base, stylized three concentric radar arcs emanating from a small central dot just beneath/within lower half of TV. Form one coherent memorable symbol implying television and distance sensing, optically balanced and highly recognizable at 60px. TV occupies about 60% width; generous 18% padding. Radar arcs integrated beautifully into the screen silhouette, no WiFi logo ambiguity dominating. Premium minimalist iOS app icon, refined geometry, smooth rounded strokes with even weight, restrained white/light-sage marks, slight softly recessed depth allowed, no skeuomorphic plastic, no 3D perspective. No letters, no words, no numbers, no T, no child/face/sofa, no tiny detail, no extra pictograms, no Apple logo, no glass glare. Final asset clean crisp high-resolution square PNG, intended to be rasterized to 180x180 for apple-touch-icon. The canvas itself must remain square; iOS applies corner masking.

更新位图后运行：`python3 tools/embed_app_icon.py firmware/ui/apple-touch-icon.png firmware/tv_trial_app_icon_data.h`，再正常编译固件。不要只替换本地PNG而忘记生成嵌入数据。
