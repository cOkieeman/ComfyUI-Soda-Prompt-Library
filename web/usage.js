// Optional display metadata. Prompt composition never reads these fields.
export function usageLines(usage) {
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) return [];
    const lines = [];
    const list = (key, heading) => {
        const items = Array.isArray(usage[key]) ? usage[key] : [];
        const valid = items.filter(item => item && typeof item.file === "string");
        if (!valid.length) return;
        lines.push(heading);
        for (const item of valid) {
            const filename = item.file.split(/[\\/]/).pop();
            const weight = typeof item.strength === "number" && Number.isFinite(item.strength) ? ` · ${item.strength}` : "";
            lines.push(`${filename}${weight}`);
            if (typeof item.trigger === "string" && item.trigger.trim()) lines.push(`触发词：${item.trigger}`);
        }
    };
    list("required_loras", "需要自行加载");
    if (typeof usage.tested_with === "string" && usage.tested_with.trim()) lines.push(`已测范围：${usage.tested_with}`);
    if (typeof usage.preview_conditions === "string" && usage.preview_conditions.trim()) lines.push(`预览条件：${usage.preview_conditions}`);
    list("preview_loras", "预览所用 LoRA（不会自动加载）");
    if (typeof usage.preview_triggers === "string" && usage.preview_triggers.trim()) lines.push(`预览触发词：${usage.preview_triggers}`);
    if (typeof usage.note === "string" && usage.note.trim()) lines.push(usage.note);
    return lines;
}
