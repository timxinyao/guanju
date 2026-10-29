[English](en/publishing.md) | [简体中文](publishing.md)

# GitHub 发布与维护

公开仓库地址为 [github.com/timxinyao/guanju](https://github.com/timxinyao/guanju)，克隆地址为 `https://github.com/timxinyao/guanju.git`。创建仓库与首次推送是不同步骤：应以 GitHub 上的文件和提交为准确认推送结果。

## 发布和维护检查

1. 在正式项目目录阅读 `AGENTS.md`、本页及 [SECURITY.zh-CN.md](../SECURITY.zh-CN.md)，并检查 `git status --short`、`git branch --show-current` 和 `git remote -v`。确认 `origin` 指向预期仓库，处理未提交改动和远端已有内容；不要强推覆盖。
2. 审阅待公开文件与历史，确保没有 `firmware/secrets.yaml`、个人 `.bin`/`.elf`、完整配置日志、闪存备份、构建缓存或个人网络资料。
3. 在具备依赖的环境运行 `python tools/verify_project.py --config`，核对下方验证记录与未验证项。推送前完成项目约定的独立审查。
4. 推送后核对 GitHub 的提交、文件、LICENSE、图片、相对链接和 Actions 实际结果，包括默认英文 `README.md`、中文 `README.zh-CN.md` 及双语切换链接。设备网页仍为中文。
5. 需要公开开发归档时，先逐个审阅相应 tag 的内容，再单独推送；不要盲推所有本地 tag。仓库描述应保留 Sony 兼容范围和实机验证限制，不声称所有电视通用或认证安全装置。

## 本地验证记录

2026-10-29 在 macOS、Python 3.13、ESPHome 2026.10.1 环境完成本地检查：

- C++ 控制器 49 项、参数事务 15 项及 HTTP 适配检查通过（ASan/UBSan）；三个 Node.js 网页测试套件通过。
- 验证工具 5 项单元测试、网页 JavaScript 语法、嵌入图标一致性、公开文档相对链接及隐私检查通过。
- 三份 YAML 均以临时示例 secrets 验证通过；`tv-trial.yaml` 以纯示例凭据完整编译成功，RAM 33.4%、Flash 56.8%。未使用或发布个人固件。
- 未进行新一轮硬件烧录、接线/外壳装配、Windows/Linux 操作、其他电视型号或 iPhone 真机测试。装盒尺寸为待实物核对的建议。
- GitHub Actions 的每次运行结果应在对应提交的 Actions 页面核对；本地验证不能代替线上结果。
- 不包含家用真实凭据或个人编译固件；本轮不烧录真实设备。

## 不应公开的内容

真实 secrets 和历史个人日志/备份留在用户私有位置。不要为了“项目完整”把它们复制进 Git。示例文件只提供键名与占位值，每位使用者本地填写、自己编译。
