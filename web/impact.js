import {compose, restore} from "./model.js?v=0.4.5";

export function sodaImportProblem(source) {
    const selection = restore(source.properties.soda_library);
    if (!selection.length) return "请先在词库选择素材并应用组合";
    const text = source.widgets.find(widget => widget.name === "text").value ?? "";
    const selectedText = compose(selection, source.properties.soda_model_family ?? source.properties.soda_library?.target_model).replace(/\r\n?/g, "\n");
    if (text.replace(/\r\n?/g, "\n") !== selectedText) return "所选素材与历史正文不同，请打开词库并应用当前组合后再导入";
    return "";
}

export function impactImportProblem(node) {
    if (!node.graph || node.graph.getNodeById(node.id) !== node) return "目标 Impact 节点已移除，请关闭词库后重新打开。";
    if (node.inputs?.some(input => ["wildcard_text", "populated_text"].includes(input.name) && input.link != null)) {
        return "Impact 的文本输入正在使用外接连线，请先恢复本地文本框后再导入。";
    }
    if (!["wildcard_text", "populated_text", "mode"].every(name => node.widgets?.some(widget => widget.name === name))) {
        return "目标 Impact 节点缺少提示词控件，请刷新页面后重试。";
    }
    return "";
}

export function impactTargets(source) {
    return source.graph?._nodes.filter(node => ["ImpactWildcardEncode", "ImpactWildcardProcessor"].includes(node.type)) ?? [];
}

export function impactTarget(source) {
    const targets = impactTargets(source);
    return targets.find(node => String(node.id) === String(source.properties.soda_impact_target)) ?? (targets.length === 1 ? targets[0] : null);
}

export function impactPromptText(node) {
    const mode = node.widgets.find(widget => widget.name === "mode").value;
    const name = mode === "populate" ? "wildcard_text" : "populated_text";
    return node.widgets.find(widget => widget.name === name).value ?? "";
}

export function importImpactText(node, text) {
    const problem = impactImportProblem(node);
    if (problem) throw new Error(problem);
    node.graph.beforeChange?.();
    for (const widget of node.widgets) {
        if (["wildcard_text", "populated_text"].includes(widget.name)) {
            widget.value = text;
            const editor = widget.element ?? widget.inputEl;
            if (editor) editor.value = text;
        }
        if (widget.name === "mode") widget.value = "populate";
    }
    node.graph.afterChange?.();
    node.setDirtyCanvas(true, true);
}
