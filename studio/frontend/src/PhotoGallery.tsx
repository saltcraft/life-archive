import {createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode,type RefObject} from 'react'
import {AnimatePresence,LayoutGroup,motion,useIsPresent} from 'framer-motion'
import type {AlbumSummary,ArchiveItem,ArchiveOperation,DataAdapter} from './api/adapter'
import {ActionConfirm} from './ArchiveTrash'
import {FoldChevron,PaperFold,PaperPills,PanelSwap} from './PaperControls'
import {PhotoImport,type ImportProps} from './PhotoImport'
import {displayDate} from './core/displayDate'
import type {DiscoveryItem} from './entrances/types'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'
import {useResource} from './workspace'

type Print = Extract<DiscoveryItem,{kind:'photo'}>
type GalleryTab = 'albums'|'singles'
export type GalleryPlace = {tab:GalleryTab; manage:boolean; expanded:string|null; scroll:number; focus:string}
type OpenPhoto = (photo:string,set?:string)=>void
const tabs = [['albums','影集'],['singles','散照']] as const
import {PAPER_EASE as ease,EXIT_EASE,TACTILE_SPRING} from './motion/motionTokens'

function galleryDate(raw?:string|null,monthOnly=false) {
  const value=raw?.trim()
  if(!value || /^(?:未知|未注明|日期未详|unknown)$/iu.test(value)) return ''
  const date=value.match(/^(\d{4})(?:[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?)?(?:[年月日])?(?:T[\d:.+\-Z]+)?$/u)
  if(!date) return displayDate(value)
  const [,year,month,day]=date
  return [year,month?.padStart(2,'0'),monthOnly?undefined:day?.padStart(2,'0')].filter(Boolean).join(' · ')
}

function frameStyle(photo:Print):CSSProperties {
  return {'--image-ratio':photo.width/photo.height} as CSSProperties
}

const Selection=createContext({chosen:new Set<string>(),toggle:(_key:string,_range:boolean)=>{}})
function CheckBadge({kind,id}:{kind:'photo'|'photo_set';id:string}){
  const {chosen,toggle}=useContext(Selection),key=kind+'/'+id,checked=chosen.has(key)
  const reduced=useReducedMotionPreference(),present=useIsPresent()
  return <motion.button type="button" data-choose={key} className="check-badge" aria-label={'选择 '+id} aria-pressed={checked} inert={!present}
    initial={reduced?false:{opacity:0,scale:.92}} animate={{opacity:1,scale:1}} exit={{opacity:0}} transition={{duration:reduced?0:.15,ease}}
    onClick={e=>toggle(key,e.shiftKey)}><motion.span initial={false} animate={{scale:checked?1:0}} transition={reduced?{duration:0}:TACTILE_SPRING}>✓</motion.span></motion.button>
}

function PrintFrame({photo,manage,open}:{photo:Print;manage:boolean;open:()=>void}) {
  const selection=useContext(Selection),key='photo/'+photo.photoId
  const date=galleryDate(photo.dateHint)
  return <figure className="gallery-print" data-selected={manage&&selection.chosen.has(key)} data-print-id={photo.photoId} style={frameStyle(photo)}>
    <div className="print-window">
      <button type="button" className="print-open" aria-label={(manage?'勾选 ':'打开 ')+photo.photoId} aria-pressed={manage?selection.chosen.has(key):undefined} data-gallery-focus={'p-'+photo.photoId} onClick={e=>manage?selection.toggle(key,e.shiftKey):open()}>
        <img src={photo.imageUrl} alt="" width={photo.width} height={photo.height} loading="lazy" decoding="async"/>
        {date && <span className="print-date">{date}</span>}
      </button>
      <AnimatePresence initial={false}>{manage && <CheckBadge key="badge" kind="photo" id={photo.photoId}/>}</AnimatePresence>
    </div>
  </figure>
}

function AlbumMembers({api,album,photos,members,open}:{api:DataAdapter;album:AlbumSummary;photos:Map<string,Print>;members:Print[];open:OpenPhoto}) {
  const detail=useResource(()=>api.album(album.set_id),[album.set_id])
  return <div className="print-wall member-wall" role="group" aria-label="组内照片" aria-busy={detail.pending}>
    {detail.error}
    {(detail.value?.items??members.map(p=>({photo_id:p.photoId}))).map(({photo_id})=>{
      const photo=photos.get(photo_id)
      return photo && <PrintFrame key={photo_id} photo={photo} manage open={()=>open(photo_id,album.set_id)}/>
    })}
  </div>
}

function AlbumCard({album,members,byId,manage,expanded,toggle,ready,api,open}:{
  album:AlbumSummary;members:Print[];byId:Map<string,Print>;manage:boolean;expanded:boolean;toggle:()=>void;
  ready:boolean;api:DataAdapter;open:OpenPhoto
}) {
  const selection=useContext(Selection)
  const front=album.first_photo_id?byId.get(album.first_photo_id):undefined
  const leaves=front?members.filter(photo=>photo.photoId!==front.photoId).slice(0,2):[]
  const month=galleryDate(album.date_hint,true)
  const title=album.title_raw?.trim()
  const description=title || month || '未题名影集'
  const noteDate=galleryDate(album.set_note_written_at)
  return <article className="gallery-album" data-selected={manage&&selection.chosen.has('photo_set/'+album.set_id)} data-album-id={album.set_id}>
    <div className="album-card-face">
      <button type="button" className="album-open" data-gallery-focus={'a-'+album.set_id}
        disabled={!front} aria-label={(manage?(expanded?'收起影集':'展开影集'):'打开影集')+' · '+description}
        aria-expanded={manage?expanded:undefined} aria-controls={manage?'members-'+album.set_id:undefined}
        onClick={()=>{if(manage)toggle();else if(front)open(front.photoId,album.set_id)}}>
        <span className="album-mount">
          {front && <span className="album-stack" style={frameStyle(front)} aria-hidden="true">
            {leaves.map((leaf,i)=><span key={leaf.photoId} className={'album-leaf back-leaf leaf-depth-'+(i+1)}>
              <img alt="" src={leaf.imageUrl} loading="lazy" decoding="async"/>
            </span>)}
            <span className="album-leaf front-leaf"><img alt="" src={front.imageUrl} width={front.width} height={front.height} loading="lazy" decoding="async"/></span>
          </span>}
        </span>
        <span className="album-lettering">
          {title && <span className="album-title">{title}</span>}
          <span className="album-meta">{month && <>{month} · </>}{album.photo_count} 张{manage && front && <FoldChevron/>}</span>
          {album.set_note_raw && <span className="album-postscript">{album.set_note_raw}
            {noteDate && <small>{noteDate} 后记</small>}</span>}
        </span>
      </button>
      <AnimatePresence initial={false}>{manage && <CheckBadge key="group" kind="photo_set" id={album.set_id}/>}</AnimatePresence>
    </div>
    <PaperFold id={'members-'+album.set_id} open={manage && expanded && ready && album.photo_count>0}>
      <AlbumMembers api={api} album={album} photos={byId} members={members} open={open}/></PaperFold>
  </article>
}

export function PhotoGallery({api,items,open,returnPlace,editing,archiveChanged}:{
  api:DataAdapter;items:DiscoveryItem[];open:OpenPhoto;returnPlace:RefObject<GalleryPlace|null>;
  archiveChanged:(op:ArchiveOperation)=>void;editing?:Omit<ImportProps,'api'>
}) {
  const albums=useResource(()=>api.albums(),[])
  const reduced=useReducedMotionPreference()
  const sheet=useRef<HTMLElement>(null),manageButton=useRef<HTMLButtonElement>(null)
  const present=useIsPresent(),place=present?returnPlace.current:null
  const [tab,setTab]=useState<GalleryTab>(place?.tab??'albums')
  const [manage,setManage]=useState(place?.manage??false),[expanded,setExpanded]=useState<string|null>(place?.expanded??null)
  const {singles,byId,groups}=useMemo(()=>{
    const singles:Print[]=[],byId=new Map<string,Print>(),groups=new Map<string,Print[]>()
    for(const photo of items) {
      if(photo.kind!=='photo')continue
      byId.set(photo.photoId,photo)
      if(!photo.setId){singles.push(photo);continue}
      const group=groups.get(photo.setId)
      if(group)group.push(photo)
      else groups.set(photo.setId,[photo])
    }
    return {singles,byId,groups}
  },[items])

  const [chosen,setChosen]=useState(new Set<string>()),anchor=useRef(''),[batch,setBatch]=useState<ArchiveItem[]>()
  function clear(){setChosen(new Set());anchor.current=''}
  function toggle(key:string,range:boolean){
    const keys=Array.from(sheet.current?.querySelectorAll<HTMLElement>('[data-choose]')??[]).filter(b=>!b.closest('[inert]')).map(b=>b.dataset.choose!)
    const a=keys.indexOf(anchor.current),b=keys.indexOf(key)
    const targets=range && a>=0 && b>=0?keys.slice(Math.min(a,b),Math.max(a,b)+1):[key]
    setChosen(previous=>{
      const next=new Set(previous),remove=previous.has(key)
      for(const k of targets){if(remove)next.delete(k);else next.add(k)}
      return next
    })
    anchor.current=key
  }
  function changeTab(next:GalleryTab){if(next!==tab){clear();setTab(next)}}
  function expand(id:string){
    setChosen(previous=>new Set([...previous].filter(key=>key.startsWith('photo_set/'))));anchor.current=''
    setExpanded(previous=>previous===id?null:id)
  }
  function leaveManage(){clear();setManage(false);setExpanded(null)}
  const currentKeys=tab==='singles'?singles.map(p=>'photo/'+p.photoId):[
    ...(albums.value??[]).map(a=>'photo_set/'+a.set_id),...(albums.value?.some(a=>a.set_id===expanded)?groups.get(expanded!)??[]:[]).map(p=>'photo/'+p.photoId)]
  const selected=currentKeys.filter(key=>chosen.has(key))
  const setCount=batch?.filter(item=>item.kind==='photo_set').length??0
  const photoCount=(batch?.length??0)-setCount
  const summary=[setCount && setCount+' 个照片集',photoCount && photoCount+' 张照片'].filter(Boolean).join('与')
  async function moveSelected(){
    if(!batch||!editing)return
    await api.moveBatch(batch)
    for(const item of batch)archiveChanged({action:'move',item})
    clear();editing.notify('已移入暂存箱 · '+summary)
  }
  useEffect(()=>{
    if(!present||!manage)return
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||document.querySelector('dialog[open]'))return
      event.preventDefault();event.stopImmediatePropagation()
      leaveManage();manageButton.current?.focus({preventScroll:true})
    }
    window.addEventListener('keydown',escape,true)
    return ()=>window.removeEventListener('keydown',escape,true)
  },[manage,present])
  useLayoutEffect(()=>{
    if(!place || returnPlace.current!==place || !sheet.current || !albums.value)return
    const pane=sheet.current
    // A member's button mounts after the ordered set arrives. Restore focus without scrolling it into view.
    const restore=()=>{
      const focus=pane.querySelector<HTMLElement>('[data-gallery-focus="'+CSS.escape(place.focus)+'"]')
      if(!focus)return false
      pane.scrollTop=place.scroll
      focus.focus({preventScroll:true});returnPlace.current=null;return true
    }
    if(restore() || !place.manage || !place.expanded || !albums.value.some(album=>album.set_id===place.expanded))return
    const observer=new MutationObserver(()=>{
      if(restore() || pane.querySelector('.member-wall[aria-busy="false"]'))observer.disconnect()
    })
    observer.observe(pane,{childList:true,subtree:true})
    return ()=>observer.disconnect()
  },[place,returnPlace,albums.value,byId])
  function view(photo:string,set?:string){
    const focus=tab==='albums'&&!manage?'a-'+set:'p-'+photo
    returnPlace.current={tab,manage,expanded,scroll:sheet.current?.scrollTop??0,focus}
    open(photo,set)
  }
  function toolbar(importToggle?:ReactNode){
    return <header className="gallery-toolbar">
      <div className="gallery-heading"><h1>照片</h1><PaperPills label="照片分栏" buttons options={tabs} value={tab} change={changeTab}/></div>
      {editing && <div className="gallery-actions">
        <button type="button" ref={manageButton} className="gallery-manage" aria-pressed={manage}
          onClick={()=>manage?leaveManage():setManage(true)}>管理</button>{importToggle}
      </div>}
    </header>
  }
  return <Selection.Provider value={{chosen,toggle}}><main data-manage={manage} className="work-sheet gallery-sheet" ref={sheet}><div className="work-column gallery-column"><LayoutGroup>
    {editing?<PhotoImport api={api} {...editing} toolbar={toolbar} selectDestination={set=>changeTab(set?'albums':'singles')}/>:toolbar()}
    <motion.section className="gallery-exhibits" layout={reduced?false:'position'} transition={{layout:{duration:.24,ease}}}>
      <PanelSwap identity={tab}>{tab==='albums'?<>
        {albums.error}
        <div className="album-wall">{albums.value?.map(album=><AlbumCard key={album.set_id} album={album} api={api}
          members={groups.get(album.set_id)??[]} byId={byId} manage={manage} ready={!albums.pending} expanded={expanded===album.set_id}
          toggle={()=>expand(album.set_id)} open={view}/>)}</div>
        {albums.value?.length===0 && <p className="gallery-empty">还没有影集。</p>}
      </>:<>
        <div className="print-wall singles-wall">{singles.map(photo=>
          <PrintFrame key={photo.photoId} photo={photo} manage={manage} open={()=>view(photo.photoId)}/>)}</div>
        {!singles.length && <p className="gallery-empty">还没有散照。</p>}
      </>}</PanelSwap>
    </motion.section>
  </LayoutGroup></div>
    <AnimatePresence>{manage && <motion.div className="bulk-toolbar" role="group" aria-label="批量管理"
      initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:8,transition:{duration:reduced?0:.15,ease:EXIT_EASE}}}
      transition={{duration:reduced?0:.2,ease}}><span>已选 <motion.b key={selected.length} initial={reduced?false:{opacity:.5,y:2}} animate={{opacity:1,y:0}}>{selected.length}</motion.b> 项</span>
      <button onClick={()=>selected.length===currentKeys.length?clear():setChosen(new Set(currentKeys))}>
        {selected.length>0 && selected.length===currentKeys.length?'取消全选':'全选当前'}</button>
      <button disabled={!selected.length} onClick={()=>setBatch(selected.map(key=>{const [kind,id]=key.split('/');return {kind:kind as ArchiveItem['kind'],id}}))}>移出所选（{selected.length}）</button>
      <button onClick={leaveManage}>完成</button></motion.div>}</AnimatePresence>
    {batch && <ActionConfirm title={'移出这 '+summary+'？'} label="确认移入暂存箱" commit={moveSelected} close={()=>setBatch(undefined)}>
      <p>记录将移入暂存箱，可在设置中恢复。电脑中的原件始终保留。</p></ActionConfirm>}
  </main></Selection.Provider>
}
