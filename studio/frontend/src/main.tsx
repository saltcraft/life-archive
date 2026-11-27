import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { createRoot } from 'react-dom/client'
import { LocalDemoAdapter } from './api/localDemoAdapter'
import { HttpAdapter } from './api/httpAdapter'
import { SilentStage } from './entrances/scheme-a/SilentStage'
import { openCover, turnPaper, useReducedMotionPreference } from './entrances/scheme-a/paperMotion'
import type { DiscoveryItem } from './entrances/types'
import { Reader, fonts } from './reader/Reader'
import { ReplyView } from './reply/ReplyView'
import { restore, usePage, type ReadingMark } from './core/navigation'
import type { Session } from './types/archive'
import {ArchiveRevision,Lookup,PhotoView,RouteLayer,useResource} from './workspace'
import {PhotoGallery,type GalleryPlace} from './PhotoGallery'
import {SaveToast} from './SaveToast'
import {TrashControls,BinList} from './ArchiveTrash'
import {defaultReadingPrefs} from './api/adapter'
import type {ReadingPrefs,ArchiveOperation} from './api/adapter'
import {Curation,Simulation} from './curation'
import type {Desk} from './core/navigation'
import './style.css'
import './workspace.css'
import './photo-gallery.css'
import './paper.css'
import {DelayedStatus,Disclosure,PanelSwap} from './PaperControls'
import {PaperDialog} from './PaperDialog'
import {PAPER_EASE,EXIT_EASE,TACTILE_SPRING,paperCurve} from './motion/motionTokens'
import type {ReactNode} from 'react'

function HeaderSlot({children,reduced}:{children:ReactNode;reduced:boolean}){
  const present=useIsPresent()
  return <motion.div inert={!present} aria-hidden={!present} initial={reduced?false:{opacity:0}} animate={{opacity:1}}
    exit={{opacity:0,transition:{duration:reduced?0:.15,ease:EXIT_EASE}}} transition={{duration:reduced?0:.15,ease:PAPER_EASE}}>{children}</motion.div>
}

const api = import.meta.env.VITE_PORTABLE_DEMO === '1' ? new LocalDemoAdapter() : new HttpAdapter()
const loadEntry=(id:string)=>api.entry(id)
const desks = [['lookup','查阅'],['albums','照片'],['curate','整理']] as const
type Destination = Desk|'stage'
function DeskNavigation({active,go,reduced}:{active?:Desk;go:(desk:Desk)=>void;reduced:boolean}) {
  const [hover,setHover]=useState<Desk>(),[focus,setFocus]=useState<Desk>()
  const selected=hover??focus??active
  return <nav className="waiting" aria-label="工作区" onPointerLeave={()=>setHover(undefined)} onBlur={e=>{
    if(!e.currentTarget.contains(e.relatedTarget))setFocus(undefined)
  }}>
    {desks.map(([key,label],i)=><span className="nav-item" key={key}>
      {i>0 && <i className="nav-dot" aria-hidden="true">·</i>}
      <button aria-label={label} data-ink={label} data-lit={active===key || selected===key} aria-current={active===key?'page':undefined}
        onPointerEnter={e=>{if(e.pointerType!=='touch'){setFocus(undefined);setHover(key)}}}
        onPointerDown={()=>setFocus(undefined)} onFocus={e=>{
          const keyboard=!!e.currentTarget.closest('[data-input=keyboard]')
          setFocus(keyboard?key:undefined);if(keyboard)setHover(undefined)
        }}
        onClick={()=>go(key)}>{label}{selected===key && (reduced?<span className="nav-line"/>:
          <motion.span aria-hidden="true" className="nav-line" layoutId="desk-underline" initial={{opacity:0}} animate={{opacity:1}}
            transition={{layout:TACTILE_SPRING,opacity:{duration:.14}}}/>)}</button>
    </span>)}
  </nav>
}
function Palette({go,read}:{go:(kind:Desk)=>void;read:(id:string,para:string)=>void}){
  const [query,setQuery]=useState('')
  const hits=useResource(()=>query?api.search(query):Promise.resolve([]),[query])
  return <><h2>快速查阅</h2><input aria-label="搜索原文" autoFocus autoComplete="off" spellCheck={false} type="search" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="work-tabs">{desks.map(([k,v])=><button key={k} onClick={()=>go(k)}>{v}</button>)}</div>{hits.error}
    {hits.value?.map(h=><button className="hit" key={h.para_id} onClick={()=>read(h.entry_id,h.para_id)}>{h.entry_id} · 第 {h.seq_no} 段　{h.text_raw}</button>)}
    {query && hits.value?.length===0 && <p>未找到原段。</p>}</>
}
function RestingCover({go,collect}:{go:(desk:Desk)=>void;collect:()=>void}) {
  const count=useResource(()=>api.entryCount(),[])
  const empty=count.value===0
  return <main className="stage cover-stage resting-cover"><div className="stage-surround" aria-hidden="true"/>
    <div className="stage-gallery"><div className="stage-spread quote-spread">
      <div className="cover-copy"><h1>{empty?'静候第一篇':count.value?'静候第一句':'Life Archive'}</h1>
        <p>{count.error ?? (count.value===undefined?<DelayedStatus>正在清点手稿…</DelayedStatus>:
          empty?'档案还是空白的，先收下你的第一篇手稿，或先导入几张照片。':"已收纳 "+count.value+" 篇手稿，等你亲手摘下一句。")}</p>
        {empty ? <div className="resting-actions"><button id="stage-clue" onClick={collect}>收下第一篇日记</button>
          <button onClick={()=>go('albums')}>导入照片</button></div> : !!count.value &&
          <div className="resting-actions"><button id="stage-clue" onClick={()=>go('lookup')}>查阅全文</button>
            <button onClick={()=>go('curate')}>去挑选第一句</button></div>}
      </div>
      <div className="cover-object" aria-hidden="true"><i className="sage-field"/><div className="anchor">
        {[0,1,2,3].map(n=><i key={n} className={'leaf leaf-'+n}/>)}
      </div></div>
    </div></div></main>
}

function Studio() {
  const studio = useRef<HTMLDivElement>(null)
  const {page, open, replace, reset, back, markVisibility} = usePage(studio)
  const galleryReturn=useRef<GalleryPlace|null>(null)
  const [stageEdition,setStageEdition]=useState(0)
  const [items, setItems] = useState<DiscoveryItem[]>([])
  const [session, setSession] = useState<Session>()
  const [index,setIndex]=useState(0), [message,setMessage]=useState('')
  const [prefs,setPrefs]=useState<ReadingPrefs>(defaultReadingPrefs), [prefsReady,readyPrefs]=useState(false)
  const {font,resume}=prefs
  const prefWrites=useRef(Promise.resolve()), desiredPrefs=useRef(prefs), savedPrefs=useRef(prefs)
  const [confirmReset,askReset]=useState(false)
  const [notice,setNotice]=useState<{message:string;key:number}>(), noticeSeq=useRef(0)
  const notify=(message:string)=>setNotice({message,key:++noticeSeq.current})
  const clearNotice=useCallback(()=>setNotice(undefined),[])
  const wantedClue=useRef<string|undefined>(undefined), currentClue=useRef<string|undefined>(undefined)
  const identity=(item?:DiscoveryItem)=>item?.kind==='quote'?item.quoteId:item?.photoId
  currentClue.current=identity(items[index])
  const [busy,setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const [retainedEntry, setRetainedEntry] = useState<string | null>(null)
  const [query,setQuery]=useState(''),[month,setMonth]=useState(''),[quick,setQuick]=useState(false)
  const [settingsReady,setSettingsReady]=useState(false)
  const [settingsOpen,setSettingsOpen]=useState(false),[paletteReady,setPaletteReady]=useState(false)
  const settings = useRef<HTMLDialogElement>(null)
  const [poolReady,setPoolReady]=useState(false)
  const focus = useRef({stage:'stage-clue', reply:'reply-spine'})
  const entryMarks=useRef(new Map<string,ReadingMark>())
  const replyMarks=useRef(new Map<string,{entry?:string;mark:ReadingMark}>())
  const prev = useRef(page.kind),coverTurn=useRef(false)
  const reduced = useReducedMotionPreference()
  useLayoutEffect(()=>{
    if(page.kind==='stage' && page.photoAnchor){
      const found=items.findIndex(item=>item.kind==='photo' && item.photoId===page.photoAnchor && item.setId===page.setId)
      if(found>=0){setIndex(found);replace({kind:'stage'})}
    }
  },[page,items])
  useEffect(() => {
    let live = true
    if(prefsReady)return
    Promise.all([api.session(),api.prefs()]).then(([s,p])=>{
      if(live){setSession(s);setPrefs(p);desiredPrefs.current=p;savedPrefs.current=p;readyPrefs(true)}
    }).catch(()=>{if(live)setMessage('本机设置暂时无法读取。')})
    return ()=>{live=false}
  }, [attempt,prefsReady])
  useEffect(()=>{
    let live=true
    api.discovery().then(clues=>{
      if(!live)return
      const target=wantedClue.current??currentClue.current
      const next=clues.findIndex(i=>identity(i)===target)
      setMessage(previous=>previous==='本机工作区暂时无法读取。'?'':previous)
      setPoolReady(true);setItems(clues);setIndex(next<0?0:next);wantedClue.current=undefined
    }).catch(()=>{if(live)setMessage('本机工作区暂时无法读取。')})
    return ()=>{live=false}
  },[attempt])
  function changePrefs(change:Partial<ReadingPrefs>){
    if(!prefsReady)return
    const next={...desiredPrefs.current,...change}
    if(change.resume===false){entryMarks.current.clear();replyMarks.current.clear()}
    desiredPrefs.current=next;setPrefs(next);setMessage('')
    prefWrites.current=prefWrites.current.then(async()=>{
      try{savedPrefs.current=await api.savePrefs(next)}
      catch{if(desiredPrefs.current===next){
        desiredPrefs.current=savedPrefs.current;setPrefs(savedPrefs.current);setMessage('偏好未能保存，请再试一次。')
      }}
    })
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k' && !document.querySelector('dialog[open]')) {
        e.preventDefault();setPaletteReady(true);setQuick(true);return
      }
      if (!e.defaultPrevented && e.key==='Escape' && page.kind!=='stage' && !document.querySelector('dialog[open]')) {
        e.preventDefault(); back()
      }
    }
    window.addEventListener('keydown',key)
    return () => window.removeEventListener('keydown',key)
  }, [page.kind,back])
  useLayoutEffect(() => {
    const stage = studio.current?.querySelector<HTMLElement>('.cover-stage')
    if (stage && page.kind === 'stage') return openCover(stage,reduced)
  }, [items.length,page.kind,reduced])
  useLayoutEffect(() => {
    const previous = prev.current
    prev.current = page.kind
    const root = studio.current
    if (!root) return
    if (page.kind === 'entry') {
      coverTurn.current=!page.via
      setRetainedEntry(page.entry)
      const pane = document.getElementById('reader')
      if (previous === 'reply' && pane) {
        const mark=resume?entryMarks.current.get(page.entry):undefined
        if(mark)restore(pane,mark);else pane.scrollTop=0
        document.getElementById(focus.current.reply)?.focus({preventScroll:true})
      } else if (page.para && pane && pane.contains(document.getElementById(page.para))) {
        restore(pane,{para:page.para,offset:0,scroll:0})
      } else if (previous === 'stage' && !page.via) {
        pane?.focus({preventScroll:true})
        if (!reduced) return turnPaper(root,'enter',() => {})
      }
    } else if (page.kind!=='reply' && page.kind!=='stage') {
      setRetainedEntry(null)
    } else if (page.kind === 'stage' && previous !== 'stage') {
      const target = document.getElementById(focus.current.stage) ?? document.getElementById('stage-clue')
      target?.focus({preventScroll:true})
      const release = () => setRetainedEntry(null)
      if (previous === 'entry' && coverTurn.current && !reduced) return turnPaper(root,'return',release)
      release()
      const gallery=root.querySelector<HTMLElement>('.stage-gallery')
      if(gallery && !reduced && previous!=='entry'){
        const arrival=gallery.animate([{opacity:.18,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:200,easing:paperCurve})
        return ()=>arrival.cancel()
      }
    }
  }, [page, reduced])
  const step = useCallback((d: -1|1) => {
    if (items.length) setIndex(i => (i+d+items.length)%items.length)
    setMessage('')
  },[items.length])
  function read(id: string, opts?: {fromQuoteId?: string}) {
    focus.current.stage = document.activeElement?.id || 'stage-clue'
    // A click can land on the outgoing clue during its 150ms exit.
    const shown = items.findIndex(item => item.kind === 'quote' && item.quoteId === opts?.fromQuoteId)
    if (shown >= 0) setIndex(shown)
    setMessage(''); open({kind:'entry',entry:id})
  }
  const backstage = page.kind!=='stage'
  const readerId = page.kind==='stage' ? (coverTurn.current?retainedEntry:null) : page.kind==='entry'||page.kind==='reply'?page.entry:null
  function go(kind:Destination){setQuick(false);if(page.kind!==kind)open({kind})}
  function readFrom(id:string,para?:string){
    setQuick(false)
    open({kind:'entry',entry:id,via:page.kind,para})
  }
  function enterPhoto(photo:string,setId?:string|null){
    if(page.kind==='stage'){
      replace({kind:'stage',photoAnchor:photo,setId})
      const shown=items.findIndex(c=>c.kind==='photo' && c.photoId===photo && c.setId===setId)
      if(shown>=0)setIndex(shown)
      focus.current.stage=document.activeElement?.id || 'stage-clue'
    }
    open({kind:'photo',photo,setId,via:page.kind==='albums'?'albums':'stage'})
  }
  function refreshPool(clueId?:string){
    if(clueId){wantedClue.current=clueId}
    setAttempt(n=>n+1)
  }
  function archiveChanged(op:ArchiveOperation){
    markVisibility(op.item.kind,op.item.id,op.action==='restore')
    if(op.item.kind==='entry' && op.action!=='restore'){
      entryMarks.current.delete(op.item.id)
      for(const [id,record] of replyMarks.current)if(record.entry===op.item.id)replyMarks.current.delete(id)
    }
    refreshPool()
  }
  async function resetFixture(){
    if(session?.scope!=='fixture'||!confirmReset||busy)return
    setBusy(true)
    try{
      await api.resetFixture()
      entryMarks.current.clear();replyMarks.current.clear();setRetainedEntry(null);setQuery('');setMonth('')
      setStageEdition(n=>n+1);setIndex(0)
      wantedClue.current='F001-Q1';refreshPool();reset();setSettingsOpen(false)
      notify('已恢复虚构演练集 · 8 篇日记、9 张照片、1 个照片集')
    }catch{setMessage('重置未完成，请再次确认。')}
    finally{setBusy(false)}
  }
  const onDesk=page.kind==='stage'||page.kind==='lookup'||page.kind==='albums'||page.kind==='curate'
  const entryVia=page.kind==='entry'?page.via:undefined
  const origins:Record<string,string>={lookup:'返回查阅',photo:'返回照片',curate:'返回整理',albums:'返回照片页',reply:'返回历史回应',entry:'返回正文'}
  function leaveArticle(){back()}
  const innerReturn=page.kind==='entry'?(origins[entryVia??'']??'回到封面'):
    page.kind==='reply'?(page.entry?'返回正文':'返回查阅'):
    page.kind==='photo' && page.via==='stage'?'回到封面':page.kind==='photo' && page.via==='albums'?'返回照片页':'返回上一层'
  return <ArchiveRevision.Provider value={attempt}><div ref={studio} className={'studio page-'+page.kind+(page.kind==='reply'?' on-reply':'')}>
    <TrashControls api={api} enabled={!!session?.writable} changed={archiveChanged} notify={notify}>
    <header className="masthead">
      <button className="signature" aria-label="Life Archive" onClick={()=>go('stage')}><span className="book-symbol" aria-hidden="true"><i/><i/><i/></span><span lang="en">Life Archive</span></button>
      <div className="header-slot"><AnimatePresence initial={false}><HeaderSlot key={onDesk?"desks":"return"} reduced={reduced}>{onDesk ? <DeskNavigation active={page.kind==='stage'?undefined:page.kind} go={go} reduced={reduced}/> :
        <button className="return" onClick={page.kind==='entry'?leaveArticle:back}>
          <svg aria-hidden="true" viewBox="0 0 19 15" width="19" height="15" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 7.5h-14m5-5-5 5 5 5"/></svg>{innerReturn}
        </button>}</HeaderSlot></AnimatePresence></div>
      <div className="preferences">
        <button id="settings" onClick={() => {setMessage('');setSettingsReady(true);setSettingsOpen(true)}} aria-label="阅读设置"><svg viewBox="0 0 17 17" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          <path d="M2 5.5h5m3 0h5M2 11.5h8m3 0h2"/><circle cx="8.5" cy="5.5" r="1.5"/><circle cx="11.5" cy="11.5" r="1.5"/>
        </svg>设置</button>
      </div>
    </header>
    <div className="stage-slot" data-scope={session?.scope} inert={backstage} aria-hidden={backstage}>
      {items.length ? <SilentStage key={stageEdition} items={items} currentIndex={index} loadEntry={loadEntry} visible={!backstage} onStep={step} onOpenEntry={read}
      onOpenPhoto={enterPhoto} onOpenLookup={()=>go('lookup')} reducedMotion={reduced}/> :
      session?.scope==='personal' && poolReady && !message ? <RestingCover go={go} collect={()=>open({kind:"curate",initialSection:"收日记"})}/> :
      <main className="stage"><p role="status">{message || (poolReady && session?'暂无可偶遇的摘句或照片。':<DelayedStatus>正在打开工作区…</DelayedStatus>)} {message && <button onClick={() => setAttempt(n=>n+1)}>重试</button>}</p></main>}
    </div>
    <AnimatePresence initial={false}>{page.kind==='lookup' && <RouteLayer key="lookup"><Lookup api={api} query={query} setQuery={setQuery} month={month} setMonth={setMonth} read={readFrom} readOrphan={reply=>open({kind:'reply',reply})}/></RouteLayer>}
    {page.kind==='albums' && <RouteLayer key="albums"><PhotoGallery archiveChanged={archiveChanged} api={api} items={items} open={enterPhoto} returnPlace={galleryReturn}
      editing={session?.writable?{changed:refreshPool,notify}:undefined}/></RouteLayer>}
    {page.kind==='photo' && <RouteLayer key="photo"><PhotoView api={api} page={page} replace={replace} read={readFrom}/></RouteLayer>}
    {page.kind==='curate' && session && <RouteLayer key="curate"><Curation api={api} items={items} changed={refreshPool} notify={notify} initialSection={page.initialSection}/></RouteLayer>}</AnimatePresence>
    <PaperDialog open={quick} className="command-panel" title="快速查阅" onDismiss={()=>setQuick(false)} onClosed={()=>setPaletteReady(false)}>
      {paletteReady && <Palette go={go} read={readFrom}/>}<button onClick={()=>setQuick(false)}>关闭</button></PaperDialog>
    <AnimatePresence>{readerId && <Reader gentle={!!entryVia} items={items} reduced={reduced} key={readerId} returnLabel={innerReturn} api={api} id={readerId} font={font} covered={page.kind==='reply'} departing={!backstage} resume={page.kind==='entry' && page.para?{para:page.para,offset:0,scroll:0}:resume?entryMarks.current.get(readerId):undefined}
      remember={mark => {if(resume && page.kind==='entry')entryMarks.current.set(page.entry,mark)}}
      onReply={(id,from) => {focus.current.reply=from; open({kind:'reply',entry:readerId,reply:id})}} back={leaveArticle}/>}</AnimatePresence>
    <AnimatePresence>{page.kind==='reply' && <ReplyView key={page.reply} resume={resume?replyMarks.current.get(page.reply)?.mark:undefined} remember={mark=>{if(resume)replyMarks.current.set(page.reply,{entry:page.entry,mark})}} id={page.reply} api={api} back={back} backLabel={page.entry?'返回正文':'返回查阅'}/>}</AnimatePresence>
    {session?.scope==='fixture' && <div className="fixture-label" style={import.meta.env.VITE_PORTABLE_DEMO==='1'?{left:'auto',right:12,transform:'none'}:undefined}>{import.meta.env.VITE_PORTABLE_DEMO==='1'?'虚构演示 · 仅存本地浏览器':'虚构演示资料'}</div>}
    {message && items.length>0 && !settings.current?.open && <p className="notice" role="status">{message}</p>}
    <PaperDialog dialogRef={settings} open={settingsOpen} className="settings-panel" title="阅读设置"
      onDismiss={()=>setSettingsOpen(false)} onClosed={()=>{askReset(false);setSettingsReady(false)}}>
      {settingsReady && <div key="settings-content">
      <div className="dialog-heading"><h2 id="settings-title">阅读设置</h2><button aria-label="关闭设置" onClick={()=>setSettingsOpen(false)}>×</button></div>
      <fieldset disabled={!prefsReady}><legend>正文字体</legend><div className="font-options">{fonts.map((name,i)=><button key={name} aria-pressed={font===i} onClick={()=>changePrefs({font:i})}>{name}</button>)}</div></fieldset>
      <label className="resume-option"><input type="checkbox" disabled={!prefsReady} checked={resume} onChange={e=>changePrefs({resume:e.target.checked})}/> 短暂折返时续读原段</label>
      <p className="reading-hint">阅读正文时，静置 7 秒或按 F 进入留白。移动鼠标或滚动即可唤回。</p>
      <Disclosure className="sampling" label="偶遇权重与抽样预览"><Simulation api={api}/></Disclosure>
      {session?.scope==='fixture' && <div className="reset-fixture"><PanelSwap identity={String(confirmReset)}>
        {confirmReset?<div role="group" aria-label="确认重置虚构演练集"><p>恢复初始演练集会清除新增条目、照片登记与整理结果。已选图片的只读副本及阅读偏好会保留。</p>
          <button disabled={busy} onClick={()=>askReset(false)}>取消</button><button disabled={busy} onClick={resetFixture}>确认重置</button></div>:
          <button onClick={()=>askReset(true)}>重置虚构演练集</button>}</PanelSwap>
      </div>}
      {session?.writable && <Disclosure className="archive-bin" label="暂存箱（已移出）"><BinList api={api} changed={archiveChanged} notify={notify}/></Disclosure>}
      {message && <p role="status">{message}{!prefsReady && <button onClick={()=>setAttempt(n=>n+1)}>重试读取设置</button>}</p>}
    </div>}</PaperDialog>
    <SaveToast notice={notice} close={clearNotice} host={settingsOpen?settings.current:null}/>
    </TrashControls>
  </div></ArchiveRevision.Provider>
}
createRoot(document.getElementById('root')!).render(<Studio/>)
