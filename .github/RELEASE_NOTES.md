# Photo Date Fixer 1.1.1

## English

### Changes

- **Automatic system language on first launch:** the desktop app reads the
  operating system's locale locally. Chinese system languages use Simplified
  Chinese; other languages fall back to English.
- **System language option:** the sidebar now offers System language, English
  and 简体中文. Manually selected languages are saved and take precedence,
  including after upgrading from an earlier version.
- **Minimal OS permission:** only the locale read is enabled. No OS version,
  device identity or other machine data is collected.
- EXIF writing, parallel workers, date matching and local undo remain unchanged.

### Downloads

- Windows x64: portable ZIP, NSIS EXE, MSI.
- Linux x86-64: AppImage, DEB.

---

## 简体中文

### 更新内容

- **首次启动跟随系统语言：** 应用从操作系统读取语言设置。中文系统自动显示简体中文，其他尚未支持的语言默认显示英语。
- **增加「跟随系统」选项：** 侧边栏可选择「跟随系统 / English / 简体中文」。如果用户主动选择语言，该偏好会保存在本机并优先使用，升级后仍然有效。
- **最小系统权限：** 仅允许读取语言代码，不收集系统版本、设备身份或其他电脑信息。
- EXIF 写入、并行工作进程、日期匹配和本地撤销功能保持不变。

### 下载

- Windows x64：Portable ZIP、NSIS EXE、MSI。
- Linux x86-64：AppImage、DEB。
