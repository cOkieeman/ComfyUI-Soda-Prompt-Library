import {app} from "../../scripts/app.js";
import {api} from "../../scripts/api.js";
import {openLibrary} from "./panel.js?v=0.4.5";
import {restore, labels, supportsPromptWeights} from "./model.js?v=0.4.5";
import {impactTargets, impactTarget, impactPromptText, sodaImportProblem, impactImportProblem, importImpactText} from "./impact.js?v=0.4.5";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./style.css?v=0.4.2", import.meta.url).href;
document.head.append(stylesheet);

const targetLabel = node => node ? `#${node.id} · ${node.title}` : "请选择 Impact 节点";

function notice(message, severity = "info") {
    app.extensionManager.toast.add({severity, summary: message, life: 4000});
}

function selectionSummary(node) {
    const root = document.createElement("section");
    root.className = "soda-node-summary";
    root.setAttribute("aria-label", "Soda 已选素材");
    const heading = document.createElement("div"); heading.className = "soda-node-heading";
    const title = document.createElement("strong"); title.textContent = "已选素材";
    const count = document.createElement("span");
    heading.append(title, count);
    const grid = document.createElement("div"); grid.className = "soda-node-selections";
    const hint = document.createElement("p"); hint.className = "soda-node-hint";
    root.append(heading, hint, grid);
    function render() {
        const selection = restore(node.properties.soda_library);
        count.textContent = `${selection.length} 项`;
        hint.textContent = selection.length ? sodaImportProblem(node) : "";
        hint.hidden = !hint.textContent;
        grid.replaceChildren();
        if (!selection.length) {
            const empty = document.createElement("p");
            empty.className = "soda-node-empty";
            empty.textContent = "打开词库选择角色、服饰和内容";
            grid.append(empty);
        }
        for (const entry of selection) {
            const card = document.createElement("article"); card.className = "soda-node-selection";
            const media = document.createElement("div"); media.className = "soda-node-media";
            const placeholder = document.createElement("span"); placeholder.textContent = "暂无预览";
            media.append(placeholder);
            if (entry.has_preview) {
                const img = document.createElement("img"); img.alt = entry.title; img.loading = "lazy";
                img.src = api.apiURL("/soda_prompt_library/preview?" + new URLSearchParams({key: entry.key, v: entry.version ?? ""}));
                img.addEventListener("load", () => {placeholder.hidden = true;}, {once: true});
                img.addEventListener("error", () => img.remove(), {once: true});
                media.append(img);
            }
            const caption = document.createElement("strong"); caption.textContent = entry.title;
            caption.title = entry.title;
            const kind = document.createElement("span"); kind.className = "soda-node-kind";
            const target = node.properties.soda_model_family ?? node.properties.soda_library?.target_model;
            kind.textContent = `${labels[entry.kind]} · ${supportsPromptWeights(target) ? `权重 ${entry.weight}` : "原文"}`;
            card.append(media, caption, kind);
            grid.append(card);
        }
        if (node.graph) node.setDirtyCanvas(true, true);
    }
    return {element: root, render};
}

app.registerExtension({
    name: "Soda.PromptLibrary",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SodaPromptLibrary") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const text = this.widgets.find(widget => widget.name === "text");
            if (!text) return result;
            text.hidden = true;
            text.computeSize = () => [0, -4];
            text.options.canvasOnly = true;
            const editor = () => text.element ?? text.inputEl;
            const hideEditor = () => {if (editor()) editor().style.display = "none";};
            hideEditor(); requestAnimationFrame(hideEditor);
            const summary = selectionSummary(this);
            let closePanel;
            const browseState = {};
            const open = this.addWidget("button", "打开库…", null, () => {
                if (closePanel) return;
                closePanel = openLibrary({
                    request: (url, options) => api.fetchApi(url, options),
                    getText: () => text.value ?? "",
                    saved: this.properties.soda_library,
                    targetModel: this.properties.soda_model_family ?? this.properties.soda_library?.target_model ?? "",
                    onTargetChange: family => {
                        this.graph?.beforeChange?.();
                        this.properties.soda_model_family = family;
                        this.graph?.afterChange?.();
                        this.setDirtyCanvas(true, true);
                    },
                    browseState,
                    editablePreview: false,
                    loadLabel: "应用所选组合",
                    onLoad: (value, state) => {
                        this.graph?.beforeChange?.();
                        text.value = value;
                        if (editor()) editor().value = value;
                        text.callback?.(value);
                        this.properties.soda_library = state;
                        this.properties.soda_model_family = state.target_model;
                        summary.render();
                        this.graph?.afterChange?.();
                        this.setDirtyCanvas(true, true);
                    },
                    onClose: () => {closePanel = null;},
                });
            }, {serialize: false});
            this.widgets.splice(this.widgets.indexOf(open), 1);
            this.widgets.unshift(open);
            const summaryWidget = this.addDOMWidget("soda_selections", "div", summary.element, {serialize: false, hideOnZoom: false});
            summaryWidget.serialize = false;
            summaryWidget.computeSize = () => [0, 236];
            const destination = this.addWidget("combo", "导入目标", targetLabel(impactTarget(this)), () => {}, {
                values: () => ["请选择 Impact 节点", ...impactTargets(this).map(targetLabel)], serialize: false,
            });
            destination.serialize = false;
            Object.defineProperty(destination, "value", {
                get: () => targetLabel(impactTarget(this)),
                set: value => {
                    this.graph?.beforeChange?.();
                    this.properties.soda_impact_target = String(impactTargets(this).find(node => targetLabel(node) === value)?.id ?? "");
                    this.graph?.afterChange?.();
                },
            });
            const send = this.addWidget("button", "导入到 Impact", null, () => {
                const target = impactTarget(this);
                if (!target) {notice("请先选择要导入的 Impact 节点", "warn"); return;}
                const problem = impactImportProblem(target);
                if (problem) {notice(problem, "warn"); return;}
                const sourceProblem = sodaImportProblem(this);
                if (sourceProblem) {notice(sourceProblem, "warn"); return;}
                const value = text.value ?? "";
                const previous = impactPromptText(target);
                if (previous && previous !== value && !window.confirm(`将替换 Impact #${target.id} 的正文，包括当前手改。确认导入？`)) return;
                importImpactText(target, value);
                notice(`已导入 Impact #${target.id}，可在上框继续修改`, "success");
            }, {serialize: false});
            send.serialize = false;
            this.setSize([520, 360]);
            const hideUnusedInput = () => {
                const inputIndex = this.inputs?.findIndex(input => input.name === "text" && input.link == null) ?? -1;
                if (inputIndex >= 0) this.removeInput(inputIndex);
            };
            const added = this.onAdded;
            this.onAdded = function () {
                const addedResult = added?.apply(this, arguments);
                hideUnusedInput(); hideEditor(); summary.render();
                return addedResult;
            };
            const configured = this.onConfigure;
            this.onConfigure = function () {
                const configuredResult = configured?.apply(this, arguments);
                hideUnusedInput();
                hideEditor(); summary.render();
                return configuredResult;
            };
            summary.render();
            const removed = this.onRemoved;
            this.onRemoved = function () {closePanel?.(); return removed?.apply(this, arguments);};
            return result;
        };
    },
});
