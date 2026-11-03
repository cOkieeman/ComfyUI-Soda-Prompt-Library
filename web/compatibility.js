export const modelNames = {anima: "Anima", krea2: "Krea2", moss: "MOSS"};
export const statusNames = {verified: "已验证", untested: "未验证", not_recommended: "不推荐"};

export function modelStatus(entry, target) {
    const value = entry?.models?.[target];
    return Object.hasOwn(statusNames, value) ? value : "untested";
}

export function modelCaption(entry, target) {
    if (modelNames[target]) {
        const other = Object.entries(entry?.models ?? {}).filter(([family, status]) => family !== target && modelNames[family] && status === "verified").map(([family]) => modelNames[family]);
        return `${modelNames[target]} · ${statusNames[modelStatus(entry, target)]}` + (other.length ? ` · 另已测 ${other.join(" / ")}` : "");
    }
    const known = Object.entries(entry?.models ?? {}).filter(([family, status]) => modelNames[family] && statusNames[status]);
    return known.length ? known.map(([family, status]) => `${modelNames[family]} · ${statusNames[status]}`).join(" / ") : "模型未标注";
}

export function selectionProblem(entry, target, allowDiscouraged = false) {
    if (!modelNames[target]) return "请先选择上方模型库，绑定工作流的模型系列。";
    const status = modelStatus(entry, target);
    if (entry?.kind === "content" && status !== "verified") return `此内容配方未验证适用于 ${modelNames[target]}，可查看和复制；请切换到对应版本后再加入组合。`;
    if (status === "not_recommended" && !allowDiscouraged) return `此素材在 ${modelNames[target]} 上不推荐，可在详情中主动试用。`;
    return "";
}

const translations = {
    nude: "裸身", clothed: "着装", partial: "部分着装", underwear: "内衣", bottomless: "下身未着装", topless: "上身未着装",
    bedroom: "卧室", bathroom: "浴室", hotel: "酒店", pool: "泳池", onsen: "温泉", tatami: "和室", shrine: "神社",
    chapel: "礼拜堂", dungeon: "地牢", outdoor: "户外", greenhouse: "温室", classroom: "教室", attic: "阁楼",
    kitchen: "厨房", garden: "花园", street: "街道", beach: "海滩", forest: "森林", balcony: "阳台", living_room: "客厅",
    studio: "摄影棚", laundry: "洗衣房", basement: "地下室",
    "eye-level": "平视", "high-angle": "俯拍", "low-angle": "仰拍", "side-back": "侧后方",
    "low-angle-front": "前方仰拍", "low-angle-behind": "后方仰拍", front: "正面", side: "侧面", back: "背面",
    "bird-eye": "鸟瞰", "top-down": "垂直俯拍", pov: "第一人称视角", closeup: "近景", landscape: "横幅", portrait: "竖幅",
};
export function filterCaption(name, value) {
    if (name === "focal") return `${value} mm`;
    if (name === "intensity") return `等级 ${value}`;
    return translations[value] ?? value;
}
