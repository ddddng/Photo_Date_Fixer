# Photo Date Fixer

[English](README.md) | **简体中文**

Photo Date Fixer 是一款完全本地运行的桌面工具，通过照片文件名和目录结构推断拍摄日期，再把识别出的时间写入照片内部的 **EXIF 元数据**。项目使用 Tauri 2、React、TypeScript 和 Rust 开发。

[下载最新版](https://github.com/ddddng/Photo_Date_Fixer/releases)
· **GPL-3.0-or-later** · Windows / Linux

## 主要功能

- **四级精度匹配：** 秒 > 分钟 > 小时 > 天。优先选更精确的时间，同精度再比较规则优先级。
- **内置文件名规则：** 支持 `20991231-235959.png`、`IMG_20200111_143025.jpg`，以及 `YYYY-MM-DD` 日期目录。
- **原修改时间精度补全：** 如果原修改时间与规则已确认的日期、小时或分钟一致，可以采用原修改时间中更精确的部分，默认开启。
- **写入前预览：** 按精度、匹配状态和文件名筛选，查看所有候选，以及未匹配和冲突文件。
- **真正写入 EXIF：** 将日期写入照片内部的 `DateTimeOriginal`、`CreateDate`、`ModifyDate`。默认保留原有拍摄时间，需要用户主动允许覆盖。
- **完整撤销：** 修改前在本机保存原照片的完整副本，撤销时校验并恢复原文件内容与修改时间。
- **并行 EXIF 写入：** 使用 1–8 个可配置工作进程，每个进程都有独立、隐藏的常驻 ExifTool。默认使用 4 个，不再让所有照片排成一队串行处理，同时仍保留备份和校验。实际速度取决于图片大小、格式与存储设备。
- **中英文界面：** 首次启动默认英语，可以通过侧边栏切换成简体中文；语言偏好只保存在本机。
- **离线与隐私：** 无账号、无照片上传、无遥测、无硬件识别。

## 下载

GitHub Releases 提供以下发行包：

| 平台 | 文件 |
| --- | --- |
| Windows x64 | Portable ZIP 便携版、EXE 安装版（NSIS）、MSI 安装版 |
| Linux x86-64 | AppImage 便携版、Debian/Ubuntu DEB 安装版 |

发行包已包含 ExifTool。

## 使用步骤

1. 选择照片文件夹并运行**只读扫描**。
2. 在「匹配规则」中管理文件名与目录匹配规则；在「EXIF 与性能设置」中选择 **1–8 个并行工作进程**。
3. 按秒级、分钟级、小时级和天级检查结果，处理未匹配和冲突项。
4. 确认写入 EXIF。原文件副本只保存在本机的应用数据目录，可能占用与原照片相近的空间。
5. 需要时进入「操作与撤销」，恢复原始照片。

支持尝试写入 JPG/JPEG、PNG、HEIC/HEIF、DNG、TIFF、WebP 等图片格式。MP4、MOV 等视频使用 QuickTime 日期元数据，暂未实现视频日期写入。

## 从源码构建

先安装 Node.js、Rust 以及对应系统的 [Tauri 2 构建依赖](https://v2.tauri.app/start/prerequisites/)。
编辑照片需要 ExifTool；自动打包流程会将其包含进安装包。

```sh
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

自动化 EXIF 测试只使用程序生成的合成 PNG，不会读取私人照片。Linux 可用以下命令运行常驻进程测试：

```sh
PHOTO_DATE_FIXER_TEST_EXIFTOOL=/usr/bin/exiftool cargo test --manifest-path src-tauri/Cargo.toml persistent_session_writes_and_reads_two_generated_photos
```

## 贡献、隐私与许可证

请使用虚构路径和合成图片提交测试或问题报告，不要上传真实照片、私人 EXIF、设备详情、本地文件路径、网络地址、凭据，或包含身份信息的日志。

参见 [贡献指南](.github/CONTRIBUTING.md)、[安全说明](.github/SECURITY.md)、
[更新日志](CHANGELOG.md)、[GPL 许可证](LICENSE)和[第三方许可声明](THIRD_PARTY_NOTICES.md)。

本项目源码使用 **GPL-3.0-or-later**。第三方组件保留原许可证；ExifTool 按 Perl 的 Artistic License 或 GPL 条款提供。
