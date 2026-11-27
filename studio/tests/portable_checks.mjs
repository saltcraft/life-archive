/* Exercise the exported file in a new Chrome context, without a backend. */
/* Set LA_PLAYWRIGHT to an installed module and LA_TEST_BROWSER to a Chromium executable if needed. */
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const assert=require('node:assert/strict')
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path')
const {pathToFileURL,fileURLToPath}=require('node:url')
const {chromium}=require(process.env.LA_PLAYWRIGHT || 'playwright')
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifact=path.join(root,'portable_demo/life-archive-demo-v1.1.0.html')

export async function exercise(browser,file,restricted){
  const url=pathToFileURL(file).href,ctx=await browser.newContext({offline:true,serviceWorkers:'block'})
  try{
    if(restricted)await ctx.addInitScript(mode=>{
      for(const method of ['pushState','replaceState'])History.prototype[method]=()=>{throw new DOMException('disabled','SecurityError')}
      Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined})
      if(mode==='blocked')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('disabled','SecurityError')}})
      else Storage.prototype.setItem=()=>{throw new DOMException('full','QuotaExceededError')}
    },restricted)
    const page=await ctx.newPage()
    page.setDefaultTimeout(7000)
    const errors=[],requests=[]
    page.on('pageerror',e=>errors.push(e.message))
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
    page.on('request',r=>{if(r.url()!==url && !/^(data|blob):/.test(r.url()))requests.push(r.url())})
    await page.goto(url)
    if(!restricted){
      await page.locator('#portable-seed').evaluate(seed=>{
        const key='la.portable.1.'+seed.dataset.version+'.'+location.pathname+'.prefs'
        localStorage.setItem(key,JSON.stringify({font:3,resume:false,stage_motion:2,book_breath:false}))
      })
      await page.reload()
    }
    const btn=n=>page.getByRole('button',{name:n,exact:true}), home=()=>page.locator('.signature').click()
    const pick=async id=>{await btn('整理').click();await btn('按篇整理').click();await btn('选择篇目').click()
      const e=seed.entries.find(e=>e.entry_id===id)
      await page.getByRole('option',{name:e?e.entry_date+' · '+e.title_raw:'2026-11-25 · 虚构测试资料',exact:true}).click()}
    const settings=()=>btn('阅读设置').click(),close=()=>btn('关闭设置').click()
    await page.getByText('虚构演示 · 仅存本地浏览器',{exact:true}).waitFor()
    assert.equal(await page.locator('script[src],link[rel=stylesheet]').count(),0)
    const seed=await page.locator('#portable-seed').evaluate(el=>JSON.parse(el.textContent))
    assert.equal(seed.entries.length,8);assert.equal(seed.photos.length,9)
    if(!restricted){
      const button=page.locator('#stage-open'),rect=await button.boundingBox()
      for(const [x,y,dx,dy] of [[-1,0,'-100%','0%'],[1,0,'100%','0%'],[0,-1,'0%','-100%'],[0,1,'0%','100%']]){
        const cx=rect.x+rect.width/2,cy=rect.y+rect.height/2
        await page.mouse.move(cx+x*(rect.width/2+5),cy+y*(rect.height/2+5));await page.waitForTimeout(270)
        await page.mouse.move(cx+x*(rect.width/2-4),cy+y*(rect.height/2-4))
        assert.deepEqual(await button.evaluate(el=>[el.style.getPropertyValue('--fill-x'),el.style.getPropertyValue('--fill-y')]),[dx,dy])
      }
      await page.locator('.slip-target').hover()
      await page.locator('.preview-slip[data-open=true]').waitFor()
    }
    await page.locator('#stage-anchor').hover({position:{x:25,y:25}})
    await page.waitForFunction(()=>!document.querySelector('[data-opening]') && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.anchor-stack')).transform).m41)>1)
    await page.locator('#stage-open').click()
    await page.locator('#reader [data-para]').first().waitFor()
    await page.locator('#reply-spine').click()
    await page.locator('#reply table').waitFor()
    assert.equal(await page.locator('#reply blockquote').count(),2)
    await page.keyboard.press('Escape');await page.locator('.page-entry').waitFor()
    if(restricted){
      await page.keyboard.press('Alt+ArrowRight');await page.locator('#reply table').waitFor()
      await page.keyboard.press('Alt+ArrowLeft');await page.locator('.page-entry').waitFor()
    }
    await home();await settings()
    if(!restricted){
      assert.equal(await page.locator('.font-options button').nth(3).getAttribute('aria-pressed'),'true')
      assert.equal(await page.getByRole('checkbox',{name:'短暂折返时续读原段'}).isChecked(),false)
      assert.equal(await page.getByText('封面翻句动效',{exact:true}).count(),0)
    }
    await page.locator('.font-options button').nth(2).click()
    await close()
    await btn('查阅').click()
    await page.getByLabel('原文字句').fill(seed.paragraphs[0].text_raw.trim().slice(0,8))
    await page.locator('.hit').first().waitFor()
    await page.getByLabel('原文字句').fill('')
    await page.locator('.work-row').filter({has:page.locator('small',{hasText:'FO01'})}).getByRole('button').click()
    await page.locator('#reply aside').waitFor()
    await home();await btn('照片').click()
    await page.locator('.album-open').first().click()
    await page.locator('.mounted-photo').waitFor();await btn('下一张').click()
    await page.getByText('2 / 6',{exact:true}).waitFor()
    await btn('返回照片页').click();await btn('散照').click()
    await page.locator('.singles-wall .gallery-print').first().waitFor()
    assert.equal(await page.locator('.singles-wall .gallery-print').count(),3)
    await btn('打开 FP07').click();await page.locator('.mounted-photo').waitFor()
    await btn('返回照片页').click()
    await btn('导入照片').click()
    const files=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=7;c.height=5
      return ['image/png','image/jpeg','image/webp'].map(mime=>c.toDataURL(mime).split(',')[1])
    })
    await page.locator('input[type=file]').setInputFiles(files.map((v,i)=>({
      name:'sample.'+['png','jpg','webp'][i],mimeType:['image/png','image/jpeg','image/webp'][i],buffer:Buffer.from(v,'base64')})))
    await btn('确认导入').click()
    await page.locator('[data-album-id=FS02] .album-open').click()
    await page.locator('.mounted-photo').waitFor()
    assert.equal(await page.locator('.mounted-photo').evaluate(im=>im.naturalWidth),7)
    await home();await pick('F002')
    await page.locator('.quote-window [data-para-body]').first().evaluate(el=>{
      const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r)
    })
    await btn('确认摘句').click()
    await page.locator('[data-clue-id="FQ009"]').waitFor({state:'attached'})
    await home();await page.locator('[data-clue-id="FQ009"]').waitFor()
    await pick('F002')
    await page.locator('.collected-list article').last().hover()
    await page.locator('.collected-list button').last().click();await btn('确认移出').click()
    await page.waitForFunction(()=>document.querySelectorAll('.collected-list article').length===1)
    await btn('移出档案 · F002').click();await btn('确认移入暂存箱').click()
    await settings();await page.getByText('暂存箱（已移出）',{exact:true}).click()
    await page.locator('[data-bin-id=F002]').getByRole('button',{name:'恢复',exact:true}).click()
    await page.getByText('暂存箱是空的。',{exact:true}).waitFor()
    await close()
    await btn('照片').click();await btn('散照').click();await btn('管理').click();await btn('全选当前').click()
    await btn('移出所选（3）').click();await btn('确认移入暂存箱').click()
    await settings();await btn('暂存箱（已移出）').click();await btn('恢复全部').click();await btn('确认恢复全部').click()
    await page.getByText('暂存箱是空的。',{exact:true}).waitFor();await close()
    await btn('勾选 FP08').click();await btn('移出所选（1）').click();await btn('确认移入暂存箱').click()
    await settings();await btn('暂存箱（已移出）').click();await btn('清空暂存箱').click();await btn('确认清空').click()
    await page.getByText('暂存箱是空的。',{exact:true}).waitFor();await close()
    if(!restricted){
      await page.reload();await page.locator('.fixture-label').waitFor();await settings()
      assert.equal(await page.locator('.font-options button').nth(2).getAttribute('aria-pressed'),'true')
      assert.equal(await page.getByRole('checkbox',{name:'短暂折返时续读原段'}).isChecked(),false)
      assert.deepEqual(await page.locator('#portable-seed').evaluate(seed=>JSON.parse(
        localStorage.getItem('la.portable.1.'+seed.dataset.version+'.'+location.pathname+'.prefs'))),{font:2,resume:false})
      await close();await btn('照片').click();await page.locator('[data-album-id=FS02]').waitFor()
    }
    if(!restricted){
      await pick('F005');await btn('确认候选').click()
      await page.locator('[data-clue-id="F005-Q1"]').waitFor({state:'attached'})
      await btn('提醒').click();await btn('暂不摘句').first().click()
      await page.getByRole('radio',{name:'已确认',exact:true}).check()
      await btn('恢复提醒').first().click()
      await btn('收日记').click()
      await page.getByLabel('原题',{exact:true}).fill('虚构测试资料')
      await page.getByLabel('篇目日期',{exact:true}).fill('2026-11-25')
      await page.getByLabel('原文',{exact:true}).fill('虚构暂存箱清除验证段落')
      await btn('收下日记').click()
      await page.getByLabel('回应原题').fill('虚构测试资料')
      await page.getByLabel('回应全文').fill('虚构测试资料')
      await btn('保存回应').click()
      await btn('选择照片').click();await page.getByRole('option',{name:'FP10',exact:true}).click()
      await btn('确认照片及位置').click()
      await btn('查阅').click()
      await page.locator('.work-row').filter({has:page.locator('small',{hasText:'F009'})}).getByRole('button').click()
      await page.locator('#reader .source-detail').waitFor()
      await page.locator('#reply-spine').click()
      await page.locator('#reply .prose').waitFor();await home()
      await pick('F009');await btn('移出档案 · F009').click();await btn('确认移入暂存箱').click()
      await settings();await page.getByText('暂存箱（已移出）',{exact:true}).click()
      await page.locator('[data-bin-id=F009]').getByRole('button',{name:'彻底清除'}).click()
      await btn('确认彻底清除').click();await page.getByText('暂存箱是空的。',{exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>Object.entries(localStorage)
        .some(([key,value])=>key.startsWith('la.portable.') && value.includes('虚构暂存箱清除验证段落'))),false)
      await page.getByText('偶遇权重与抽样预览',{exact:true}).click()
      await page.locator('dialog .sampling table tbody tr').first().waitFor()
      const sums=await page.locator('dialog .sampling tbody tr').evaluateAll(rows=>rows.reduce((v,r)=>
        [v[0]+Number(r.cells[1].textContent),v[1]+Number(r.cells[2].textContent)],[0,0]))
      assert.deepEqual(sums,[1000,1000]);await close()
    }
    await settings();await btn('重置虚构演练集').click();await btn('确认重置').click()
    await page.locator('[data-clue-id="F001-Q1"]').waitFor()
    await btn('查阅').click();await page.locator('.work-row').first().waitFor()
    assert.equal(await page.locator('.work-row').count(),9)
    await btn('照片').click();await page.locator('.album-open').waitFor()
    assert.equal(await page.locator('.gallery-album').count(),1)
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
    console.log(restricted||'normal','file:// PASS; console/page errors=0; external/sibling requests=0')
  }finally{await ctx.close()}
}
async function run(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'la-portable-'))
  const copy=path.join(temp,'demo.html')
  const browser=await chromium.launch({executablePath:process.env.LA_TEST_BROWSER || undefined,
    headless:true,args:['--disable-background-networking','--disable-crash-reporter']})
  try{
    await exercise(browser,artifact,null)
    await fs.copyFile(artifact,copy)
    assert.deepEqual(await fs.readdir(temp),['demo.html'])
    await exercise(browser,copy,'blocked');await exercise(browser,copy,'quota')
  }finally{
    await browser.close();await fs.rm(copy,{force:true});await fs.rmdir(temp)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e=>{console.error(e);process.exitCode=1})
}
