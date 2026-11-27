import {defaultReadingPrefs as defaults,validReadingPrefs} from './adapter'
import type {Album, ArchiveItem, ArchiveKind, ArchiveOperation, BinItem, DataAdapter, PhotoMetadata, ReadingPrefs, Simulation} from './adapter'
import type {DiscoveryItem} from '../entrances/types'
import type {Entry, Reply, Session} from '../types/archive'

type Diary = Omit<Entry,'photos'|'links'|'paragraphs'>
type Paragraph = Entry['paragraphs'][number] & {entry_id:string; seq_no:number}
type Quote = {entry_id:string; quote_id:string; para_id:string; char_start:number; char_end:number; quote_text:string; status:string; weight_override?:number}
type Print = {photo_id:string; width:number; height:number; url:string; has_inner_margin:number; taken_date_raw:string|null; date_precision:string; caption_raw:string|null}
type Link = Entry['links'][number] & {entry_id:string|null}
type Placement = {entry_id:string; photo_id:string; placement:string; anchor_para_id?:string; confirmed_by_user:number; link_id:string}
type Seed = {
  entries:Diary[]; paragraphs:Paragraph[]; quotes:Quote[]; ai_responses:Reply[]; entry_ai_links:Link[]
  photos:Print[]; photo_sets:Omit<Album,'items'>[]; photo_set_items:{set_id:string; photo_id:string; item_order:number}[]
  entry_photo_links:Placement[]; curation_dismissals:{entry_id:string; dismiss_kind:string}[]
}
type Batch = {photo_ids:string[];set_id:string|null}
type State = Seed & {bin:BinItem[]; sequences:Record<string,number>; receipts:Record<string,({id:string;signature?:string}|Batch) & {retired?:boolean}>}
function required<T>(value:T|undefined):T {
  if(value===undefined) throw Error('记录不存在')
  return value
}
function valid(ok:unknown):asserts ok {if(!ok)throw Error('演示数据无效')}

function readStore<T>(key:string,fallback:T):T {
  try {const text=localStorage.getItem(key);return text?JSON.parse(text):fallback}
  catch {return fallback}
}

async function readPhoto(file:File):Promise<Omit<Print,'photo_id'|'taken_date_raw'|'date_precision'|'caption_raw'>> {
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer())
  const match=(start:number,signature:number[])=>signature.every((v,i)=>bytes[start+i]===v)
  let type:string
  if(match(0,[255,216,255])) type='image/jpeg'
  else if(match(0,[137,80,78,71,13,10,26,10])) type='image/png'
  else if(match(0,[82,73,70,70]) && match(8,[87,69,66,80])) type='image/webp'
  else throw Error('图片格式')
  const url=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>resolve(String(reader.result))
    reader.onerror=reader.onabort=()=>reject(Error('图片读取失败'))
    reader.readAsDataURL(file.slice(0,file.size,type))
  })
  const image=new Image()
  image.src=url
  await image.decode()
  valid(image.naturalWidth*image.naturalHeight<=40000000)
  return {url,width:image.naturalWidth,height:image.naturalHeight,has_inner_margin:0}
}

export class LocalDemoAdapter implements DataAdapter {
  private readonly seed=required(document.getElementById('portable-seed')??undefined)
  private readonly key='la.portable.1.'+this.seed.dataset.version+'.'+location.pathname
  private readonly volatile=new Set<string>()
  private state:State
  private preferences:ReadingPrefs
  constructor(){
    this.state=this.loadState(this.initial())
    const stored=readStore<ReadingPrefs & {stage_motion?:unknown;book_breath?:unknown}>(this.key+'.prefs',defaults)
    const prefs={...defaults,...stored}
    delete prefs.stage_motion
    delete prefs.book_breath
    this.preferences=validReadingPrefs(prefs)?prefs:defaults
  }
  private loadState(fallback:State):State{
    const saved=readStore(this.key,fallback)
    if(!saved || typeof saved!=='object')return fallback
    for(const key of Object.keys(fallback) as (keyof State)[]){
      if(!saved[key] || typeof saved[key]!=='object' || Array.isArray(saved[key])!==Array.isArray(fallback[key]))return fallback
    }
    return saved
  }
  private initial():State {
    return {...JSON.parse(this.seed.textContent!),bin:[],sequences:{},receipts:{}}
  }
  private persist(key:string,value:unknown){
    if(this.volatile.has(key))return
    try {localStorage.setItem(key,JSON.stringify(value))}
    catch {
      this.volatile.add(key)
      // Keep the last successfully persisted snapshot for the next launch.
    }
  }
  private async edit<T>(operation:()=>T):Promise<T>{
    const run=()=>{
      if(!this.volatile.has(this.key))this.state=this.loadState(this.state)
      return operation()
    }
    // File origins may expose Web Locks but deny requests. Fall back only before
    // the callback starts, so a failed mutation is never inadvertently replayed.
    let started=false
    try{
      if(navigator.locks)return await navigator.locks.request(this.key,()=>{started=true;return run()})
    }catch(error){if(started)throw error}
    return run()
  }
  private commit(next:State){this.state=next;this.persist(this.key,next)}
  private active(kind:ArchiveKind,id:string){return !this.state.bin.some(v=>v.kind===kind && v.id===id)}
  private diaries(){return this.state.entries.filter(e=>this.active('entry',e.entry_id))}
  private prints(){return this.state.photos.filter(p=>this.active('photo',p.photo_id))}
  private sets(){return this.state.photo_sets.filter(a=>this.active('photo_set',a.set_id))}
  private linked(entry:string){return this.state.entry_ai_links.filter(l=>l.entry_id===entry)}
  private members(id:string){return this.state.photo_set_items.filter(m=>m.set_id===id && this.active('photo',m.photo_id)).sort((a,b)=>a.item_order-b.item_order)}
  private confirmed(){return this.state.quotes.filter(q=>q.status==='user_confirmed' && this.active('entry',q.entry_id))}
  async session():Promise<Session>{return {scope:'fixture',writable:true,allow_scope_switch:false,session_token:'portable-demo',label:'虚构测试资料'}}
  async prefs(){return {...this.preferences}}
  async savePrefs(p:ReadingPrefs){
    valid(validReadingPrefs(p))
    this.preferences={...p};this.persist(this.key+'.prefs',p);return this.prefs()
  }
  async entryCount(){return this.diaries().length}
  async entries(){return this.diaries().sort((a,b)=>a.entry_date.localeCompare(b.entry_date)||a.entry_id.localeCompare(b.entry_id))}
  async entry(id:string):Promise<Entry>{
    const e=required(this.diaries().find(v=>v.entry_id===id))
    const photos=this.state.entry_photo_links.filter(l=>l.entry_id===id && l.confirmed_by_user && this.active('photo',l.photo_id))
      .map(l=>({...l,...required(this.state.photos.find(p=>p.photo_id===l.photo_id))}))
    return {...e,paragraphs:this.state.paragraphs.filter(p=>p.entry_id===id).sort((a,b)=>a.seq_no-b.seq_no),photos,links:this.linked(id)}
  }
  async search(q:string){return q?this.state.paragraphs.filter(p=>this.active('entry',p.entry_id)&&p.text_raw.includes(q)):[]}
  async reply(id:string){
    const links=this.state.entry_ai_links.filter(l=>l.response_id===id)
    valid(!links.length || links.some(l=>!l.entry_id || this.active('entry',l.entry_id)))
    return required(this.state.ai_responses.find(r=>r.response_id===id))
  }
  async orphans(){
    return this.state.ai_responses.filter(r=>!this.state.entry_ai_links.some(l=>l.response_id===r.response_id && l.entry_id))
      .map(r=>({response_id:r.response_id,title_raw:r.title_raw||r.response_id,note:this.state.entry_ai_links.find(l=>l.response_id===r.response_id)?.note||'当前未关联篇目'}))
  }
  image(id:string){return required(this.state.photos.find(p=>p.photo_id===id)).url}
  async photo(id:string){
    const p=required(this.prints().find(v=>v.photo_id===id))
    return {...p,links:this.state.entry_photo_links.filter(l=>l.photo_id===id && l.confirmed_by_user && this.active('entry',l.entry_id))}
  }
  async albums(){return this.sets().map(a=>{
    const items=this.members(a.set_id)
    return {...a,first_photo_id:items[0]?.photo_id??null,photo_count:items.length}
  })}
  async album(id:string){return {...required(this.sets().find(a=>a.set_id===id)),items:this.members(id)}}
  async discovery(){
    const entries=this.diaries()
    const quotes:DiscoveryItem[]=this.confirmed().map(q=>({kind:'quote',entryId:q.entry_id,quoteId:q.quote_id,
      paraId:q.para_id,quoteText:q.quote_text,charEnd:q.char_end,entryCount:entries.length,
      linked:this.linked(q.entry_id).some(l=>l.link_status==='linked'),entryDate:required(entries.find(e=>e.entry_id===q.entry_id)).entry_date}))
    const photos:DiscoveryItem[]=this.prints().flatMap(p=>{
      const sets=this.state.photo_set_items.filter(m=>m.photo_id===p.photo_id && this.active('photo_set',m.set_id)).map(m=>m.set_id)
      return (sets.length?sets:[null]).map(setId=>({kind:'photo' as const,photoId:p.photo_id,setId,width:p.width,height:p.height,
        imageUrl:p.url,hasInnerMargin:!!p.has_inner_margin,dateHint:p.taken_date_raw}))
    })
    const list:DiscoveryItem[]=[]
    for(let i=0;i<Math.max(quotes.length,photos.length);i++){if(quotes[i])list.push(quotes[i]);if(photos[i])list.push(photos[i])}
    return list
  }
  async queue(){
    return {entries:(await this.entries()).map(e=>({...e,has_quote:Number(this.confirmed().some(q=>q.entry_id===e.entry_id)),
      has_ai:Number(this.linked(e.entry_id).some(l=>l.link_status==='linked')),
      confirmed_none:Number(this.linked(e.entry_id).some(l=>l.link_status==='confirmed_none'))})),
      dismissed:this.state.curation_dismissals.filter(d=>this.active('entry',d.entry_id)),
      candidates:this.state.quotes.filter(q=>q.status==='ai_candidate' && this.active('entry',q.entry_id))}
  }
  async simulate(mode:string):Promise<Simulation>{
    valid(mode==='equal_entry'||mode==='mild')
    const groups=new Map<string,Quote[]>()
    for(const q of this.confirmed()){
      if(!groups.has(q.entry_id))groups.set(q.entry_id,[])
      groups.get(q.entry_id)!.push(q)
    }
    let seed=24
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
    const pick=<T,>(items:T[],weight:(v:T)=>number)=>{
      let sample=random()*items.reduce((sum,item)=>sum+weight(item),0)
      return items.find(v=>(sample-=weight(v))<0)??items[items.length-1]
    }
    const result:Simulation={count:0,entries:{},quotes:{}}, lists=[...groups.values()]
    for(const list of lists){result.entries[list[0].entry_id]=0;for(const q of list)result.quotes[q.quote_id]=0}
    while(lists.length && result.count<1000){
      const list=pick(lists,g=>mode==='mild'?Math.sqrt(g.length):1)
      const q=pick(list,q=>q.weight_override||1)
      result.entries[q.entry_id]++;result.quotes[q.quote_id]++;result.count++
    }
    return result
  }
  private allocate(s:State,prefix:string,ids:string[],width:number){
    const floor=s.sequences[prefix]??Math.max(0,...ids.filter(k=>new RegExp('^'+prefix+'[0-9]+$').test(k)).map(k=>Number(k.slice(prefix.length))),
      prefix==='FQ'?ids.filter(k=>/^F\d+-Q\d+$/.test(k)).length:0)
    s.sequences[prefix]=floor+1
    return prefix+String(floor+1).padStart(width,'0')
  }
  async save(p:Record<string,unknown>,key:string){
    // Receipt comparison must survive field reordering without retaining another copy of the diary.
    const canonical=JSON.stringify(p,(_key,value)=>value && typeof value==='object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])) : value)
    const bytes=new TextEncoder().encode(canonical)
    let signature:string
    if(globalThis.crypto?.subtle){
      const digest=await crypto.subtle.digest('SHA-256',bytes)
      signature=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
    }else{
      // This is only a replay check in browsers without Web Crypto.
      let hash=2166136261
      for(const byte of bytes)hash=Math.imul(hash^byte,16777619)
      signature=bytes.length+'-'+(hash>>>0)
    }
    return this.edit(()=>this.saveRecord(p,key,signature))
  }
  private saveRecord(p:Record<string,unknown>,key:string,signature:string){
    const prior=this.state.receipts[key]
    valid(!prior?.retired)
    if(prior){
      valid('id' in prior && (!prior.signature || prior.signature===signature))
      return {id:prior.id}
    }
    const s=structuredClone(this.state)
    const entryId=String(p.entry_id??'')
    const checkEntry=(id:string)=>valid(this.diaries().some(e=>e.entry_id===id))
    let id:string
    switch(p.kind){
      case 'entry': {
        valid(typeof p.title_raw==='string' && p.title_raw.trim() && typeof p.entry_date==='string')
        valid(Array.isArray(p.paragraphs) && p.paragraphs.every(t=>typeof t==='string') && p.paragraphs.some(t=>t.trim()))
        id=this.allocate(s,'F',s.entries.map(e=>e.entry_id),3)
        s.entries.push({entry_id:id,title_raw:p.title_raw,entry_date:p.entry_date,backfill_note:String(p.backfill_note||'')})
        p.paragraphs.forEach((text,i)=>s.paragraphs.push({entry_id:id,para_id:id+'-P'+(i+1),seq_no:i+1,text_raw:text}))
        s.entry_ai_links.push({entry_id:id,response_id:null,link_status:'unverified'})
        break
      }
      case 'quote': {
        checkEntry(entryId)
        const para=required(s.paragraphs.find(v=>v.para_id===p.para_id && v.entry_id===entryId))
        const chars=Array.from(para.text_raw),a=Number(p.char_start),b=Number(p.char_end)
        valid(Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&a<b&&b<=chars.length)
        id=this.allocate(s,'FQ',s.quotes.map(q=>q.quote_id),3)
        s.quotes.push({entry_id:entryId,quote_id:id,para_id:para.para_id,char_start:a,char_end:b,quote_text:chars.slice(a,b).join(''),status:'user_confirmed'})
        break
      }
      case 'archive_quote': {
        const q=required(s.quotes.find(q=>q.quote_id===p.quote_id && q.status==='user_confirmed'))
        checkEntry(q.entry_id);q.status='archived';id=q.quote_id;break
      }
      case 'confirm_quote': {
        const q=required(s.quotes.find(q=>q.quote_id===p.quote_id))
        checkEntry(q.entry_id);valid(q.status!=='archived');q.status='user_confirmed';id=q.quote_id;break
      }
      case 'response': {
        valid(Array.isArray(p.entry_ids)&&p.entry_ids.length && typeof p.title_raw==='string' && Array.isArray(p.blocks) && p.blocks.length)
        p.entry_ids.forEach(checkEntry)
        id=this.allocate(s,'FR',s.ai_responses.map(r=>r.response_id),2)
        s.ai_responses.push({response_id:id,title_raw:p.title_raw,blocks:p.blocks})
        for(const entry of new Set(p.entry_ids)){
          s.entry_ai_links=s.entry_ai_links.filter(l=>l.entry_id!==entry||l.response_id)
          s.entry_ai_links.push({entry_id:entry,response_id:id,link_status:'linked'})
        }
        break
      }
      case 'photo_link': {
        checkEntry(entryId)
        const photo=required(this.prints().find(v=>v.photo_id===p.photo_id))
        const placement=String(p.placement),anchor=typeof p.anchor_para_id==='string'?p.anchor_para_id:undefined
        valid(['entry_level','after_paragraph','hero_before_text'].includes(placement)&&p.confirmed_by_user===true)
        if(placement==='after_paragraph')valid(s.paragraphs.some(v=>v.entry_id===entryId && v.para_id===anchor))
        const link=s.entry_photo_links.find(l=>l.entry_id===entryId && l.photo_id===photo.photo_id && l.placement===placement && (l.anchor_para_id??undefined)===anchor)
        if(link){link.confirmed_by_user=1;id=link.link_id}
        else{
          id=this.allocate(s,'FL',s.entry_photo_links.map(l=>l.link_id),2)
          s.entry_photo_links.push({link_id:id,entry_id:entryId,photo_id:photo.photo_id,placement,anchor_para_id:anchor,confirmed_by_user:1})
        }
        break
      }
      case 'reminder': {
        checkEntry(entryId);id=entryId
        const kind=String(p.dismiss_kind)
        valid(['no_ai_ok','no_quote_ok'].includes(kind))
        s.curation_dismissals=s.curation_dismissals.filter(d=>d.entry_id!==id||d.dismiss_kind!==kind)
        if(p.dismissed)s.curation_dismissals.push({entry_id:id,dismiss_kind:kind})
        break
      }
      default:throw Error('未知整理操作')
    }
    const result={id}
    s.receipts[key]={...result,signature};this.commit(s);return result
  }
  async importPhotos(files:File[],meta:PhotoMetadata){
    valid(files.length>0 && files.length<=12 && files.every(f=>f.size>0 && f.size<=12*1024**2) && files.reduce((n,f)=>n+f.size,0)<=24*1024**2)
    const decoded=await Promise.all(files.map(readPhoto))
    return this.edit(()=>this.addPhotos(decoded,meta))
  }
  private addPhotos(decoded:Awaited<ReturnType<typeof readPhoto>>[],meta:PhotoMetadata){
    const prior=this.state.receipts[meta.key]
    valid(!prior?.retired)
    if(prior){valid('photo_ids' in prior);return prior}
    const s=structuredClone(this.state)
    let set_id:string|null=null
    if(meta.mode==='existing')set_id=required(this.sets().find(a=>a.set_id===meta.set_id)).set_id
    if(meta.mode==='new'){
      set_id=this.allocate(s,'FS',s.photo_sets.map(a=>a.set_id),2)
      s.photo_sets.push({set_id,title_raw:meta.title||'',date_hint:meta.date||'',set_note_raw:meta.note,set_note_written_at:meta.note?new Date().toISOString().slice(0,10):undefined})
    }
    const photo_ids:string[]=[]
    let order=Math.max(0,...s.photo_set_items.filter(m=>m.set_id===set_id).map(m=>m.item_order))
    for(const image of decoded){
      const photo_id=this.allocate(s,'FP',s.photos.map(p=>p.photo_id),2)
      s.photos.push({...image,photo_id,taken_date_raw:meta.date||null,date_precision:meta.precision,caption_raw:meta.note||null})
      if(set_id)s.photo_set_items.push({set_id,photo_id,item_order:++order})
      photo_ids.push(photo_id)
    }
    const result={photo_ids,set_id}
    s.receipts[meta.key]=result;this.commit(s);return result
  }
  async trash(){return [...this.state.bin].sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at))}
  async changeArchive(op:ArchiveOperation){
    return this.edit(()=>{
      const draft=structuredClone(this.state)
      this.applyArchive(draft,op);this.commit(draft);return {id:op.item.id}
    })
  }
  async moveBatch(items:ArchiveItem[]){
    return this.edit(()=>{
      const draft=structuredClone(this.state),seen=new Set<string>()
      valid(items.length)
      for(const item of items){
        const key=item.kind+'/'+item.id
        valid(['entry','photo','photo_set'].includes(item.kind) && !seen.has(key))
        seen.add(key);this.applyArchive(draft,{action:'move',item})
      }
      this.commit(draft);return {moved:seen.size}
    })
  }
  async restoreAll(){
    return this.edit(()=>{
      const draft=structuredClone(this.state),count=draft.bin.length
      draft.bin=draft.bin.filter(item=>item.purging)
      this.commit(draft);return {restored:count-draft.bin.length,skipped:draft.bin.length}
    })
  }
  async purgeAll(){
    return this.edit(()=>{
      const draft=structuredClone(this.state),items=[...draft.bin]
      for(const item of items)this.applyArchive(draft,{action:'purge',item})
      this.commit(draft);return {purged:items.length}
    })
  }
  private applyArchive(s:State,op:ArchiveOperation){
    const {kind,id}=op.item,existing=s.bin.find(v=>v.id===id && v.kind===kind)
    if(op.action==='move'){
      if(existing)return {id}
      const item=kind==='entry'?s.entries.find(e=>e.entry_id===id):kind==='photo'?s.photos.find(p=>p.photo_id===id):s.photo_sets.find(a=>a.set_id===id)
      valid(item)
      s.bin.push({...op.item,deleted_at:new Date().toISOString(),purging:0})
    }else{
      valid(existing && existing.deleted_at===op.item.deleted_at)
      s.bin=s.bin.filter(v=>v!==existing)
      if(op.action==='purge'){
        const removed=new Set([id])
        if(kind==='entry')for(const q of s.quotes.filter(q=>q.entry_id===id))removed.add(q.quote_id)
        for(const l of s.entry_photo_links)if((kind==='entry'&&l.entry_id===id)||(kind==='photo'&&l.photo_id===id))removed.add(l.link_id)
        for(const receipt of Object.values(s.receipts)){
          if('id' in receipt?removed.has(receipt.id):receipt.photo_ids.includes(id)||receipt.set_id===id)receipt.retired=true
        }
        // Reserve the pre-purge floor even when removing a seeded ID before the first import.
        const preserve=(prefix:string,ids:string[],width:number)=>{this.allocate(s,prefix,ids,width);s.sequences[prefix]--}
        if(kind!=='photo_set')preserve('FL',s.entry_photo_links.map(l=>l.link_id),2)
        if(kind==='entry'){
          preserve('F',s.entries.map(e=>e.entry_id),3);preserve('FQ',s.quotes.map(q=>q.quote_id),3)
          s.entries=s.entries.filter(e=>e.entry_id!==id);s.quotes=s.quotes.filter(q=>q.entry_id!==id)
          s.paragraphs=s.paragraphs.filter(p=>p.entry_id!==id);s.entry_ai_links=s.entry_ai_links.filter(l=>l.entry_id!==id)
          s.entry_photo_links=s.entry_photo_links.filter(l=>l.entry_id!==id);s.curation_dismissals=s.curation_dismissals.filter(d=>d.entry_id!==id)
        }else if(kind==='photo'){
          preserve('FP',s.photos.map(p=>p.photo_id),2)
          s.photos=s.photos.filter(p=>p.photo_id!==id);s.entry_photo_links=s.entry_photo_links.filter(l=>l.photo_id!==id)
          s.photo_set_items=s.photo_set_items.filter(m=>m.photo_id!==id)
        }else{
          preserve('FS',s.photo_sets.map(a=>a.set_id),2)
          s.photo_sets=s.photo_sets.filter(a=>a.set_id!==id);s.photo_set_items=s.photo_set_items.filter(m=>m.set_id!==id)
        }
      }
    }
  }
  async resetFixture(){await this.edit(()=>{this.volatile.delete(this.key);this.commit(this.initial())})}
}
