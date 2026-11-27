import {useRef,useState} from 'react'
import {AnimatePresence,motion} from 'framer-motion'
import {PaperDatePicker,PaperSelect} from './PaperFields'
import {QuoteWindow,type CollectedQuote} from './QuoteWindow'
import {enterPaper,exitPaper} from './motion/motionTokens'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'
import {newId} from './core/newId'
import type {DataAdapter,Queue,OnArchiveChange} from './api/adapter'
import type {DiscoveryItem} from './entrances/types'
import type {Entry} from './types/archive'
import {PaperPills,PanelSwap,DelayedStatus} from './PaperControls'
import {ActionConfirm,MoveOut} from './ArchiveTrash'
import {Sheet,useResource} from './workspace'

import {trimTrailingBlankParagraphs} from './core/paragraphs'

type Save=(payload:Record<string,unknown>,confirmation?:string)=>Promise<string|undefined>
type Fact='no_quote_ok'|'no_ai_ok'
const sections=[['提醒','提醒'],['收日记','收日记'],['按篇整理','按篇整理']] as const
const views=[['待整理','待整理'],['已确认','已确认'],['按事实查全','按事实查全']] as const
const facts:readonly (readonly [Fact,string])[]=[['no_quote_ok','未摘句'],['no_ai_ok','未关联回应']]

export function Curation({api,items,changed,notify,initialSection='提醒'}:{initialSection?:'提醒'|'收日记';api:DataAdapter;items:DiscoveryItem[];changed:OnArchiveChange;notify:(s:string)=>void}) {
  const [selected,select]=useState(''), [message,say]=useState('')
  const [busy,setBusy]=useState(false), [section,setSection]=useState<string>(initialSection)
  const request=useRef({signature:'',key:'',busy:false})
  const queue=useResource(()=>api.queue(),[])
  const lists=queue.value??queue.lastValue
  const entry=useResource(()=>selected?api.entry(selected):Promise.resolve(null),[selected])
  const visible=selected?(entry.value??(entry.pending?entry.lastValue:null)):null
  const save:Save=async (payload,confirmation)=>{
    const job=request.current
    if(job.busy)return
    job.busy=true;setBusy(true);say('')
    const signature=JSON.stringify(payload)
    if(job.signature!==signature){job.signature=signature;job.key=newId()}
    try {
      const result=await api.save(payload,job.key)
      job.signature=''
      const clue=payload.kind==='quote'||payload.kind==='confirm_quote'?result.id:payload.kind==='photo_link'?String(payload.photo_id):undefined
      changed(clue)
      if(confirmation) notify(confirmation)
      else say('已保存')
      return result.id
    }catch{say('保存失败，可再次提交。')}
    finally{job.busy=false;setBusy(false)}
  }
  return <Sheet title="整理"><PaperPills label="整理项目" options={sections} value={section} buttons change={s=>{setSection(s);say('')}}/>
    <p role="status">{message}</p>{queue.error}
    <fieldset disabled={busy} className="work-form"><PanelSwap identity={section}>
      {section==='收日记' && <NewEntry save={save} selected={id=>{select(id);setSection('按篇整理')}}/>}
      {section==='提醒' && lists && <Reminders queue={lists} save={save} edit={id=>{select(id);setSection('按篇整理')}}/>}
      {section==='按篇整理' && <><PaperSelect label="选择篇目" searchable value={selected} change={id=>{select(id);say('')}}
        options={[['','请选择'],...(lists?.entries??[]).map(e=>[e.entry_id,e.entry_date+' · '+e.title_raw] as const)]}/>{entry.error}
        {visible && <fieldset className="entry-tools" disabled={visible.entry_id!==selected} aria-busy={visible.entry_id!==selected}>
          <EntryTools key={visible.entry_id} entry={visible} api={api} items={items} save={save} candidates={lists?.candidates??[]}/>
          <span style={{marginInlineStart:18}}><MoveOut item={{kind:'entry',id:visible.entry_id,title:visible.title_raw}} done={()=>select('')}/></span></fieldset>}</>}
    </PanelSwap></fieldset>
    </Sheet>
}
function NewEntry({save,selected}:{save:Save;selected:(id:string)=>void}){
  return <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget)
    const id=await save({kind:'entry',title_raw:f.get('title'),entry_date:f.get('date'),paragraphs:trimTrailingBlankParagraphs(String(f.get('body')).split('\n')),backfill_note:f.get('note')||null})
    if(id)selected(id)
  }}><h2>收一篇日记</h2><label>原题<input required name="title"/></label><PaperDatePicker required label="篇目日期" name="date"/>
    <label>原文<textarea required name="body" rows={7}/></label><label>补录说明（可选）<input name="note"/></label><button>收下日记</button></form>
}
function Reminders({queue,edit,save}:{queue:Queue;edit:(id:string)=>void;save:Save}){
  const [view,setView]=useState('待整理'),[fact,setFact]=useState<Fact>('no_quote_ok')
  const reduced=useReducedMotionPreference()
  const rows=queue.entries.filter(e=>{
    const dismissed=queue.dismissed.some(d=>d.entry_id===e.entry_id&&d.dismiss_kind===fact)
    const missing=fact==='no_quote_ok'?!e.has_quote:!e.has_ai
    if(view==='已确认')return dismissed
    return missing && (view==='按事实查全'||(!dismissed && !(fact==='no_ai_ok'&&e.confirmed_none)))
  })
  return <><div className="reminder-filters">
    <PaperPills label="清单" options={views} value={view} change={setView}/>
    <PaperPills label="按事实筛选" options={facts} value={fact} change={setFact}/>
  </div><PanelSwap identity={view+fact}>
    <div className="reminders"><AnimatePresence initial={false} mode="popLayout">{rows.map(e=>{
      const dismissed=queue.dismissed.some(d=>d.entry_id===e.entry_id && d.dismiss_kind===fact)
      const action=dismissed?'恢复提醒':fact==='no_quote_ok'?'暂不摘句':'暂不关联'
      return <motion.article layout={reduced?false:'position'} key={e.entry_id} className="work-row reminder-row"
        initial={reduced?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:reduced?{duration:0}:exitPaper}}
        transition={reduced?{duration:0}:enterPaper}><div><button className="reminder-title" onClick={()=>edit(e.entry_id)}>{e.title_raw}</button>
          <small>{e.entry_date} · {e.entry_id}{dismissed?' · 已确认':''}{fact==='no_ai_ok'&&e.confirmed_none?' · 已确认无回应':''}</small></div>
        <button className="reminder-action" onClick={()=>save({kind:'reminder',entry_id:e.entry_id,dismiss_kind:fact,dismissed:!dismissed},
          dismissed?'已恢复提醒':'已确认 · '+action)}><i aria-hidden="true">{dismissed?'↶':'✓'}</i>{action}</button></motion.article>
    })}</AnimatePresence></div>
    {!rows.length && <p>此清单暂无篇目。</p>}</PanelSwap></>
}
function EntryTools({entry,api,items,save,candidates}:{entry:Entry;api:DataAdapter;items:DiscoveryItem[];save:Save;candidates:Queue['candidates']}){
  const rows=trimTrailingBlankParagraphs(entry.paragraphs)
  const [para,setPara]=useState(rows[0]?.para_id||'')
  const [photo,setPhoto]=useState(''),[placement,setPlacement]=useState('entry_level')
  const p=rows.find(p=>p.para_id===para)
  const paraNo=rows.findIndex(p=>p.para_id===para)+1
  const where=placement==='after_paragraph'?'第 '+paraNo+' 段后':placement==='hero_before_text'?'正文首图':'篇目关联'
  const quotes=items.filter((q):q is CollectedQuote=>q.kind==='quote'&&q.entryId===entry.entry_id)
  const [removing,setRemoving]=useState<CollectedQuote>(),reduced=useReducedMotionPreference()
  const photos=[...new Map(items.filter(i=>i.kind==='photo').map(i=>[i.photoId,i])).values()]
  return <><h2>划选摘句</h2><QuoteWindow entry={entry} items={items} para={para} activate={setPara} remove={setRemoving}
      confirm={(slice,n)=>save({kind:'quote',entry_id:entry.entry_id,para_id:slice.id,char_start:slice.start,char_end:slice.end,status:'user_confirmed'},
        '已确认摘句 · 第 '+n+' 段，第 '+(slice.start+1)+'–'+slice.end+' 字「'+Array.from(slice.text).slice(0,20).join('')+'」 · '+entry.title_raw)}/>
    {!!quotes.length && <section className="collected-list"><h2>本篇已收摘句（{quotes.length}）</h2><AnimatePresence initial={false} mode="popLayout">
      {quotes.map(q=><motion.article key={q.quoteId} className="work-row reminder-row" layout={reduced?false:'position'}
        exit={{opacity:0,transition:reduced?{duration:0}:exitPaper}} transition={reduced?{duration:0}:enterPaper}>
        <div><small>第 {entry.paragraphs.findIndex(p=>p.para_id===q.paraId)+1} 段</small>{q.quoteText}</div>
        <button type="button" className="reminder-action" onClick={()=>setRemoving(q)}>移出</button></motion.article>)}</AnimatePresence></section>}
    {removing && <ActionConfirm title="移出这条摘句？" label="确认移出" close={()=>setRemoving(undefined)} commit={async()=>{
      if(!await save({kind:'archive_quote',quote_id:removing.quoteId},'已移出摘句 · '+Array.from(removing.quoteText).slice(0,20).join('')))throw Error('archive quote')
    }}><p>{removing.quoteText}</p><p>移出后不再出现在封面偶遇，日记原文完全保留。</p></ActionConfirm>}
    {candidates.filter(c=>c.entry_id===entry.entry_id).map(c=><div key={c.quote_id}>候选 · {c.quote_text} <button onClick={()=>save({kind:'confirm_quote',quote_id:c.quote_id},'已确认候选摘句「'+c.quote_text+'」 · '+entry.title_raw)}>确认候选</button></div>)}
    <h2>历史回应</h2><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form)
      if(await save({kind:'response',entry_ids:[entry.entry_id],title_raw:f.get('title'),blocks:String(f.get('body')).split('\n').map(text=>({type:'paragraph',text}))},'已保存历史回应「'+f.get('title')+'」 · 已关联至「'+entry.title_raw+'」'))form.reset()
    }}><label>回应原题<input name="title" required/></label><label>回应全文<textarea rows={4} name="body" required/></label><button>保存回应</button></form>
    <h2>确认图文关联</h2><PaperSelect label="选择照片" value={photo} change={setPhoto} options={[['','请选择'],...photos.map(p=>[p.photoId,p.photoId] as const)]}/>
    {photo && <img className="curate-preview" src={api.image(photo)} alt="待确认照片"/>}
    <PaperSelect label="呈现位置" value={placement} change={setPlacement} options={[[ 'entry_level','篇目关联'],['hero_before_text','正文首图'],['after_paragraph','所选原段之后']]}/>
    {placement==='after_paragraph' && <p>关联至第 {paraNo} 段后 · {Array.from(p?.text_raw??'').slice(0,24).join('')||'空段'}</p>}
    <button disabled={!photo} onClick={()=>save({kind:'photo_link',entry_id:entry.entry_id,photo_id:photo,placement,anchor_para_id:placement==='after_paragraph'?para:null,confirmed_by_user:true},'已确认 '+photo+' · '+where+' · '+entry.title_raw)}>确认照片及位置</button></>
}
export function Simulation({api}:{api:DataAdapter}){
  const sim=useResource(()=>Promise.all([api.simulate('equal_entry'),api.simulate('mild'),api.entries()]),[])
  if(!sim.value)return sim.error || <DelayedStatus>正在抽取…</DelayedStatus>
  const [equal,mild,entries]=sim.value
  return <><h2>每种模式抽取 1000 次</h2><table><thead><tr><th>篇目</th><th>等篇</th><th>温和降权</th></tr></thead><tbody>{Object.keys(equal.entries).map(id=>
    <tr key={id}><td>{entries.find(e=>e.entry_id===id)?.title_raw??id}</td><td>{equal.entries[id]}</td><td>{mild.entries[id]}</td></tr>)}</tbody></table>
    <details><summary>查看逐句次数</summary>{Object.keys(equal.quotes).map(q=><p key={q}>{q}　{equal.quotes[q]} ／ {mild.quotes[q]}</p>)}</details></>
}
