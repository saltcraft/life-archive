import {FoldChevron} from './PaperControls'
import {useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent,type ReactNode} from 'react'
import {AnimatePresence,motion,useIsPresent} from 'framer-motion'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'
import {EXIT_EASE,PAPER_EASE} from './motion/motionTokens'

function usePopup() {
  const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null)
  const [open,setOpen]=useState(false),[above,setAbove]=useState(false),[space,setSpace]=useState(320)
  function show(){
    const box=root.current!.getBoundingClientRect()
    const pane=root.current!.closest('dialog[open],.work-sheet')?.getBoundingClientRect()
    const below=Math.min(innerHeight,pane?.bottom??innerHeight)-box.bottom-8
    const top=box.top-Math.max(0,pane?.top??0)-8
    const flip=below<320 && top>below
    setAbove(flip);setSpace(Math.max(80,Math.min(360,flip?top:below)));setOpen(true)
  }
  function close(restore=true){setOpen(false);if(restore)trigger.current?.focus({preventScroll:true})}
  useEffect(()=>{
    if(!open)return
    const outside=(e:Event)=>{if(e.target instanceof Node && !root.current?.contains(e.target))setOpen(false)}
    document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside,true)
    return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true)}
  },[open])
  return {root,trigger,open,above,space,show,close}
}
function PopupPaper({popup,children}:{popup:ReturnType<typeof usePopup>;children:ReactNode}){
  const reduced=useReducedMotionPreference(), offset=popup.above?4:-4
  const present=useIsPresent()
  return <motion.div inert={!present} aria-hidden={!present} className="paper-popup" data-above={popup.above}
    style={{maxHeight:popup.space, transformOrigin:popup.above?'bottom':'top'}}
    initial={reduced?false:{opacity:0,y:offset,scale:.985}} animate={{opacity:1,y:0,scale:1}}
    exit={{opacity:0,y:reduced?0:offset,scale:reduced?1:.985,transition:{duration:reduced?0:.13,ease:EXIT_EASE}}}
    transition={{duration:reduced?0:.18,ease:PAPER_EASE}}>{children}</motion.div>
}
function Popup({popup,children}:{popup:ReturnType<typeof usePopup>;children:ReactNode}){
  return <AnimatePresence>{popup.open && <PopupPaper popup={popup}>{children}</PopupPaper>}</AnimatePresence>
}
export type Choice=readonly [string,string]
export function PaperSelect({label,options,value,change,searchable=false,display}:{label:string;options:readonly Choice[];
  value:string;change:(s:string)=>void;searchable?:boolean;display?:string}){
  const popup=usePopup(),id=useId(), list=useRef<HTMLDivElement>(null), filter=useRef<HTMLInputElement>(null)
  const [query,setQuery]=useState(''),[active,setActive]=useState(value)
  const filtered=options.filter(([,name])=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const index=filtered.findIndex(([key])=>key===active), current=index<0?0:index
  function show(){setQuery('');setActive(value);popup.show()}
  function choose(key:string){change(key);popup.close()}
  useLayoutEffect(()=>{
    if(!popup.open)return
    if(searchable)filter.current?.focus({preventScroll:true});else list.current?.focus({preventScroll:true})
    const row=list.current?.querySelector<HTMLElement>('[data-active=true]')
    if(row && list.current)list.current.scrollTop=row.offsetTop-list.current.clientHeight/2+row.offsetHeight/2
  },[popup.open])
  function keys(e:KeyboardEvent){
    if(e.key==='Escape' && popup.open){e.preventDefault();e.stopPropagation();popup.close();return}
    const step=e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0
    if(!popup.open){if(step){e.preventDefault();show()}return}
    if(e.key==='Tab'){popup.close(false);return}
    if((e.key==='Enter'||(e.key===' ' && e.target!==filter.current)) && filtered[current]){
      e.preventDefault();choose(filtered[current][0]);return
    }
    if(!step && !['Home','End'].includes(e.key))return
    e.preventDefault()
    const next=step?Math.max(0,Math.min(filtered.length-1,current+step)):e.key==='Home'?0:filtered.length-1
    if(filtered[next]){
      setActive(filtered[next][0])
      list.current?.children[next]?.scrollIntoView({block:'nearest'})
    }
  }
  const activeId=popup.open && filtered[current]?id+'-'+current:undefined
  return <div className="paper-field" ref={popup.root} onKeyDown={keys}>
    <span className="field-name" id={id+'-label'}>{label}</span>
    <button ref={popup.trigger} className="paper-trigger" type="button" aria-label={label}
      aria-haspopup="listbox" aria-expanded={popup.open} aria-controls={id}
      onClick={()=>popup.open?popup.close():show()}><span>{display??options.find(([k])=>k===value)?.[1]??'请选择'}</span><FoldChevron/></button>
    <Popup popup={popup}>{searchable && <input ref={filter} type="search" role="combobox" aria-expanded={popup.open}
      aria-controls={id} aria-activedescendant={activeId} aria-label={'筛选'+label} placeholder="按日期或标题筛选"
      value={query} onChange={e=>{setQuery(e.target.value);setActive('')}}/>}
      <div id={id} ref={list} className="paper-options" role="listbox" tabIndex={-1} aria-labelledby={id+'-label'} aria-activedescendant={activeId}>
        {filtered.map(([key,name],i)=><div role="option" key={key} id={id+'-'+i} aria-selected={value===key} data-active={i===current}
          onPointerDown={e=>e.preventDefault()} onClick={()=>choose(key)}>{name}</div>)}
      </div>{!filtered.length && <small role="status">没有匹配的篇目</small>}</Popup>
  </div>
}

const pad=(n:number)=>String(n).padStart(2,'0')
function dateKey(d:Date){return String(d.getFullYear()).padStart(4,'0')+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function dayAt(y:number,m:number,d:number){const date=new Date(2000,0,1,12);date.setFullYear(y,m,d);return date}
function parseDay(s:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return
  const [y,m,d]=s.split('-').map(Number),date=dayAt(y,m-1,d)
  if(y>0 && dateKey(date)===s)return date
}
export function PaperDatePicker({label,name,required=false}:{label:string;name:string;required?:boolean}){
  const popup=usePopup(), id=useId(), today=dateKey(new Date()), input=useRef<HTMLInputElement>(null)
  const [value,setValue]=useState(''),[cursor,setCursor]=useState(new Date()),[direction,direct]=useState(1)
  const grid=useRef<HTMLDivElement>(null),reduced=useReducedMotionPreference()
  const year=cursor.getFullYear(),month=cursor.getMonth(),days=dayAt(year,month+1,0).getDate()
  const [yearDraft,setYearDraft]=useState(String(year))
  useEffect(()=>setYearDraft(String(year)),[year])
  function update(text:string){setValue(text);input.current?.setCustomValidity(text && !parseDay(text)?'请输入有效的 YYYY-MM-DD 日期':'')}
  function navigate(d:Date){if(d.getFullYear()<1||d.getFullYear()>9999)return;direct(+d>=+cursor?1:-1);setCursor(d)}
  function jump(y:number,m:number){navigate(dayAt(y,m,Math.min(cursor.getDate(),dayAt(y,m+1,0).getDate())))}
  function select(text:string){update(text);popup.close()}
  useLayoutEffect(()=>{if(popup.open)grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({preventScroll:true})},[popup.open])
  return <div className="paper-field date-field" ref={popup.root} onKeyDown={e=>{
    if(e.key==='Escape' && popup.open){e.preventDefault();e.stopPropagation();popup.close()}
  }}><label htmlFor={id}>{label}</label><div className="date-line">
    <input id={id} ref={input} name={name} required={required} placeholder="YYYY-MM-DD" value={value} autoComplete="off"
      onChange={e=>update(e.target.value)}/><button type="button" ref={popup.trigger} aria-label={'打开'+label+'日历'} aria-expanded={popup.open}
      onClick={()=>{if(popup.open)popup.close();else{setCursor(parseDay(value)??new Date());popup.show()}}}>日历<FoldChevron/></button></div>
    <Popup popup={popup}><div role="group" aria-label={label+'日历'} className="calendar">
      <div className="calendar-nav"><button type="button" aria-label="上个月" onClick={()=>jump(year,month-1)}>‹</button>
        <input type="number" aria-label="年份" min="1" max="9999" value={yearDraft}
          onChange={e=>{const s=e.target.value;setYearDraft(s);if(/^\d{4}$/.test(s)&&+s>0)jump(+s,month)}}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}
          onBlur={()=>{if(+yearDraft>=1&&+yearDraft<=9999)jump(+yearDraft,month);else setYearDraft(String(year))}}/>
        <input type="number" aria-label="月份" min="1" max="12" key={month} defaultValue={month+1}
          onBlur={e=>{const m=Number(e.target.value);if(m>=1 && m<=12)jump(year,m-1);else e.target.value=String(month+1)}}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}/>
        <button type="button" aria-label="下个月" onClick={()=>jump(year,month+1)}>›</button></div>
      <motion.div key={year+'-'+month} ref={grid} className="calendar-grid" initial={reduced?false:{opacity:.45,x:direction*6}}
        animate={{opacity:1,x:0}} transition={{duration:reduced?0:.18,ease:PAPER_EASE}} onKeyDown={e=>{
          const delta:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}
          if(!delta[e.key])return
          e.preventDefault();navigate(dayAt(year,month,cursor.getDate()+delta[e.key]))
          requestAnimationFrame(()=>grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({preventScroll:true}))
        }}>
        {Array.from('日一二三四五六').map(d=><small key={d}>{d}</small>)}
        {Array.from({length:days},(_,i)=>{const key=dateKey(dayAt(year,month,i+1));return <button type="button" key={key}
          style={i===0?{gridColumnStart:dayAt(year,month,1).getDay()+1}:undefined} tabIndex={i+1===cursor.getDate()?0:-1}
          aria-label={key} aria-pressed={value===key} aria-current={key===today?'date':undefined}
          onClick={()=>select(key)}>{i+1}</button>})}</motion.div>
      <div className="calendar-foot"><button type="button" onClick={()=>select(today)}>今天</button><button type="button" onClick={()=>select('')}>清除</button></div>
    </div></Popup></div>
}

export function PaperMonthPicker({label,name,required=false}:{label:string;name:string;required?:boolean}){
  const popup=usePopup(),id=useId(),today=dateKey(new Date()).slice(0,7)
  const [value,setValue]=useState(''),[year,setYear]=useState(new Date().getFullYear()),[draft,setDraft]=useState('')
  const [direction,setDirection]=useState(1),reduced=useReducedMotionPreference()
  function jump(next:number){
    if(!Number.isInteger(next)||next<1||next>9999){setDraft(String(year));return}
    setDirection(next>=year?1:-1);setYear(next);setDraft(String(next))
  }
  function select(month:string){setValue(month);popup.close()}
  return <div className="paper-field date-field" ref={popup.root} onKeyDown={e=>{
    if(e.key==='Escape'&&popup.open){e.preventDefault();e.stopPropagation();popup.close()}
  }}><label htmlFor={id}>{label}</label><div className="date-line">
    <input id={id} name={name} value={value} onChange={e=>setValue(e.target.value)} required={required} placeholder="YYYY-MM"
      pattern="(?!0000)[0-9]{4}-(0[1-9]|1[0-2])" title="YYYY-MM"/>
    <button type="button" ref={popup.trigger} aria-label="选择年月" aria-expanded={popup.open}
      onClick={()=>{if(popup.open)popup.close();else{jump(Number(value.slice(0,4))||Number(today.slice(0,4)));popup.show()}}}>年月<FoldChevron/></button></div>
    <Popup popup={popup}><div className="calendar"><div className="calendar-nav">
      <button type="button" aria-label="上一年" disabled={year<=1} onClick={()=>jump(year-1)}>‹</button>
      <input type="number" aria-label="年份" min="1" max="9999" value={draft} onChange={e=>{
        setDraft(e.target.value);if(e.target.value.length===4)jump(Number(e.target.value))
      }} onBlur={()=>jump(Number(draft))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}/>
      <button type="button" aria-label="下一年" disabled={year>=9999} onClick={()=>jump(year+1)}>›</button></div>
      <motion.div className="month-grid" key={year} initial={reduced?false:{opacity:0,x:direction*6}} animate={{opacity:1,x:0}}
        transition={{duration:reduced?0:.18,ease:PAPER_EASE}}>
        {Array.from({length:12},(_,i)=>{const key=String(year).padStart(4,'0')+'-'+pad(i+1)
          return <button type="button" key={key} aria-current={key===today?'date':undefined} aria-pressed={value===key} onClick={()=>select(key)}>{i+1}月</button>})}
      </motion.div><div className="calendar-foot"><button type="button" onClick={()=>select(today)}>本月</button>
        <button type="button" onClick={()=>select('')}>清除</button></div></div></Popup></div>
}
