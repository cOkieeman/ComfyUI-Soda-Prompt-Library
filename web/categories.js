function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(text, action, cls) {
    const node = el('button', cls, text); node.type = 'button';
    node.addEventListener('click', action); return node;
}

// Keep original paths as identifiers; shortening labels never changes library data.
export function categoryTree(counts) {
    const roots = new Map();
    for (const [path, count] of Object.entries(counts ?? {})) {
        let siblings = roots, prefix = '';
        for (const [index, part] of path.split('/').entries()) {
            prefix = index ? prefix + '/' + part : part;
            if (!siblings.has(prefix)) siblings.set(prefix, {path: prefix, label: part || '未命名', count: 0, own: 0, children: new Map()});
            const node = siblings.get(prefix); node.count += count;
            if (prefix === path) node.own = count;
            siblings = node.children;
        }
    }
    return roots;
}
const browseOrder = ['单人姿态', '服饰主题', '情绪与情境', '单人成人内容', '双人互动', '奇幻与特殊'];
const rank = node => !node.path.includes('/') && browseOrder.includes(node.label) ? browseOrder.indexOf(node.label) :
    /^(其他|未分类)/.test(node.label) ? 100 : 50;
const ordered = nodes => [...nodes.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh-CN'));

export function createCategories({state = {}, onChange, onMessage}) {
    const root = el('aside', 'soda-categories'); root.setAttribute('aria-label', '分类导航');
    const heading = el('div', 'soda-category-heading');
    const multi = button('多选', () => {
        view.multi = !view.multi;
        if (!view.multi && selected.length > 1) {
            selected = selected.slice(-1); onMessage('已切回单选，保留最后选择的分类。'); onChange(selected);
        }
        render();
    }, 'soda-category-multi');
    heading.append(el('h3', '', '分类'), multi);
    const search = el('input', 'soda-category-search'); search.type = 'search';
    search.placeholder = '查找作品或分类'; search.setAttribute('aria-label', '查找作品或分类');
    search.addEventListener('input', () => {view.q = search.value; render(0);});
    const all = button('全部素材', () => {selected = []; onChange([]); render();}, 'soda-category-all');
    const list = el('div', 'soda-category-list'); list.setAttribute('aria-label', '分类 / 作品');
    const hint = el('p', 'soda-muted', '点名称筛选 · 点箭头展开');
    root.append(heading, search, all, list, hint);
    let view, tree = new Map(), selected = [], supported = false;
    function setState(value = {}) {
        view = {q: value.q ?? '', multi: value.multi ?? false,
            expanded: value.expanded == null ? null : new Set(value.expanded), scrollTop: value.scrollTop ?? 0};
        search.value = view.q;
    }
    setState(state);
    function pick(node) {
        if (node.children.size && !supported) {
            onMessage('分类导航已更新；请重启 ComfyUI 后查看父分类下的全部素材。'); return;
        }
        if (!view.multi) selected = [node.path];
        else if (selected.includes(node.path)) selected = selected.filter(path => path !== node.path);
        else selected = [...selected.filter(path => !path.startsWith(node.path + '/') && !node.path.startsWith(path + '/')), node.path];
        onChange([...selected]); render();
    }
    function render(scroll = list.scrollTop) {
        const focus = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
        const panel = root.closest('dialog'), outerScroll = panel?.scrollTop;
        list.replaceChildren();
        multi.setAttribute('aria-pressed', String(view.multi));
        multi.textContent = view.multi ? '完成多选' : '多选';
        all.setAttribute('aria-pressed', String(selected.length === 0));
        const needle = view.q.trim().toLocaleLowerCase();
        function row(node, depth, searching) {
            const item = el('div', 'soda-category-option'); item.style.setProperty('--depth', depth);
            const expanded = view.expanded?.has(node.path);
            if (node.children.size && !searching) {
                const toggle = button(expanded ? '▾' : '▸', () => {
                    if (view.expanded.has(node.path)) view.expanded.delete(node.path); else view.expanded.add(node.path);
                    render();
                }, 'soda-category-toggle');
                toggle.setAttribute('aria-label', `展开或收起：${node.path}`);
                toggle.setAttribute('aria-expanded', String(Boolean(expanded))); toggle.dataset.focusKey = 'toggle:' + node.path;
                item.append(toggle);
            } else item.append(el('span', 'soda-category-spacer'));
            const active = selected.includes(node.path);
            if (view.multi) {
                const check = el('input'); check.type = 'checkbox'; check.value = node.path; check.checked = active;
                check.indeterminate = !active && selected.some(path => path.startsWith(node.path + '/'));
                check.setAttribute('aria-label', `选择分类：${node.path}`); check.dataset.focusKey = 'check:' + node.path;
                check.addEventListener('change', () => pick(node)); item.append(check);
            }
            const name = button('', () => pick(node), 'soda-category-name'); name.title = node.path;
            name.dataset.path = node.path; name.dataset.focusKey = 'name:' + node.path;
            name.setAttribute('aria-pressed', String(active));
            const caption = el('span', 'soda-category-caption'); caption.append(el('span', '', node.label));
            if (searching && node.path.includes('/')) caption.append(el('small', 'soda-muted', node.path.slice(0, node.path.lastIndexOf('/'))));
            name.append(caption, el('span', 'soda-category-count', node.count)); item.append(name);
            if (active) item.classList.add('is-selected');
            list.append(item);
        }
        function walk(nodes, depth) {
            for (const node of ordered(nodes)) {
                if (needle) {
                    if (node.label.toLocaleLowerCase().includes(needle) || (node.own && node.path.toLocaleLowerCase().includes(needle))) row(node, 0, true);
                    walk(node.children, 0);
                } else {
                    row(node, depth, false);
                    if (view.expanded?.has(node.path)) walk(node.children, depth + 1);
                }
            }
        }
        walk(tree, 0);
        if (!list.children.length) list.append(el('p', 'soda-category-empty', needle ? '没有匹配的分类，试试其他关键词。' : '当前数据源没有分类。'));
        if (focus) [...list.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focus)?.focus({preventScroll: true});
        list.scrollTop = scroll;
        if (panel) panel.scrollTop = outerScroll;
    }
    return {
        element: root,
        setState,
        getState: () => ({q: search.value, multi: view.multi, expanded: view.expanded == null ? null : [...view.expanded], scrollTop: view.scrollTop ?? list.scrollTop}),
        clearSearch: () => {search.value = ''; view.q = '';},
        update(counts, picked = [], categoryTreeSupported = false) {
            tree = categoryTree(counts); selected = [...picked]; supported = categoryTreeSupported;
            if (selected.length > 1) view.multi = true;
            const scroll = view.scrollTop;
            if (tree.size) view.scrollTop = null;
            if (view.expanded === null && tree.size) {
                view.expanded = new Set();
                const starts = tree.size === 1 ? [...tree.values()] : [...tree.values()].filter(node => ['角色', '服饰', '内容'].includes(node.label));
                for (let node of starts) {
                    while (node.children.size) {
                        view.expanded.add(node.path);
                        if (node.children.size !== 1) break;
                        node = node.children.values().next().value;
                    }
                }
            }
            render(scroll ?? list.scrollTop);
        },
    };
}
