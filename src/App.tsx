import {useCallback,useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {open,save} from '@tauri-apps/plugin-dialog';
import {CalendarClock,FolderOpen,ScanSearch,SlidersHorizontal,ListFilter,AlertTriangle,History,Sun,Moon,Plus,Save,Trash2,Pencil,Eye,Play,Download,RotateCcw,X,ShieldCheck,LoaderCircle,Search} from 'lucide-react';
import './styles.css';

type Rule={id:string;name:string;precision:number;source:string;pattern:string;format:string;priority:number;enabled:boolean};
type Candidate={ruleId:string;ruleName:string;source:string;precision:number;priority:number;date:string;epoch:number|null};
type FileRow={id:number;path:string;name:string;size:number;original:string;status:string;selected:Candidate|null;candidates:Candidate[];warning:string|null;refinedFromMtime:boolean};
type Settings={preservePreciseMtime:boolean;overwriteExistingExif:boolean};
const defaultSettings:Settings={preservePreciseMtime:true,overwriteExistingExif:false};
type Summary={total:number;matched:number;conflict:number;unmatched:number;errors:number;cancelled:boolean};
type Page={rows:FileRow[];total:number};
type ResultCounts={all:number;second:number;minute:number;hour:number;day:number;unmatched:number;conflict:number;invalid:number};
const zeroCounts:ResultCounts={all:0,second:0,minute:0,hour:0,day:0,unmatched:0,conflict:0,invalid:0};
type ResultGroup='all'|'second'|'minute'|'hour'|'day'|'unmatched'|'conflict';
const groups:{key:ResultGroup;label:string;precision:number|null;status:string}[]=[
 {key:'all',label:'全部文件',precision:null,status:'all'},
 {key:'second',label:'秒级',precision:4,status:'all'},
 {key:'minute',label:'分钟级',precision:3,status:'all'},
 {key:'hour',label:'小时级',precision:2,status:'all'},
 {key:'day',label:'天级',precision:1,status:'all'},
 {key:'unmatched',label:'未匹配',precision:null,status:'unmatched'},
 {key:'conflict',label:'冲突',precision:null,status:'conflict'},
];
type Journal={id:string;status:string;items:{path:string;status:string;error:string|null}[]};
type OpResult={id:string;succeeded:number;failed:number;skipped:number};
const labels:Record<number,string>={4:'秒级',3:'分钟级',2:'小时级',1:'天级'};
const fmt=(n:number)=>n.toLocaleString('zh-CN');
const explain=(e:unknown)=>e instanceof Error?e.message:String(e);
const newRule=():Rule=>({id:crypto.randomUUID(),name:'新规则',precision:4,source:'filename',pattern:'(?P<date>\\d{8}_\\d{6})',format:'%Y%m%d_%H%M%S',priority:100,enabled:true});
const nav=[{id:'scan',name:'扫描工作台',icon:ScanSearch},{id:'rules',name:'匹配规则',icon:SlidersHorizontal},{id:'results',name:'结果工作台',icon:ListFilter},{id:'history',name:'操作记录',icon:History}];

export default function App(){
 const [tab,setTab]=useState('scan'),[dark,setDark]=useState(true),[root,setRoot]=useState(''),[summary,setSummary]=useState<Summary>({total:0,matched:0,conflict:0,unmatched:0,errors:0,cancelled:false});
 const [busy,setBusy]=useState(false),[scanning,setScanning]=useState(false),[progress,setProgress]=useState(0),[opProgress,setOpProgress]=useState(0);
 const [settings,setSettings]=useState<Settings>(defaultSettings),[rules,setRules]=useState<Rule[]>([]),[draft,setDraft]=useState<Rule|null>(null),[rows,setRows]=useState<FileRow[]>([]),[total,setTotal]=useState(0),[status,setStatus]=useState('all'),[precision,setPrecision]=useState<number|null>(null),[counts,setCounts]=useState<ResultCounts>(zeroCounts),[search,setSearch]=useState(''),[page,setPage]=useState(0),[expanded,setExpanded]=useState<number|null>(null),[selected,setSelected]=useState<number[]>([]),[history,setHistory]=useState<Journal[]>([]),[message,setMessage]=useState('');
 const notify=(s:string)=>setMessage(s);
 const refreshRows=useCallback(async()=>{try{const r=await invoke<Page>('get_files',{offset:page*100,limit:100,status,precision,search});setRows(r.rows);setTotal(r.total);}catch(e){notify(explain(e));}},[page,status,precision,search]);
 const refreshCounts=useCallback(async()=>{try{setCounts(await invoke<ResultCounts>('get_result_counts'));}catch(e){notify(explain(e));}},[]);
 const refreshHistory=useCallback(async()=>{try{setHistory(await invoke<Journal[]>('get_operations'));}catch(e){notify(explain(e));}},[]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
 useEffect(()=>{invoke<Rule[]>('get_rules').then(setRules).catch(e=>notify(explain(e)));invoke<Settings>('get_settings').then(setSettings).catch(e=>notify(explain(e)));void refreshCounts();const a=listen<number>('scan-progress',e=>setProgress(e.payload));const b=listen<number>('operation-progress',e=>setOpProgress(e.payload));return()=>{void a.then(f=>f());void b.then(f=>f());};},[]);
 useEffect(()=>{void refreshRows();},[refreshRows]);
 useEffect(()=>{if(tab==='history')void refreshHistory();},[tab,refreshHistory]);
 const navigate=(next:string)=>{setTab(next);};
 const activeGroup:ResultGroup=precision===4?'second':precision===3?'minute':precision===2?'hour':precision===1?'day':status==='unmatched'?'unmatched':status==='conflict'?'conflict':'all';
 const chooseGroup=(key:ResultGroup)=>{
   const choice=groups.find(g=>g.key===key);
   if(!choice)return;
   setPrecision(choice.precision);setStatus(choice.status);setPage(0);setSelected([]);setExpanded(null);
 };
 const choose=async()=>{try{const p=await open({directory:true,multiple:false,title:'选择照片或视频文件夹'});if(typeof p==='string')setRoot(p);}catch(e){notify(explain(e));}};
 const scan=async()=>{if(!root)return;setScanning(true);setProgress(0);setSelected([]);try{const s=await invoke<Summary>('start_scan',{root});setSummary(s);setStatus('all');setPrecision(null);setPage(0);setTab('results');await refreshCounts();await refreshRows();notify(s.cancelled?'扫描已取消':'扫描完成，所有文件尚未修改');}catch(e){notify('扫描失败：'+explain(e));}finally{setScanning(false);}};
 const commitRules=async(next:Rule[])=>{setBusy(true);try{await invoke('save_rules',{rules:next});setRules(next);setSummary(await invoke<Summary>('rematch'));setPage(0);setSelected([]);await refreshCounts();await refreshRows();notify('规则已保存并重新匹配');}catch(e){notify('保存失败：'+explain(e));}finally{setBusy(false);}};
 const apply=async()=>{if(!confirm('将识别出的时间写入所选照片内部的 EXIF 拍摄日期，并同步文件修改时间。\n仅支持可写入 EXIF 的图片格式；视频和已有 EXIF 的照片（若未开启覆盖）会跳过。\n\n为支持撤销，程序会在本机应用数据目录保留被修改照片的完整原件副本，这可能占用较多空间。\n\n确定执行吗？'))return;setBusy(true);setOpProgress(0);try{const r=await invoke<OpResult>('apply_changes',{ids:selected,status,precision,search});notify('EXIF 写入 '+r.succeeded+' 个；跳过 '+r.skipped+' 个；失败 '+r.failed+' 个');setTab('history');await refreshHistory();}catch(e){notify('修复失败：'+explain(e));}finally{setBusy(false);}};
 const undo=async(id:string)=>{if(!confirm('确定将该批照片恢复到写入前的完整文件内容和原始时间戳？'))return;setBusy(true);try{const r=await invoke<OpResult>('undo_operation',{id});notify('已恢复 '+r.succeeded+' 个；跳过 '+r.skipped+' 个；失败 '+r.failed+' 个');await refreshHistory();}catch(e){notify(explain(e));}finally{setBusy(false);}};
 const updateSettings=async(next:Settings)=>{setBusy(true);try{await invoke('save_settings',{settings:next});setSettings(next);setSummary(await invoke<Summary>('rematch'));setSelected([]);setPage(0);await refreshRows();notify('匹配选项已保存并重新计算。');}catch(e){notify('设置保存失败：'+explain(e));}finally{setBusy(false);}};
 const exportCsv=async()=>{try{const path=await save({title:'导出报告（包含绝对文件路径）',defaultPath:'photo-date-report.csv',filters:[{name:'CSV',extensions:['csv']}]});if(path){const n=await invoke<number>('export_report',{output:path,status,precision,search});notify('已在本机保存 '+n+' 条记录');}}catch(e){notify(explain(e));}};
 return <div className="shell">
 <aside className="sidebar"><div className="brand"><span className="brand-icon"><CalendarClock size={22}/></span><div><strong>Photo Date Fixer</strong><small>LOCAL WORKSPACE</small></div></div><div className="side-caption">工作空间</div><nav>{nav.map(n=><button key={n.id} className={'nav-link '+(tab===n.id?'active':'')} onClick={()=>navigate(n.id)}><n.icon size={18}/>{n.name}{n.id==='unmatched'&&summary.unmatched>0&&<b className="nav-count">{summary.unmatched}</b>}</button>)}</nav><div className="sidebar-foot"><div className="privacy"><ShieldCheck size={19}/><span><b>数据仅在本地处理</b><small>不上传照片与文件路径</small></span></div><button className="theme" onClick={()=>setDark(!dark)}>{dark?<Sun size={16}/>:<Moon size={16}/>}切换{dark?'浅色':'深色'}主题</button><div className="footnote">OPEN SOURCE · PREVIEW</div></div></aside>
 <main className="main"><header className="top"><span>工作空间 <span className="muted">/</span> {nav.find(n=>n.id===tab)?.name}</span><span className="local"><span className="dot"/>本地运行</span></header><div className="content">
 {tab==='scan'&&<><Header eyebrow="WORKSPACE OVERVIEW" title="让照片回到正确的时间" subtitle="从文件名与目录结构推断日期，按精度匹配，确认后写入照片的 EXIF 拍摄时间。"/><section className="hero"><div><div className="eyebrow">GET STARTED</div><h2>选择待扫描文件夹</h2><p>递归扫描媒体文件。扫描阶段完全只读，确认执行后才会写入照片内部 EXIF 元数据。</p><div className="path"><FolderOpen size={19}/><span title={root}>{root||'尚未选择文件夹'}</span><button onClick={choose} disabled={scanning}>浏览目录</button></div><div className="button-row"><button className="primary" onClick={scan} disabled={scanning||!root}>{scanning?<LoaderCircle className="spin" size={18}/>:<ScanSearch size={18}/>} {scanning?'正在扫描':'开始扫描'}</button>{scanning&&<button className="secondary" onClick={()=>void invoke('cancel_scan')}>停止扫描</button>}</div>{scanning&&<p className="muted">已扫描 {fmt(progress)} 个媒体文件…</p>}</div><div className="hero-art"><CalendarClock size={110} strokeWidth={1}/></div></section><Stats s={summary}/><section className="panel"><div className="panel-header"><h3>精度优先规则</h3><button className="link" onClick={()=>navigate('rules')}>编辑规则 →</button></div><div className="precision-grid">{[4,3,2,1].map(p=><div className="precision" key={p}><span>{p===4?'SS':p===3?'MM':p===2?'HH':'DD'}</span><b>{labels[p]}</b><small>{p===4?'最优先':'自动回退'}</small></div>)}</div><p className="muted">全部候选先比较精度，同精度再依据规则优先级。冲突文件默认不修改。</p></section></>}
 {tab==='rules'&&<><Header eyebrow="MATCHING ENGINE" title="匹配规则" subtitle="支持任意数量规则。精度优先；同精度中数字越小，优先级越高。"/>
 <section className="panel setting-panel">
   <div className="panel-header"><h3>日期来源与 EXIF 写入设置</h3></div>
   <label className="setting-row">
     <input type="checkbox" checked={settings.preservePreciseMtime} disabled={busy}
       onChange={e=>void updateSettings({...settings,preservePreciseMtime:e.target.checked})}/>
     <span><b>在日期一致时，使用原修改时间中更精确的部分</b><small>默认开启。例如父目录匹配到 2022-06-20，而原修改时间为当天 13:42:17，则采用 13:42:17；日期不同则不借用。</small></span>
   </label>
   <label className="setting-row">
     <input type="checkbox" checked={settings.overwriteExistingExif} disabled={busy}
       onChange={e=>void updateSettings({...settings,overwriteExistingExif:e.target.checked})}/>
     <span><b>允许覆盖已有的 EXIF 拍摄时间</b><small>默认关闭。已带拍摄时间的照片不会被覆盖；开启后允许按规则改写现有时间。</small></span>
   </label>
   <p className="muted">执行修复时写入照片内部的 EXIF DateTimeOriginal / CreateDate / ModifyDate；自动保存原件副本，以便完整撤销。</p>
 </section>
 <div className="toolbar"><span className="muted">共 {rules.length} 条规则</span><button className="primary" onClick={()=>setDraft(newRule())}><Plus size={16}/>添加规则</button></div>{[4,3,2,1].map(p=><section className="panel rule-group" key={p}><div className="panel-header"><h3><span className="precision-tag">{labels[p]}</span>规则组</h3><span className="muted">{rules.filter(r=>r.precision===p).length} 条</span></div>{rules.filter(r=>r.precision===p).sort((a,b)=>a.priority-b.priority).map(r=><div className="rule" key={r.id}><input type="checkbox" checked={r.enabled} onChange={()=>void commitRules(rules.map(x=>x.id===r.id?{...x,enabled:!x.enabled}:x))}/><div><b>{r.name}</b><small>{r.source==='filename'?'文件名':'目录'} · {r.format} · 优先级 {r.priority}</small></div><button className="icon-btn" onClick={()=>setDraft({...r})} title="编辑"><Pencil size={16}/></button><button className="icon-btn" onClick={()=>{if(confirm('删除规则？'))void commitRules(rules.filter(x=>x.id!==r.id));}} title="删除"><Trash2 size={16}/></button></div>)}</section>)}</>}
 {tab==='results'&&<><Header eyebrow="RESULT EXPLORER" title="结果工作台" subtitle="按精度和匹配状态筛选。每个级别都可以独立查看文件、识别时间与全部候选结果。"/><Stats s={summary}/>
 <section className="panel filter-panel">
   <div className="panel-header"><div><h3>按日期精度筛选</h3><p className="muted filter-help">高精度优先；冲突文件会归入最高精度的候选组。</p></div><button className="link" onClick={()=>chooseGroup('all')}>清除筛选</button></div>
   <div className="result-groups">{groups.map(g=><button key={g.key} className={'group-chip '+(activeGroup===g.key && status===g.status?'chosen':'')} onClick={()=>chooseGroup(g.key)} aria-pressed={activeGroup===g.key && status===g.status}><span>{g.label}</span><strong>{fmt(counts[g.key])}</strong></button>)}</div>
   <div className="filter-divider"/>
   <div className="toolbar wrap"><div className="search"><Search size={16}/><input placeholder="搜索当前范围内的文件名或路径" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);setSelected([]);}}/></div><label className="status-filter">状态<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);setSelected([]);}}><option value="all">全部状态</option><option value="matched">匹配成功</option><option value="unmatched">未匹配</option><option value="conflict">规则冲突</option><option value="invalid">时间无效</option></select></label><button className="secondary" onClick={exportCsv}><Download size={16}/>导出当前筛选</button></div>
   <div className="filter-summary"><span>当前筛选：<b>{precision?labels[precision]:'全部精度'}</b> · <b>{status==='all'?'全部状态':status==='matched'?'匹配成功':status==='unmatched'?'未匹配':status==='conflict'?'规则冲突':'时间无效'}</b></span><span>符合条件 <b>{fmt(total)}</b> 项</span></div>
 </section>
 <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="选中当前页可修复的文件" checked={rows.some(r=>r.status==='matched')&&rows.filter(r=>r.status==='matched').every(r=>selected.includes(r.id))} onChange={e=>setSelected(old=>e.target.checked?Array.from(new Set([...old,...rows.filter(r=>r.status==='matched').map(r=>r.id)])):old.filter(id=>!rows.some(r=>r.id===id)))}/></th><th>文件</th><th>原修改时间</th><th>匹配时间</th><th>精度</th><th>状态</th><th/></tr></thead><tbody>{rows.map(r=><Fragment key={r.id} row={r} selected={selected.includes(r.id)} expanded={expanded===r.id} toggle={()=>setSelected(old=>old.includes(r.id)?old.filter(x=>x!==r.id):[...old,r.id])} expand={()=>setExpanded(expanded===r.id?null:r.id)}/>)}{rows.length===0&&<tr><td className="empty" colSpan={7}>此筛选条件没有结果。可以切换精度或清除筛选。</td></tr>}</tbody></table></div><div className="footer"><span className="muted">当前筛选 {fmt(total)} 条 · 第 {page+1} 页 · 已选择 {selected.length} 条</span><div className="button-row"><button className="secondary" disabled={page===0} onClick={()=>setPage(Math.max(0,page-1))}>上一页</button><button className="secondary" disabled={(page+1)*100>=total} onClick={()=>setPage(page+1)}>下一页</button></div></div></section>
 <div className="apply-bar"><span><ShieldCheck size={18}/>写入照片 EXIF + 修改时间；原始文件备份仅保存在本机。</span><button className="primary" disabled={busy||summary.matched===0||(!selected.length&&(total===0||status==='unmatched'||status==='conflict'||status==='invalid'))} onClick={apply}><Play size={16}/>写入 EXIF：{selected.length?'选中的 '+selected.length+' 条':'当前筛选中的已匹配文件'}</button></div></>}
 {tab==='history'&&<><Header eyebrow="OPERATION HISTORY" title="执行与撤销" subtitle="撤销记录仅保存在此电脑的应用数据目录。"/>{busy&&<div className="panel">正在处理第 {opProgress} 个文件…</div>}{history.length===0?<div className="panel empty">暂无操作记录。请先扫描和确认修复。</div>:history.map(j=><section className="panel history" key={j.id}><div><h3>EXIF 日期修复操作</h3><small className="muted">任务编号 {j.id}</small><p><span className="tag ok">{j.items.filter(i=>i.status==='applied').length} 已修改</span> <span className="tag warn">{j.items.filter(i=>i.status==='failed').length} 失败</span> <span className="tag">{j.items.filter(i=>i.status==='skipped').length} 跳过</span> <span className="tag">{j.items.filter(i=>i.status==='undone').length} 已撤销</span></p></div><button className="secondary" disabled={busy||j.status==='undone'} onClick={()=>undo(j.id)}><RotateCcw size={16}/>撤销</button></section>)}</>}
 </div></main>
 {draft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null);}}><div className="modal"><div className="panel-header"><h2>编辑日期匹配规则</h2><button className="icon-btn" onClick={()=>setDraft(null)}><X/></button></div><div className="form"><label>规则名称<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><div className="form-two"><label>时间精度<select value={draft.precision} onChange={e=>setDraft({...draft,precision:Number(e.target.value)})}>{[4,3,2,1].map(p=><option key={p} value={p}>{labels[p]}</option>)}</select></label><label>匹配来源<select value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value})}><option value="filename">文件名</option><option value="directory">目录名称</option></select></label></div><label>正则表达式（需包含 date 捕获组）<input className="mono" spellCheck={false} value={draft.pattern} onChange={e=>setDraft({...draft,pattern:e.target.value})}/></label><div className="form-two"><label>日期解析格式<input className="mono" value={draft.format} onChange={e=>setDraft({...draft,format:e.target.value})}/></label><label>同精度优先级<input type="number" value={draft.priority} onChange={e=>setDraft({...draft,priority:Number(e.target.value)})}/></label></div><p className="muted">格式示例：%Y%m%d_%H%M%S。文件名与目录仅用于识别日期，不执行任何内容。</p></div><div className="button-row right"><button className="secondary" onClick={()=>setDraft(null)}>取消</button><button className="primary" disabled={busy||!draft.name.trim()} onClick={async()=>{const next=rules.some(r=>r.id===draft.id)?rules.map(r=>r.id===draft.id?draft:r):[...rules,draft];await commitRules(next);setDraft(null);}}><Save size={16}/>保存</button></div></div></div>}
 {message&&<div className="toast"><span>{message}</span><button onClick={()=>setMessage('')}><X size={17}/></button></div>}
 </div>;
}

function Header({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}){return <div className="heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>;}
function Stats({s}:{s:Summary}){return <div className="stats"><Stat label="已扫描文件" value={s.total} icon={<FolderOpen/>}/><Stat label="成功匹配" value={s.matched} icon={<ScanSearch/>}/><Stat label="未匹配" value={s.unmatched} icon={<AlertTriangle/>}/><Stat label="冲突文件" value={s.conflict} icon={<ListFilter/>}/></div>;}
function Stat({label,value,icon}:{label:string;value:number;icon:React.ReactNode}){return <div className="stat"><span className="stat-icon">{icon}</span><b>{fmt(value)}</b><small>{label}</small></div>;}
function Fragment({row,selected,expanded,toggle,expand}:{row:FileRow;selected:boolean;expanded:boolean;toggle:()=>void;expand:()=>void}){return <><tr><td><input type="checkbox" checked={selected} disabled={row.status!=='matched'} onChange={toggle}/></td><td><b className="file">{row.name}</b><small className="path-small" title={row.path}>{row.path}</small></td><td className="mono">{row.original}</td><td className="mono">{row.selected?.date||'—'}{row.refinedFromMtime&&<span className="mtime-refined" title="已借用原文件修改时间中更精确的时分秒"> · 原时间细化</span>}</td><td>{row.selected?<span className="tag">{labels[row.selected.precision]}</span>:'—'}</td><td><span className={'tag '+(row.status==='matched'?'ok':'warn')}>{row.status==='matched'?'成功':row.status==='unmatched'?'未匹配':row.status==='conflict'?'冲突':'时间无效'}</span></td><td><button className="icon-btn" onClick={expand} title="查看全部匹配"><Eye size={17}/></button></td></tr>{expanded&&<tr className="details"><td colSpan={7}><b>全部候选</b><p className="muted">{row.warning||'按精度和同精度规则优先级筛选'}</p>{row.candidates.length===0?<span className="muted">没有候选</span>:row.candidates.map((c,i)=><div className="candidate" key={i}><span className="tag">{labels[c.precision]}</span><b>{c.date}</b><span className="muted">{c.ruleName} / 优先级 {c.priority}</span></div>)}</td></tr>}</>;}
