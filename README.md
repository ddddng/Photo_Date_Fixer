# Photo Date Fixer

完全本地运行的照片日期恢复工具。Tauri 2 + React + TypeScript + Rust。

**当前版本：v0.2.0 开发预览版。**

## 核心功能

- 递归扫描照片与视频文件；扫描本身只读，不上传用户文件。
- 日期候选来源为文件名、父目录；**秒 > 分钟 > 小时 > 天**，同精度按规则优先级匹配。
- 内置 `20991231-235959.png`、`IMG_20200111_143025.jpg` 等秒级文件名规则。
- **默认开启**「原修改时间与规则日期一致时，借用更精确的时分秒」；设置可关闭，且仅在日期/小时/分钟真实一致时采用。
- **执行修复会写入照片内部 EXIF 拍摄日期**（DateTimeOriginal / CreateDate / ModifyDate）；文件系统的最后修改时间也会更新。
- 通过 ExifTool 写入并重新读取验证。已有 EXIF 拍摄日期默认不覆盖，用户可在规则设置中开启覆盖。
- 修改前备份**完整原件**到用户的本地应用数据目录，撤销会恢复原始文件内容和原修改时间，并验证校验值。
- 结果工作台支持精度、状态、文件名筛选；可查看多个日期候选，修复仅作用于当前筛选或选中项。
- JPEG/JPG、PNG、HEIC/HEIF、DNG、TIFF、WebP 可尝试写入 EXIF；视频使用 QuickTime 元数据，不在当前 EXIF 写入范围内，执行时跳过。

## 本地开发

安装 Node.js、Rust、Windows C++ Build Tools / WebView2。开发运行需要本地 ExifTool：
- Windows: 从 [ExifTool](https://exiftool.org/) 下载，放到 PATH，或把 `exiftool.exe` 和 `exiftool_files` 整个目录放进 `src-tauri/resources/exiftool/`。
- Linux: 可以安装 `libimage-exiftool-perl`，提供 `exiftool` 命令。

```sh
npm install
npm run tauri dev
npm run build
cd src-tauri && cargo test && cargo check
```

CI 构建在安装包中自动包含 ExifTool 运行所需文件。Windows portable ZIP 也包含 ExifTool。

## 使用流程

1. 扫描媒体文件夹。
2. 在「匹配规则」确认是否开启原修改时间精度细化、是否覆盖现有 EXIF。
3. 在「结果工作台」按秒/分钟/小时/天和状态筛选，预览预计写入时间。
4. 选择文件后执行。应用将照片的原件完整备份到当前用户的本地应用数据目录，避免向照片文件夹添加 `_original` 文件。
5. 在「操作记录」可撤销：将被修改照片的文件字节与修改时间恢复为原值。

**原件备份可能占用较多本地磁盘空间。** 备份会保留供撤销使用，不会提交到 GitHub 或上传到互联网。

## 目前限制

- 时间匹配仍使用文件名/目录。已有 EXIF 拍摄时间的文件在执行时检查，默认跳过；更全面的扫描时读取与比较未来实现。
- MOV/MP4 等视频没有相同的 EXIF DateTimeOriginal 写入机制，需要独立的 QuickTime 元数据实现。
- ExifTool 逐个读取、写入和验收，处理大量媒体文件的效率有进一步优化空间。
- 尚未完成真实 NAS 大规模文件与全部图片格式实机回归测试。
- 跨平台便携包依赖相应系统运行环境；Linux 需要 Perl 才能运行捆绑的 ExifTool 脚本。

## 隐私与开源

应用不采集硬件、系统、网络/IP 等诊断资料。扫描路径、照片与 EXIF 写入撤销副本只保存在本机；导出 CSV 由用户明确选择目标路径。

**禁止把真实照片、用户路径、EXIF 内容、备份、日志、硬件信息和身份相关数据提交到本仓库。**

MIT 许可证见 [LICENSE](LICENSE)。内嵌 ExifTool 由其作者发布，附带原许可文件。

发布包的 SHA-256 校验值由 GitHub Releases 原生展示，不额外附带 `SHA256SUMS.txt`。
