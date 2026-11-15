# Photo Date Fixer v0.2.1 — EXIF 写入预览版

## 改动
- 新增 `20991231-235959.png` 内置秒级规则。
- 新增默认开启的精度补全：原修改时间与文件名/目录日期在已有精度内一致时，保留更精确的时间。
- 将修复目标从“仅修改 LastWriteTime”升级为“写入 EXIF 拍摄日期，同时设置文件修改时间”。
- 写入前备份完整原件，写入后回读 EXIF 验证，撤销时恢复备份文件内容。
- 默认保留已有 EXIF 拍摄时间；可在规则页主动开启覆盖。
- 安装包包含离线 ExifTool（Linux 运行需 Perl）。

## 下载
Windows x64：Portable ZIP、NSIS EXE、MSI。
Linux x86-64：AppImage、DEB。
GitHub 本身为 Release 附件显示 SHA-256，不另附校验清单。

## 已知限制
首版 EXIF 写入只针对支持的照片格式；MP4/MOV 视频需另行处理 QuickTime 日期元数据。尚未完成真实照片库批量测试，建议先用少量复制出的照片验证。
