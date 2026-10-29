[English](en/publishing.md) | [简体中文](publishing.md)

# GitHub 发布交接

此仓库在本地准备；创建 GitHub 仓库、设置远端和首次推送由另一个 agent 在用户授权下完成。不要将创建远端仓库等同于已推送本地源码，也不要未经确认覆盖已有远端内容。

## 接手步骤

1. 以用户提供的**正式项目目录**为工作目录，阅读 `AGENTS.md`、本页及 `SECURITY.md`。
2. 核对本地状态：

   ```sh
   git status --short
   git branch --show-current
   git log -3 --oneline
   git remote -v
   ```

   应在 `main`，没有未处理改动；本轮不预设 GitHub 组织或仓库 URL。
3. 用用户选定的 GitHub 账户创建空仓库。已有 README/LICENSE 的远端并非空仓库，先核对差异，不能强推覆盖。
4. 审阅待公开文件与历史，确保没有 `firmware/secrets.yaml`、个人 `.bin`/`.elf`、完整配置日志、闪存备份、构建缓存或个人网络资料。
5. 在具备依赖的环境运行 `python tools/verify_project.py --config`，核对下方验证记录与未验证项。
6. 由实际返回的仓库 URL 设置远端。以下仅是模板，不得把占位 URL 当成真实目的地：

   ```sh
   git remote add origin <用户授权的仓库URL>
   git push -u origin main
   ```

   只有不存在 origin 时才能 add；已有 origin 应先核对归属。需要保留开发归档历史时，可在确认相应 tag 内容适合公开后单独推送 `archive/open-source-readiness`；不盲推所有本地 tag。
7. 核对 GitHub 文件、LICENSE、图片、相对链接和 CI 结果，包括默认英文 `README.md`、中文 `README.zh-CN.md` 及双语切换链接。设备网页仍为中文。仓库介绍可写“ESP32-C3 + LD2410C 的电视近距息屏助手，设备托管中文网页”；不要写“所有电视通用”或“可靠儿童保护”。

## 本地验证记录

2026-10-29 在 macOS、Python 3.13、ESPHome 2026.10.1 环境完成本地检查：

- C++ 控制器 49 项、参数事务 15 项及 HTTP 适配检查通过（ASan/UBSan）；三个 Node.js 网页测试套件通过。
- 验证工具 5 项单元测试、网页 JavaScript 语法、嵌入图标一致性、公开文档相对链接及隐私检查通过。
- 三份 YAML 均以临时示例 secrets 验证通过；`tv-trial.yaml` 以纯示例凭据完整编译成功，RAM 33.4%、Flash 56.8%。未使用或发布个人固件。
- 未进行新一轮硬件烧录、接线/外壳装配、Windows/Linux 操作、其他电视型号或 iPhone 真机测试。装盒尺寸为待实物核对的建议。
- GitHub Actions：待远端创建并首次运行后确认。
- 不包含家用真实凭据或个人编译固件；本轮不烧录真实设备。

## 不应公开的内容

真实 secrets 和历史个人日志/备份留在用户私有位置。不要为了“项目完整”把它们复制进 Git。示例文件只提供键名与占位值，每位使用者本地填写、自己编译。
