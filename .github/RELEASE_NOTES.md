# Photo Date Fixer 1.1.0

## English

### What's new

- **Parallel EXIF repairs:** 1–8 independent persistent ExifTool workers
  (4 by default). Different photos can now be backed up, written, verified
  and hashed concurrently rather than sharing a single processing queue.
  User-selected concurrency is stored locally; adjust it for your storage.
- **English and Simplified Chinese UI:** English is the initial interface
  language, with a persistent language switch in the sidebar. All principal
  workspace, rule editor, results, operation and confirmation screens have
  bilingual labels and help text.
- **Bilingual documentation:** English README first, separate Chinese README,
  and bilingual release notes, with English followed by Chinese.
- **Original-file backups and verified undo are preserved.** Performance
  work does not disable EXIF readback verification or file integrity checks.

### Downloads

- **Windows x64:** portable ZIP, NSIS EXE installer, and MSI installer.
- **Linux x86-64:** AppImage and Debian/Ubuntu DEB.
- Bundled ExifTool. GitHub displays SHA-256 hashes for the uploaded assets.

### Notes

EXIF writing covers supported photo formats, including JPEG, PNG, HEIC,
DNG, TIFF and WebP. MP4/MOV QuickTime metadata writing is not yet included.
Performance depends on photo formats, sizes and storage; no fixed throughput
is promised. Local backups occupy additional disk space.

---

## 简体中文

### 本次更新

- **并行 EXIF 修复：** 提供 1–8 个独立常驻 ExifTool 工作进程，默认 4 个。
  不同照片的原件备份、EXIF 写入、回读验证和文件哈希可以并行执行，
  不再由一个工作进程逐张排队。并行度可以根据磁盘或网络存储调整。
- **中英文界面：** 首次使用默认英语，侧边栏可以切换为简体中文，语言
  偏好保存在本机。扫描、规则编辑、结果筛选、执行撤销和确认提示均已适配。
- **双语文档：** 英文 README 作为首页，附独立中文 README；
  Release 说明采用英文在前、中文在后的顺序。
- **完整备份和可验证撤销保留：** 性能优化没有移除 EXIF 回读验证或文件完整性检查。

### 下载

- **Windows x64：** Portable ZIP、NSIS EXE 安装版、MSI 安装版。
- **Linux x86-64：** AppImage、Debian/Ubuntu DEB。
- 已附带 ExifTool。下载附件的 SHA-256 可直接在 GitHub 查看。

### 说明

支持为 JPEG、PNG、HEIC、DNG、TIFF、WebP 等图片写入 EXIF；
暂不写入 MP4/MOV 视频的 QuickTime 拍摄时间。实际处理速度受图片
格式、大小及存储设备影响，不承诺固定吞吐量。完整原件备份需要额外空间。
