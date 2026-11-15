//! Local ExifTool adapter. Nothing is uploaded and files are never executed.
use std::{fs::File, io::{BufReader, Read}, path::{Path, PathBuf}, process::Command};
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
    match Command::new(&system).arg("-ver").output() {
        Ok(result) if result.status.success() => Ok(system),
        _ => Err("找不到 ExifTool：请安装 ExifTool，或使用包含 ExifTool 的发行版安装包".into()),
    }
}

fn output(executable: &Path, args: &[&str], file: &Path) -> Result<String, String> {
    let result = Command::new(executable)
        .args(["-charset", "filename=UTF8"])
        .args(args)
        .arg("--")
        .arg(file)
        .output().map_err(|e| format!("无法启动 ExifTool: {e}"))?;
    if !result.status.success() {
        let error = String::from_utf8_lossy(&result.stderr);
        return Err(format!("ExifTool 操作失败: {}", error.chars().take(320).collect::<String>()));
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim().into())
}

pub fn read_datetime_original(executable: &Path, file: &Path) -> Result<Option<String>, String> {
    let content = output(executable, &["-s3", "-EXIF:DateTimeOriginal"], file)?;
    Ok((!content.is_empty()).then_some(content))
}

pub fn write_datetime_original(
    executable: &Path, file: &Path, datetime: &str,
) -> Result<(), String> {
    // A complete original-file backup is saved by the caller BEFORE this command.
    // The -P option preserves filesystem modified time until the caller chooses
    // whether to update it. In-place overwrite preserves Windows creation time.
    let date = chrono::NaiveDateTime::parse_from_str(datetime, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| "无效的目标拍摄日期".to_owned())?
        .format("%Y:%m:%d %H:%M:%S").to_string();
    let tags = [
        format!("-EXIF:DateTimeOriginal={date}"),
        format!("-EXIF:CreateDate={date}"),
        format!("-EXIF:ModifyDate={date}"),
    ];
    let args = [
        "-overwrite_original_in_place", "-P",
        "-api", "LargeFileSupport=1",
        tags[0].as_str(), tags[1].as_str(), tags[2].as_str(),
    ];
    output(executable, &args, file)?;
    let reported = read_datetime_original(executable, file)?;
    if reported.as_deref() != Some(date.as_str()) {
        return Err("写入后读取验证失败：文件内 EXIF 拍摄时间与预期不符".into());
    }
    Ok(())
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
