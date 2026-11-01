export const kinds = ["character", "outfit", "content"];
export const labels = {character: "角色", outfit: "服饰", content: "内容"};

export function compose(selection) {
    return kinds.map(kind => selection[kind]?.text ?? "").filter(text => text !== "").join("\n\n");
}

export function snapshot(selection) {
    return {version: 1, selection: JSON.parse(JSON.stringify(selection))};
}

export function restore(value) {
    const selection = {};
    if (value?.version !== 1) return selection;
    for (const kind of kinds) {
        const entry = value.selection?.[kind];
        if (entry && typeof entry.text === "string" && typeof entry.key === "string") {
            // ComfyUI may wrap saved properties in reactive Proxies after loading.
            selection[kind] = JSON.parse(JSON.stringify(entry));
        }
    }
    return selection;
}
