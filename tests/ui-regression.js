import {openLibrary} from '../web/panel.js';
import {snapshot} from '../web/model.js';

const entry = (kind, id = 'a') => ({key: `${kind}:${id}`, kind, id, title: `${kind} ${id}`, text: `  ${kind} ${id}\n`, has_preview: false, models:{anima:'verified'}});
const response = (data, status = 200) => ({ok: status < 400, status, json: async () => structuredClone(data?.entries ? {model_filtering:true, ...data} : data)});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const assert = (condition, message) => {if (!condition) throw new Error(message);};
const button = text => [...document.querySelectorAll('.soda-library button')].find(b => b.textContent === text);
const preview = () => document.querySelector('.soda-preview').textContent;
const cards = () => [...document.querySelectorAll('.soda-card')];
const tests = [];
const test = (name, action) => tests.push({name, action});
let closePanel;
function mount(options = {}) {
    let loaded = null;
    const request = options.request ?? (async url => {
        const u = new URL(url, location.origin), kind = u.searchParams.get('kind') || 'character';
        if (u.pathname.endsWith('/entry')) {
            const [k, id] = u.searchParams.get('key').split(':');
            return response(entry(k, id));
        }
        if (u.searchParams.has('random')) return response(entry(kind));
        return response({entries: [entry(kind), entry(kind, 'b')], total: 120, page: Number(u.searchParams.get('page') || 1), page_size: 60, category_tree: true, facets: {}, sources: [], warnings: []});
    });
    closePanel = openLibrary({request, getText: options.getText || (() => ''), saved: options.saved, targetModel:options.targetModel ?? 'anima', onTargetChange:options.onTargetChange, browseState: options.browseState, editablePreview:options.editablePreview, loadLabel:options.loadLabel,
        onLoad: (text, state) => {loaded = {text, state};}});
    return {request, loaded: () => loaded};
}

test('角色、服饰、内容顺序；载入前不改正文', async () => {
    const state = mount(); await tick();
    cards()[0].click(); await tick();
    button('服饰').click(); await tick(); cards()[0].click(); await tick();
    button('内容').click(); await tick(); cards()[0].click(); await tick();
    const expected = ['character', 'outfit', 'content'].map(k => entry(k).text).join('\n\n');
    assert(preview() === expected, '组合顺序或原文变化');
    assert(state.loaded() === null, '选择过程中提前写入正文');
    button('载入正文').click();
    assert(state.loaded().text === expected, '载入文本与预览不一致');
});
test('保留手改 / 确认替换 / 快照 JSON 往返', async () => {
    const state = mount({getText: () => 'manual body'}); await tick();
    cards()[0].click(); await tick(); button('载入正文').click();
    assert(!document.querySelector('.soda-confirm').hidden, '没有替换确认');
    button('保留当前正文').click(); assert(state.loaded() === null, '取消后正文被覆盖');
    button('载入正文').click(); button('确认替换正文').click();
    const saved = JSON.parse(JSON.stringify(state.loaded().state));
    mount({saved}); await tick();
    assert(preview() === entry('character').text, '保存的组合未恢复');
});
test('源条目删除仍保留组合快照', async () => {
    const saved = snapshot({character: entry('character')});
    const base = mount(); closePanel();
    mount({saved, request: url => url.includes('/entry?') ? Promise.resolve(response({}, 404)) : base.request(url)});
    await tick(); await tick();
    assert(preview() === entry('character').text, '删除来源导致快照丢失');
    assert(document.querySelector('.soda-side-scroll').textContent.includes('来源暂不可用'), '缺少来源提示');
});
test('快速多选按点击顺序组合，响应倒序也不会丢条目', async () => {
    const base = mount(); closePanel(); const pending = [];
    mount({request: url => url.includes('/entry?') ? new Promise(resolve => pending.push(resolve)) : base.request(url)});
    await tick(); cards()[0].click(); cards()[1].click();
    pending[1](response(entry('character', 'b'))); await tick();
    pending[0](response(entry('character'))); await tick();
    await tick();
    assert(preview() === entry('character').text + '\n\n' + entry('character', 'b').text, '多选顺序改变或条目丢失');
});
test('移除组合后，未完成的详情请求不能恢复该项', async () => {
    const base = mount(); closePanel(); let resolveDetail;
    mount({saved: snapshot({character: entry('character')}), request: url => url.includes('key=character%3Ab') ? new Promise(resolve => {resolveDetail = resolve;}) : base.request(url)});
    await tick(); cards()[1].click(); button('移除').click();
    resolveDetail(response(entry('character', 'b'))); await tick();
    assert(!document.querySelector('.soda-selected').textContent.includes('character b'), '移除后旧响应重新加入素材');
});
test('切换筛选后，旧随机请求不能回填', async () => {
    const base = mount(); closePanel(); let resolveRandom;
    mount({request: url => url.includes('random=1') ? new Promise(resolve => {resolveRandom = resolve;}) : base.request(url)});
    await tick(); button('内容').click(); await tick(); button('随机一条').click();
    const search = document.querySelector('.soda-search'); search.value = 'new query'; search.dispatchEvent(new Event('input'));
    resolveRandom(response(entry('content'))); await tick();
    assert(!document.querySelector('.soda-selected').textContent.includes('content a'), '已更改筛选却接受了旧随机结果');
});
test('列表读取失败时清除旧卡片并禁用分页', async () => {
    const base = mount(); closePanel(); let fail = false;
    mount({request: url => fail ? Promise.resolve(response({}, 500)) : base.request(url)});
    await tick(); fail = true; button('下一页').click(); await tick();
    assert(cards().length === 0, '报错后仍显示旧页素材');
    assert(button('下一页').disabled && button('上一页').disabled, '错误状态还能翻页');
});
test('复制权限被拒绝时展开原文并选中文字', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('denied');}}});
    try {
        mount(); await tick(); cards()[0].click(); await tick(); button('复制提示词').click(); await tick();
        const raw = document.querySelector('.soda-raw');
        assert(document.querySelector('.soda-raw-details').open, '备用复制文本仍被折叠');
        assert(document.activeElement === raw && raw.selectionEnd === raw.value.length, '原文未聚焦选中');
    } finally {
        if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else delete navigator.clipboard;
    }
});
test('完整预览保留原文，关闭后回到素材面板', async () => {
    mount(); await tick(); cards()[0].click(); await tick(); button('展开预览').click();
    assert(document.querySelector('.soda-full-text').textContent === entry('character').text, '展开预览改写正文');
    document.querySelector('.soda-text-dialog').dispatchEvent(new Event('cancel', {cancelable:true}));
    assert(!document.querySelector('.soda-text-dialog') && document.querySelector('.soda-library').open, '关闭子预览时关闭了主面板');
});
test('标签切换后迟到的列表响应不会替换当前页', async () => {
    const pending = [];
    mount({request: url => new Promise(resolve => pending.push({url, resolve}))});
    button('服饰').click();
    const result = kind => ({entries:[entry(kind)], total:1, page:1, page_size:60, facets:{}, sources:[], warnings:[]});
    pending[1].resolve(response(result('outfit'))); await tick();
    pending[0].resolve(response(result('character'))); await tick();
    assert(cards()[0].dataset.key === 'outfit:a', '旧页替换了当前服饰列表');
});
test('读取失败后可恢复，已有正文与快照保持不变', async () => {
    const base = mount(); closePanel(); let fail = false;
    const state = mount({saved:snapshot({character:entry('character')}), getText:()=> 'manual body',
        request: url => fail ? Promise.resolve(response({}, 500)) : base.request(url)});
    await tick(); fail = true; button('下一页').click(); await tick();
    assert(preview() === entry('character').text && state.loaded() === null, '读取错误影响了正文或快照');
    fail = false; button('角色').click(); await tick();
    assert(cards().length === 2 && !button('上一页').disabled, '无法恢复到出错前请求的第二页');
});
test('随机请求期间改选卡片后仍可再次随机', async () => {
    const base = mount(); closePanel(); let resolveRandom;
    mount({request: url => url.includes('random=1') ? new Promise(resolve => {resolveRandom = resolve;}) : base.request(url)});
    await tick(); button('内容').click(); await tick(); button('随机一条').click();
    cards()[1].click(); await tick(); resolveRandom(response(entry('content'))); await tick();
    assert(preview() === entry('content', 'b').text, '旧随机结果覆盖手动选择');
    assert(!button('随机一条').disabled, '随机按钮永久禁用');
});
test('刷新请求失败后显示错误而不是永久加载', async () => {
    const base = mount(); closePanel();
    mount({request: url => url.endsWith('/reload') ? Promise.resolve(response({}, 500)) : base.request(url)});
    await tick(); button('刷新库').click(); await tick();
    assert(document.querySelector('.soda-status').textContent.includes('读取失败'), '刷新失败后仍显示正在读取');
    assert(!button('刷新库').disabled, '刷新按钮永久禁用');
    assert(document.querySelector('.soda-grid').getAttribute('aria-busy') === 'false', '刷新失败后仍标记为加载中');
});

test('页签分别记住搜索、页码与重新打开的位置', async () => {
    const browseState = {};
    mount({browseState}); await tick();
    const search = document.querySelector('.soda-search');
    search.value = 'traveler'; search.dispatchEvent(new Event('input'));
    button('服饰').click(); await tick();
    assert(search.value === '', '角色搜索污染服饰');
    button('下一页').click(); await tick();
    button('角色').click(); await tick();
    assert(search.value === 'traveler', '角色搜索未恢复');
    assert(document.querySelector('.soda-pager').textContent.includes('1 / 2'), '未完成的搜索没有重置页码');
    button('服饰').click(); await tick();
    assert(document.querySelector('.soda-pager').textContent.includes('2 / 2'), '服饰页码未恢复');
    closePanel(); mount({browseState}); await tick();
    assert(document.querySelector('.soda-tabs button[aria-pressed=true]').textContent === '服饰', '重新打开没有恢复页签');
    assert(document.querySelector('.soda-pager').textContent.includes('2 / 2'), '重新打开没有恢复页码');
});
test('分类搜索与勾选互不清除；分类跨页签保留', async () => {
    const base = mount(); closePanel();
    mount({request: async url => {
        const result = await base.request(url); const data = await result.json();
        if (data.entries) data.facets = {category:{'作品/Alpha':1,'作品/Beta':1}};
        return response(data);
    }}); await tick();
    button('多选').click();
    const search = document.querySelector('.soda-category-search');
    search.value = 'Alpha'; search.dispatchEvent(new Event('input'));
    assert(document.querySelectorAll('.soda-category-option').length === 1, '分类搜索未缩小列表');
    document.querySelector('.soda-category-option input').click(); await tick();
    search.value = 'Beta'; search.dispatchEvent(new Event('input'));
    document.querySelector('.soda-category-option input').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 2, '改搜分类丢失之前勾选');
    button('服饰').click(); await tick(); button('角色').click(); await tick();
    assert(search.value === 'Beta' && button('完成多选'), '分类搜索和展开状态未恢复');
    assert(document.querySelectorAll('.soda-active-filters button').length === 2, '切换页签丢失已选分类');
    document.querySelector('.soda-active-filters button').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 1, '分类快捷移除失败');
});
test('查看已选缩略图与原文使用快照，不修改当前组合', async () => {
    const character = {...entry('character'),has_preview:true};
    mount({saved:snapshot({character})}); await tick();
    const before = preview();
    const thumb = document.querySelector('.soda-selection-thumb');
    assert(thumb.querySelector('img').getAttribute('src').includes('character%3Aa'), '缩略图引用错误条目');
    button('服饰').click(); await tick();
    document.querySelector('.soda-selection-name').click();
    assert(document.querySelector('.soda-raw').value === character.text, '没有显示保存的原文');
    assert(preview() === before, '查看原文改变了组合');
    thumb.click();
    assert(document.querySelector('.soda-image-dialog').getAttribute('aria-label').includes(character.title), '已选缩略图未打开对应大图');
    document.querySelector('.soda-image-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
    assert(preview() === before, '查看图片改变了组合');
});
test('切换页签和重新打开恢复列表滚动位置', async () => {
    const base = mount(); closePanel(); const browseState = {};
    const request = async url => {
        const result = await base.request(url); const data = await result.json();
        if (data.entries) data.entries = Array.from({length:60},(_,i)=>entry(new URL(url,location.origin).searchParams.get('kind'),String(i)));
        return response(data);
    };
    mount({request,browseState}); await tick();
    const grid = document.querySelector('.soda-grid'); grid.scrollTop = 300;
    assert(grid.scrollTop === 300, '测试列表没有滚动空间');
    button('服饰').click(); await tick(); button('角色').click(); await tick();
    assert(grid.scrollTop === 300, '切换页签丢失滚动位置');
    closePanel(); mount({request,browseState}); await tick();
    assert(document.querySelector('.soda-grid').scrollTop === 300, '重新打开丢失滚动位置');
});

async function mountScrollFixture(options = {}) {
    const base = mount(); closePanel();
    const text = Array.from({length:60},(_,i)=>`Line ${i}: adult traveler in the garden.`).join('\n');
    const request = async url => {
        await options.beforeReply?.(url);
        const result = await base.request(url); const data = await result.json();
        if (data.entries) {
            data.entries = Array.from({length:60},(_,i)=>({...entry('character',String(i)),text}));
            data.facets = {category:Object.fromEntries(Array.from({length:100},(_,i)=>[`作品/${String(i).padStart(3,'0')}`,1]))};
        } else if (data.text) data.text = text;
        return response(data);
    };
    const state = mount({...options,request}); await tick();
    return state;
}
test('勾选靠后的分类后，分类列表不回顶且键盘焦点保留', async () => {
    await mountScrollFixture(); button('多选').click();
    const list = document.querySelector('.soda-category-list'); list.scrollTop = 900;
    const check = list.querySelectorAll('input')[32]; check.focus({preventScroll:true});
    const before = list.scrollTop; check.click(); await tick();
    assert(document.querySelector('.soda-category-list').scrollTop === before, '勾选后分类列表回顶');
    assert(document.activeElement?.value === check.value, '勾选后键盘焦点丢失');
});
test('替换选中卡片时，右侧长预览不回顶', async () => {
    await mountScrollFixture(); cards()[0].click(); await tick();
    const side = document.querySelector(innerWidth <= 760 ? '.soda-library' : '.soda-side-scroll'); side.scrollTop = 350;
    const before = side.scrollTop; cards()[1].click(); await tick();
    assert(before > 0 && side.scrollTop === before, `右侧滚动从 ${before} 跳到 ${side.scrollTop}`);
});
test('刷新未变更的库时保留当前列表滚动位置', async () => {
    await mountScrollFixture(); const grid = document.querySelector('.soda-grid'); grid.scrollTop = 500;
    const before = grid.scrollTop; button('刷新库').click(); await tick(); await tick();
    assert(grid.scrollTop === before, `刷新后列表从 ${before} 回到 ${grid.scrollTop}`);
});
test('关闭展开预览后保持父面板滚动位置', async () => {
    await mountScrollFixture(); cards()[0].click(); await tick();
    const side = document.querySelector(innerWidth <= 760 ? '.soda-library' : '.soda-side-scroll');
    button('展开预览').focus({preventScroll:true}); side.scrollTop = 400;
    const before = side.scrollTop; button('展开预览').click();
    document.querySelector('.soda-text-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
    assert(side.scrollTop === before, `关闭预览后从 ${before} 跳到 ${side.scrollTop}`);
});
test('分类滚动位置在切换页签后恢复', async () => {
    await mountScrollFixture(); button('多选').click();
    document.querySelector('.soda-category-list').scrollTop = 900;
    const before = document.querySelector('.soda-category-list').scrollTop;
    button('服饰').click(); await tick(); button('角色').click(); await tick();
    assert(document.querySelector('.soda-category-list').scrollTop === before, '返回页签时分类列表回顶');
});
test('翻页不会让外层弹窗意外回顶', async () => {
    await mountScrollFixture();
    const panel = document.querySelector('.soda-library');
    panel.scrollTop = 350;
    const before = panel.scrollTop;
    button('下一页').click(); await tick();
    assert(panel.scrollTop === before, `翻页后外层从 ${before} 跳到 ${panel.scrollTop}`);
});
test('重复点击当前页签不重建列表或改变焦点', async () => {
    await mountScrollFixture(); const card = cards()[8]; const grid = document.querySelector('.soda-grid');
    grid.scrollTop = 400; button('角色').click(); await tick();
    assert(cards()[8] === card && grid.scrollTop === 400, '当前页签被无意义重新加载');
});
test('慢速翻页等待期间也不让弹窗回顶', async () => {
    let finish;
    await mountScrollFixture({beforeReply: url => url.includes('page=2') ? new Promise(resolve => {finish = resolve;}) : undefined});
    const panel = document.querySelector('.soda-library'); panel.scrollTop = 300;
    const before = panel.scrollTop;
    button('下一页').click(); await tick();
    assert(panel.scrollTop === before, `等待响应时弹窗从 ${before} 跳到 ${panel.scrollTop}`);
    finish(); await tick();
    assert(panel.scrollTop === before, '响应完成后弹窗位置变化');
});

async function mountTree(options = {}) {
    const base = mount(); closePanel(); const urls = [];
    const request = async url => {
        urls.push(url);
        const data = await (await base.request(url)).json();
        if (data.entries) {
            data.category_tree = options.supported !== false;
            data.facets = {category:{'角色/系列甲/作品一':4,'角色/系列甲/作品二':3,'角色/系列乙/作品一':2}};
        }
        return response(data);
    };
    const state = mount({request, browseState: options.browseState}); await tick();
    return {...state, urls, request};
}
const categoryButton = path => [...document.querySelectorAll('.soda-category-name')].find(el => el.dataset.path === path);
const toggleCategory = path => document.querySelector(`[aria-label="展开或收起：${path}"]`).click();
test('分类默认单选；展开箭头不筛选，父分类查询包含子分类模式', async () => {
    const {urls} = await mountTree(); const before = urls.length;
    assert(!document.querySelector('.soda-category-list input'), '默认仍是多选复选框');
    toggleCategory('角色/系列甲'); await tick();
    assert(urls.length === before && categoryButton('角色/系列甲/作品一'), '展开目录触发请求或未显示子项');
    categoryButton('角色/系列甲').click(); await tick();
    const query = new URL(urls.at(-1), location.origin).searchParams;
    assert(query.get('category') === '角色/系列甲' && query.get('category_mode') === 'branch', '父分类没有使用后端子树筛选');
    categoryButton('角色/系列乙').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 1, '单选时累积了分类');
});
test('同名分类搜索显示所属上级，搜索不修改已选分类', async () => {
    await mountTree(); categoryButton('角色/系列甲').click(); await tick();
    const search = document.querySelector('.soda-category-search'); search.value = '作品一'; search.dispatchEvent(new Event('input'));
    assert(document.querySelectorAll('.soda-category-name').length === 2, '搜索没有跨层级匹配同名分类');
    assert(document.querySelector('.soda-category-list').textContent.includes('角色/系列乙'), '搜索结果缺少所属上级');
    assert(document.querySelectorAll('.soda-active-filters button').length === 1, '搜索清除了选择');
});
test('多选去掉父子重复范围，切回单选及全部素材可继续浏览', async () => {
    await mountTree(); button('多选').click(); toggleCategory('角色/系列甲');
    categoryButton('角色/系列甲/作品一').click(); await tick();
    categoryButton('角色/系列甲').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 1, '父子范围重复累积');
    categoryButton('角色/系列乙').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 2, '多选未保留其他分类');
    button('完成多选').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 1, '退出多选未收敛至单分类');
    button('全部素材').click(); await tick();
    assert(document.querySelector('.soda-active-filters').hidden, '全部素材未清除分类');
});
test('分类展开状态跨页签和重新打开保留', async () => {
    const browseState = {}; const {request, urls} = await mountTree({browseState});
    toggleCategory('角色/系列甲');
    categoryButton('角色/系列甲').click(); await tick();
    button('服饰').click(); await tick(); button('角色').click(); await tick();
    assert(categoryButton('角色/系列甲/作品二'), '切换页签丢失展开状态');
    closePanel(); mount({request,browseState}); await tick();
    assert(categoryButton('角色/系列甲/作品二'), '重新打开丢失展开状态');
    const query = new URL(urls.at(-1),location.origin).searchParams;
    assert(query.get('category') === '角色/系列甲' && query.get('category_mode') === 'branch', '重新打开父分类丢失子树查询模式');
});
test('旧后端不支持子树查询时提示重启，不能悄悄返回错误范围', async () => {
    const {urls} = await mountTree({supported:false}); const before = urls.length;
    categoryButton('角色/系列甲').click(); await tick();
    assert(urls.length === before && document.querySelector('.soda-feedback').textContent.includes('重启'), '旧后端静默执行了不支持的子树请求');
    toggleCategory('角色/系列甲'); categoryButton('角色/系列甲/作品一').click(); await tick();
    assert(new URL(urls.at(-1),location.origin).searchParams.get('category') === '角色/系列甲/作品一', '旧后端叶分类无法继续浏览');
});
test('分类导航与素材各自滚动，窄窗口无横向溢出', async () => {
    await mountScrollFixture();
    const nav = document.querySelector('.soda-category-list'), grid = document.querySelector('.soda-grid');
    nav.scrollTop = 400; const before = grid.scrollTop;
    assert(nav.scrollTop > 0 && grid.scrollTop === before, '分类滚动影响素材列表');
    const panel = document.querySelector('.soda-library');
    assert(panel.scrollWidth <= panel.clientWidth + 1, '弹窗出现横向溢出');
});

test('使用条件按文本显示，与正文和预览依赖分开', async () => {
    const base = mount(); closePanel();
    const value = {...entry('character'), usage: {
        required_loras: [{file:'tool/camera.safetensors',strength:-0.6}],
        preview_loras: [{file:'style/example.safetensors',strength:0.4}],
        note:'<img src=x onerror=alert(1)>'}};
    mount({request: url => url.includes('/entry?') ? Promise.resolve(response(value)) :
        url.startsWith('/userdata/') ? Promise.resolve(response({},404)) : base.request(url)});
    await tick(); cards()[0].click(); await tick(); await tick();
    const box = document.querySelector('.soda-usage');
    assert(!box.hidden && box.textContent.includes('camera.safetensors · -0.6'), '必要模型未显示');
    assert(box.textContent.includes('预览所用 LoRA（不会自动加载）'), '预览与必要依赖混淆');
    assert(box.textContent.includes('<img') && !box.querySelector('img'), '说明被解析为HTML');
    assert(preview() === value.text, '使用条件污染正文');
});

test('旧服务的延迟说明不能回填到其他页签', async () => {
    const base = mount(); closePanel(); let resolveUsage;
    mount({request: url => url.startsWith('/userdata/') ? new Promise(resolve => {resolveUsage=resolve;}) : base.request(url)});
    await tick(); cards()[0].click(); await tick();
    assert(resolveUsage, '没有发起兼容读取');
    button('服饰').click(); await tick();
    resolveUsage(response({version:1,entries:{'character:a':{text:entry('character').text,usage:{note:'过期说明'}}}}));
    await tick(); await tick();
    assert(document.querySelector('.soda-usage').hidden, '迟到说明跨页签回填');
});

test('预览手改进入正文和快照，源素材原文不变', async () => {
    const state = mount(); await tick(); cards()[0].click(); await tick();
    const editor = document.querySelector('.soda-preview');
    editor.textContent = '  手改第一行\n手改第二行  '; editor.dispatchEvent(new Event('input'));
    button('载入正文').click();
    assert(state.loaded().text === '  手改第一行\n手改第二行  ', '载入时丢失手改或换行');
    assert(state.loaded().state.draft_text === state.loaded().text, '快照缺少最终预览');
    assert(state.loaded().state.target_model === 'anima', '快照缺少模型绑定');
    assert(state.loaded().state.selection[0].text === entry('character').text, '手改回写了素材快照');
    mount({saved:state.loaded().state}); await tick();
    assert(preview() === state.loaded().text, '重新打开没有恢复手改预览');
});

test('预览手改后换素材不覆盖手改；可主动恢复组合原文', async () => {
    mount(); await tick(); cards()[0].click(); await tick();
    const editor = document.querySelector('.soda-preview'); editor.textContent = 'manual draft'; editor.dispatchEvent(new Event('input'));
    cards()[1].click(); await tick();
    assert(preview() === 'manual draft', '换素材悄悄覆盖了预览手改');
    button('恢复组合原文').click();
    assert(preview() === entry('character').text + '\n\n' + entry('character','b').text, '无法按当前多选组合重新合并');
});

test('工作流系列绑定控制查询；切换系列保留已选快照并阻止错配内容', async () => {
    let family = null; const state = mount({onTargetChange:value=>{family=value;}}); await tick();
    button('内容').click(); await tick(); cards()[0].click(); await tick();
    const select = document.querySelector('[aria-label="模型库"]'); select.value = 'krea2'; select.dispatchEvent(new Event('change')); await tick();
    assert(family === 'krea2', '绑定修改没有回写工作流');
    assert(select.selectedOptions[0].textContent === 'Krea2', '当前模型库标识未更新');
    assert(preview() === entry('content').text, '修改模型丢弃了旧快照');
    assert(button('载入正文').disabled && state.loaded() === null, '不同模型内容可以直接载入');
});

test('其他系列内容仅查看；角色未验证可主动试用', async () => {
    const base = mount(); closePanel();
    mount({request:async url=>{
        const res = await base.request(url); const data = await res.json();
        if (data.text) data.models = {krea2:'verified'};
        return response(data);
    }}); await tick();
    cards()[0].click(); await tick();
    assert(preview() === entry('character').text, '未验证角色被判为不兼容');
    assert(document.querySelector('.soda-model-detail').textContent.includes('Anima · 未验证'), '缺少未验证标记');
    button('内容').click(); await tick(); cards()[0].click(); await tick();
    assert(!document.querySelector('.soda-selected').textContent.includes('content a'), '其他系列内容被加入组合');
    assert(!button('复制提示词').disabled && document.querySelector('.soda-raw').value === entry('content').text, '仅查看时不能复制原文');
});

test('不推荐服饰可显式试用，试用许可仅适用当前系列', async () => {
    const base = mount(); closePanel();
    mount({request:async url=>{
        const res=await base.request(url); const data=await res.json();
        if (data.text) data.models={anima:'not_recommended'};
        return response(data);
    }}); await tick(); button('服饰').click(); await tick(); cards()[0].click(); await tick();
    assert(preview() === '', '未经主动试用就加入不推荐服饰');
    button('仍要试用此素材').click();
    assert(preview() === entry('outfit').text && !button('载入正文').disabled, '无法主动试用服饰');
});

test('旧服务不支持模型筛选时明确报错，不返回伪匹配结果', async () => {
    mount({request:async()=>({ok:true,status:200,json:async()=>({entries:[entry('content')],total:1,page:1,page_size:60,facets:{},sources:[],warnings:[]})})}); await tick();
    assert(cards().length === 0 && document.querySelector('.soda-status').textContent.includes('重启'), '旧服务静默忽略模型适配');
});

test('模型未绑定时可浏览，不能把组合写入未知工作流', async () => {
    const state = mount({targetModel:''}); await tick(); cards()[0].click(); await tick();
    assert(button('载入正文').disabled && state.loaded() === null, '未绑定工作流可直接插入');
    assert(document.querySelector('.soda-feedback').textContent.includes('绑定'), '未绑定时没有指引');
});

test('旧快照原文和版本匹配时只补模型信息，不采用新正文', async () => {
    const value = {...entry('content'),version:'1'}; delete value.models;
    const base=mount(); closePanel();
    mount({saved:snapshot({content:value}),request:async url=>url.includes('/entry?') ? response({...value,models:{anima:'verified'}}) : base.request(url)});
    await tick(); await tick();
    assert(preview() === value.text && !button('载入正文').disabled, '旧快照未补适配信息或正文改变');
});

test('来源正文更新时不把当前模型标记回填到旧快照', async () => {
    const value={...entry('content'),version:'1'}; delete value.models;
    const base=mount(); closePanel();
    mount({saved:snapshot({content:value}),request:async url=>url.includes('/entry?') ? response({...value,text:'new source text',version:'2',models:{anima:'verified'}}) : base.request(url)});
    await tick(); await tick();
    assert(preview() === value.text && button('载入正文').disabled, '来源新版本覆盖了旧快照正文或验证依据');
});

test('模型库是唯一日常选择器；旧来源筛选不再隐藏其他库', async () => {
    const base=mount(); closePanel(); const urls=[];
    mount({browseState:{kind:'content',content:{source:'old_photography'}},request:url=>{urls.push(url);return base.request(url);}}); await tick();
    const picker=document.querySelector('[aria-label="模型库"]');
    assert(picker && !document.querySelector('[aria-label="数据源"]') && !document.querySelector('.soda-model-settings'), '模型选择与来源选择仍然重复');
    assert([...picker.options].map(o=>o.value).join(',') === ',anima,krea2,moss', '模型库选项不完整');
    assert(!new URL(urls[0],location.origin).searchParams.has('source'), '旧隐藏来源筛选仍在限制列表');
    picker.value='krea2';picker.dispatchEvent(new Event('change'));await tick();
    button('服饰').click();await tick();button('角色').click();await tick();
    assert(picker.value==='krea2', '切页签后模型库选择丢失');
    assert(urls.filter(url=>url.includes('/index?')).slice(-3).every(url=>new URL(url,location.origin).searchParams.get('target_model')==='krea2'), '三个页签没有共用模型库范围');
});

test('同类多选、逐条权重与键盘排序进入快照并恢复', async () => {
    const state = mount(); await tick();
    cards()[0].click(); await tick(); cards()[1].click(); await tick();
    assert(document.querySelectorAll('.soda-selection-row').length === 2, '同类多选丢失条目');
    const weight = document.querySelector('.soda-weight input');
    weight.value = '1.25'; weight.dispatchEvent(new Event('change'));
    const handle = document.querySelector('.soda-drag-handle');
    handle.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',altKey:true,bubbles:true}));
    const expected = entry('character','b').text + '\n\n(' + entry('character').text + ':1.25)';
    assert(preview() === expected, '权重或排序没有写入组合');
    button('载入正文').click();
    const saved = JSON.parse(JSON.stringify(state.loaded().state));
    assert(saved.version === 2 && saved.selection.length === 2, '多选快照没有升级');
    mount({saved}); await tick();
    assert(preview() === expected, '保存重载丢失顺序、原文或权重');
    assert(document.querySelectorAll('.soda-card[aria-pressed="true"]').length === 2, '卡片多选状态没有恢复');
});

test('重复点击已选素材只移除该条，不影响同类其他素材', async () => {
    mount(); await tick(); cards()[0].click(); await tick(); cards()[1].click(); await tick();
    cards()[0].click(); await tick();
    assert(preview() === entry('character','b').text, '取消单项时影响了其他素材');
    assert(document.querySelectorAll('.soda-selection-row').length === 1, '组合数量错误');
});

test('旧页签条目请求一直等待时，新页签仍能正常加入素材', async () => {
    const base = mount(); closePanel(); let resolveOld;
    mount({request:url=>url.includes('key=character%3Aa') ? new Promise(resolve=>{resolveOld=resolve;}) : base.request(url)});
    await tick(); cards()[0].click(); await tick();
    button('服饰').click(); await tick(); cards()[0].click(); await tick();
    assert(preview() === entry('outfit').text, '新页签仍在等待过期请求');
    resolveOld(response(entry('character'))); await tick();
    assert(preview() === entry('outfit').text, '过期条目在新页签回填');
});

test('随机抽到已选条目时保留原文、权重和选中状态', async () => {
    mount(); await tick(); button('内容').click(); await tick(); cards()[0].click(); await tick();
    const weight = document.querySelector('.soda-weight input');
    weight.focus(); weight.value='1.3'; weight.dispatchEvent(new Event('change'));
    assert(document.activeElement === weight, '调整权重时丢失输入焦点');
    const before = preview();
    button('随机一条').click(); await tick();
    assert(preview() === before && document.querySelectorAll('.soda-selection-row').length === 1, '随机重复取消了已选素材或重置权重');
});

test('选材面板模式只读预览，按素材组合生成正文', async () => {
    const saved=snapshot({character:entry('character')},{target_model:'anima',draft_text:'legacy manual draft'});
    const state=mount({saved,editablePreview:false,loadLabel:'应用所选组合'}); await tick();
    assert(preview()===entry('character').text, '只读面板使用了历史手写正文');
    assert(document.querySelector('.soda-preview').contentEditable==='false', '只读预览仍可编辑');
    button('展开预览').click();
    assert(document.querySelector('.soda-full-text').contentEditable==='false', '完整预览仍可编辑');
    document.querySelector('.soda-text-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
    cards()[1].click(); await tick();
    button('应用所选组合').click();
    assert(state.loaded().text===entry('character').text+'\n\n'+entry('character','b').text, '应用结果与素材组合不一致');
});

document.querySelector('#run').onclick = async () => {
    const run = document.querySelector('#run'), output = document.querySelector('#results');
    run.disabled = true; output.textContent = ''; let passed = 0;
    for (const {name, action} of tests) {
        try {await action(); passed++; output.textContent += `PASS ${name}\n`;}
        catch (error) {output.textContent += `FAIL ${name}：${error.message}\n`;}
        finally {closePanel?.();}
    }
    output.textContent += `\n${passed}/${tests.length} passed`;
    run.disabled = false;
};
