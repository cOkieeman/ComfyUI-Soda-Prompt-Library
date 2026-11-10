export const kinds = ["character", "outfit", "content"];
export const labels = {character: "角色", outfit: "服饰", content: "内容"};

function entries(selection) {
    if (Array.isArray(selection)) return selection;
    return kinds.flatMap(kind => selection?.[kind] ? [{...selection[kind], kind}] : []);
}

export function supportsPromptWeights(target) {
    return !["krea2", "moss", "qwen"].includes(target);
}

export function compose(selection, target = "") {
    return entries(selection).filter(entry => entry.text !== "").map(entry => {
        const weight = entry.weight ?? 1;
        return weight === 1 || !supportsPromptWeights(target) ? entry.text : `(${entry.text}:${weight})`;
    }).join("\n\n");
}

export function snapshot(selection, options = {}) {
    return {version: 2, selection: JSON.parse(JSON.stringify(entries(selection))), ...options};
}

export function restore(value) {
    if (![1, 2].includes(value?.version)) return [];
    // JSON cloning also accepts the reactive proxies used by the ComfyUI frontend.
    return JSON.parse(JSON.stringify(entries(value.selection))).filter(entry =>
        entry && kinds.includes(entry.kind) && typeof entry.text === "string" && typeof entry.key === "string"
    ).map(entry => ({...entry, weight: Number.isFinite(entry.weight) && entry.weight >= 0 && entry.weight <= 20 ? entry.weight : 1}));
}
