import {compose, kinds, labels, restore, snapshot} from "./model.js";

const prefix = "/soda_prompt_library";
const filterLabels = {family: "族", undress: "着装状态", intensity: "强度", scene: "场景", camera: "机位", focal: "焦段"};

function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

function button(text, action, className = "") {
    const el = element("button", className, text);
    el.type = "button";
    el.addEventListener("click", action);
    return el;
}

export function openLibrary({request, getText, saved, onLoad, onClose = () => {}}) {
    const oldFocus = document.activeElement;
    const dialog = element("dialog", "soda-library");
    dialog.setAttribute("aria-label", "Soda 提示词库");
    const selection = restore(saved);
    let kind = "character", page = 1, source = "", detail = null;
    let filters = {}, total = 0, queryId = 0, detailId = 0, controller;
    let closed = false, searchTimer, closeImage;
    const heading = element("header", "soda-head");
    const headingText = element("div");
    headingText.append(element("h2", "", "Soda 提示词库"), element("p", "soda-muted", "选好素材，预览后载入。原文保留，正文由你修改。"));
    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(searchTimer);
        controller?.abort();
        closeImage?.();
        dialog.close();
        dialog.remove();
        onClose();
        oldFocus?.focus();
    };
    heading.append(headingText, button("关闭", close));
    dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
    dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });

    const tabs = element("nav", "soda-tabs");
    tabs.setAttribute("aria-label", "素材类型");
    const tabButtons = {};
    for (const item of kinds) {
        tabButtons[item] = button(labels[item], () => {
            kind = item; page = 1; filters = {}; source = ""; search.value = "";
            detailId++; detail = null; raw.value = ""; copy.disabled = true; enlarge.disabled = true;
            detailTitle.textContent = "条目原文";
            for (const k of kinds) tabButtons[k].setAttribute("aria-pressed", String(k === kind));
            random.hidden = kind !== "content";
            query();
        });
        tabButtons[item].setAttribute("aria-pressed", String(item === kind));
        tabs.append(tabButtons[item]);
    }
    const toolbar = element("div", "soda-toolbar");
    const search = element("input", "soda-search");
    search.type = "search"; search.placeholder = "搜索名称、作品、ID 或提示词";
    search.setAttribute("aria-label", "搜索素材");
    search.addEventListener("input", () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {page = 1; query();}, 200);});
    const sources = element("select"); sources.setAttribute("aria-label", "数据源");
    sources.addEventListener("change", () => {source = sources.value; page = 1; query();});
    const refresh = button("刷新库", async () => {
        refresh.disabled = true;
        try {await json(prefix + "/reload", {method: "POST"}); await query(); await checkSaved();}
        catch (error) {message(error.message);}
        finally {refresh.disabled = false;}
    });
    const random = button("随机一条", async () => {
        random.disabled = true;
        try {
            const ticket = ++detailId;
            const entry = await json(prefix + "/index?" + params(true));
            if (!closed && ticket === detailId && entry) choose(entry);
        } catch (error) {message(error.message);}
        finally {random.disabled = total === 0;}
    });
    random.hidden = true;
    toolbar.append(search, sources, refresh, random);

    const body = element("div", "soda-body");
    const browse = element("section", "soda-browse");
    const filterBox = element("details", "soda-filters");
    filterBox.append(element("summary", "", "分类与筛选（可多选）"));
    const filterFields = element("div", "soda-filter-fields");
    filterBox.append(filterFields);
    const status = element("p", "soda-status"); status.setAttribute("aria-live", "polite");
    const grid = element("div", "soda-grid"); grid.setAttribute("aria-label", "素材卡片");
    const pager = element("div", "soda-pager");
    const previous = button("上一页", () => {page--; query();});
    const next = button("下一页", () => {page++; query();});
    const pageText = element("span");
    pager.append(previous, pageText, next);
    browse.append(filterBox, status, grid, pager);

    const side = element("aside", "soda-side");
    side.append(element("h3", "", "当前组合"));
    const selected = element("div", "soda-selected");
    const sourceStatus = element("p", "soda-muted");
    const detailTitle = element("h3", "", "条目原文");
    const raw = element("textarea", "soda-raw"); raw.readOnly = true;
    raw.setAttribute("aria-label", "条目原文"); raw.placeholder = "点选卡片，查看完整原文";
    const copy = button("复制提示词", async () => {
        if (!detail) return;
        try {await navigator.clipboard.writeText(detail.text); message("已复制，正文没有变化。");}
        catch {raw.focus(); raw.select(); message("无法直接复制，请在原文框中按 Ctrl+C。");}
    }); copy.disabled = true;
    const enlarge = button("查看大图", () => {
        if (!detail?.has_preview) return;
        const imageDialog = element("dialog", "soda-image-dialog");
        imageDialog.setAttribute("aria-label", detail.title + " 图像预览");
        const imageTitle = element("h3", "", detail.title);
        const img = element("img"); img.alt = detail.title;
        const imageMessage = element("p", "", "正在加载原图…");
        img.addEventListener("load", () => {imageMessage.textContent = "";});
        img.addEventListener("error", () => {imageMessage.textContent = "图片不存在或无法读取，提示词仍可复制。"; img.hidden = true;});
        img.src = prefix + "/preview?" + new URLSearchParams({key: detail.key, v: detail.version});
        closeImage = () => {imageDialog.close(); imageDialog.remove(); closeImage = null; enlarge.focus();};
        imageDialog.addEventListener("cancel", event => {event.preventDefault(); closeImage?.();});
        imageDialog.append(imageTitle, button("关闭大图", () => closeImage?.()), img, imageMessage);
        document.body.append(imageDialog); imageDialog.showModal();
    }); enlarge.disabled = true;
    const detailActions = element("div", "soda-detail-actions"); detailActions.append(copy, enlarge);
    const preview = element("textarea", "soda-preview"); preview.readOnly = true;
    preview.setAttribute("aria-label", "合并预览"); preview.placeholder = "角色 → 服饰 → 内容，可跳过任一类";
    const feedback = element("p", "soda-feedback"); feedback.setAttribute("role", "status");
    const confirmation = element("div", "soda-confirm"); confirmation.hidden = true;
    confirmation.append(element("p", "", "将整段替换当前正文，包括你的手改。"), button("确认替换正文", commit, "soda-primary"), button("保留当前正文", () => {confirmation.hidden = true;}));
    const load = button("载入正文", () => {
        if (!compose(selection)) return;
        if (getText() && getText() !== compose(selection)) confirmation.hidden = false;
        else commit();
    }, "soda-primary");
    side.append(selected, sourceStatus, detailTitle, raw, detailActions, element("h3", "", "合并预览"), preview, feedback, confirmation, load);
    body.append(browse, side);
    const diagnostics = element("details", "soda-diagnostics");
    diagnostics.append(element("summary", "", "数据源状态"));
    const warnings = element("div"); diagnostics.append(warnings);
    dialog.append(heading, tabs, toolbar, body, diagnostics);
    document.body.append(dialog);
    dialog.showModal();
    updateSelection(); query(); checkSaved(); search.focus();

    async function json(url, options) {
        const response = await request(url, options);
        if (!response.ok) throw new Error(response.status === 404 ? "来源条目不存在；已保存正文仍然可用。" : `读取失败（${response.status}），请重试。`);
        return response.json();
    }
    function message(text) {feedback.textContent = text;}
    function commit() {onLoad(compose(selection), snapshot(selection)); close();}
    function updateSelection() {
        selected.replaceChildren();
        for (const item of kinds) {
            const row = element("div", "soda-selection-row");
            row.append(element("span", "soda-muted", labels[item]), element("span", "", selection[item]?.title ?? "未选择"));
            if (selection[item]) row.append(button("移除", () => {delete selection[item]; updateSelection(); markSelected();}));
            selected.append(row);
        }
        preview.value = compose(selection); load.disabled = !preview.value;
        confirmation.hidden = true;
    }
    function markSelected() {
        for (const card of grid.children) card.setAttribute("aria-pressed", String(card.dataset.key === selection[kind]?.key));
    }
    function choose(entry) {
        if (entry.kind !== kind) return;
        detail = entry; selection[kind] = structuredClone(entry);
        detailTitle.textContent = entry.title; raw.value = entry.text; copy.disabled = false; enlarge.disabled = !entry.has_preview;
        updateSelection(); markSelected(); message("已加入待选组合，正文尚未改变。");
    }
    function params(roll = false) {
        const result = new URLSearchParams({kind, q: search.value, page: String(page)});
        if (source) result.set("source", source);
        if (roll) result.set("random", "1");
        for (const [name, values] of Object.entries(filters)) for (const value of values) result.append(name, value);
        return result;
    }
    function renderFilters(facets) {
        filterFields.replaceChildren();
        const names = {category: "分类 / 作品", ...(kind === "content" ? filterLabels : {})};
        for (const [name, label] of Object.entries(names)) {
            const values = Object.entries(facets[name] ?? {});
            if (!values.length) continue;
            const field = element("label", "soda-field", label);
            const select = element("select"); select.multiple = true; select.size = 4;
            select.setAttribute("aria-label", label);
            for (const [value, count] of values.sort((a, b) => a[0].localeCompare(b[0]))) {
                const option = element("option", "", `${value} (${count})`);
                option.value = value; option.selected = filters[name]?.includes(value) ?? false;
                select.append(option);
            }
            select.addEventListener("change", () => {filters[name] = [...select.selectedOptions].map(o => o.value); page = 1; query();});
            field.append(select); filterFields.append(field);
        }
        filterFields.append(button("清除筛选", () => {filters = {}; source = ""; page = 1; query();}));
    }
    async function query() {
        controller?.abort(); controller = new AbortController();
        const ticket = ++queryId;
        status.textContent = "正在读取素材…";
        try {
            const result = await json(prefix + "/index?" + params(), {signal: controller.signal});
            if (closed || ticket !== queryId) return;
            total = result.total; page = result.page;
            status.textContent = total ? `找到 ${total.toLocaleString()} 条 · 当前展示 ${result.entries.length} 条` : "没有匹配的素材。可更换筛选，或查看下方数据源状态。";
            pageText.textContent = `${page} / ${Math.max(1, Math.ceil(total / result.page_size))}`;
            previous.disabled = page <= 1; next.disabled = page * result.page_size >= total; random.disabled = total === 0;
            sources.replaceChildren(element("option", "", "全部数据源")); sources.firstChild.value = "";
            for (const s of result.sources) {const o = element("option", "", s.label); o.value = s.id; sources.append(o);}
            sources.value = source;
            renderFilters(result.facets);
            grid.replaceChildren();
            for (const entry of result.entries) {
                const card = button("", async () => {
                    const detailTicket = ++detailId;
                    try {const value = await json(prefix + "/entry?" + new URLSearchParams({key: entry.key})); if (!closed && detailTicket === detailId) choose(value);}
                    catch (error) {message(error.message);}
                }, "soda-card");
                card.dataset.key = entry.key;
                const media = element("div", "soda-media");
                const placeholder = element("span", "soda-placeholder", "暂无预览"); media.append(placeholder);
                if (entry.has_preview) {
                    const img = element("img"); img.loading = "lazy"; img.alt = entry.title;
                    img.src = prefix + "/preview?" + new URLSearchParams({key: entry.key, v: result.revision});
                    img.addEventListener("load", () => {placeholder.hidden = true;}, {once: true});
                    img.addEventListener("error", () => img.remove(), {once: true}); media.append(img);
                }
                card.append(media, element("strong", "", entry.title), element("span", "soda-category", entry.category));
                grid.append(card);
            }
            markSelected(); grid.scrollTop = 0;
            warnings.replaceChildren();
            for (const s of result.sources) warnings.append(element("p", "", `${s.label}：${s.status === "ready" ? `${s.count} 条` : "不可用"}`));
            for (const warning of result.warnings) warnings.append(element("p", "soda-warning", warning));
        } catch (error) {
            if (error.name !== "AbortError" && !closed && ticket === queryId) status.textContent = error.message;
        }
    }
    async function checkSaved() {
        const missing = [];
        for (const entry of Object.values(restore(saved))) {
            try {await json(prefix + "/entry?" + new URLSearchParams({key: entry.key}));}
            catch {missing.push(entry.title);}
        }
        if (!closed) sourceStatus.textContent = missing.length ? `来源暂不可用：${missing.join("、")}。已保存的正文和组合快照保留。` : "载入过的素材保留快照；重新点选卡片才采用库中当前版本。";
    }
    return close;
}
