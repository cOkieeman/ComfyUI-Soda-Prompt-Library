import {compose, kinds, labels, restore, snapshot, supportsPromptWeights} from "./model.js?v=0.4.5";
import {createCategories} from "./categories.js?v=0.3.0";
import {usageLines} from "./usage.js";
import {modelNames, modelCaption, modelStatus, selectionProblem, filterCaption} from "./compatibility.js?v=0.4.4";

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

export function openLibrary({request, getText, saved, targetModel = saved?.target_model ?? "", onTargetChange = () => {}, browseState = {}, onLoad, onClose = () => {}, loadLabel = "载入正文", importProblem = () => "", editablePreview = true}) {
    const oldFocus = document.activeElement;
    const dialog = element("dialog", "soda-library");
    dialog.setAttribute("aria-label", "Soda 提示词库");
    const selection = restore(saved);
    let target = modelNames[targetModel] ? targetModel : "";
    let showOther = false, draftText = editablePreview && typeof saved?.draft_text === "string" ? saved.draft_text : compose(selection, target);
    let draftDirty = draftText !== compose(selection, target);
    let kind = kinds.includes(browseState.kind) ? browseState.kind : "character";
    const initialView = viewFor(kind);
    let page = initialView.page, detail = null;
    let filters = initialView.filters, total = 0, queryId = 0, detailId = 0, controller;
    let loading = true, desiredScroll = initialView.scrollTop, facets = {};
    let pendingFilterScroll = initialView.filterScroll;
    let categoryTreeSupported = false;
    let closed = false, searchTimer, closeImage, closeText;
    let choiceQueue = Promise.resolve(), selectionEpoch = 0;
    const heading = element("header", "soda-head");
    const headingText = element("div");
    headingText.append(element("h2", "", "Soda 提示词库"), element("p", "soda-muted", editablePreview ? "多选素材 · 拖动排序 · 调整权重 · 预览后导入" : "多选素材 · 拖动排序 · 调整权重 · 应用到选材面板"));
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
    const modelLabel = element("label", "soda-model-picker", "模型库");
    const modelSelect = element("select"); modelSelect.setAttribute("aria-label", "模型库");
    modelSelect.title = "选择当前使用的模型系列；社区微调按底模系列选择，三个页签共用。";
    modelSelect.append(element("option", "", "请选择")); modelSelect.firstChild.value = ""; modelSelect.firstChild.disabled = true;
    for (const [value, label] of Object.entries(modelNames)) {const option = element("option", "", label); option.value = value; modelSelect.append(option);}
    modelSelect.value = target; modelLabel.append(modelSelect);
    const otherLabel = element("label", "soda-model-scope");
    const otherModels = element("input"); otherModels.type = "checkbox"; otherModels.setAttribute("aria-label", "浏览其他系列与不推荐项");
    otherLabel.append(otherModels, document.createTextNode("浏览其他系列与不推荐项"));
    modelSelect.addEventListener("change", () => {
        target = modelSelect.value;
        onTargetChange(target);
        filters = {}; page = 1;
        for (const item of kinds) delete browseState[item];
        categories.clearSearch(); updateSelection(); if (detail) inspect(detail); query();
    });
    otherModels.addEventListener("change", () => {showOther = otherModels.checked; page = 1; query();});
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
            page = view.page; filters = view.filters; search.value = view.q;
            categories.setState(view.categoryView); filterBox.open = view.filtersOpen;
            filterBox.hidden = kind !== "content";
            pendingFilterScroll = view.filterScroll;
            facets = {}; renderFilters(facets, {});
            detailId++; detail = null; raw.value = ""; copy.disabled = true; enlarge.disabled = true;
            renderUsage(null);
            detailTitle.textContent = "条目原文";
            detailModel.textContent = ""; tryAnyway.hidden = true;
            const picked = selection.findLast(entry => entry.kind === kind);
            if (picked) inspect(picked);
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
    toolbar.append(search, modelLabel, refresh, random);

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
    const selectionHeading = element("div", "soda-selection-heading");
    const selectionCount = element("span", "soda-muted");
    selectionHeading.append(element("h3", "", "当前组合"), selectionCount);
    sideScroll.append(selectionHeading, element("p", "soda-muted", "拖动左侧手柄排序；聚焦手柄后按 Alt＋方向键也可移动。"));
    const selected = element("div", "soda-selected");
    const sourceStatus = element("p", "soda-muted"); sourceStatus.hidden = true;
    const rawDetails = element("details", "soda-raw-details");
    const detailTitle = element("summary", "", "条目原文");
    const raw = element("textarea", "soda-raw"); raw.readOnly = true;
    const detailModel = element("p", "soda-model-detail");
    const tryAnyway = button("仍要试用此素材", () => detail && choose(detail, {allowDiscouraged: true})); tryAnyway.hidden = true;
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
    preview.contentEditable = String(editablePreview); preview.setAttribute("role", "textbox"); preview.setAttribute("aria-multiline", "true");
    preview.setAttribute("aria-readonly", String(!editablePreview));
    preview.setAttribute("aria-label", editablePreview ? "合并预览，可手动修改" : "合并预览"); preview.tabIndex = 0;
    preview.addEventListener("paste", pastePlainText);
    preview.addEventListener("input", () => {draftText = preview.innerText; draftDirty = draftText !== compose(selection, target); updateLoadState();});
    const resetDraft = button("恢复组合原文", () => {draftText = compose(selection, target); draftDirty = false; preview.textContent = draftText; updateLoadState(); message("已恢复所选素材的原文组合，库文件未改变。");});
    resetDraft.title = "放弃本次预览中的手改，恢复角色、服饰、内容的原文组合";
    const expand = button("展开预览", () => {
        const value = draftText;
        if (!value) return;
        const textDialog = element("dialog", "soda-text-dialog");
        textDialog.setAttribute("aria-label", "完整合并预览");
        const textHeading = element("header", "soda-text-head");
        const fullText = element("pre", "soda-full-text", value); fullText.tabIndex = 0; fullText.contentEditable = String(editablePreview);
        fullText.setAttribute("role", "textbox"); fullText.setAttribute("aria-multiline", "true");
        fullText.addEventListener("paste", pastePlainText);
        fullText.addEventListener("input", () => {draftText = fullText.innerText; draftDirty = draftText !== compose(selection, target); preview.textContent = draftText; updateLoadState();});
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
    previewHeading.append(element("h3", "", editablePreview ? "合并预览 · 可手改" : "合并预览"), expand);
    const feedback = element("p", "soda-feedback"); feedback.setAttribute("role", "status");
    const confirmation = element("div", "soda-confirm"); confirmation.hidden = true;
    confirmation.append(element("p", "", editablePreview ? "将整段替换当前正文，包括你的手改。" : "将用当前选择更新 Soda 节点保存的组合。"), button(editablePreview ? "确认替换正文" : "确认应用组合", commit, "soda-primary"), button(editablePreview ? "保留当前正文" : "保留现有组合", () => {confirmation.hidden = true;}));
    const load = button(loadLabel, () => {
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
    diagnostics.append(otherLabel, element("p", "soda-muted", "模型库在上方选择。角色与服饰可跨模型试用；内容配方按已验证系列选择。"));
    const warnings = element("div"); diagnostics.append(warnings);
    dialog.append(heading, tabs, toolbar, body, diagnostics);
    document.body.append(dialog);
    dialog.showModal();
    updateSelection();
    const initialEntry = selection.findLast(entry => entry.kind === kind);
    if (initialEntry) inspect(initialEntry);
    query(initialView.scrollTop); checkSaved(); search.focus();

    function viewFor(item) {
        const stored = browseState[item] ?? {};
        return {page: 1, filters: {}, q: "", scrollTop: 0, filtersOpen: false, filterScroll: {},
            ...stored, categoryView: stored.categoryView ?? {q: stored.categoryQuery ?? "", scrollTop: stored.filterScroll?.category ?? 0}};
    }
    function saveView() {
        browseState.kind = kind;
        browseState[kind] = {page, filters, q: search.value, categoryView: categories.getState(),
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
        const destinationProblem = importProblem();
        if (destinationProblem) return destinationProblem;
        if (!target) return "请先选择上方模型库，绑定工作流的模型系列。";
        return selection.map(entry => selectionProblem(entry, target, entry.model_trial === target)).find(Boolean) ?? "";
    }
    function updateLoadState() {
        const problem = loadProblem();
        load.disabled = !draftText || !!problem; load.title = problem;
        expand.disabled = !draftText; resetDraft.hidden = !draftDirty;
        confirmation.hidden = true;
    }
    function commit() {
        if (loadProblem()) {message(loadProblem()); return;}
        try {onLoad(draftText, snapshot(selection, {target_model: target, draft_text: draftText})); close();}
        catch (error) {message(error.message); updateLoadState();}
    }
    function moveSelection(key, index) {
        const from = selection.findIndex(entry => entry.key === key);
        if (from < 0 || index < 0 || index >= selection.length || from === index) return;
        selection.splice(index, 0, selection.splice(from, 1)[0]);
        updateSelection();
        selected.querySelector(`[data-key="${CSS.escape(key)}"] .soda-drag-handle`)?.focus({preventScroll: true});
    }
    function updateSelection() {
        const scroll = sideScroll.scrollTop;
        selected.replaceChildren();
        if (!supportsPromptWeights(target)) selected.append(element("p", "soda-muted", "当前模型按原文组合，数值权重不可用。"));
        selectionCount.textContent = `${selection.length} 项`;
        for (const [index, entry] of selection.entries()) {
            const row = element("div", "soda-selection-row");
            row.dataset.key = entry.key;
            const handle = button("", () => {}, "soda-drag-handle");
            handle.innerHTML = '<svg viewBox="0 0 16 20" width="12" height="18" aria-hidden="true"><path d="M5 4h1m4 0h1M5 10h1m4 0h1M5 16h1m4 0h1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            handle.draggable = true;
            handle.setAttribute("aria-label", `排序 ${entry.title}`);
            handle.addEventListener("dragstart", event => {
                event.dataTransfer.setData("application/x-soda-selection", entry.key);
                event.dataTransfer.effectAllowed = "move";
                row.classList.add("is-dragging");
            });
            handle.addEventListener("dragend", () => {
                for (const item of selected.children) item.classList.remove("is-dragging", "is-drop-target");
            });
            handle.addEventListener("keydown", event => {
                if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                moveSelection(entry.key, index + (event.key === "ArrowUp" ? -1 : 1));
            });
            row.addEventListener("dragover", event => {
                if (!event.dataTransfer.types.includes("application/x-soda-selection")) return;
                event.preventDefault(); row.classList.add("is-drop-target");
            });
            row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
            row.addEventListener("drop", event => {
                const key = event.dataTransfer.getData("application/x-soda-selection");
                if (!key) return;
                event.preventDefault(); moveSelection(key, index);
            });
            const caption = element("div", "soda-selection-caption");
            caption.append(element("span", "soda-muted", labels[entry.kind]));
            const thumb = button("", () => entry.has_preview ? showImage(entry, thumb) : inspectSelected(entry), "soda-selection-thumb");
            thumb.setAttribute("aria-label", `${entry.has_preview ? "查看大图" : "查看原文"}：${entry.title}`);
            thumb.append(mediaFor(entry, entry.version));
            const name = button(entry.title, () => inspectSelected(entry), "soda-selection-name");
            name.title = "查看已选原文";
            caption.append(name, element("span", "soda-model-badge", modelCaption(entry, target)));
            const weightLabel = element("label", "soda-weight", supportsPromptWeights(target) ? "权重" : "原文");
            const weight = element("input");
            weight.type = "number"; weight.min = "0"; weight.max = "20"; weight.step = "0.05";
            weight.value = supportsPromptWeights(target) ? entry.weight ?? 1 : 1;
            weight.disabled = !supportsPromptWeights(target);
            if (weight.disabled) weight.title = "当前模型的原生编码器按原文读取，不解析数值权重。";
            weight.setAttribute("aria-label", `${entry.title} 权重`);
            weight.addEventListener("change", () => {
                if (!weight.validity.valid || weight.value === "") {weight.value = entry.weight ?? 1; return;}
                entry.weight = weight.valueAsNumber;
                updatePreview();
            });
            weightLabel.append(weight);
            row.append(handle, thumb, caption, weightLabel, button("移除", () => {
                detailId++; selectionEpoch++; choiceQueue = Promise.resolve(); random.disabled = total === 0;
                selection.splice(selection.indexOf(entry), 1);
                updateSelection(); markSelected();
            }, "soda-remove"));
            selected.append(row);
        }
        if (!selection.length) selected.append(element("p", "soda-selection-empty soda-muted", "点击素材卡片加入组合，同类可选多项。"));
        updatePreview();
        sideScroll.scrollTop = scroll;
    }
    function updatePreview() {
        if (!draftDirty) draftText = compose(selection, target);
        preview.textContent = draftText;
        preview.dataset.placeholder = "按当前列表顺序合并，可自由手改";
        updateLoadState();
    }
    function markSelected() {
        const keys = new Set(selection.map(entry => entry.key));
        for (const card of grid.children) card.setAttribute("aria-pressed", String(keys.has(card.dataset.key)));
    }
    function choose(entry, {allowDiscouraged = false, toggle = false} = {}) {
        if (entry.kind !== kind) return;
        const index = selection.findIndex(item => item.key === entry.key);
        const problem = index >= 0 && toggle ? "" : selectionProblem(entry, target, allowDiscouraged);
        if (problem) {inspect(entry); message(problem); return;}
        if (allowDiscouraged) entry = {...entry, model_trial: target};
        if (index >= 0 && toggle) selection.splice(index, 1);
        else if (index < 0) selection.push({...structuredClone(entry), weight: 1});
        else if (allowDiscouraged) selection[index].model_trial = target;
        inspect(entry);
        updateSelection(); markSelected();
        message(draftDirty ? "组合已改变，已保留预览手改；点击“恢复组合原文”可重新合并。" : index >= 0 && toggle ? "已从待选组合移除此素材。" :
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
        filterFields.append(button("清除筛选", () => {filters = {}; categories.clearSearch(); page = 1; query();}));
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
        choiceQueue = Promise.resolve();
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
                target && kind === "content" && !showOther ? `没有匹配的 ${modelNames[target]} 已验证内容。可更换模型库、分类或搜索条件。` : "没有匹配的素材。可更换筛选，或查看下方数据源状态。";
            pageText.textContent = `${page} / ${Math.max(1, Math.ceil(total / result.page_size))}`;
            previous.disabled = page <= 1; next.disabled = page * result.page_size >= total; random.disabled = total === 0;
            categoryTreeSupported = result.category_tree === true;
            facets = result.facets; renderFilters(facets, pendingFilterScroll ?? captureFilterScroll()); pendingFilterScroll = null;
            grid.replaceChildren();
            for (const entry of result.entries) {
                const card = button("", async () => {
                    detailId++;
                    const browsingTicket = queryId, epoch = selectionEpoch;
                    random.disabled = total === 0;
                    const result = json(prefix + "/entry?" + new URLSearchParams({key: entry.key})).then(value => ({value}), error => ({error}));
                    choiceQueue = choiceQueue.then(async () => {
                        const {value, error} = await result;
                        if (closed || browsingTicket !== queryId || epoch !== selectionEpoch) return;
                        if (error) message(error.message);
                        else choose(value, {toggle: true});
                    });
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
        for (const entry of [...selection]) {
            try {
                const current = await json(prefix + "/entry?" + new URLSearchParams({key: entry.key}));
                if (!closed && selection.includes(entry) && current.text === entry.text && String(current.version) === String(entry.version)) {
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
