import {test} from "node:test";
import assert from "node:assert/strict";
import {compose, restore, snapshot, supportsPromptWeights} from "../web/model.js";

test("composition uses fixed roles, preserves whitespace and omits empty categories", () => {
    assert.equal(compose({content: {text: "garden"}, character: {text: " a,, \n"}}), " a,, \n\n\ngarden");
    assert.equal(compose({}), "");
});

test("snapshots are detached from source and roundtrip with workflow JSON", () => {
    const source = {character: {key: "a:1", text: "original"}};
    const state = snapshot(source);
    source.character.text = "changed source";
    const loaded = restore(JSON.parse(JSON.stringify(state)));
    assert.equal(compose(loaded), "original");
    loaded[0].text = "manual";
    assert.equal(compose(restore(state)), "original");
});

test("invalid or absent source metadata never creates prompt text", () => {
    assert.deepEqual(restore({version: 99, selection: {}}), []);
    assert.deepEqual(restore({version: 1, selection: {character: {text: null}}}), []);
});

test("restores ComfyUI reactive proxy properties without losing a snapshot", () => {
    const entry = new Proxy({key: "a:1", text: "  edited\nbody  ", metadata: new Proxy({scene: "garden"}, {})}, {});
    const selection = new Proxy({character: entry}, {});
    const state = new Proxy({version: 1, selection}, {});
    assert.equal(compose(restore(state)), "  edited\nbody  ");
    assert.equal(snapshot(selection).version, 2);
    restore(state)[0].metadata.scene = "changed";
    assert.equal(entry.metadata.scene, "garden");
});

test("multiple entries of one kind preserve user order and per-entry weights", () => {
    const selection = [
        {key: "a:2", kind: "character", text: "second", weight: 1.25},
        {key: "a:1", kind: "character", text: " first\n", weight: 1},
        {key: "b:1", kind: "outfit", text: "dress", weight: 0},
    ];
    const saved = JSON.parse(JSON.stringify(snapshot(selection)));
    assert.equal(compose(restore(saved)), "(second:1.25)\n\n first\n\n\n(dress:0)");
    assert.deepEqual(restore(saved), selection);
});

test("legacy snapshots migrate role order and retain original source text", () => {
    const saved = {version: 1, selection: {content: {key: "b", text: "scene"}, character: {key: "a", text: "__soda/pose__ <lora:soda_oc:0.8>"}}};
    const restored = restore(saved);
    assert.deepEqual(restored.map(entry => entry.kind), ["character", "content"]);
    assert.equal(compose(restored), "__soda/pose__ <lora:soda_oc:0.8>\n\nscene");
});
test("native language encoders receive original text while Anima retains weights", () => {
    const selection = [{kind: "character", key: "role:1", text: "original {a|b}", weight: 1.2}];
    for (const target of ["krea2", "moss", "qwen"]) {
        assert.equal(supportsPromptWeights(target), false);
        assert.equal(compose(selection, target), "original {a|b}");
    }
    assert.equal(compose(selection, "anima"), "(original {a|b}:1.2)");
    assert.equal(selection[0].weight, 1.2);
});
