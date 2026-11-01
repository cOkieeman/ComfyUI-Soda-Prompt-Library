import {compose, kinds, labels, restore, snapshot} from "./model.js";
import {createCategories} from "./categories.js?v=0.2.0";

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

export function openLibrary({request, getText, saved, browseState = {}, onLoad, onClose = () => {}}) {
    const oldFocus = document.activeElement;
    const dialog = element("dialog", "soda-library");
    dialog.setAttribute("aria-label", "Soda 提示词库");
    const selection = restore(saved);
    let kind = kinds.includes(browseState.kind) ? browseState.kind : "character";
    const initialView = viewFor(kind);
    let page = initialView.page, source = initialView.source, detail = null;
    let filters = initialView.filters, total = 0, queryId = 0, detailId = 0, controller;
    let loading = true, desiredScroll = initialView.scrollTop, facets = {};
    let pendingFilterScroll = initialView.filterScroll;
    let categoryTreeSupported = false;
    let closed = false, searchTimer, closeImage, closeText;
    const heading = element("header", "soda-head");
    const headingText = element("div");
    headingText.append(element("h2", "", "Soda 提示词库"), element("p", "soda-muted", "选好素材，预览后载入。原文保留，正文由你修改。"));
    const close = () => {
        if (closed) return;
        saveView();
        closed = true;
        clearTimeout(searchTimer);
        controller?.abort();
        closeImage?.();
        closeText?.();
        dialog.close();
        dialog.remove();
        onClose();
        oldFocus?.focus({preventScroll: true});
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
            if (item === kind && !loading) return;
            saveView();
            kind = item;
            const view = viewFor(kind);
            page = view.page; filters = view.filters; source = view.source; search.value = view.q;
            categories.setState(view.categoryView); filterBox.open = view.filtersOpen;
            filterBox.hidden = kind !== "content";
            pendingFilterScroll = view.filterScroll;
            facets = {}; renderFilters(facets, {});
            detailId++; detail = null; raw.value = ""; copy.disabled = true; enlarge.disabled = true;
            detailTitle.textContent = "条目原文";
            if (selection[kind]) inspect(selection[kind]);
            for (const k of kinds) tabButtons[k].setAttribute("aria-pressed", String(k === kind));
            random.hidden = kind !== "content";
            query(view.scrollTop);
        });
        tabButtons[item].setAttribute("aria-pressed", String(item === kind));
        tabs.append(tabButtons[item]);
    }
    const toolbar = element("div", "soda-toolbar");
    const search = element("input", "soda-search");
    search.type = "search"; search.placeholder = "搜索名称、作品、ID 或提示词";
    search.setAttribute("aria-label", "搜索素材");
    search.value = initialView.q;
    search.addEventListener("input", () => {
        page = 1; desiredScroll = 0;
        clearTimeout(searchTimer); invalidateBrowse();
        searchTimer = setTimeout(() => query(), 200);
    });
    const sources = element("select"); sources.setAttribute("aria-label", "数据源");
    sources.addEventListener("change", () => {source = sources.value; filters.category = []; page = 1; query();});
    const refresh = button("刷新库", async () => {
        refresh.disabled = true;
        const scroll = loading ? desiredScroll : grid.scrollTop;
        desiredScroll = scroll;
        invalidateBrowse();
        const ticket = queryId;
        try {
            await json(prefix + "/reload", {method: "POST"});
            if (closed || ticket !== queryId) return;
            await query(scroll); await checkSaved();
        }
        catch (error) {
            if (!closed && ticket === queryId) {
                grid.setAttribute('aria-busy', 'false');
                status.textContent = error.message; message(error.message);
            }
        }
        finally {refresh.disabled = false;}
    });
    const random = button("随机一条", async () => {
        random.disabled = true;
        const ticket = ++detailId;
        try {
            const entry = await json(prefix + "/index?" + params(true));
            if (!closed && ticket === detailId && entry) choose(entry);
        } catch (error) {if (!closed && ticket === detailId) message(error.message);}
        finally {if (!closed && ticket === detailId) random.disabled = total === 0;}
    });
    random.hidden = kind !== "content";
    toolbar.append(search, sources, refresh, random);

    const body = element("div", "soda-body");
    const browse = element("section", "soda-browse");
    const categories = createCategories({state: initialView.categoryView,
        onChange: picked => {filters.category = picked; page = 1; query();}, onMessage: message});
    const filterBox = element("details", "soda-filters");
    filterBox.append(element("summary", "", "更多筛选"));
    filterBox.open = initialView.filtersOpen;
    filterBox.hidden = kind !== "content";
    const filterFields = element("div", "soda-filter-fields");
    filterBox.append(filterFields);
    const activeFilters = element("div", "soda-active-filters"); activeFilters.hidden = true;
    const status = element("p", "soda-status"); status.setAttribute("aria-live", "polite");
    const grid = element("div", "soda-grid"); grid.setAttribute("aria-label", "素材卡片");
    const pager = element("div", "soda-pager");
    const previous = button("上一页", () => {page--; query();});
    const next = button("下一页", () => {page++; query();});
    const pageText = element("span");
    pager.append(previous, pageText, next);
    browse.append(filterBox, activeFilters, status, grid, pager);

    const side = element("aside", "soda-side");
    const sideScroll = element("div", "soda-side-scroll");
    sideScroll.append(element("h3", "", "当前组合"));
    const selected = element("div", "soda-selected");
    const sourceStatus = element("p", "soda-muted"); sourceStatus.hidden = true;
    const rawDetails = element("details", "soda-raw-details");
    const detailTitle = element("summary", "", "条目原文");
    const raw = element("textarea", "soda-raw"); raw.readOnly = true;
    raw.setAttribute("aria-label", "条目原文"); raw.placeholder = "点选卡片，查看完整原文";
    const copy = button("复制提示词", async () => {
        if (!detail) return;
        try {await navigator.clipboard.writeText(detail.text); message("已复制，正文没有变化。");}
        catch {rawDetails.open = true; raw.focus(); raw.select(); message("无法直接复制，请在原文框中按 Ctrl+C。");}
    }); copy.disabled = true;
    const enlarge = button("查看大图", () => showImage(detail, enlarge)); enlarge.disabled = true;
    function showImage(entry, trigger) {
        if (!entry?.has_preview) return;
        const imageDialog = element("dialog", "soda-image-dialog");
        imageDialog.setAttribute("aria-label", entry.title + " 图像预览");
        const imageTitle = element("h3", "", entry.title);
        const img = element("img"); img.alt = entry.title;
        const imageMessage = element("p", "", "正在加载原图…");
        img.addEventListener("load", () => {imageMessage.textContent = "";});
        img.addEventListener("error", () => {imageMessage.textContent = "图片不存在或无法读取，提示词仍可复制。"; img.hidden = true;});
        img.src = prefix + "/preview?" + new URLSearchParams({key: entry.key, v: entry.version ?? ""});
        closeImage = () => {imageDialog.close(); imageDialog.remove(); closeImage = null; trigger?.focus({preventScroll: true});};
        imageDialog.addEventListener("cancel", event => {event.preventDefault(); closeImage?.();});
        imageDialog.append(imageTitle, button("关闭大图", () => closeImage?.()), img, imageMessage);
        document.body.append(imageDialog); imageDialog.showModal();
    }
    const detailActions = element("div", "soda-detail-actions"); detailActions.append(copy, enlarge);
    rawDetails.append(detailTitle, raw);
    const preview = element("pre", "soda-preview");
    preview.setAttribute("aria-label", "合并预览"); preview.tabIndex = 0;
    const expand = button("展开预览", () => {
        const value = compose(selection);
        if (!value) return;
        const textDialog = element("dialog", "soda-text-dialog");
        textDialog.setAttribute("aria-label", "完整合并预览");
        const textHeading = element("header", "soda-text-head");
        const fullText = element("pre", "soda-full-text", value); fullText.tabIndex = 0;
        fullText.setAttribute("aria-label", "完整正文");
        closeText = () => {textDialog.close(); textDialog.remove(); closeText = null; expand.focus({preventScroll: true});};
        const copyAll = button("复制全文", async () => {
            try {await navigator.clipboard.writeText(value); copyAll.textContent = "已复制";}
            catch {copyAll.textContent = "请选中文字后按 Ctrl+C"; fullText.focus();}
        });
        textHeading.append(element("h3", "", "完整合并预览"), copyAll, button("关闭预览", () => closeText?.()));
        textDialog.addEventListener("cancel", event => {event.preventDefault(); closeText?.();});
        textDialog.append(textHeading, fullText);
        document.body.append(textDialog); textDialog.showModal();
    });
    const previewHeading = element("div", "soda-preview-heading");
    previewHeading.append(element("h3", "", "合并预览"), expand);
    const feedback = element("p", "soda-feedback"); feedback.setAttribute("role", "status");
    const confirmation = element("div", "soda-confirm"); confirmation.hidden = true;
    confirmation.append(element("p", "", "将整段替换当前正文，包括你的手改。"), button("确认替换正文", commit, "soda-primary"), button("保留当前正文", () => {confirmation.hidden = true;}));
    const load = button("载入正文", () => {
        if (!compose(selection)) return;
        if (getText() && getText() !== compose(selection)) confirmation.hidden = false;
        else commit();
    }, "soda-primary");
    sideScroll.append(selected, sourceStatus, detailActions, rawDetails, previewHeading, preview);
    const sideFooter = element("div", "soda-side-footer");
    sideFooter.append(feedback, confirmation, load);
    side.append(sideScroll, sideFooter);
    body.append(categories.element, browse, side);
    const diagnostics = element("details", "soda-diagnostics");
    diagnostics.append(element("summary", "", "数据源状态"));
    const warnings = element("div"); diagnostics.append(warnings);
    dialog.append(heading, tabs, toolbar, body, diagnostics);
    document.body.append(dialog);
    dialog.showModal();
    updateSelection();
    if (selection[kind]) inspect(selection[kind]);
    query(initialView.scrollTop); checkSaved(); search.focus();

    function viewFor(item) {
        const stored = browseState[item] ?? {};
        return {page: 1, source: "", filters: {}, q: "", scrollTop: 0, filtersOpen: false, filterScroll: {},
            ...stored, categoryView: stored.categoryView ?? {q: stored.categoryQuery ?? "", scrollTop: stored.filterScroll?.category ?? 0}};
    }
    function saveView() {
        browseState.kind = kind;
        browseState[kind] = {page, source, filters, q: search.value, categoryView: categories.getState(),
            scrollTop: loading ? desiredScroll : grid.scrollTop, filtersOpen: filterBox.open,
            filterScroll: pendingFilterScroll ?? captureFilterScroll()};
    }

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
            const entry = selection[item];
            const caption = element("div", "soda-selection-caption");
            caption.append(element("span", "soda-muted", labels[item]));
            if (entry) {
                const thumb = button("", () => entry.has_preview ? showImage(entry, thumb) : inspectSelected(entry), "soda-selection-thumb");
                thumb.setAttribute("aria-label", `${entry.has_preview ? "查看大图" : "查看原文"}：${entry.title}`);
                thumb.append(mediaFor(entry, entry.version));
                row.append(thumb);
                const name = button(entry.title, () => inspectSelected(entry), "soda-selection-name");
                name.title = "查看已选原文";
                caption.append(name);
            } else {
                row.classList.add("soda-selection-empty");
                caption.append(element("span", "soda-muted", "未选择"));
            }
            row.append(caption);
            if (entry) row.append(button("移除", () => {
                if (item === kind) {detailId++; random.disabled = total === 0;}
                delete selection[item]; updateSelection(); markSelected();
            }));
            selected.append(row);
        }
        const value = compose(selection);
        preview.textContent = value || "角色 → 服饰 → 内容，可跳过任一类";
        load.disabled = !value; expand.disabled = !value;
        confirmation.hidden = true;
    }
    function markSelected() {
        for (const card of grid.children) card.setAttribute("aria-pressed", String(card.dataset.key === selection[kind]?.key));
    }
    function choose(entry) {
        if (entry.kind !== kind) return;
        selection[kind] = structuredClone(entry); inspect(entry);
        updateSelection(); markSelected(); message("已加入待选组合，正文尚未改变。");
    }
    function inspect(entry) {
        detail = entry;
        detailTitle.textContent = entry.title; raw.value = entry.text; copy.disabled = false; enlarge.disabled = !entry.has_preview;
    }
    function inspectSelected(entry) {
        inspect(entry); rawDetails.open = true;
        raw.focus(); message("正在查看已选素材的原文快照，组合和正文没有变化。");
    }
    function mediaFor(entry, version = "") {
        const media = element("div", "soda-media");
        const placeholder = element("span", "soda-placeholder", "暂无预览"); media.append(placeholder);
        if (entry.has_preview) {
            const img = element("img"); img.loading = "lazy"; img.alt = entry.title;
            img.src = prefix + "/preview?" + new URLSearchParams({key: entry.key, v: version ?? ""});
            img.addEventListener("load", () => {placeholder.hidden = true;}, {once: true});
            img.addEventListener("error", () => img.remove(), {once: true}); media.append(img);
        }
        return media;
    }
    function params(roll = false) {
        const result = new URLSearchParams({kind, q: search.value, page: String(page)});
        if (source) result.set("source", source);
        if (roll) result.set("random", "1");
        result.set("category_mode", "branch");
        for (const [name, values] of Object.entries(filters)) for (const value of values) result.append(name, value);
        return result;
    }
    function captureFilterScroll() {
        return {fields: filterFields.scrollTop, category: categories.element.querySelector('.soda-category-list').scrollTop,
            selects: Object.fromEntries([...filterFields.querySelectorAll('select')].map(el => [el.dataset.filter, el.scrollTop]))};
    }
    function restoreFilterScroll(scroll) {
        for (const el of filterFields.querySelectorAll('select')) el.scrollTop = scroll.selects?.[el.dataset.filter] ?? 0;
        filterFields.scrollTop = scroll.fields ?? 0;
    }
    function renderFilters(facets, scroll = captureFilterScroll()) {
        const focused = filterFields.contains(document.activeElement) ? document.activeElement : null;
        const parentScroll = dialog.scrollTop;
        filterFields.replaceChildren();
        activeFilters.replaceChildren();
        for (const value of filters.category ?? []) {
            const chip = button(`${value.split("/").at(-1)} ×`, () => {
                filters.category = filters.category.filter(item => item !== value); page = 1; query();
            });
            chip.title = value; chip.setAttribute("aria-label", `移除分类：${value}`); activeFilters.append(chip);
        }
        activeFilters.hidden = !activeFilters.children.length;
        categories.update(facets.category, filters.category, categoryTreeSupported);
        const names = kind === "content" ? filterLabels : {};
        for (const [name, label] of Object.entries(names)) {
            const values = Object.entries(facets[name] ?? {});
            if (!values.length) continue;
            const field = element("label", "soda-field", label);
            const select = element("select"); select.multiple = true; select.size = 4;
            select.dataset.filter = name;
            select.setAttribute("aria-label", label);
            for (const [value, count] of values.sort((a, b) => a[0].localeCompare(b[0]))) {
                const option = element("option", "", `${value} (${count})`);
                option.value = value; option.selected = filters[name]?.includes(value) ?? false;
                select.append(option);
            }
            select.addEventListener("change", () => {filters[name] = [...select.selectedOptions].map(o => o.value); page = 1; query();});
            field.append(select); filterFields.append(field);
        }
        filterFields.append(button("清除筛选", () => {filters = {}; source = ""; categories.clearSearch(); page = 1; query();}));
        if (focused) {
            const replacement = [...filterFields.querySelectorAll('input, select, button')].find(el =>
                el.tagName === focused.tagName && (el.tagName === 'BUTTON' ? el.textContent === focused.textContent :
                    el.tagName === 'SELECT' ? el.dataset.filter === focused.dataset.filter : el.value === focused.value));
            (replacement ?? filterBox.querySelector('summary')).focus({preventScroll: true});
        }
        restoreFilterScroll(scroll);
        dialog.scrollTop = parentScroll;
    }
    function invalidateBrowse() {
        controller?.abort(); queryId++; detailId++; total = 0;
        loading = true;
        grid.style.setProperty('--soda-loading-height', `${grid.getBoundingClientRect().height}px`);
        grid.setAttribute('aria-busy', 'true');
        grid.replaceChildren();
        previous.disabled = true; next.disabled = true; random.disabled = true;
        pageText.textContent = "—";
        status.textContent = "正在读取素材…";
    }
    async function query(scrollTop = 0) {
        if (closed) return;
        desiredScroll = scrollTop;
        clearTimeout(searchTimer);
        invalidateBrowse(); controller = new AbortController();
        const ticket = queryId;
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
            categoryTreeSupported = result.category_tree === true;
            facets = result.facets; renderFilters(facets, pendingFilterScroll ?? captureFilterScroll()); pendingFilterScroll = null;
            grid.replaceChildren();
            for (const entry of result.entries) {
                const card = button("", async () => {
                    const detailTicket = ++detailId;
                    random.disabled = total === 0;
                    try {const value = await json(prefix + "/entry?" + new URLSearchParams({key: entry.key})); if (!closed && detailTicket === detailId) choose(value);}
                    catch (error) {if (!closed && detailTicket === detailId) message(error.message);}
                }, "soda-card");
                card.dataset.key = entry.key;
                const category = element("span", "soda-category", entry.category?.split('/').at(-1));
                category.title = entry.category ?? "";
                card.append(mediaFor(entry, result.revision), element("strong", "", entry.title), category);
                grid.append(card);
            }
            grid.setAttribute('aria-busy', 'false');
            markSelected(); grid.scrollTop = scrollTop; loading = false;
            warnings.replaceChildren();
            for (const s of result.sources) warnings.append(element("p", "", `${s.label}：${s.status === "ready" ? `${s.count} 条` : "不可用"}`));
            for (const warning of result.warnings) warnings.append(element("p", "soda-warning", warning));
        } catch (error) {
            if (error.name !== "AbortError" && !closed && ticket === queryId) {
                grid.setAttribute('aria-busy', 'false'); status.textContent = error.message;
            }
        }
    }
    async function checkSaved() {
        const missing = [];
        for (const entry of Object.values(restore(saved))) {
            try {await json(prefix + "/entry?" + new URLSearchParams({key: entry.key}));}
            catch {missing.push(entry.title);}
        }
        if (!closed) {
            sourceStatus.hidden = !missing.length;
            sourceStatus.textContent = missing.length ? `来源暂不可用：${missing.join("、")}。已保存的正文和组合快照保留。` : "";
        }
    }
    return close;
}
