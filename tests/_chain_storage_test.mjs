/** Chain must send the Load node's storage selection to both HTTP routes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const requests = [];
const api = {
  addEventListener() {},
  async fetchApi(url, options) {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, async json() { return { exists: true, removed: 2 }; } };
  },
};
const source = await readFile(new URL("../web/h3_motion_context.js", import.meta.url), "utf8");
const chain = vm.runInNewContext(
  source.replace(/^import .*;\r?$/gm, "") + "\n({ firstClipExists, clearLatents });",
  { app: { registerExtension() {} }, api },
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
          folder: "output", clip_index: 1 },
});
assert.equal(await chain.clearLatents(custom), 2);
assert.deepEqual(requests.pop(), {
  url: "/h3_motion_context/clear_latents",
  body: { latent_path: "story_01", storage_root: "/runpod-volume/h3_latents", folder: "output" },
});

// Old graphs have neither the new root widget nor, sometimes, folder.
assert.equal(await chain.firstClipExists(pair({ latent_path: "h3_context" })), true);
assert.deepEqual(requests.pop().body, {
  latent_path: "h3_context", storage_root: "", folder: "output", clip_index: 1,
});
await chain.clearLatents(pair({ latent_path: "uploaded.safetensors", folder: "input" }));
assert.deepEqual(requests.pop().body, {
  latent_path: "uploaded.safetensors", storage_root: "", folder: "input",
});
console.log("Chain storage requests: custom roots, legacy widgets and input mode passed");
