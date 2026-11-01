import {openLibrary} from '../web/panel.js';
import {snapshot} from '../web/model.js';

const entry = (kind, id = 'a') => ({key: `${kind}:${id}`, kind, id, title: `${kind} ${id}`, text: `  ${kind} ${id}\n`, has_preview: false});
const response = (data, status = 200) => ({ok: status < 400, status, json: async () => structuredClone(data)});
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
        return response({entries: [entry(kind), entry(kind, 'b')], total: 120, page: Number(u.searchParams.get('page') || 1), page_size: 60, facets: {}, sources: [], warnings: []});
    });
    closePanel = openLibrary({request, getText: options.getText || (() => ''), saved: options.saved, browseState: options.browseState,
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
test('快速点击时只接受最后一条响应', async () => {
    const base = mount(); closePanel(); const pending = [];
    mount({request: url => url.includes('/entry?') ? new Promise(resolve => pending.push(resolve)) : base.request(url)});
    await tick(); cards()[0].click(); cards()[1].click();
    pending[1](response(entry('character', 'b'))); await tick();
    pending[0](response(entry('character'))); await tick();
    assert(preview() === entry('character', 'b').text, '较早响应覆盖了最后选择');
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
    document.querySelector('.soda-filters').open = true;
    const search = document.querySelector('.soda-category-search');
    search.value = 'Alpha'; search.dispatchEvent(new Event('input'));
    assert(document.querySelectorAll('.soda-category-option').length === 1, '分类搜索未缩小列表');
    document.querySelector('.soda-category-option input').click(); await tick();
    search.value = 'Beta'; search.dispatchEvent(new Event('input'));
    document.querySelector('.soda-category-option input').click(); await tick();
    assert(document.querySelectorAll('.soda-active-filters button').length === 2, '改搜分类丢失之前勾选');
    button('服饰').click(); await tick(); button('角色').click(); await tick();
    assert(search.value === 'Beta' && document.querySelector('.soda-filters').open, '分类搜索和展开状态未恢复');
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
