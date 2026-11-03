import {app} from "../../scripts/app.js";
import {api} from "../../scripts/api.js";
import {openLibrary} from "./panel.js?v=0.3.0";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./style.css?v=0.3.0", import.meta.url).href;
document.head.append(stylesheet);

app.registerExtension({
    name: "Soda.PromptLibrary",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SodaPromptLibrary") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const text = this.widgets.find(widget => widget.name === "text");
            text.label = "正文";
            const editor = () => text.element ?? text.inputEl;
            if (editor()) {editor().placeholder = "在这里手写，或打开库选择后修改"; editor().setAttribute("aria-label", "正文");}
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
                    onLoad: (value, state) => {
                        this.graph?.beforeChange?.();
                        text.value = value;
                        if (editor()) editor().value = value;
                        text.callback?.(value);
                        this.properties.soda_library = state;
                        this.properties.soda_model_family = state.target_model;
                        this.graph?.afterChange?.();
                        this.setDirtyCanvas(true, true);
                    },
                    onClose: () => {closePanel = null;},
                });
            }, {serialize: false});
            this.widgets.splice(this.widgets.indexOf(open), 1);
            this.widgets.unshift(open);
            this.setSize([420, 370]);
            const removed = this.onRemoved;
            this.onRemoved = function () {closePanel?.(); return removed?.apply(this, arguments);};
            return result;
        };
    },
});
