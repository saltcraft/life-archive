"""Deterministic, original fictional archive of a small paper-model ferry exhibition."""
from contextlib import closing
from uuid import uuid4

from . import db
from .importer import LABEL, add_entry, add_quote, add_response, add_set, photo_link

STAMP = "2026-10-01T09:00:00+08:00"
# Eight independent observations, all invented for this fixture.
STORIES = [
 ("候船室的纸钟","2026-06-02",[
 "门口那只纸钟慢了半圈。我搬来矮凳，从背面拨动横穿表盘的竹签，才发现停住它的是一小片透明胶。窗外并没有船，展柜里也只摆着一艘还没粘上船名的模型。",
 "我把分针剪短，针尖从此碰不到外框。纸面仍有一圈淡淡的铅笔印，是昨天定尺寸的时候留下的。",
 "下午来试灯的人提议把时间固定在开门那一刻。我想了想，把两根针都装回可以转动的位置。门开多久，至少该由来开门的人自己决定。",
 "柜脚原来有些不平。我用写坏的班次表垫了一角，表上的墨线从木板下面露出短短的一截。",
 "临走时我把矮凳推回墙边。隔着玻璃再看，短针恰好指向那条没有名字的船，倒像是在等它先走。"]),
 ("夜里晾干的蓝纸","2026-07-26",[
 "蓝纸刚从浅盘里捞出来时，颜色看上去比样册深了整整两格。小屋里只有一条绳，我把四张纸错开角度夹上去，让它们在半空里围成一扇透风的屏。",
 "夜里再来收纸，夹子附近已经发白，中间还带着水光。灯一照，几处没有揉开的颜料像沉在水底的石头。我忍住没有用手去摸。",
 "收工簿上按开始染色的那天登记。写到最后的时候窗外已经没了脚步声，那四张纸还留了一张在绳上。我在门口放了只空盘，接住最后滴下来的蓝水。",
 "补记。后来拆下最后一只夹子，才看清背面有一道极细的蓝线。原来那天两张纸的边贴在一起过，我把这个细节记在纸样袋上。"]),
 ("旧票孔","2026-09-23",[
 "早班的时候我给纸码头做了一叠船票。每张票右上角都留着一个小方格，本来准备盖日期，找到的旧打孔器却只肯在离边缘很近的地方咬下一口。",
 "我试着把票横过来，圆孔立刻落到印好的河面上。票下垫一片蓝纸，看上去就像河上漂过一粒蓝色的浮标。",
 "第二张票我没有照着第一张打。把两张叠起来靠近灯，两个圆点分开一点，仿佛模型也有了不同的出发时刻。",
 "午前我把打好的票放进浅木盒，盒盖虚掩，留一角方便下一班拿取。最后留下那张没有打孔的样票，夹进了图纸册的透明封皮。"]),
 ("侧门听雨","2026-09-23",[
 "傍晚从侧门进展棚，屋檐上的雨沿着铁皮滚下来，打在空搪瓷盆里。上午的票盒还在原处，我绕过它去看靠墙的纸桥，有一只桥脚已经被潮气抬高。",
 "我拿棉线从两侧拉了一道临时的栏杆，没有粘死。雨停以后，桥面大概还会降下来，线要是绷紧就会拉破那两片薄薄的桥墩。",
 "站在门里往外望，湿砖地把灯影接得很长。走廊尽头的值班牌转了半面，露出背面没上色的木纹。",
 "我把盆里的水倒掉，又把它搁回原处。拉门之前多听了一小会儿，雨点碰上空盆和碰上有水的盆，原来是两种声音。"]),
 ("给浮标选色","2026-09-25",[
 "桌上摆着三个木浮标，个头都没有一节指头高。调色碟里剩着一点橘红，我用旧笔蘸过，先在废纸边试了三个小圆点。",
 "第一个浮标刷满了颜色，第二个留一道白环，第三个只刷朝向水面的一侧。从正门进去看它们，最容易一下子找到的是有白环的那个。",
 "我又绕去背面看。逆光的时候三个木块几乎一样黑，只能靠轮廓认。于是留下两张观察卡，分别写清楚我站在玻璃的哪一边。",
 "真正摆进展柜时谁会先看见哪一个，我没有把握。等油漆干透，我把剩下的颜料封进小玻璃瓶，纸签上只写配色的日期。"]),
 ("空船架","2026-09-26",[
 "今天只有木架到货，船还在隔壁的小屋里补漆。空架放在桌面上像两扇错开的矮门，我把它们分别朝前挪了半寸，好让船底落下去时不会蹭到新漆。",
 "工具袋里没有合适的软垫，我剪了两条洗过的旧布，绕着托架轻轻缠上一层。两边布的厚薄略有不同，只好靠一小块纸片试平。",
 "有人问空架为什么也摆得这样认真。我没有马上想好怎么说，就请他把一枚橡皮放上去试试。橡皮滚了半圈，在我刚添上的布条前停下。",
 "晚上关灯时桌面仍然空着。我在值班本上留了两行尺寸，把那枚橡皮收回抽屉。"]),
 ("桥的第六节","2026-09-28",[
 "这座折纸桥一共分成十节。","我从最靠岸的那一节拆起，每拆一处就在格纸上描下折线。","第三节底部藏着一条反折，摊平以后才看得见。",
 "第四节的纸色略深，换的是另一包纸。","我把前半段放在窗沿上晾着，转身取回放在书下面压平的后半段。",
 "第六节的折痕偏了半指宽，桥面却在那里获得了一点弹性。手一放开，纸自己回到原先的弧度。",
 "后面几节我依样试过，只有这里肯这样轻轻弹一下。","我画了一支小箭头记下按压的位置，又把格纸翻过来，从背面描了一回。",
 "重新接上桥面时，先前露着一道白缝的地方刚好合拢。","剩下那片剪错的纸角没有用上，我把它塞进了记录袋。"]),
 ("沿河布景清点册","2026-09-30",[
 "展棚明早拆除，我沿着缩小的河岸慢走了一遍。桌上每一件东西都得回到纸箱里，布景图上却只有位置，没有记下装箱时应该先扶住哪一边。于是我从入口开始逐件补写。"])
]
OBJECTS = [
 ("售票亭","挑出的窄檐","先把票窗从里面托起，再抽出底座上的竹签","墙角那一滴没擦干的蓝漆"),
 ("水尺","细如火柴的立柱","把刻度面朝上躺在棉布中间","背后反着写的小小数字"),
 ("堆栈","薄木片做的货架","先收下层纸箱，免得上层空架随之倾倒","两只颜色近似却宽度不同的箱子"),
 ("灯塔","没有粘牢的灯罩","用指腹按住塔身，另一只手从灯座下方托起","罩子内侧铅笔画的灯丝"),
 ("栈桥","两排细纸桩","顺着桥面长边滑进硬纸套，留出一端作提手","侧边那截用作标记的黄棉线"),
 ("修船棚","悬在屋梁上的小钩","先取下工具再合拢两扇门，在门缝里夹一条纸","壁上几乎看不出来的粉笔记号"),
 ("趸船","两片翘起的船头","让船腹落进弧形托垫，再松开绕在指节上的绳","舷窗里那张比指甲还小的长凳"),
 ("白石阶","最下面一层踏步","让石阶沿河岸线退出来，绝不能朝上硬拔","踏步拐角粘住的一小粒软木屑"),
 ("风向标","薄锡片剪成的尾翼","把转轴垫平，在尾翼下方塞一团松纸","箭头背面忘记涂掉的草稿线"),
 ("摆渡牌","可以翻转的木轴","先记下牌面朝向，再把轴两端的小套分开收好","两面字迹深浅不同的末笔"),
 ("钟楼","伸出墙体的长针","在表盘外扣一个宽纸圈，盒盖便碰不到指针","顶层小窗里斜靠着的红梯子"),
 ("芦苇滩","最外圈的纸叶","捏住整片底板移入封套，把纸叶轻轻理向同侧","一丛比其他苇叶更浅的尖芽"),
 ("浮桥","一头活结的棉绳","先卷绳，再把桥身托离水面","木条中间露出的白色接缝"),
 ("岸边仓门","细纸做的门闩","用折角的信封把两扇门分开收好","门背面留下的旧价签")]
SIZES = [(960,540),(540,720),(640,640),(1008,432),(720,540),(540,720),(640,480),(480,640),(700,420)]
PALETTES = [("#c5d7cd","#efd6aa","#53766e","#284e50"),("#d7c3b3","#fce3b1","#a67e75","#645665"),
            ("#aabfcd","#f2d5a2","#6f91a2","#354f65")]


def lines_for(i):
    lines = STORIES[i][2].copy()
    endings = {1:"",2:"翻到册子的最后一页，我在票孔旁边画了一个很小的圆，免得下次忘记打孔器的尺寸。",
               3:"回到屋里才发现，衣袖边沿湿了一线。我把它搭在椅背上，明早来量桥面的时候再拿。",
               4:"瓶底碰到桌面，干透的那一圈颜色从玻璃里面透出来，和纸上的颜色又有一点不同。",
               5:"隔壁补漆的灯还亮着，门口挂起一块写着晾干时间的小木牌。我没有进去催问。"}
    if endings.get(i):
        lines[-1] += endings[i]
    if i == 1:
        lines[0] = lines[0].replace("一条绳","绳").replace("半空里","空中")
    if i == 7:
        for n,(obj,weak,move,mark) in enumerate(OBJECTS,1):
            lines.append(f"第{n}件是{obj}。我特地检查了{weak}，把拆取顺序记在袋口：{move}。装进去以前，我最后看了一眼{mark}，在清单上给它留了一格空白。")
        lines.append("最后一箱合上，露出了底板。把清单放在最上面，留给下一次开箱的人。")
    paragraphs = ["　　"+t for t in lines]
    paragraphs.insert(6 if i==6 else 2,"")
    return paragraphs


def picture(i,w,h,margin):
    sky,sun,far,near = PALETTES[i%3]
    offset = i*7
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<title>虚构测试影像 · 折纸河岸 {i}</title><desc>虚构测试资料；原创几何插画</desc>
<rect width="100%" height="100%" fill="#fff"/><svg x="{margin}" y="{margin}" width="{w-2*margin}" height="{h-2*margin}" viewBox="0 0 300 210" preserveAspectRatio="none">
<rect width="300" height="210" fill="{sky}"/><circle cx="{75+offset}" cy="62" r="25" fill="{sun}"/>
<path d="M0 130 L{60+offset} 70 155 126 226 82 300 108V210H0Z" fill="{far}"/>
<path d="M0 145 Q100 {110+offset} 200 137T300 122V210H0Z" fill="{near}"/>
<path d="M{30+offset} 157h38l-9 6h-22z M{48+offset} 155v-22l14 22z" fill="{sun}"/>
<path d="M18 177h65m20 10h103m20-24h57" fill="none" stroke="{sky}" opacity=".55"/>
</svg></svg>'''.encode()


def seed(root=db.LIVE):
    if db.local(root).is_relative_to(db.PERSONAL):
        raise ValueError("fixture workspace required")
    with closing(db.connect(root,create=True,scope="fixture")) as c, db.transaction(c):
        if c.execute("""SELECT EXISTS(SELECT 1 FROM ai_responses) OR EXISTS(SELECT 1 FROM entries)
                     OR EXISTS(SELECT 1 FROM photos) OR EXISTS(SELECT 1 FROM entity_sequences)""").fetchone()[0]:
            return
        populate(c, root)


def reset(c, root):
    if c.scope != "fixture" or db.local(root).is_relative_to(db.PERSONAL):
        raise ValueError("fixture workspace required")
    with db.transaction(c):
        for table in reversed(db.TABLES):
            c.execute(f"DELETE FROM {table}")
        populate(c, root)


def populate(c, root):
    assets = db.local(root/"assets")
    assets.mkdir(exist_ok=True)
    for i,(title,day,_) in enumerate(STORIES):
        key = f"F{i+1:03}"
        lines = lines_for(i)
        payload = dict(title_raw=title,entry_date=day,paragraphs=lines,label=LABEL)
        if i==1:
            payload.update(written_time_raw="2026-07-27 凌晨写完",backfill_note="2026-07-31 补录一段后来想起的细节")
        add_entry(c,payload,key,STAMP)
        positions = {0:[1,2,4,5,6],1:[1],4:[1],6:[6]}.get(i,[])
        for n,seq in enumerate(positions,1):
            t = lines[seq-1]
            add_quote(c,dict(entry_id=key,para_id=f"{key}-P{seq}",char_start=2,char_end=t.index("。")+1,
                             status="ai_candidate" if i==4 else "user_confirmed"),f"{key}-Q{n}",STAMP)
    blocks = [{"type":"paragraph","text":"两次试样都保留了可以改动的位置。"},
              {"type":"user_followup","text":"纸针和船票各自留下了什么？"},
              {"type":"table","rows":[["物件","记录"],["纸针","转动"],["船票","错孔"]]},
              {"type":"user_followup","text":"下一次还可以怎样观察？"},
              {"type":"paragraph","text":"等下一班开门，再看两件东西停在哪里。"}]
    add_response(c,dict(entry_ids=["F001","F003"],title_raw="两份试样",blocks=blocks),"FR01",STAMP)
    add_response(c,dict(entry_ids=["F004"],title_raw="听雨记录",blocks=[
        {"type":"paragraph","runs":[["bold","空盆和水盆"]]}, {"type":"bullet","text":"各留一次听音记录。"},
        {"type":"rule"}]),"FR02",STAMP)
    for key,status in [("F005","confirmed_none"),("F006","pending_add")]:
        c.execute("UPDATE entry_ai_links SET link_status=? WHERE entry_id=?", (status,key))
    c.execute("INSERT INTO ai_responses VALUES('FO01','fixture','只留下的回信',NULL,NULL,NULL,NULL,?,?)",
              (db.encoded([{"type":"gap_notice","text":"虚构测试资料：原输入遗失。"},
                           {"type":"paragraph","text":"还可以量一下纸的厚度。"}]).decode(),STAMP))
    c.execute("INSERT INTO entry_ai_links VALUES('FO01-link',NULL,'FO01','orphan_missing_input','原输入遗失')")
    for n,(w,h) in enumerate(SIZES,1):
        key = f"FP{n:02}"
        margin = {5:48,6:12}.get(n,0)
        img = picture(n,w,h,margin)
        rel = "assets/"+key+".svg"
        path = db.local(root/rel)
        if path.exists() and path.read_bytes()!=img:
            raise ValueError("asset fingerprint")
        if not path.exists():
            pending = db.local(assets / ("image-"+uuid4().hex+".tmp"))
            try:
                pending.write_bytes(img)
                pending.replace(path)
            finally:
                pending.unlink(missing_ok=True)
        c.execute("INSERT INTO sources VALUES(?,'fixture','fixture_asset',?,?,1,?)",(key+"-src",rel,db.digest(img),STAMP))
        day,precision = {7:("2026-06-02","exact"),8:("2024","year"),9:(None,"unknown")}.get(n,("2026-08","month"))
        c.execute("INSERT INTO photos(photo_id,dataset_scope,orig_source_id,derived_rel_path,derived_ops_json,width,height,has_inner_margin,taken_date_raw,date_precision,caption_raw,caption_written_at) VALUES(?,'fixture',?,?,?, ?,?,?,?,?,?,NULL)",
                  (key,key+"-src",rel,'[]',w,h,int(bool(margin)),day,precision,"虚构测试影像"))
    add_set(c,dict(photo_ids=[f"FP{n:02}" for n in range(1,7)],title_raw="纸河沿岸",date_hint="2026-08",
                   set_note_raw="撤展后按沿岸方向重排了六幅图。",set_note_written_at="2026-10-02"),"FS01",STAMP)
    for photo,confirmed in [("FP05",True),("FP07",False)]:
        photo_link(c,dict(entry_id="F001",photo_id=photo,placement="hero_before_text",confirmed_by_user=confirmed),
                   photo+"-link",STAMP)
