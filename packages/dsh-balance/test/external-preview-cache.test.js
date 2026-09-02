import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  deleteExternalPreviewCache,
  externalPreviewFingerprint,
  readExternalPreviewCache,
  writeExternalPreviewCache
} from "../lib/host/external-preview-cache.js";
import { externalPreviewStage } from "../lib/host/external-status.js";
import { createRouter } from "../lib/host/routes.js";

const source = (overrides = {}) => ({
  id: "ai-input",
  endpoint: "https://status.input.im/api/status",
  method: "GET",
  headers: { accept: "application/json", "x-status-client": "balance" },
  ...overrides
});

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "dsh-balance-preview-"));
}

function memoryConfigStore(initial) {
  let value = structuredClone(initial);
  return {
    loadConfig: async () => structuredClone(value),
    mutateConfig: async mutator => mutator(value),
    saveConfig: async next => { value = structuredClone(next); }
  };
}

async function callRouter(router, method, url, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  req.method = method;
  req.url = url;
  let status = 0;
  let raw = "";
  const res = {
    writeHead: code => { status = code; },
    end: chunk => { raw += chunk || ""; }
  };
  await router(req, res);
  return { status, body: JSON.parse(raw) };
}

test("writes and reads a private external preview cache atomically", async () => {
  const directory = await temporaryDirectory();
  const current = source();
  await chmod(directory, 0o755);
  const entry = {
    sourceId: current.id,
    requestFingerprint: externalPreviewFingerprint(current),
    fetchedAt: "2026-08-30T00:00:00.000Z",
    payload: { services: [{ model: "gpt-5.6-sol", ok: true }] }
  };
  assert.deepEqual(await writeExternalPreviewCache(entry, { directory }), { written: true });
  const restored = await readExternalPreviewCache(current, { directory });
  assert.deepEqual(restored.payload, entry.payload);
  assert.equal(restored.fetchedAt, entry.fetchedAt);
  // Windows 不完整保留 Unix 权限位（chmod 0o700/0o600 实际表现为 0o666），
  // 严格的权限位断言仅适用于 POSIX；Windows 上由上方读写断言保证缓存内容与原子性。
  if (process.platform !== "win32") {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, "ai-input.json"))).mode & 0o777, 0o600);
  }
  assert.equal((await readFile(join(directory, "ai-input.json"), "utf8")).includes(".tmp"), false);
});

test("fingerprints are stable for header order and change with request identity", () => {
  const first = source({ headers: { "x-status-client": "balance", accept: "application/json" } });
  const reordered = source({ headers: { accept: "application/json", "x-status-client": "balance" } });
  assert.equal(externalPreviewFingerprint(first), externalPreviewFingerprint(reordered));
  assert.notEqual(externalPreviewFingerprint(first), externalPreviewFingerprint(source({ endpoint: "https://example.com/status" })));
  assert.notEqual(externalPreviewFingerprint(first), externalPreviewFingerprint(source({ headers: { accept: "application/json" } })));
});

test("treats corrupt, unsupported, and mismatched caches as misses", async () => {
  const directory = await temporaryDirectory();
  const current = source();
  await writeFile(join(directory, "ai-input.json"), "not-json", { mode: 0o600 });
  assert.equal(await readExternalPreviewCache(current, { directory }), null);
  await writeFile(join(directory, "ai-input.json"), JSON.stringify({ version: 2, sourceId: current.id, requestFingerprint: externalPreviewFingerprint(current), payload: {} }), { mode: 0o600 });
  assert.equal(await readExternalPreviewCache(current, { directory }), null);
  await writeExternalPreviewCache({ sourceId: current.id, requestFingerprint: externalPreviewFingerprint(current), payload: { ok: true } }, { directory });
  assert.equal(await readExternalPreviewCache(source({ endpoint: "https://example.com/status" }), { directory }), null);
});

test("rejects oversized entries without writing a cache file", async () => {
  const directory = await temporaryDirectory();
  const current = source();
  const result = await writeExternalPreviewCache({ sourceId: current.id, requestFingerprint: externalPreviewFingerprint(current), payload: { value: "x".repeat(500) } }, { directory, maxFileBytes: 200 });
  assert.equal(result.written, false);
  assert.match(result.warning, /大小限制/);
  assert.equal(await readExternalPreviewCache(current, { directory, maxFileBytes: 200 }), null);
});

test("evicts oldest cache files when the total limit is exceeded", async () => {
  const directory = await temporaryDirectory();
  const first = source({ id: "first" });
  const second = source({ id: "second" });
  const third = source({ id: "third" });
  const options = { directory, maxFileBytes: 2_000, maxTotalBytes: 700 };
  const payload = { value: "x".repeat(180) };
  await writeExternalPreviewCache({ sourceId: first.id, requestFingerprint: externalPreviewFingerprint(first), payload }, options);
  await utimes(join(directory, "first.json"), new Date(1_000), new Date(1_000));
  await writeExternalPreviewCache({ sourceId: second.id, requestFingerprint: externalPreviewFingerprint(second), payload }, options);
  await utimes(join(directory, "second.json"), new Date(2_000), new Date(2_000));
  await writeExternalPreviewCache({ sourceId: third.id, requestFingerprint: externalPreviewFingerprint(third), payload }, options);
  assert.equal(await readExternalPreviewCache(first, options), null);
  assert.ok(await readExternalPreviewCache(third, options));
});

test("deletes caches idempotently and rejects unsafe ids", async () => {
  const directory = await temporaryDirectory();
  const current = source();
  await writeExternalPreviewCache({ sourceId: current.id, requestFingerprint: externalPreviewFingerprint(current), payload: {} }, { directory });
  assert.deepEqual(await deleteExternalPreviewCache(current.id, { directory }), { deleted: true });
  assert.deepEqual(await deleteExternalPreviewCache(current.id, { directory }), { deleted: false });
  await assert.rejects(() => writeExternalPreviewCache({ sourceId: "../bad", requestFingerprint: "hash", payload: {} }, { directory }), /invalid external preview cache entry/);
});

test("commits matching staged previews and restores them with current mappings", async () => {
  const directory = await temporaryDirectory();
  const savedSource = {
    ...source(),
    name: "Input Status",
    modelListPath: "$.services",
    fields: { model: "$.model", status: "$.ok", availability: "$.uptime" }
  };
  const configStore = memoryConfigStore({ statusBar: true, bindings: {}, providers: [], externalStatusSources: [] });
  const router = createRouter({ credentials: {} }, { previewCache: { directory }, configStore });
  externalPreviewStage.set(savedSource.id, {
    requestFingerprint: externalPreviewFingerprint(savedSource),
    fetchedAt: "2026-08-30T00:00:00.000Z",
    payload: { services: [{ model: "gpt-5.6-sol", ok: true, uptime: 98.5 }] }
  });
  const saved = await callRouter(router, "POST", "/dsh-balance-quota/external-status-source", savedSource);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(externalPreviewStage.has(savedSource.id), false);
  const restored = await callRouter(router, "GET", `/dsh-balance-quota/external-status-preview/${savedSource.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.cached, true);
  assert.equal(restored.body.preview.services[0].model, "gpt-5.6-sol");
  assert.equal(restored.body.normalized.models[0].availability, 98.5);
  assert.ok(restored.body.keys.some(item => item.path === "$.services" && item.type === "array"));
});

test("restores raw JSON when current mappings cannot be normalized", async () => {
  const directory = await temporaryDirectory();
  const savedSource = {
    ...source(),
    name: "Input Status",
    modelListPath: "$.missing",
    fields: { model: "$.model" }
  };
  const configStore = memoryConfigStore({ statusBar: true, bindings: {}, providers: [], externalStatusSources: [savedSource] });
  const router = createRouter({ credentials: {} }, { previewCache: { directory }, configStore });
  await writeExternalPreviewCache({ sourceId: savedSource.id, requestFingerprint: externalPreviewFingerprint(savedSource), payload: { services: [{ model: "gpt-5.6-sol" }] } }, { directory });
  const restored = await callRouter(router, "GET", `/dsh-balance-quota/external-status-preview/${savedSource.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.preview.services[0].model, "gpt-5.6-sol");
  assert.equal(restored.body.normalized, null);
  assert.ok(restored.body.keys.some(item => item.path === "$.services"));
});

test("does not persist mismatched staged previews and clears them after save", async () => {
  const directory = await temporaryDirectory();
  const savedSource = {
    ...source(),
    name: "Input Status",
    modelListPath: "$.services",
    fields: { model: "$.model" }
  };
  const configStore = memoryConfigStore({ statusBar: true, bindings: {}, providers: [], externalStatusSources: [] });
  const router = createRouter({ credentials: {} }, { previewCache: { directory }, configStore });
  externalPreviewStage.set(savedSource.id, {
    requestFingerprint: externalPreviewFingerprint({ ...savedSource, endpoint: "https://example.com/other" }),
    fetchedAt: "2026-08-30T00:00:00.000Z",
    payload: { services: [{ model: "wrong" }] }
  });
  assert.equal((await callRouter(router, "POST", "/dsh-balance-quota/external-status-source", savedSource)).status, 200);
  assert.equal(externalPreviewStage.has(savedSource.id), false);
  assert.equal((await callRouter(router, "GET", `/dsh-balance-quota/external-status-preview/${savedSource.id}`)).status, 404);
});

test("deleting a source clears its staged and persisted previews", async () => {
  const directory = await temporaryDirectory();
  const savedSource = {
    ...source(),
    name: "Input Status",
    modelListPath: "$.services",
    fields: { model: "$.model" }
  };
  const configStore = memoryConfigStore({ statusBar: true, bindings: {}, providers: [], externalStatusSources: [savedSource] });
  const router = createRouter({ credentials: {} }, { previewCache: { directory }, configStore });
  await writeExternalPreviewCache({ sourceId: savedSource.id, requestFingerprint: externalPreviewFingerprint(savedSource), payload: { services: [] } }, { directory });
  externalPreviewStage.set(savedSource.id, { requestFingerprint: "staged", payload: {} });
  const removed = await callRouter(router, "DELETE", `/dsh-balance-quota/external-status-source/${savedSource.id}`);
  assert.equal(removed.status, 200);
  assert.equal(externalPreviewStage.has(savedSource.id), false);
  assert.equal(await readExternalPreviewCache(savedSource, { directory }), null);
  assert.equal((await configStore.loadConfig()).externalStatusSources.length, 0);
});
