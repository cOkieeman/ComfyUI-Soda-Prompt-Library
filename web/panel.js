import {compose, kinds, labels, restore, snapshot} from "./model.js?v=0.3.0";
import {createCategories} from "./categories.js?v=0.3.0";
import {usageLines} from "./usage.js";
import {modelNames, modelCaption, modelStatus, selectionProblem, filterCaption} from "./compatibility.js";

const prefix = "/soda_prompt_library";
const filterLabels = {undress: "着装状态", intensity: "强度", scene: "场景", camera: "机位", focal: "焦段"};

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

function pastePlainText(event) {
    if (!event.clipboardData) return;
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
}

export function openLibrary({request, getText, saved, targetModel = saved?.target_model ?? "", onTargetChange = () => {}, browseState = {}, onLoad, onClose = () => {}}) {
    const oldFocus = document.activeElement;
    const dialog = element("dialog", "soda-library");
    dialog.setAttribute("aria-label", "Soda 提示词库");
    const selection = restore(saved);
    let target = modelNames[targetModel] ? targetModel : "";
    let showOther = false, draftText = typeof saved?.draft_text === "string" ? saved.draft_text : compose(selection);
    let draftDirty = draftText !== compose(selection);
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
    const modelSettings = element("details", "soda-model-settings");
    const modelSummary = element("summary", "", `当前适配：${modelNames[target] ?? "未绑定"}`);
    const modelLabel = element("label", "soda-field", "工作流模型系列（社区微调按底模系列）");
    const modelSelect = element("select"); modelSelect.setAttribute("aria-label", "工作流模型系列");
    modelSelect.append(element("option", "", "请选择模型系列")); modelSelect.firstChild.value = "";
    for (const [value, label] of Object.entries(modelNames)) {const option = element("option", "", label); option.value = value; modelSelect.append(option);}
    modelSelect.value = target; modelLabel.append(modelSelect);
    const otherLabel = element("label", "soda-model-scope");
    const otherModels = element("input"); otherModels.type = "checkbox"; otherModels.setAttribute("aria-label", "浏览其他系列与不推荐项");
    otherLabel.append(otherModels, document.createTextNode("浏览其他系列与不推荐项"));
    modelSettings.append(modelSummary, modelLabel, otherLabel, element("p", "soda-muted", "角色与服饰可跨模型试用；内容配方按已验证系列选择。"));
    modelSelect.addEventListener("change", () => {
        target = modelSelect.value; modelSummary.textContent = `当前适配：${modelNames[target] ?? "未绑定"}`;
        onTargetChange(target);
        source = ""; filters = {}; page = 1;
        for (const item of kinds) delete browseState[item];
        categories.clearSearch(); updateSelection(); if (detail) inspect(detail); query();
    });
    otherModels.addEventListener("change", () => {showOther = otherModels.checked; page = 1; query();});
    heading.append(headingText, modelSettings, button("关闭", close));
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
            renderUsage(null);
            detailTitle.textContent = "条目原文";
            detailModel.textContent = ""; tryAnyway.hidden = true;
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
    const detailModel = element("p", "soda-model-detail");
    const tryAnyway = button("仍要试用此素材", () => detail && choose(detail, true)); tryAnyway.hidden = true;
    const usageDetails = element("details", "soda-usage"); usageDetails.hidden = true;
    const usageTitle = element("summary", "", "使用条件与说明");
    const usageBody = element("div", "soda-usage-body");
    usageDetails.append(usageTitle, usageBody);
    let usageCatalog;
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
    preview.contentEditable = "true"; preview.setAttribute("role", "textbox"); preview.setAttribute("aria-multiline", "true");
    preview.setAttribute("aria-label", "合并预览，可手动修改"); preview.tabIndex = 0;
    preview.addEventListener("paste", pastePlainText);
    preview.addEventListener("input", () => {draftText = preview.innerText; draftDirty = draftText !== compose(selection); updateLoadState();});
    const resetDraft = button("恢复组合原文", () => {draftText = compose(selection); draftDirty = false; preview.textContent = draftText; updateLoadState(); message("已恢复所选素材的原文组合，库文件未改变。");});
    resetDraft.title = "放弃本次预览中的手改，恢复角色、服饰、内容的原文组合";
    const expand = button("展开预览", () => {
        const value = draftText;
        if (!value) return;
        const textDialog = element("dialog", "soda-text-dialog");
        textDialog.setAttribute("aria-label", "完整合并预览");
        const textHeading = element("header", "soda-text-head");
        const fullText = element("pre", "soda-full-text", value); fullText.tabIndex = 0; fullText.contentEditable = "true";
        fullText.setAttribute("role", "textbox"); fullText.setAttribute("aria-multiline", "true");
        fullText.addEventListener("paste", pastePlainText);
        fullText.addEventListener("input", () => {draftText = fullText.innerText; draftDirty = draftText !== compose(selection); preview.textContent = draftText; updateLoadState();});
        fullText.setAttribute("aria-label", "完整正文");
        closeText = () => {textDialog.close(); textDialog.remove(); closeText = null; expand.focus({preventScroll: true});};
        const copyAll = button("复制全文", async () => {
            try {await navigator.clipboard.writeText(fullText.innerText); copyAll.textContent = "已复制";}
            catch {copyAll.textContent = "请选中文字后按 Ctrl+C"; fullText.focus();}
        });
        textHeading.append(element("h3", "", "完整合并预览"), copyAll, button("关闭预览", () => closeText?.()));
        textDialog.addEventListener("cancel", event => {event.preventDefault(); closeText?.();});
        textDialog.append(textHeading, fullText);
        document.body.append(textDialog); textDialog.showModal();
    });
    const previewHeading = element("div", "soda-preview-heading");
    previewHeading.append(element("h3", "", "合并预览 · 可手改"), expand);
    const feedback = element("p", "soda-feedback"); feedback.setAttribute("role", "status");
    const confirmation = element("div", "soda-confirm"); confirmation.hidden = true;
    confirmation.append(element("p", "", "将整段替换当前正文，包括你的手改。"), button("确认替换正文", commit, "soda-primary"), button("保留当前正文", () => {confirmation.hidden = true;}));
    const load = button("载入正文", () => {
        if (!draftText || loadProblem()) return;
        if (getText() && getText() !== draftText) confirmation.hidden = false;
        else commit();
    }, "soda-primary");
    sideScroll.append(selected, sourceStatus, detailModel, tryAnyway, detailActions, rawDetails, usageDetails, previewHeading, preview, resetDraft);
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
    function loadProblem() {
        if (!target) return "请先点击顶部“当前适配”，绑定工作流模型系列。";
        return Object.values(selection).map(entry => selectionProblem(entry, target, entry.model_trial === target)).find(Boolean) ?? "";
    }
    function updateLoadState() {
        const problem = loadProblem();
        load.disabled = !draftText || !!problem; load.title = problem;
        expand.disabled = !draftText; resetDraft.hidden = !draftDirty;
        confirmation.hidden = true;
    }
    function commit() {if (loadProblem()) {message(loadProblem()); return;} onLoad(draftText, snapshot(selection, {target_model: target, draft_text: draftText})); close();}
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
                caption.append(element("span", "soda-model-badge", modelCaption(entry, target)));
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
        const scroll = sideScroll.scrollTop;
        if (!draftDirty) draftText = compose(selection);
        preview.textContent = draftText;
        preview.dataset.placeholder = "角色 → 服饰 → 内容，可跳过任一类";
        updateLoadState();
        sideScroll.scrollTop = scroll;
    }
    function markSelected() {
        for (const card of grid.children) card.setAttribute("aria-pressed", String(card.dataset.key === selection[kind]?.key));
    }
    function choose(entry, allowDiscouraged = false) {
        if (entry.kind !== kind) return;
        const problem = selectionProblem(entry, target, allowDiscouraged);
        if (problem) {inspect(entry); message(problem); return;}
        if (allowDiscouraged) entry = {...entry, model_trial: target};
        selection[kind] = structuredClone(entry); inspect(entry);
        updateSelection(); markSelected();
        message(draftDirty ? "组合已改变，已保留预览手改；点击“恢复组合原文”可重新合并。" :
            modelStatus(entry, target) === "verified" ? "已加入待选组合，正文尚未改变。" : "已加入待选组合；此素材在当前系列未验证，请自行试用。");
    }
    function inspect(entry) {
        detail = entry;
        detailTitle.textContent = entry.title; raw.value = entry.text; copy.disabled = false; enlarge.disabled = !entry.has_preview;
        detailModel.textContent = modelCaption(entry, target) + (entry.preview_model ? `\n预览出图：${entry.preview_model}` : "\n预览出图模型未记录");
        tryAnyway.hidden = entry.kind === "content" || modelStatus(entry, target) !== "not_recommended" || !target;
        renderUsage(entry.usage);
        loadUsageFallback(entry);
    }
    function renderUsage(usage) {
        const scroll = sideScroll.scrollTop;
        const lines = usageLines(usage);
        usageBody.replaceChildren(...lines.map(line => element("p", "", line)));
        usageDetails.hidden = !lines.length;
        usageTitle.textContent = usage?.required_loras?.length ? "使用条件 · 需自行加载 LoRA" : "使用条件与预览说明";
        sideScroll.scrollTop = scroll;
    }
    async function loadUsageFallback(entry) {
        // Existing ComfyUI servers may still have the older Python adapter loaded.
        // A user-owned local catalog provides display metadata until their next normal restart.
        usageCatalog ??= json("/userdata/soda_prompt_library_usage.json", {cache: "no-store"}).catch(() => null);
        const catalog = await usageCatalog;
        const value = catalog?.version === 1 ? catalog.entries?.[entry.key] : null;
        if (!closed && detail === entry && value?.text === entry.text && String(value.version) === String(entry.version)) renderUsage({...value.usage, ...entry.usage});
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
        if (target) result.set("target_model", target);
        if (showOther) result.set("model_scope", "all");
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
                const option = element("option", "", `${filterCaption(name, value)} (${count})`);
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
            if (target && result.model_filtering !== true) throw new Error("请重启 ComfyUI 以启用模型适配筛选。");
            total = result.total; page = result.page;
            status.textContent = total ? `找到 ${total.toLocaleString()} 条 · 当前展示 ${result.entries.length} 条` :
                target && kind === "content" && !showOther ? `没有匹配的 ${modelNames[target]} 已验证内容。可更换库或搜索条件；适配设置中可查看其他系列。` : "没有匹配的素材。可更换筛选，或查看下方数据源状态。";
            pageText.textContent = `${page} / ${Math.max(1, Math.ceil(total / result.page_size))}`;
            previous.disabled = page <= 1; next.disabled = page * result.page_size >= total; random.disabled = total === 0;
            sources.replaceChildren(element("option", "", "全部数据源")); sources.firstChild.value = "";
            for (const s of result.sources) {
                if (Array.isArray(s.kinds) && !s.kinds.includes(kind)) continue;
                const otherOnly = target && kind === "content" && !showOther && Object.keys(s.models ?? {}).length && s.models[target] !== "verified";
                if (otherOnly && s.id !== source) continue;
                const o = element("option", "", s.label + (otherOnly ? "（其他系列）" : "")); o.value = s.id; o.disabled = !!otherOnly; sources.append(o);
            }
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
                const hasOutfit = entry.has_outfit === true || entry.kind === "outfit" || entry.category?.startsWith("服饰主题/") || /^【衣】/.test(entry.title || "");
                const badge = element("span", hasOutfit ? "soda-outfit-badge" : "soda-outfit-badge is-none", hasOutfit ? "含服饰描述" : "服饰未标注");
                badge.title = "完整保留条目；角色或内容可能自带衣服，请在组合预览中手动检查和替换。";
                const modelBadge = element("span", "soda-model-badge", modelCaption(entry, target));
                card.append(mediaFor(entry, result.revision), element("strong", "", entry.title), category, modelBadge, badge);
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
        for (const [item, entry] of Object.entries(selection)) {
            try {
                const current = await json(prefix + "/entry?" + new URLSearchParams({key: entry.key}));
                if (!closed && selection[item] === entry && current.text === entry.text && String(current.version) === String(entry.version)) {
                    // Enrich legacy snapshots only when their exact source version still matches.
                    // Never replace saved text or infer validation for a changed source.
                    if (!entry.models) entry.models = current.models;
                    if (!entry.preview_model) entry.preview_model = current.preview_model;
                    updateSelection(); if (detail === entry) inspect(entry);
                }
            }
            catch {missing.push(entry.title);}
        }
        if (!closed) {
            sourceStatus.hidden = !missing.length;
            sourceStatus.textContent = missing.length ? `来源暂不可用：${missing.join("、")}。已保存的正文和组合快照保留。` : "";
        }
    }
    return close;
}
