use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike};
mod exif;
use filetime::{set_file_mtime, FileTime};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    id: String,
    name: String,
    precision: u8, // 4 second, 3 minute, 2 hour, 1 day
    source: String, // filename, directory
    pattern: String,
    format: String,
    priority: i32, // smaller wins, ties with differing dates are conflicts
    enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    rule_id: String,
    rule_name: String,
    source: String,
    precision: u8,
    priority: i32,
    date: String,
    epoch: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRow {
    id: usize,
    path: String,
    name: String,
    size: u64,
    original: String,
    modified_seconds: i64,
    modified_nanos: u32,
    status: String, // matched, conflict, unmatched, invalid
    selected: Option<Candidate>,
    candidates: Vec<Candidate>,
    warning: Option<String>,
    refined_from_mtime: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    preserve_precise_mtime: bool,
}

impl Default for Settings {
    fn default() -> Self { Self { preserve_precise_mtime: true } }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    total: usize,
    matched: usize,
    conflict: usize,
    unmatched: usize,
    errors: usize,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    rows: Vec<FileRow>,
    total: usize,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ResultCounts {
    all: usize,
    second: usize,
    minute: usize,
    hour: usize,
    day: usize,
    unmatched: usize,
    conflict: usize,
    invalid: usize,
}

// Matched files use their winning precision. Conflicts and invalid timestamps
// remain visible within their highest-precision candidate group.
fn result_precision(row: &FileRow) -> Option<u8> {
    row.selected.as_ref().map(|c| c.precision)
        .or_else(|| row.candidates.iter().map(|c| c.precision).max())
}

fn row_matches(row: &FileRow, status: &str, precision: Option<u8>, needle: &str) -> bool {
    (status == "all" || row.status == status)
        && precision.is_none_or(|p| result_precision(row) == Some(p))
        && (needle.is_empty() || row.path.to_lowercase().contains(needle))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalItem {
    path: String,
    size: u64,
    before_seconds: i64,
    before_nanos: u32,
    target_seconds: i64,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    id: String,
    status: String,
    items: Vec<JournalItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResult {
    id: String,
    succeeded: usize,
    failed: usize,
    skipped: usize,
}

#[derive(Default)]
struct Runtime {
    files: Mutex<Vec<FileRow>>,
    root: Mutex<Option<PathBuf>>,
    rules: Mutex<Vec<Rule>>,
    settings: Mutex<Settings>,
    cancel: AtomicBool,
}

fn default_rules() -> Vec<Rule> {
    let data = [
        ("name-seconds-compact", "文件名：年月日_时分秒", 4, "filename", r"(?P<date>\d{8}_\d{6})", "%Y%m%d_%H%M%S", 10),
        ("name-seconds-dashed", "文件名：连字符日期时间", 4, "filename", r"(?P<date>\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})", "%Y-%m-%d_%H-%M-%S", 20),
        ("name-seconds-compact-hyphen", "文件名：年月日-时分秒（20991231-235959）", 4, "filename", r"(?P<date>\d{8}-\d{6})(?:[^\d]|$)", "%Y%m%d-%H%M%S", 15),
        ("name-minutes", "文件名：精确到分钟", 3, "filename", r"(?P<date>\d{8}_\d{4})(?:[^\d]|$)", "%Y%m%d_%H%M", 10),
        ("name-hours", "文件名：精确到小时", 2, "filename", r"(?P<date>\d{8}_\d{2})(?:[^\d]|$)", "%Y%m%d_%H", 10),
        ("name-days-dashed", "文件名：年月日", 1, "filename", r"(?P<date>\d{4}-\d{2}-\d{2})", "%Y-%m-%d", 10),
        ("name-days-compact", "文件名：八位日期", 1, "filename", r"(?P<date>\d{8})(?:[^\d]|$)", "%Y%m%d", 20),
        ("directory-days", "父目录：年月日", 1, "directory", r"^(?P<date>\d{4}-\d{2}-\d{2})$", "%Y-%m-%d", 30),
    ];
    data.into_iter().map(|(id,name,precision,source,pattern,format,priority)| Rule {
        id: id.into(), name: name.into(), precision, source: source.into(),
        pattern: pattern.into(), format: format.into(), priority, enabled: true,
    }).collect()
}

fn parse_date(raw: &str, fmt: &str, precision: u8) -> Option<NaiveDateTime> {
    match precision {
        4 => NaiveDateTime::parse_from_str(raw, fmt).ok(),
        3 => NaiveDateTime::parse_from_str(&format!("{raw}:00"), &format!("{fmt}:%S")).ok(),
        2 => NaiveDateTime::parse_from_str(&format!("{raw}:00:00"), &format!("{fmt}:%M:%S")).ok(),
        1 => NaiveDate::parse_from_str(raw, fmt).ok()?.and_hms_opt(12, 0, 0),
        _ => None,
    }
}

fn epoch_local(date: NaiveDateTime) -> Option<i64> {
    Local.from_local_datetime(&date).single().map(|value| value.timestamp())
}

fn choose_candidates(candidates: &[Candidate]) -> (String, Option<Candidate>, Option<String>) {
    if candidates.is_empty() { return ("unmatched".into(), None, None); }
    let best_precision = candidates.iter().map(|c| c.precision).max().unwrap_or(0);
    let matching: Vec<&Candidate> = candidates.iter().filter(|c| c.precision == best_precision).collect();
    let best_priority = matching.iter().map(|c| c.priority).min().unwrap_or(0);
    let top: Vec<&Candidate> = matching.into_iter().filter(|c| c.priority == best_priority).collect();
    let distinct: HashSet<&str> = top.iter().map(|c| c.date.as_str()).collect();
    if distinct.len() > 1 {
        return ("conflict".into(), None, Some("同精度、同优先级的规则给出了不同日期".into()));
    }
    let chosen = (*top[0]).clone();
    if chosen.epoch.is_none() {
        return ("invalid".into(), None, Some("日期在当前时区无唯一有效时间点".into()));
    }
    ("matched".into(), Some(chosen), None)
}

// The original modification timestamp may be more precise than the winning
// rule. Only borrow its finer fields if the timestamp agrees at the rule's
// real precision. The winning rule/precision are kept for auditing.
fn refine_with_mtime(
    selection: Option<Candidate>, 
    seconds: i64,
    enabled: bool,
) -> (Option<Candidate>, bool) {
    let Some(mut selected) = selection else { return (None, false) };
    if !enabled || selected.precision == 4 { return (Some(selected), false); }
    let Some(original) = chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0)
        .map(|v| v.with_timezone(&Local).naive_local()) else { return (Some(selected), false); };
    let Ok(candidate) = NaiveDateTime::parse_from_str(&selected.date, "%Y-%m-%d %H:%M:%S") else {
        return (Some(selected), false);
    };
    let same = match selected.precision {
        1 => candidate.date() == original.date(),
        2 => candidate.date() == original.date() && candidate.hour() == original.hour(),
        3 => candidate.date() == original.date() && candidate.hour() == original.hour() && candidate.minute() == original.minute(),
        _ => false,
    };
    if same && Some(seconds) != selected.epoch {
        selected.epoch = Some(seconds);
        selected.date = original.format("%Y-%m-%d %H:%M:%S").to_string();
        return (Some(selected), true);
    }
    (Some(selected), false)
}

fn get_candidates(path: &Path, root: &Path, compiled: &[(Rule, Regex)]) -> Vec<Candidate> {
    let mut out = Vec::new();
    let filename = path.file_stem().and_then(|v| v.to_str()).unwrap_or("");
    for (rule, re) in compiled {
        let strings: Vec<String> = if rule.source == "filename" {
            vec![filename.to_owned()]
        } else if rule.source == "directory" {
            let mut names = Vec::new();
            let mut ancestor = path.parent();
            while let Some(dir) = ancestor {
                if !dir.starts_with(root) { break; }
                if let Some(name) = dir.file_name().and_then(|s| s.to_str()) { names.push(name.to_owned()); }
                if dir == root { break; }
                ancestor = dir.parent();
            }
            names
        } else { continue };
        // For each rule, the nearest matching directory wins.
        for text in strings {
            if let Some(caps) = re.captures(&text) {
                if let Some(value) = caps.name("date").or_else(|| caps.get(1)) {
                    if let Some(dt) = parse_date(value.as_str(), &rule.format, rule.precision) {
                        out.push(Candidate {
                            rule_id: rule.id.clone(), rule_name: rule.name.clone(),
                            source: rule.source.clone(), precision: rule.precision, priority: rule.priority,
                            date: dt.format("%Y-%m-%d %H:%M:%S").to_string(),
                            epoch: epoch_local(dt),
                        });
                        break;
                    }
                }
            }
        }
    }
    out
}

fn compile_rules(rules: &[Rule]) -> Result<Vec<(Rule, Regex)>, String> {
    rules.iter().filter(|r| r.enabled).map(|rule| {
        if !(1..=4).contains(&rule.precision) { return Err(format!("规则 {} 的精度无效", rule.name)); }
        if !["filename", "directory"].contains(&rule.source.as_str()) {
            return Err(format!("规则 {} 的来源无效", rule.name));
        }
        let compiled = Regex::new(&rule.pattern).map_err(|e| format!("规则 {}: {e}", rule.name))?;
        if !rule.pattern.contains("?P<date>") && compiled.captures_len() < 2 {
            return Err(format!("规则 {} 必须包含命名捕获组 (?P<date>...) 或普通捕获组", rule.name));
        }
        Ok((rule.clone(), compiled))
    }).collect()
}

fn media_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else { return false; };
    matches!(ext.to_ascii_lowercase().as_str(),
        "jpg"|"jpeg"|"png"|"heic"|"heif"|"dng"|"raw"|"cr2"|"cr3"|"nef"|"arw"|"webp"|"gif"|"tif"|"tiff"|
        "mp4"|"mov"|"m4v"|"avi"|"mkv"|"flv"|"3gp"|"mts"|"m2ts")
}

fn excluded(entry: &walkdir::DirEntry) -> bool {
    if entry.path_is_symlink() { return true; }
    let name = entry.file_name().to_string_lossy().to_lowercase();
    !["@eadir", "thumbs.db", "desktop.ini", ".ds_store"].contains(&name.as_str())
}

fn scan_sync(app: AppHandle, runtime: Arc<Runtime>, root: String) -> Result<Summary, String> {
    let root = PathBuf::from(root).canonicalize().map_err(|e| format!("无法访问目录: {e}"))?;
    if !root.is_dir() { return Err("请选择文件夹".into()); }
    let rules = runtime.rules.lock().map_err(|e| e.to_string())?.clone();
    let compiled = compile_rules(&rules)?;
    let preserve_mtime = runtime.settings.lock().map_err(|e| e.to_string())?.preserve_precise_mtime;
    runtime.cancel.store(false, Ordering::Relaxed);
    // Store results only in memory. No scanned path is ever sent to a remote service.
    runtime.files.lock().map_err(|e| e.to_string())?.clear();
    *runtime.root.lock().map_err(|e| e.to_string())? = Some(root.clone());
    let mut rows = Vec::new();
    let mut errors = 0;
    let mut cancelled = false;
    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_entry(excluded) {
        if runtime.cancel.load(Ordering::Relaxed) { cancelled = true; break; }
        let entry = match entry { Ok(e) => e, Err(_) => { errors += 1; continue; } };
        if !entry.file_type().is_file() || !media_extension(entry.path()) { continue; }
        let metadata = match entry.metadata() { Ok(m) => m, Err(_) => { errors += 1; continue; } };
        let stamp = FileTime::from_last_modification_time(&metadata);
        let original = chrono::DateTime::<chrono::Utc>::from_timestamp(stamp.unix_seconds(), stamp.nanoseconds())
            .map(|v| v.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default();
        let candidates = get_candidates(entry.path(), &root, &compiled);
        let (status, selected, warning) = choose_candidates(&candidates);
        let (selected, refined_from_mtime) = refine_with_mtime(selected, stamp.unix_seconds(), preserve_mtime);
        rows.push(FileRow {
            id: rows.len(), path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            size: metadata.len(), original, modified_seconds: stamp.unix_seconds(),
            modified_nanos: stamp.nanoseconds(), status, selected, candidates, warning,
            refined_from_mtime,
        });
        if rows.len() % 100 == 0 {
            let _ = app.emit("scan-progress", rows.len());
        }
    }
    let summary = Summary {
        total: rows.len(),
        matched: rows.iter().filter(|r| r.status == "matched").count(),
        conflict: rows.iter().filter(|r| r.status == "conflict").count(),
        unmatched: rows.iter().filter(|r| r.status == "unmatched").count(),
        errors, cancelled,
    };
    *runtime.files.lock().map_err(|e| e.to_string())? = rows;
    Ok(summary)
}

fn local_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn atomic_json<T: Serialize>(file: &Path, value: &T) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let temp = file.with_extension("writing");
    fs::write(&temp, body).map_err(|e| e.to_string())?;
    fs::rename(&temp, file).map_err(|e| e.to_string())
}

fn journal_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !Uuid::parse_str(id).is_ok() { return Err("无效操作编号".into()); }
    let dir = local_dir(app)?.join("operations");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

#[tauri::command]
async fn start_scan(app: AppHandle, state: State<'_, Arc<Runtime>>, root: String) -> Result<Summary, String> {
    let runtime = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || scan_sync(app, runtime, root))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_scan(state: State<'_, Arc<Runtime>>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn get_files(state: State<'_, Arc<Runtime>>, offset: usize, limit: usize, status: String, precision: Option<u8>, search: String) -> Result<Page, String> {
    if precision.is_some_and(|p| !(1..=4).contains(&p)) { return Err("不支持的日期精度".into()); }
    let files = state.files.lock().map_err(|e| e.to_string())?;
    let needle = search.to_lowercase();
    let filtered = files.iter().filter(|row| row_matches(row, &status, precision, &needle));
    let total = filtered.clone().count();
    let rows = filtered.skip(offset).take(limit.min(500)).cloned().collect();
    Ok(Page { rows, total })
}

#[tauri::command]
fn get_result_counts(state: State<'_, Arc<Runtime>>) -> Result<ResultCounts, String> {
    let files = state.files.lock().map_err(|e| e.to_string())?;
    let mut counts = ResultCounts { all: files.len(), ..ResultCounts::default() };
    for row in files.iter() {
        match result_precision(row) {
            Some(4) => counts.second += 1,
            Some(3) => counts.minute += 1,
            Some(2) => counts.hour += 1,
            Some(1) => counts.day += 1,
            _ => {},
        }
        match row.status.as_str() {
            "unmatched" => counts.unmatched += 1,
            "conflict" => counts.conflict += 1,
            "invalid" => counts.invalid += 1,
            _ => {},
        }
    }
    Ok(counts)
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<Runtime>>) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, Arc<Runtime>>, settings: Settings) -> Result<(), String> {
    atomic_json(&local_dir(&app)?.join("settings.json"), &settings)?;
    *state.settings.lock().map_err(|e| e.to_string())? = settings;
    Ok(())
}

#[tauri::command]
fn get_rules(state: State<'_, Arc<Runtime>>) -> Result<Vec<Rule>, String> {
    Ok(state.rules.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn save_rules(app: AppHandle, state: State<'_, Arc<Runtime>>, rules: Vec<Rule>) -> Result<(), String> {
    compile_rules(&rules)?;
    let mut ids = HashSet::new();
    for rule in &rules {
        if !ids.insert(rule.id.as_str()) { return Err("规则 ID 重复".into()); }
    }
    atomic_json(&local_dir(&app)?.join("rules.json"), &rules)?;
    *state.rules.lock().map_err(|e| e.to_string())? = rules;
    Ok(())
}

#[tauri::command]
fn rematch(state: State<'_, Arc<Runtime>>) -> Result<Summary, String> {
    let rules = state.rules.lock().map_err(|e| e.to_string())?.clone();
    let compiled = compile_rules(&rules)?;
    let preserve_mtime = state.settings.lock().map_err(|e| e.to_string())?.preserve_precise_mtime;
    let mut rows = state.files.lock().map_err(|e| e.to_string())?;
    let root = state.root.lock().map_err(|e| e.to_string())?.clone();
    for row in rows.iter_mut() {
        let path = Path::new(&row.path);
        let scan_root = root.as_deref().unwrap_or_else(|| path.parent().unwrap_or(path));
        row.candidates = get_candidates(path, scan_root, &compiled);
        let (status, selected, warning) = choose_candidates(&row.candidates);
        let (selected, refined) = refine_with_mtime(selected, row.modified_seconds, preserve_mtime);
        row.status = status; row.selected = selected; row.warning = warning;
        row.refined_from_mtime = refined;
    }
    Ok(Summary {
        total: rows.len(), matched: rows.iter().filter(|r| r.status == "matched").count(),
        conflict: rows.iter().filter(|r| r.status == "conflict").count(),
        unmatched: rows.iter().filter(|r| r.status == "unmatched").count(),
        errors: 0, cancelled: false,
    })
}

fn apply_changes_sync(app: AppHandle, runtime: Arc<Runtime>, ids: Vec<usize>, status: String, precision: Option<u8>, search: String) -> Result<OperationResult, String> {
    let files = runtime.files.lock().map_err(|e| e.to_string())?;
    let filter: HashSet<usize> = ids.into_iter().collect();
    let needle = search.to_lowercase();
    let items: Vec<JournalItem> = files.iter().filter(|row| {
        row.status == "matched" &&
            (if filter.is_empty() {
                row_matches(row, &status, precision, &needle)
            } else {
                filter.contains(&row.id)
            })
    }).filter_map(|row| {
        let target = row.selected.as_ref()?.epoch?;
        Some(JournalItem {
            path: row.path.clone(), size: row.size,
            before_seconds: row.modified_seconds, before_nanos: row.modified_nanos,
            target_seconds: target, status: "pending".into(), error: None,
        })
    }).collect();
    drop(files);
    if items.is_empty() { return Err("没有可执行的匹配文件".into()); }
    let id = Uuid::new_v4().to_string();
    let path = journal_path(&app, &id)?;
    let mut journal = Journal { id: id.clone(), status: "running".into(), items };
    // Write-ahead journal: original timestamps are on disk before the first file changes.
    atomic_json(&path, &journal)?;
    let mut succeeded = 0;
    let mut failed = 0;
    let skipped = 0;
    for index in 0..journal.items.len() {
        let item = &mut journal.items[index];
        let outcome = (|| -> Result<(), String> {
            let meta = fs::symlink_metadata(&item.path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() { return Err("拒绝操作符号链接".into()); }
            if !meta.is_file() || meta.len() != item.size { return Err("文件大小已改变".into()); }
            let now = FileTime::from_last_modification_time(&meta);
            if now.unix_seconds() != item.before_seconds || now.nanoseconds() != item.before_nanos {
                return Err("文件最后修改时间已被外部更改".into());
            }
            set_file_mtime(&item.path, FileTime::from_unix_time(item.target_seconds, 0)).map_err(|e| e.to_string())?;
            let after = FileTime::from_last_modification_time(&fs::metadata(&item.path).map_err(|e| e.to_string())?);
            if after.unix_seconds() != item.target_seconds { return Err("文件系统未保存预期时间".into()); }
            Ok(())
        })();
        match outcome {
            Ok(()) => { item.status = "applied".into(); succeeded += 1; }
            Err(e) => { item.status = "failed".into(); item.error = Some(e); failed += 1; }
        }
        if (index + 1) % 500 == 0 { atomic_json(&path, &journal)?; }
        let _ = app.emit("operation-progress", index + 1);
    }
    journal.status = "completed".into();
    atomic_json(&path, &journal)?;
    Ok(OperationResult { id, succeeded, failed, skipped })
}


#[tauri::command]
async fn apply_changes(app: AppHandle, state: State<'_, Arc<Runtime>>, ids: Vec<usize>, status: String, precision: Option<u8>, search: String) -> Result<OperationResult, String> {
    let runtime = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || apply_changes_sync(app, runtime, ids, status, precision, search))
        .await.map_err(|e| e.to_string())?
}

fn undo_sync(app: AppHandle, id: String) -> Result<OperationResult, String> {
    let path = journal_path(&app, &id)?;
    let mut journal: Journal = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut succeeded = 0;
    let mut failed = 0;
    let mut skipped = 0;
    for index in 0..journal.items.len() {
        let item = &mut journal.items[index];
        if item.status == "undone" || item.status == "failed" { skipped += 1; continue; }
        // A pending journal may represent a crash between the filesystem write and log flush.
        let result = (|| -> Result<bool, String> {
            let meta = fs::symlink_metadata(&item.path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() { return Err("拒绝操作符号链接".into()); }
            if !meta.is_file() || meta.len() != item.size { return Err("文件大小已改变".into()); }
            let current = FileTime::from_last_modification_time(&meta);
            if current.unix_seconds() == item.before_seconds && current.nanoseconds() == item.before_nanos {
                return Ok(false);
            }
            if current.unix_seconds() != item.target_seconds { return Err("文件已在操作之后发生变化，拒绝覆盖".into()); }
            set_file_mtime(&item.path, FileTime::from_unix_time(item.before_seconds, item.before_nanos))
                .map_err(|e| e.to_string())?;
            Ok(true)
        })();
        match result {
            Ok(true) => { item.status = "undone".into(); item.error = None; succeeded += 1; }
            Ok(false) => { item.status = "undone".into(); skipped += 1; }
            Err(e) => { item.error = Some(e); failed += 1; }
        }
        if (index + 1) % 500 == 0 { atomic_json(&path, &journal)?; }
    }
    if failed == 0 { journal.status = "undone".into(); }
    atomic_json(&path, &journal)?;
    Ok(OperationResult { id, succeeded, failed, skipped })
}


#[tauri::command]
async fn undo_operation(app: AppHandle, id: String) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || undo_sync(app, id))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_operations(app: AppHandle) -> Result<Vec<Journal>, String> {
    let dir = local_dir(&app)?.join("operations");
    if !dir.exists() { return Ok(Vec::new()); }
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") { continue; }
        if let Ok(content) = fs::read(&path) {
            if let Ok(journal) = serde_json::from_slice::<Journal>(&content) { out.push(journal); }
        }
    }
    out.sort_by(|a,b| b.id.cmp(&a.id));
    Ok(out)
}

#[tauri::command]
fn export_report(app: AppHandle, state: State<'_, Arc<Runtime>>, output: String, status: String, precision: Option<u8>, search: String) -> Result<usize, String> {
    let rows = state.files.lock().map_err(|e| e.to_string())?;
    if rows.is_empty() { return Err("没有扫描结果".into()); }
    let mut content = String::from("path,status,original,target,precision,rule\n");
    fn esc(s: &str) -> String { format!("\"{}\"", s.replace('"', "\"\"")) }
    let needle = search.to_lowercase();
    let filtered: Vec<&FileRow> = rows.iter().filter(|r| row_matches(r, &status, precision, &needle)).collect();
    if filtered.is_empty() { return Err("当前筛选没有可导出的文件".into()); }
    for row in filtered.iter() {
        let selected = row.selected.as_ref();
        let parts = [
            esc(&row.path), esc(&row.status), esc(&row.original),
            esc(selected.map(|x| x.date.as_str()).unwrap_or("")),
            selected.map(|x| x.precision.to_string()).unwrap_or_default(),
            esc(selected.map(|x| x.rule_name.as_str()).unwrap_or("")),
        ];
        content.push_str(&parts.join(","));
        content.push('\n');
    }
    // Explicit user-selected destination only; reports may contain private absolute paths.
    let _ = app; // reserved for a future explicit path permission layer
    fs::write(output, content).map_err(|e| e.to_string())?;
    Ok(filtered.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precision_filter_keeps_conflicts_and_excludes_unmatched() {
        let winning = Candidate { rule_id: "seconds".into(), rule_name: "seconds".into(),
            source: "filename".into(), precision: 4, priority: 10,
            date: "2020-01-11 14:30:25".into(), epoch: Some(1578753025) };
        let mut alternate = winning.clone();
        alternate.date = "2020-01-11 14:30:26".into();
        let mut row = FileRow {
            id: 0, path: "photos/example.jpg".into(), name: "example.jpg".into(), size: 10,
            original: "".into(), modified_seconds: 0, modified_nanos: 0,
            status: "conflict".into(), selected: None, candidates: vec![winning, alternate],
            warning: None,
            refined_from_mtime: false,
        };
        assert!(row_matches(&row, "all", Some(4), ""));
        assert!(row_matches(&row, "conflict", Some(4), "example"));
        assert!(!row_matches(&row, "matched", Some(4), ""));
        assert!(!row_matches(&row, "all", Some(1), ""));
        row.status = "unmatched".into();
        row.candidates.clear();
        assert!(row_matches(&row, "unmatched", None, ""));
        assert!(!row_matches(&row, "all", Some(4), ""));
    }
    #[test]
    fn mtime_refines_day_hour_and_minute_only_on_exact_prefix() {
        let date = Local.with_ymd_and_hms(2022, 6, 20, 13, 42, 17).single().unwrap().timestamp();
        let rule_candidate = |precision, date_str: &str| Candidate {
            rule_id: "x".into(), rule_name: "x".into(), source: "directory".into(),
            precision, priority: 1, date: date_str.into(),
            epoch: Some(Local.with_ymd_and_hms(2022, 6, 20, 12, 0, 0).single().unwrap().timestamp()),
        };
        let (v, yes) = refine_with_mtime(Some(rule_candidate(1, "2022-06-20 12:00:00")), date, true);
        assert!(yes);
        assert_eq!(v.unwrap().date, "2022-06-20 13:42:17");
        let (v, yes) = refine_with_mtime(Some(rule_candidate(2, "2022-06-20 13:00:00")), date, true);
        assert!(yes);
        assert_eq!(v.unwrap().precision, 2);
        let (_, yes) = refine_with_mtime(Some(rule_candidate(3, "2022-06-20 13:41:00")), date, true);
        assert!(!yes);
        let (_, yes) = refine_with_mtime(Some(rule_candidate(1, "2022-06-21 12:00:00")), date, true);
        assert!(!yes);
        let (_, yes) = refine_with_mtime(Some(rule_candidate(1, "2022-06-20 12:00:00")), date, false);
        assert!(!yes);
    }
    #[test]
    fn compact_hyphenated_seconds_rule() {
        let compiled = compile_rules(&default_rules()).unwrap();
        let path = Path::new("Web/2099-12-31/20991231-235959.png");
        let values = get_candidates(path, Path::new("Web"), &compiled);
        let (status, chosen, _) = choose_candidates(&values);
        assert_eq!(status, "matched");
        let selected = chosen.expect("seconds match");
        assert_eq!(selected.date, "2099-12-31 23:59:59");
        assert_eq!(selected.precision, 4);
    }

    #[test]
    fn highest_precision_wins() {
        let rules = default_rules();
        let compiled = compile_rules(&rules).unwrap();
        let path = Path::new("Web/2020-01-11/IMG_20200111_143025.jpg");
        let candidates = get_candidates(path, Path::new("Web"), &compiled);
        let (status, chosen, _) = choose_candidates(&candidates);
        assert_eq!(status, "matched");
        assert_eq!(chosen.unwrap().date, "2020-01-11 14:30:25");
    }
    #[test]
    fn directory_fallback() {
        let compiled = compile_rules(&default_rules()).unwrap();
        let candidates = get_candidates(Path::new("Web/2020-01-11/random.jpg"), Path::new("Web"), &compiled);
        let (_, chosen, _) = choose_candidates(&candidates);
        assert_eq!(chosen.unwrap().precision, 1);
    }
    #[test]
    fn invalid_dates_rejected() {
        assert!(parse_date("20201399", "%Y%m%d", 1).is_none());
        assert!(parse_date("20200230", "%Y%m%d", 1).is_none());
    }
    #[test]
    fn equal_priority_conflict() {
        let a = Candidate { rule_id: "a".into(),rule_name: "a".into(),source:"filename".into(),precision:4,priority:1,date:"2020-01-11 14:30:25".into(),epoch:Some(1) };
        let mut b = a.clone(); b.date = "2020-01-12 14:30:25".into();
        assert_eq!(choose_candidates(&[a,b]).0, "conflict");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let rules_path = local_dir(app.handle()).map_err(std::io::Error::other)?.join("rules.json");
            let rules = fs::read(&rules_path).ok().and_then(|data| serde_json::from_slice::<Vec<Rule>>(&data).ok()).unwrap_or_else(default_rules);
            let settings = fs::read(local_dir(app.handle()).map_err(std::io::Error::other)?.join("settings.json"))
                .ok().and_then(|data| serde_json::from_slice::<Settings>(&data).ok()).unwrap_or_default();
            app.manage(Arc::new(Runtime { files: Mutex::new(Vec::new()), root: Mutex::new(None), rules: Mutex::new(rules), settings: Mutex::new(settings), cancel: AtomicBool::new(false) }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_scan, cancel_scan, get_files, get_result_counts, get_rules, save_rules, get_settings, save_settings, rematch,
            apply_changes, undo_operation, get_operations, export_report,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Photo Date Fixer");
}
