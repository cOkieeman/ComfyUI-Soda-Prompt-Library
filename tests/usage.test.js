import assert from "node:assert/strict";
import test from "node:test";
import {usageLines} from "../web/usage.js";
import {compose, snapshot} from "../web/model.js";

test("preview models are presented separately from required models without altering the prompt", () => {
    const usage = {required_loras: [{file: "tool/camera.safetensors", strength: -0.6, trigger: "view"}],
        preview_loras: [{file: "style\\example.safetensors", strength: 0.4}], note: "仅在此配置测试"};
    const entry = {text: " exact body,,\n", usage};
    const selection = {content: entry};
    const text = compose(selection);
    assert.equal(text, entry.text);
    assert.ok(usageLines(usage).includes("需要自行加载"));
    assert.ok(usageLines(usage).includes("camera.safetensors · -0.6"));
    assert.ok(usageLines(usage).includes("预览所用 LoRA（不会自动加载）"));
    assert.ok(usageLines(usage).includes("example.safetensors · 0.4"));
    const saved = snapshot(selection);
    usage.required_loras[0].strength = 5;
    assert.equal(saved.selection[0].usage.required_loras[0].strength, -0.6);
    assert.equal(compose(saved.selection), entry.text);
});

test("malformed optional metadata does not break browsing", () => {
    for (const value of [null, undefined, [], "text"]) assert.deepEqual(usageLines(value), []);
    assert.deepEqual(usageLines({preview_loras: [null, 3, {}, {file: "x", strength: Infinity}]}),
        ["预览所用 LoRA（不会自动加载）", "x"]);
    assert.deepEqual(usageLines({note: "<img src=x onerror=alert(1)>"}), ["<img src=x onerror=alert(1)>"]);
});
