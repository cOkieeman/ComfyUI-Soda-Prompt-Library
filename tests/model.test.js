import {test} from "node:test";
import assert from "node:assert/strict";
import {compose, restore, snapshot} from "../web/model.js";

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
    loaded.character.text = "manual";
    assert.equal(compose(restore(state)), "original");
});

test("invalid or absent source metadata never creates prompt text", () => {
    assert.deepEqual(restore({version: 99, selection: {}}), {});
    assert.deepEqual(restore({version: 1, selection: {character: {text: null}}}), {});
});

test("restores ComfyUI reactive proxy properties without losing a snapshot", () => {
    const entry = new Proxy({key: "a:1", text: "  edited\nbody  ", metadata: new Proxy({scene: "garden"}, {})}, {});
    const selection = new Proxy({character: entry}, {});
    const state = new Proxy({version: 1, selection}, {});
    assert.equal(compose(restore(state)), "  edited\nbody  ");
    assert.deepEqual(snapshot(selection), JSON.parse(JSON.stringify(state)));
    restore(state).character.metadata.scene = "changed";
    assert.equal(entry.metadata.scene, "garden");
});
