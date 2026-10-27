/** Chain must send the Load node's storage selection to both HTTP routes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const requests = [];
const extensions = [];
const api = {
  addEventListener() {},
  async fetchApi(url, options) {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, async json() { return { exists: true, removed: 2 }; } };
  },
};
const source = await readFile(new URL("../web/h3_motion_context.js", import.meta.url), "utf8");
const chain = vm.runInNewContext(
  source.replace(/^import .*;\r?$/gm, "") +
    "\n({ firstClipExists, clearLatents, usesClipIds, advance, resetFirst, startChain, syncRefines });",
  { app: { registerExtension(extension) { extensions.push(extension); } }, api },
);

function pair(values) {
  return { load: { widgets: Object.entries(values).map(([name, value]) => ({ name, value })) } };
}

const custom = pair({
  latent_path: "story_01",
  storage_root: "/runpod-volume/h3_latents",
  folder: "output",
});
assert.equal(await chain.firstClipExists(custom), true);
assert.deepEqual(requests.pop(), {
  url: "/h3_motion_context/slot_exists",
  body: { latent_path: "story_01", storage_root: "/runpod-volume/h3_latents",
          folder: "output", clip_id: "", clip_index: 1 },
});
assert.equal(await chain.clearLatents(custom), 2);
assert.deepEqual(requests.pop(), {
  url: "/h3_motion_context/clear_latents",
  body: { latent_path: "story_01", storage_root: "/runpod-volume/h3_latents",
          folder: "output", clip_id: "" },
});

// Old graphs have neither the new root widget nor, sometimes, folder.
assert.equal(await chain.firstClipExists(pair({ latent_path: "h3_context" })), true);
assert.deepEqual(requests.pop().body, {
  latent_path: "h3_context", storage_root: "", folder: "output", clip_id: "", clip_index: 1,
});
await chain.clearLatents(pair({ latent_path: "uploaded.safetensors", folder: "input" }));
assert.deepEqual(requests.pop().body, {
  latent_path: "uploaded.safetensors", storage_root: "", folder: "input", clip_id: "",
});

// Named requests carry the caller's ID; indexed automation must never
// increment an ignored index and overwrite that same UUID in a loop.
const named = pair({ storage_root: "/runpod-volume/h3_latents",
                     clip_id: "414f844c-41fd-4ca5-a5e3-b7381577d346" });
named.load.comfyClass = "MiniMaxH3MotionContextLoadLatent";
named.save = { comfyClass: "MiniMaxH3MotionContextSaveLatent", widgets: [] };
const ctrl = { graph: { _nodes: [named.load, named.save], _groups: [] } };
assert.equal(chain.usesClipIds(named), true);
assert.equal(await chain.firstClipExists(named), true);
assert.equal(requests.pop().body.clip_id, "414f844c-41fd-4ca5-a5e3-b7381577d346");
assert.equal(chain.advance(ctrl), false);
assert.equal(chain.resetFirst(ctrl), false);
assert.equal(await chain.startChain(ctrl), false);
assert.equal(await chain.clearLatents(named), 0);
assert.equal(requests.length, 0);
const refine = { widgets: [{ name: "clip_index", value: 0 }] };
chain.syncRefines({ ...named, refines: [refine] });
assert.equal(refine.widgets[0].value, 1);

// A named first clip has no previous ID and should still refine in full.
const firstNamed = pair({ clip_index: 0 });
firstNamed.save = { widgets: [{ name: "clip_id", value: "new-clip-id" }] };
chain.syncRefines({ ...firstNamed, refines: [refine] });
assert.equal(chain.usesClipIds(firstNamed), true);
assert.equal(refine.widgets[0].value, 0);

// Editing/clearing a UUID repaints the existing Chain controls immediately,
// including re-enabling numbered workflows after IDs have been cleared.
const indexedButton = { disabled: false };
ctrl.comfyClass = "MiniMaxH3MotionContextChain";
ctrl._h3mc = { meta: { textContent: "" }, indexedButtons: [indexedButton],
               chainBtn: { classList: { toggle() {} } } };
ctrl.graph._nodes.push(ctrl);
function SaveNode() {}
await extensions[0].beforeRegisterNodeDef(SaveNode,
  { name: "MiniMaxH3MotionContextSaveLatent" });
const saveNode = new SaveNode();
saveNode.widgets = [{ name: "clip_id", value: "next-uuid" }];
saveNode.comfyClass = "MiniMaxH3MotionContextSaveLatent";
saveNode.graph = ctrl.graph;
ctrl.graph._nodes[1] = saveNode;
saveNode.onNodeCreated();
saveNode.widgets[0].callback();
assert.equal(indexedButton.disabled, true);
named.load.widgets.find((w) => w.name === "clip_id").value = "";
saveNode.widgets[0].value = "";
saveNode.widgets[0].callback();
assert.equal(indexedButton.disabled, false);
assert.equal(ctrl._h3mc.chainBtn.disabled, false);
console.log("Chain storage requests: legacy defaults, clip IDs and automation guards passed");
