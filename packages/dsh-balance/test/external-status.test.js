import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExternalStatus, validateExternalStatusSource } from "../lib/host/index.js";
import { collectExternalPaths, previewExternalJson } from "../lib/host/external-status.js";

test("normalizes an Input-style uptime payload", async () => {
  const source = await validateExternalStatusSource({
    id: "input-status",
    name: "Input 状态",
    endpoint: "https://status.input.im/api/status",
    modelListPath: "$.services",
    fields: { model: "$.model", status: "$.last.ok", availability: "$.uptime_pct", history: "$.history", historyAt: "$.ts", historyStatus: "$.ok", historyError: "$.error", error: "$.last.error" },
  });
  const result = normalizeExternalStatus(source, {
    services: [{ model: "gpt-5.6-sol", uptime_pct: 97.38, last: { ok: true, error: "current failure" }, history: [{ ts: 10, ok: true, error: "" }, { ts: 20, ok: false, error: "timeout" }] }],
  }, "2026-08-23T08:00:00.000Z");
  assert.equal(result.status, "ok");
  assert.equal(result.models[0].model, "gpt-5.6-sol");
  assert.equal(result.models[0].availability, 97.38);
  assert.equal(result.models[0].status, "ok");
  assert.equal(result.models[0].samples, 2);
  assert.deepEqual(result.models[0].history[1], { at: 20, status: "error", error: "timeout" });
  assert.deepEqual(result.models[0].errors, ["current failure"]);
  assert.equal(source.enabled, false);
});

test("enables a health source only for an explicit boolean true", async () => {
  const enabled = await validateExternalStatusSource({ id: "enabled-status", name: "Enabled", endpoint: "https://example.com/status", enabled: true });
  const truthy = await validateExternalStatusSource({ id: "truthy-status", name: "Truthy", endpoint: "https://example.com/status", enabled: "true" });
  assert.equal(enabled.enabled, true);
  assert.equal(truthy.enabled, false);
});

test("normalizes a Neco-style traffic payload", async () => {
  const source = await validateExternalStatusSource({
    id: "neco-status",
    name: "Neco 状态",
    endpoint: "https://speed.sbbbbbbbbb.xyz/api/pulse?window=604800",
    modelListPath: "$.models",
    fields: { model: "$.model", status: "$.health", availability: "$.success_rate", ttft: "$.avg_ttft_ms", response: "$.avg_resp_sec", error: "$.last_errors" },
    responseUnit: "s",
  });
  const result = normalizeExternalStatus(source, {
    models: [{ model: "gpt-5.6-sol", health: "healthy", success_rate: 0.9738, avg_ttft_ms: 1352, avg_resp_sec: 3.1, last_errors: ["timeout"] }],
  });
  assert.equal(result.models[0].status, "ok");
  assert.equal(result.models[0].availability, 97.38);
  assert.equal(result.models[0].ttftMs, 1352);
  assert.equal(result.models[0].responseMs, 3100);
  assert.deepEqual(result.models[0].errors, ["timeout"]);
  assert.equal(source.timeoutSeconds, 10);
});

test("rejects unsafe external mappings and local endpoints", async () => {
  await assert.rejects(() => validateExternalStatusSource({ id: "bad", name: "Bad", endpoint: "https://127.0.0.1/status" }));
  await assert.rejects(() => validateExternalStatusSource({ id: "bad", name: "Bad", endpoint: "https://example.com/status", modelListPath: "$.constructor" }));
  await assert.rejects(() => validateExternalStatusSource({ id: "bad", name: "Bad", endpoint: "https://example.com/status", fields: { model: "$.a.__proto__.b" } }));
});

test("preserves complete deeply nested JSON previews and path catalogs", () => {
  const payload = {
    services: [{
      history: Array.from({ length: 7 }, (_, index) => ({
        ts: index + 10,
        ok: index % 2 === 0,
        latency_ms: index * 25,
        error: index === 1 ? "timeout" : ""
      }))
    }],
    variants: [{ first: true }, { second: true }],
    nested: { a: { b: { c: { d: { e: { value: "visible", long: "x".repeat(300) } } } } } },
    many: Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`field_${index}`, index]))
  };
  const preview = previewExternalJson(payload);
  const paths = collectExternalPaths(payload);
  assert.deepEqual(preview.services[0].history[0], { ts: 10, ok: true, latency_ms: 0, error: "" });
  assert.equal(preview.services[0].history[1].error, "timeout");
  assert.equal(preview.services[0].history.length, 7);
  assert.equal(preview.nested.a.b.c.d.e.value, "visible");
  assert.equal(preview.nested.a.b.c.d.e.long.length, 300);
  assert.ok(paths.some(item => item.path === "$.variants[].second"));
  assert.ok(paths.some(item => item.path === "$.many.field_204"));
  assert.ok(paths.length > 200);
});

test("preserves a bounded JSON preview and path catalog in the source schema", async () => {
  const preview = { services: [{ model: "gpt-5.6-sol", last: { ok: true } }] };
  const previewKeys = [{ path: "$.services", type: "array" }, { path: "$.services[].model", type: "string" }];
  const source = await validateExternalStatusSource({ id: "preview-source", name: "Preview", endpoint: "https://example.com/status", modelListPath: "$.services", preview, previewKeys });
  assert.deepEqual(source.preview, preview);
  assert.deepEqual(source.previewKeys, previewKeys);
});

test("rejects an oversized JSON preview", async () => {
  await assert.rejects(() => validateExternalStatusSource({ id: "preview-source", name: "Preview", endpoint: "https://example.com/status", preview: { value: "x".repeat(100001) } }), /preview is too large/);
});

test("maps boolean and string health states", async () => {
  const source = await validateExternalStatusSource({ id: "states", name: "States", endpoint: "https://example.com/status", modelListPath: "$.items", fields: { model: "$.name", status: "$.state" } });
  const result = normalizeExternalStatus(source, { items: [{ name: "a", state: true }, { name: "b", state: "degraded" }, { name: "c", state: "offline" }] });
  assert.deepEqual(result.models.map(item => item.status), ["ok", "error", "error"]);
});
