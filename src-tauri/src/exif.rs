//! Local ExifTool adapter. Nothing is uploaded and files are never executed.
use std::{fs::File, io::{BufReader, Read}, path::{Path, PathBuf}};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// For the first EXIF-writing version, only enable formats whose metadata can
/// be embedded. Videos are intentionally not assigned EXIF tags: MP4/MOV use
/// different QuickTime metadata with different timezone semantics.
pub fn supports_embedded_exif(path: &Path) -> bool {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "heic" | "heif" | "dng" | "tif" | "tiff" | "webp")
}

pub fn locate(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(windows) { "exiftool.exe" } else { "exiftool" };
    let mut paths = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        paths.push(resource.join("exiftool").join(executable));
        paths.push(resource.join("resources").join("exiftool").join(executable));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            paths.push(parent.join("exiftool").join(executable));
        }
    }
    for path in paths {
        if path.is_file() { return Ok(path); }
    }
    let system = PathBuf::from(executable);
    match configure_command(&system)?.arg("-ver").output() {
        Ok(result) if result.status.success() => Ok(system),
        _ => Err("找不到 ExifTool：请安装 ExifTool，或使用包含 ExifTool 的发行版安装包".into()),
    }
}

/// A single ExifTool process serves the whole repair batch. Launching the
/// self-contained Windows runtime per tag is slow and shows console windows.
pub struct Session {
    child: std::process::Child,
    input: std::process::ChildStdin,
    output: std::io::BufReader<std::process::ChildStdout>,
    request_id: u64,
}

fn configure_command(executable: &Path) -> Result<std::process::Command, String> {
    let mut command = std::process::Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash console windows from a GUI app.
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        // The Linux package includes Perl modules beside the ExifTool script.
        if let Some(parent) = executable.parent() {
            let bundled_lib = parent.join("lib");
            if bundled_lib.is_dir() {
                let inherited = std::env::var_os("PERL5LIB").unwrap_or_default();
                let mut paths = vec![bundled_lib];
                paths.extend(std::env::split_paths(&inherited));
                let value = std::env::join_paths(paths).map_err(|e| e.to_string())?;
                command.env("PERL5LIB", value);
            }
        }
    }
    Ok(command)
}

impl Session {
    pub fn new(executable: &Path) -> Result<Self, String> {
        use std::process::Stdio;
        let mut child = configure_command(executable)?
            .args(["-stay_open", "True", "-@", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // ExifTool errors are also checked via response and readback.
            // Don't allow an undrained stderr pipe to block the worker.
            .stderr(Stdio::null())
            .spawn().map_err(|e| format!("启动常驻 ExifTool 失败: {e}"))?;
        let input = child.stdin.take().ok_or("无法连接 ExifTool 的输入通道")?;
        let output = std::io::BufReader::new(child.stdout.take().ok_or("无法连接 ExifTool 的输出通道")?);
        Ok(Self { child, input, output, request_id: 0 })
    }

    fn execute(&mut self, file: &Path, arguments: &[String]) -> Result<String, String> {
        use std::io::{BufRead, Write};
        let filename = file.to_str().ok_or("ExifTool 不能处理当前文件路径的字符编码")?;
        // ExifTool's -@ protocol is newline-delimited. Reject embedded line
        // breaks rather than accidentally treating part of a filename as an
        // ExifTool command.
        if filename.contains(['\r', '\n']) || arguments.iter().any(|arg| arg.contains(['\r', '\n'])) {
            return Err("文件名或 ExifTool 参数不能包含换行符".into());
        }
        self.request_id += 1;
        let end = format!("{{ready{}}}", self.request_id);
        for argument in ["-charset", "filename=UTF8"] {
            writeln!(self.input, "{argument}").map_err(|e| e.to_string())?;
        }
        for argument in arguments {
            writeln!(self.input, "{argument}").map_err(|e| e.to_string())?;
        }
        writeln!(self.input, "--").map_err(|e| e.to_string())?;
        writeln!(self.input, "{filename}").map_err(|e| e.to_string())?;
        writeln!(self.input, "-execute{}", self.request_id).map_err(|e| e.to_string())?;
        self.input.flush().map_err(|e| e.to_string())?;
        let mut result = String::new();
        loop {
            let mut line = String::new();
            let count = self.output.read_line(&mut line).map_err(|e| format!("读取 ExifTool 响应失败: {e}"))?;
            if count == 0 { return Err("ExifTool 工作进程意外退出".into()); }
            if line.trim_end_matches(['\r', '\n']) == end { break; }
            if result.len() + line.len() > 1024 * 1024 {
                return Err("ExifTool 响应超过最大长度，拒绝处理".into());
            }
            result.push_str(&line);
        }
        Ok(result.trim().to_owned())
    }

    pub fn read_datetime_original(&mut self, file: &Path) -> Result<Option<String>, String> {
        let result = self.execute(file, &["-s3".into(), "-EXIF:DateTimeOriginal".into()])?;
        if result.starts_with("Error:") { return Err(result); }
        Ok((!result.is_empty()).then_some(result))
    }

    pub fn write_datetime_original(
        &mut self, file: &Path, datetime: &str, subsecond_nanos: u32,
    ) -> Result<(), String> {
        let date = chrono::NaiveDateTime::parse_from_str(datetime, "%Y-%m-%d %H:%M:%S")
            .map_err(|_| "无效的目标拍摄日期".to_owned())?
            .format("%Y:%m:%d %H:%M:%S").to_string();
        let mut arguments = vec![
            "-overwrite_original_in_place".to_owned(), "-P".to_owned(),
            "-api".to_owned(), "LargeFileSupport=1".to_owned(),
            format!("-EXIF:DateTimeOriginal={date}"),
            format!("-EXIF:CreateDate={date}"),
            format!("-EXIF:ModifyDate={date}"),
        ];
        if subsecond_nanos > 0 {
            let fractional = format!("{subsecond_nanos:09}").trim_end_matches('0').to_owned();
            arguments.push(format!("-EXIF:SubSecTimeOriginal={fractional}"));
            arguments.push(format!("-EXIF:SubSecTimeDigitized={fractional}"));
        }
        let status = self.execute(file, &arguments)?;
        if status.starts_with("Error:") || status.contains("0 image files updated") {
            return Err(format!("ExifTool 写入未成功: {}", status.chars().take(240).collect::<String>()));
        }
        let reported = self.read_datetime_original(file)?;
        if reported.as_deref() != Some(date.as_str()) {
            return Err("写入后 EXIF 拍摄时间回读验证失败".into());
        }
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        use std::io::Write;
        let _ = self.input.write_all(b"-stay_open\nFalse\n");
        let _ = self.input.flush();
        // Shut down promptly even if ExifTool became unresponsive.
        match self.child.try_wait() {
            Ok(Some(_)) => {},
            _ => { let _ = self.child.kill(); let _ = self.child.wait(); },
        }
    }
}

pub fn sha256(file: &Path) -> Result<String, String> {
    let file = File::open(file).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut buffer = [0_u8; 65536];
    let mut sha = Sha256::new();
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        sha.update(&buffer[..n]);
    }
    Ok(format!("{:x}", sha.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_supported_image_formats_are_eligible_for_exif_writing() {
        assert!(supports_embedded_exif(Path::new("picture.png")));
        assert!(supports_embedded_exif(Path::new("picture.HEIC")));
        assert!(supports_embedded_exif(Path::new("picture.jpg")));
        assert!(!supports_embedded_exif(Path::new("clip.mov")));
        assert!(!supports_embedded_exif(Path::new("clip.mp4")));
    }
}
