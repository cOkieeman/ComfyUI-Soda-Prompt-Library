import {test} from "node:test";
import assert from "node:assert/strict";
import {modelCaption, modelStatus, selectionProblem, filterCaption} from "../web/compatibility.js";
import {snapshot, restore, compose} from "../web/model.js";

test("tag characters can be validated on multiple families; unknown is untested", () => {
    const role = {kind:"character", models:{anima:"verified",krea2:"verified"}};
    assert.equal(selectionProblem(role,"krea2"), "");
    assert.equal(selectionProblem(role,"moss"), "");
    assert.equal(modelStatus(role,"moss"), "untested");
    assert.equal(modelCaption(role,"moss"), "MOSS · 未验证 · 另已测 Anima / Krea2");
});
test("content recipes require matching validation; explicit role trials stay bounded", () => {
    const content = {kind:"content",models:{anima:"verified"}};
    assert.ok(selectionProblem(content,"krea2",true));
    assert.equal(selectionProblem(content,"anima"), "");
    const role = {kind:"outfit",models:{moss:"not_recommended"}};
    assert.ok(selectionProblem(role,"moss"));
    assert.equal(selectionProblem(role,"moss",true), "");
    assert.ok(selectionProblem(role,""));
});
test("workflow snapshots retain the chosen family, original entries and edited draft", () => {
    const selection = {outfit:{key:"local:a",text:"original tags",models:{anima:"verified",moss:"untested"}}};
    const state = snapshot(selection,{target_model:"anima",draft_text:"  edited\nbody  "});
    const stored = JSON.parse(JSON.stringify(state));
    assert.equal(stored.draft_text,"  edited\nbody  ");
    assert.equal(stored.target_model,"anima");
    assert.equal(compose(restore(stored)),"original tags");
    assert.deepEqual(restore(stored).outfit.models,selection.outfit.models);
});
test("filter translation changes captions without changing query identifiers", () => {
    assert.equal(filterCaption("scene","bedroom"),"卧室");
    assert.equal(filterCaption("camera","side-back"),"侧后方");
    assert.equal(filterCaption("camera","custom camera"),"custom camera");
    assert.equal(modelCaption({},""),"模型未标注");
});
