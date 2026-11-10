import {test} from "node:test";
import assert from "node:assert/strict";
import {impactTargets, impactTarget, impactPromptText, sodaImportProblem, impactImportProblem, importImpactText} from "../web/impact.js";

function target() {
    const node = {
        id: 522, type: "ImpactWildcardEncode", properties: {}, inputs: [],
        widgets: [
            {name: "wildcard_text", value: "old"}, {name: "populated_text", value: "expanded"},
            {name: "mode", value: "fixed"}, {name: "seed", value: 123},
        ],
        setDirtyCanvas() {},
    };
    node.graph = {getNodeById: id => id === node.id ? node : null};
    return node;
}

test("import updates native prompt widgets without shifting seed or widget order", () => {
    const node = target();
    const names = node.widgets.map(widget => widget.name);
    importImpactText(node, "__soda/pose__ <lora:soda_oc:0.8>");
    assert.deepEqual(node.widgets.map(widget => widget.name), names);
    assert.equal(node.widgets[0].value, node.widgets[1].value);
    assert.equal(node.widgets[2].value, "populate");
    assert.equal(node.widgets[3].value, 123);
    assert.deepEqual(node.properties, {});
});

test("Processor targets import through the same native prompt widgets", () => {
    const node = target();
    node.type = "ImpactWildcardProcessor";
    node.graph._nodes = [node];
    const source = {properties: {soda_impact_target: "522"}, graph: node.graph};
    assert.equal(impactTarget(source), node);
    importImpactText(node, "original Qwen description");
    assert.equal(impactPromptText(node), "original Qwen description");
    assert.equal(node.widgets.find(widget => widget.name === "seed").value, 123);
    node.inputs = [{name: "wildcard_text", link: 42}];
    assert.throws(() => importImpactText(node, "replacement"), /外接/);
});

test("standalone source resolves its saved target and requires a choice for multiple targets", () => {
    const first = {id:522,type:"ImpactWildcardEncode"};
    const second = {id:700,type:"ImpactWildcardEncode"};
    const source = {properties:{},graph:{_nodes:[first,second,{id:576,type:"SodaPromptLibrary"}]}};
    assert.equal(impactTargets(source).length, 2);
    assert.equal(impactTarget(source), null);
    source.properties.soda_impact_target = "700";
    assert.equal(impactTarget(source), second);
    source.graph._nodes = [first];
    assert.equal(impactTarget(source), first);
});

test("replacement confirmation compares the prompt used by the current Impact mode", () => {
    const node = target();
    assert.equal(impactPromptText(node), "expanded");
    node.widgets[2].value = "populate";
    assert.equal(impactPromptText(node), "old");
});

test("legacy hidden text must match the visible material selection before import", () => {
    const source = {properties:{soda_library:{version:1,selection:{character:{key:'role:1',text:'selected role'}}}},widgets:[{name:'text',value:'legacy manual text'}]};
    assert.match(sodaImportProblem(source), /应用当前组合/);
    assert.equal(source.widgets[0].value, 'legacy manual text');
    source.widgets[0].value='selected role';
    assert.equal(sodaImportProblem(source), '');
    source.properties.soda_library.selection.character.text='line one\r\nline two';
    source.widgets[0].value='line one\nline two';
    assert.equal(sodaImportProblem(source), '');
    source.properties.soda_library={version:2,selection:[]};
    assert.match(sodaImportProblem(source), /选择素材/);
});

test("linked or removed targets reject an import before modifying any values", () => {
    const node = target();
    node.inputs = [{name: "populated_text", link: 19}];
    assert.match(impactImportProblem(node), /外接/);
    assert.throws(() => importImpactText(node, "new", {}), /外接/);
    assert.equal(node.widgets[0].value, "old");
    node.inputs = [];
    node.graph.getNodeById = () => null;
    assert.match(impactImportProblem(node), /已移除/);
});
