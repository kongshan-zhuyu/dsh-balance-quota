window.__ModuleLoader__.load({
  id: "dsh-balance-quota",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const inject = ["slots", "connection", "sessions"];

    const state = {
      selectedProviderId: null,
      providers: [],
      config: null,
      timer: null,
      clock: null,
      bar: null,
      style: null,
      provider: null,
      connection: null,
      sessions: null,
      sessionsUnsubscribe: null,
      sessionId: null,
      requestGeneration: 0,
      refreshingProviderId: null,
      healthModal: null,
      healthRequestGeneration: 0,
      llmSettingsSnapshot: null,
      llmSettingsPromise: null,
      dockListeners: new Set()
    };

    const selectionKey = (sessionId) => `dsh-balance-quota:selected-provider:${sessionId || "global"}`;
    const OFFICIAL_PRESETS = new Set(["deepseek", "opencode-go"]);

    const refreshDue = (provider, syncedAt, now = Date.now()) => {
      if (provider?.status === "disabled" || provider?.balanceEnabled === false) return false;
      const interval = Number(provider?.queryIntervalMinutes ?? 30);
      const synced = Date.parse(syncedAt || "");
      return !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(synced) || now - synced >= interval * 60_000;
    };

    const resolveSelectedProvider = (providers, sessionId, defaultProviderId) => {
      const manual = sessionStorage.getItem(selectionKey(sessionId));
      if (manual && providers.some(provider => provider.id === manual)) return manual;
      if (defaultProviderId && providers.some(provider => provider.id === defaultProviderId)) return defaultProviderId;
      return providers[0]?.id || null;
    };

    const api = async (path, options) => {
      const res = await fetch(`/dsh-balance-quota${path}`, {
        cache: "no-store",
        ...options,
        headers: { "content-type": "application/json", ...(options?.headers || {}) }
      });
      const data = await res.json();
      if (!data.ok) {
        const error = new Error(data.error || "余额查询请求失败");
        error.status = res.status;
        throw error;
      }
      return data;
    };

    const formatMoney = (value, currency) => {
      try {
        return new Intl.NumberFormat("zh-CN", {
          style: "currency",
          currency: currency || "CNY",
          currencyDisplay: "narrowSymbol",
          maximumFractionDigits: 2
        }).format(value);
      } catch {
        return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
      }
    };

    const usageLabel = (type) => type === "rolling" ? "滚动用量" : type === "weekly" ? "每周用量" : "每月用量";
    const compactUsageLabel = (type) => type === "rolling" ? "滚动" : type === "weekly" ? "每周" : "每月";

    function formatResetAt(value) {
      if (!value) return "暂无重置时间";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return String(value);
      const diff = date.getTime() - Date.now();
      if (diff <= 0) return "即将重置";
      const totalMinutes = Math.max(1, Math.ceil(diff / 60_000));
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      const parts = [];
      if (days) parts.push(`${days} 天`);
      if (hours) parts.push(`${hours} 小时`);
      if (!days && minutes) parts.push(`${minutes} 分钟`);
      return `重置于 ${parts.join(" ")}`;
    }

    function formatSyncedAt(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      if (seconds < 10) return "刚刚更新";
      if (seconds < 60) return `${seconds} 秒前更新`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前更新`;
      return `${Math.floor(seconds / 3600)} 小时前更新`;
    }

    function formatHistoryAt(value) {
      if (value === undefined || value === null || value === "") return "";
      const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
      const date = new Date(Number.isFinite(numeric) ? (Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric) : value);
      if (!Number.isFinite(date.getTime())) return String(value);
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(date);
    }

    // 未绑定历史记录时，用可用率百分比近似生成健康进度条：
    // ok 格数向下取整——可用率未满 100% 时至少保留 1 格红色标记损失部分
    function availabilityProgressBars(availability, total = 60) {
      const ratio = Number(availability);
      if (!Number.isFinite(ratio)) return null;
      const clamped = Math.max(0, Math.min(100, ratio)) / 100;
      const okCount = Math.floor(clamped * total);
      return Array.from({ length: total }, (_, index) => ({
        status: index < okCount ? "ok" : "error",
        note: "按可用率生成的近似展示"
      }));
    }

    // 指标值显示格式化：统一存储的 ms 数值按配置单位（ms/s）与小数位（0-2）格式化
    function formatMetricValue(ms, unit, decimals) {
      const number = Number(ms);
      if (!Number.isFinite(number)) return "";
      const safeDecimals = Math.max(0, Math.min(2, Number(decimals) || 0));
      const value = unit === "s" ? number / 1000 : number;
      return `${value.toFixed(safeDecimals)}${unit === "s" ? "s" : "ms"}`;
    }

    function formatCapacity(value) {
      if (value === undefined || value === null || value === "") return "";
      const num = Number(value);
      if (!Number.isFinite(num)) return String(value);
      if (num >= 1024 * 1024 && num % (1024 * 1024) === 0) return `${num / (1024 * 1024)}M`;
      if (num >= 1000 * 1000 && num % (1000 * 1000) === 0) return `${num / 1000000}M`;
      if (num >= 1024 && num % 1024 === 0) return `${num / 1024}K`;
      if (num >= 1000 && num % 1000 === 0) return `${num / 1000}K`;
      return String(num);
    }

    function parseCapacity(value) {
      if (!value || typeof value !== "string") return typeof value === "number" ? value : undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const match = /^(\d+(?:\.\d+)?)\s*([kmKM])?$/i.exec(trimmed);
      if (!match) {
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : undefined;
      }
      const val = parseFloat(match[1]);
      const unit = (match[2] || "").toUpperCase();
      if (unit === "K") return Math.round(val * 1024);
      if (unit === "M") return Math.round(val * 1024 * 1024);
      return Math.round(val);
    }

    function ensureSettingsStyle() {
      const id = "dsh-balance-quota-settings-style";
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        .db-plugin-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);list-style:none;transition:border-color .16s,background .16s}
        .db-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}
        .db-plugin-card.open{border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}
        .db-plugin-card-head{appearance:none;display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
        .db-plugin-card-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
        .db-plugin-card-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}
        .db-plugin-card-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
        .db-plugin-card-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
        .db-plugin-card-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
        .db-plugin-card.open .db-plugin-card-chevron{transform:rotate(180deg)}
        .db-plugin-card-body{margin:0 16px;padding:12px 0 16px;border-top:1px solid var(--dsw-alias-border-l2)}
        .db-settings{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary);font-family:inherit}
        .db-import-wrap{position:relative}
        .db-import-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:1000;min-width:260px;max-width:320px;max-height:380px;overflow-y:auto;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 12px 36px rgba(0,0,0,.2)}
        .db-import-group-title{padding:6px 10px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}
        .db-import-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:13px/18px inherit;text-align:left;cursor:pointer}
        .db-import-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .db-import-item-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .db-import-item-desc{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px}
        .db-import-divider{height:1px;margin:4px 0;background:var(--dsw-alias-border-l2)}
        .db-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
        .db-provider-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
        .db-provider-row{display:flex;align-items:center;gap:10px;padding:12px 14px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent}
        .db-provider-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
        .db-live{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
        .db-live.error{background:var(--dsw-alias-state-error-primary)}
        .db-live.disabled{background:var(--dsw-alias-label-dimmed)}
        .db-tag{flex:none;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;padding:1px 6px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}
        .db-spacer{flex:1}
        .db-quiet,.db-primary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:18px;font:inherit;font-size:14px;line-height:22px;cursor:pointer}
        .db-quiet{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
        .db-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
        .db-delete{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:0;border-radius:18px;background:transparent;color:var(--dsw-alias-state-error-primary);font:14px/22px inherit;cursor:pointer}
        .db-delete:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
        .db-provider-row .db-quiet,.db-provider-row .db-delete{height:28px;padding:0 10px;border-radius:14px;font-size:12px;line-height:18px}
        .db-provider-row .db-select.db-query-select{flex:none;height:28px;width:auto;min-width:0;padding:0 26px 0 10px;border-radius:14px;font-size:12px;line-height:18px;background-position:right 8px center}
        .db-quiet:disabled,.db-primary:disabled,.db-delete:disabled,.db-add:disabled,.db-back:disabled{opacity:.4;cursor:default}
        .db-quiet:focus-visible,.db-primary:focus-visible,.db-delete:focus-visible,.db-add:focus-visible,.db-back:focus-visible,.db-select:focus-visible,.db-toggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
        .db-bottom-settings{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;margin-top:0;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .db-bottom-settings .db-setting-label{flex:none;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
        .db-bottom-settings .db-quiet{height:30px;padding:0 12px;border-radius:15px;font-size:12px;line-height:18px}
        .db-bottom-settings .db-select{flex:0 1 auto;width:145px;max-width:100%}
        .db-bottom-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}
        .db-select{box-sizing:border-box;height:32px;max-width:240px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 32px 0 10px;font:14px/22px inherit;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px}
        .db-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
        .db-toggle{width:32px;height:18px;border:0;border-radius:9px;background:var(--dsw-alias-bg-overlay);padding:2px;cursor:pointer;flex:none}
        .db-toggle i{display:block;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s var(--ds-ease-in-out)}
        .db-toggle.on{background:var(--dsw-alias-button-info-fill)}
        .db-toggle.on i{transform:translateX(14px)}
        .db-field-help{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .db-header-list{display:flex;flex-direction:column;gap:12px}
        .db-header-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 28px;gap:8px;align-items:center;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent}
        .db-header-row input{width:100%;height:40px;box-sizing:border-box;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:14px/22px inherit;outline:none}
        .db-header-row input:focus{border-color:var(--dsw-alias-brand-primary)}
        .db-header-remove{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
        .db-header-remove:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
        .db-header-remove svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
        .db-header-add{align-self:flex-start;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/18px inherit;cursor:pointer}
        .db-header-add:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .db-editor{display:flex;flex-direction:column;gap:14px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
        .db-editor-head{display:flex;align-items:center;gap:8px}
        .db-editor-head h3{margin:0;font-size:14px;line-height:22px;font-weight:500}
        .db-back{box-sizing:border-box;display:inline-flex;align-items:center;height:28px;padding:0 10px;border:0;border-radius:14px;background:transparent;color:var(--dsw-alias-label-tertiary);font:12px/18px inherit;cursor:pointer}
        .db-back:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
        .db-form{display:grid;grid-template-columns:1fr;gap:14px}
        .db-field{display:flex;flex-direction:column;gap:6px}
        .db-field.wide{grid-column:1/-1}
        .db-field-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .db-field label{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;gap:10px}
        .db-field input{box-sizing:border-box;height:32px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 10px;font:14px/22px inherit;outline:none}
        .db-field input:focus{border-color:var(--dsw-alias-brand-primary)}
        .db-field input::placeholder{color:var(--dsw-alias-label-dimmed)}
        .db-field input:disabled{opacity:.6;cursor:default}
        .db-form-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
        .db-form-actions .db-quiet,.db-form-actions .db-primary{height:36px;min-width:72px;padding:0 16px;border-radius:18px;font-size:14px;line-height:22px}
        .db-primary{border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
        .db-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
        .db-message{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
        .db-message.warn{color:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-message.error{color:var(--dsw-alias-state-error-primary)}
        @media(max-width:640px){.db-provider-row .db-delete{padding:0 6px}.db-bottom-settings .db-setting-label{min-width:100%}.db-bottom-actions{margin-left:0}}
        @media (prefers-reduced-motion:reduce){.db-toggle i{transition:none}.db-json-preview-loading .db-spinner,.db-endpoint-loading::before{animation:none}}
        .db-provider-card{flex-direction:column;align-items:stretch;gap:0;padding:12px 14px}
        .db-row-line{display:flex;align-items:center;gap:10px;min-width:0}
        .db-row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-width:0;padding-top:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .db-row-meta .db-meta-note{color:var(--dsw-alias-label-caption)}
        .db-inline-editor{margin-top:12px;padding:16px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
        .db-meta-error{color:var(--dsw-alias-state-error-primary)}
        .db-external{margin-top:18px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}
        .db-external-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .db-external-head h3{margin:0;font-size:15px;font-weight:600}
        .db-external-note{margin:4px 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .db-external-source{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
        .db-external-source+.db-external-source{margin-top:8px}
        .db-external-source-top{display:flex;align-items:center;gap:8px}
        .db-external-source-name{font-size:14px;font-weight:600}
        .db-external-endpoint{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .db-external-overall{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
        .db-external-models{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:10px}
        .db-external-model{padding:9px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);font-size:12px}
        .db-external-model-top{display:flex;align-items:center;gap:6px}
        .db-external-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .db-external-metrics{margin-top:5px;color:var(--dsw-alias-label-tertiary);line-height:18px}
        .db-external-error{color:var(--dsw-alias-state-error-primary)}
        .db-preview-status{margin:12px 0 14px}
        .db-preview-status-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
        .db-preview-status-head strong{color:var(--dsw-alias-label-primary);font-size:14px}
        .db-preview-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        @media(max-width:680px){.db-preview-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:460px){.db-preview-cards{grid-template-columns:minmax(0,1fr)}}
        .db-preview-card{min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
        .db-preview-card.ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l2))}
        .db-preview-card.error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l2))}
        .db-preview-card-head{display:flex;align-items:center;gap:7px;min-width:0}
        .db-preview-card-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:16px}
        .db-preview-group{display:inline-block;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
        .db-preview-card-group{margin-bottom:7px}
        .db-preview-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-dimmed)}
        .db-preview-card.ok .db-preview-dot{background:var(--dsw-alias-state-success-primary)}
        .db-preview-card.error .db-preview-dot{background:var(--dsw-alias-state-error-primary)}
        .db-preview-card.warn .db-preview-dot{background:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-preview-card.unknown .db-preview-dot{background:var(--dsw-alias-label-secondary)}
        .db-preview-state{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
        /* 状态文字按语义着色，与状态点同色系，四种状态有区分度 */
        .db-preview-card.ok .db-preview-state{color:var(--dsw-alias-state-success-primary,#21aa8b)}
        .db-preview-card.error .db-preview-state{color:var(--dsw-alias-state-error-primary,#ec1313)}
        .db-preview-card.warn .db-preview-state{color:var(--dsw-alias-state-warning-primary,#f59e0b)}
        .db-preview-card.unknown .db-preview-state{color:var(--dsw-alias-label-secondary,#68707b)}
        .db-preview-metrics{display:flex;flex-wrap:wrap;gap:8px 12px;margin:8px 0;font-size:11px;color:var(--dsw-alias-label-secondary)}
        .db-preview-metrics b{color:var(--dsw-alias-label-primary);font-weight:600;overflow-wrap:anywhere}
        .db-preview-history{display:flex;width:100%;min-width:0;gap:clamp(1px,.3vw,2px);align-items:center;height:8px;margin-top:6px;overflow:hidden}
        .db-preview-history i{flex:1 1 0;min-width:0;height:100%;border-radius:1px;background:var(--dsw-alias-border-l2)}
        .db-preview-history i.ok{background:var(--dsw-alias-state-success-primary)}
        .db-preview-history i.error{background:var(--dsw-alias-state-error-primary)}
        .db-preview-history i.warn{background:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-preview-history i.unknown{background:color-mix(in srgb,var(--dsw-alias-label-dimmed) 55%,transparent)}
        .db-json-preview-box{min-height:120px;max-height:300px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
        .db-json-preview-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:120px;color:var(--dsw-alias-label-dimmed);font-size:13px}
        .db-json-preview-empty svg{width:28px;height:28px;opacity:.4}
        .db-json-preview-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:120px}
        .db-json-preview-loading .db-spinner{width:26px;height:26px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:db-spin 0.7s linear infinite}
        .db-json-preview-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:120px;color:var(--dsw-alias-state-error-primary);font-size:13px;padding:12px;text-align:center}
        .db-json-preview-error svg{width:24px;height:24px;opacity:.6}
        @keyframes db-spin{to{transform:rotate(360deg)}}
        .db-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;overscroll-behavior:none;background:rgba(0,0,0,.38)}
        .db-modal{display:flex;flex-direction:column;width:min(760px,calc(100vw - 32px));height:min(620px,calc(100vh - 48px));overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 60px rgba(0,0,0,.28)}
        .db-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l2)}
        .db-modal-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .15s,color .15s}
        .db-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        .db-modal-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
        .db-modal-tabs{display:flex;gap:18px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l2)}
        .db-modal-tabs button{padding:11px 2px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer}
        .db-modal-tabs button.active{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:600}
        .db-modal-content{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:16px 18px}
        .db-models-tab{display:flex;flex-direction:column;gap:12px}
        .db-models-head{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:13px}
        .db-model-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
        .db-model-card{display:flex;flex-direction:column;gap:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .16s}
        .db-model-card:hover{border-color:var(--dsw-alias-label-dimmed)}
        .db-model-id{font-weight:600;color:var(--dsw-alias-label-primary);font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .db-model-name{color:var(--dsw-alias-label-secondary);font-size:13px}
        .db-model-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:4px}
        .db-model-tag{border:1px solid var(--dsw-alias-border-l3);border-radius:4px;padding:1px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
        .db-checkbox-group{display:flex;align-items:center;gap:16px;margin-top:2px}
        .db-checkbox-label{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none}
        .db-checkbox-label input[type="checkbox"]{width:15px;height:15px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}
        .db-monitor-toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
        .db-monitor-toggle-copy{display:flex;min-width:0;flex-direction:column;gap:3px}
        .db-monitor-toggle-copy strong{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
        .db-monitor-toggle-copy span{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
        .db-monitor-toggle input{width:17px;height:17px;flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}
        .db-model-editor{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
        .db-models-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px}
        .db-external-source-switch{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
        .db-endpoint-row{display:flex;gap:8px;position:relative}
        .db-endpoint-loading{position:absolute;left:0;right:0;bottom:-8px;height:2px;overflow:hidden;border-radius:1px;pointer-events:none}
        .db-endpoint-loading::before{content:"";position:absolute;top:0;bottom:0;width:36%;border-radius:1px;background:var(--dsw-alias-brand-primary);animation:db-loading-slide 1.1s ease-in-out infinite}
        @keyframes db-loading-slide{from{transform:translateX(-110%)}to{transform:translateX(320%)}}
        .db-endpoint-row input{flex:1;min-width:0}
        .db-map-section{margin:12px 0 4px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
        .db-map-section-head{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
        .db-map-section-head strong{font-size:13px;font-weight:600}
        .db-map-section-head span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
        .db-map-section-hint,.db-map-section-empty{margin:0 0 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
        .db-map-grid-head,.db-map-grid{display:grid;grid-template-columns:minmax(200px,1fr) 150px 30px;gap:8px;align-items:center}
        .db-map-grid-head{padding-bottom:6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .db-map-grid{margin-bottom:8px}
        .db-map-grid input{box-sizing:border-box;width:100%;height:32px;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 10px;font:13px inherit}
        .db-icon-button{display:grid;place-items:center;width:30px;height:30px;padding:0}
        .db-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
        .db-test-message{margin:8px 0 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
        .db-test-message.error{color:var(--dsw-alias-state-error-primary)}
        .db-test-message.success{color:var(--dsw-alias-state-success-primary)}
        .db-save-message{margin:0;flex:1;text-align:center;padding:2px 12px;max-height:88px;overflow-y:auto;word-break:break-word;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;font-weight:500}
        .db-modal-footer{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
        .db-modal-footer .db-quiet,.db-modal-footer .db-primary{white-space:nowrap}
        .db-json-node{margin:2px 0;padding-left:14px;border-left:1px solid var(--dsw-alias-border-l3)}
        .db-json-preview-box>.db-json-node{border-left:0;padding-left:2px}
        .db-json-node>summary{display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:6px;list-style:none;cursor:pointer;font-family:inherit;font-size:11px;transition:background .15s,color .15s}
        .db-json-node>summary::-webkit-details-marker{display:none}
        .db-json-node>summary::before{content:"";flex:none;width:0;height:0;border-style:solid;border-width:4px 0 4px 5px;border-color:transparent transparent transparent currentColor;opacity:.5;transition:transform .16s}
        .db-json-node[open]>summary::before{transform:rotate(90deg)}
        .db-json-node>summary:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        .db-json-leaf{display:flex;gap:6px;align-items:center;padding:2px 6px;border-radius:6px;font-family:inherit;font-size:11px;transition:background .15s}
        .db-json-leaf:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .db-json-key{color:var(--dsw-alias-label-secondary);font-weight:600}
        .db-json-string{color:var(--dsw-alias-state-success-primary)}
        .db-json-number{color:var(--dsw-alias-brand-primary)}
        .db-json-boolean{color:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-json-null{color:var(--dsw-alias-label-dimmed)}
        .db-json-type{flex:none;margin-left:2px;padding:0 5px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
        .db-json-type.binding{cursor:pointer;border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
        .db-json-leaf.binding{cursor:crosshair}
        .db-json-preview-box.binding{cursor:crosshair}
        .db-json-preview-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:center}
        .db-json-preview-title{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
        .db-preview-all-toggle{height:26px;padding:0 10px;border-radius:13px;font-size:12px;line-height:18px;cursor:pointer}
        .db-preview-all-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .db-json-preview-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:560px;gap:16px;align-items:stretch}
        .db-json-preview-split>.db-json-preview-box,.db-json-preview-split>.db-bind-card{width:100%;height:100%;min-height:0;max-height:100%;box-sizing:border-box;overflow:auto;scrollbar-gutter:stable}
        @media(max-width:760px){.db-json-preview-head,.db-json-preview-split{grid-template-columns:1fr}.db-json-preview-split{grid-template-rows:repeat(2,minmax(0,420px));height:auto}.db-json-preview-split>.db-json-preview-box,.db-json-preview-split>.db-bind-card{height:420px;max-height:420px}}
        .db-bind-card{display:flex;flex-direction:column;gap:14px;min-width:0;padding:18px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
        .db-bind-list-row{display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l3);font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-list-row>span:first-child{flex:none}
        .db-bind-list-target{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
        .db-bind-target{cursor:pointer;border-radius:8px;outline:1px solid transparent;outline-offset:2px;transition:color .15s,outline-color .15s,background .15s}
        .db-bind-target:hover{outline-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
        .db-bind-target.active{outline-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
        .db-bind-target.empty{color:var(--dsw-alias-label-secondary)}
        .db-bind-target.empty b{color:var(--dsw-alias-label-secondary);font-weight:500}
        .db-bind-target.ok{color:var(--dsw-alias-state-success-primary)}
        .db-bind-target.error{color:var(--dsw-alias-state-error-primary)}
        .db-bind-target.warn{color:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-bind-dashboard-head{display:flex;align-items:center;gap:12px;min-width:0}
        .db-bind-model-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
        .db-bind-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:22px;font-weight:600}
        .db-bind-group{flex:none;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 7px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:400}
        .db-bind-model-meta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-state{display:flex;flex:none;min-width:54px;flex-direction:column;align-items:center;gap:1px;padding:5px 10px;border-radius:14px;background:var(--dsw-alias-bg-module-platform);font-size:12px;font-weight:600}
        .db-bind-status-path{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:9px;font-weight:500;opacity:.72}
        .db-bind-state.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
        .db-bind-state.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
        .db-bind-state.warn{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary, #f59e0b) 12%,transparent);color:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-bind-metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .db-bind-metric-grid>.db-bind-target,.db-bind-card>.db-bind-target{display:block;min-width:0}
        .db-bind-metric-card{display:flex;min-width:0;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent)}
        .db-bind-target.empty .db-bind-metric-value,.db-bind-target.empty .db-bind-availability-value{color:var(--dsw-alias-label-secondary)}
        .db-bind-metric-label{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-metric-label svg{width:14px;height:14px;flex:none}
        .db-bind-metric-name{box-sizing:border-box;width:64px;min-width:0;height:20px;padding:0 5px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
        .db-bind-metric-opt{box-sizing:border-box;flex:none;height:20px;padding:0 2px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#68707b));font-size:10px;line-height:18px;cursor:pointer}
        .db-bind-metric-opt:hover,.db-bind-metric-opt:focus{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1,#d9dee5))}
        .db-bind-metric-name::placeholder{color:var(--dsw-alias-label-tertiary)}
        .db-bind-metric-name:focus{outline:none;border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
        .db-bind-field-path{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-metric-value{display:flex;align-items:center;gap:6px;font-size:22px;line-height:28px;font-weight:600;color:var(--dsw-alias-label-primary);min-width:0;word-break:break-all}
        .db-bind-metric-value small{margin-left:3px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
        /* 数值行右侧的单位/小数位下拉：小号、弱化、悬停才显边框 */
        .db-bind-metric-value .db-bind-metric-opt{margin-left:auto;font-size:11px;font-weight:500}
        /* 指标网格里的「＋ 新增自定义字段」虚线卡片 */
        .db-bind-add-field{display:grid;place-items:center;min-height:76px;padding:0;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#68707b));font-size:20px;line-height:1;cursor:pointer}
        .db-bind-add-field:hover{border-color:var(--dsw-alias-state-success-primary,#21aa8b);color:var(--dsw-alias-state-success-primary,#21aa8b)}
        /* 转换按钮组内嵌的单位/小数位下拉 */
        .db-bind-actions .db-bind-metric-opt{height:26px}
        .db-bind-availability{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l3);border-bottom:1px solid var(--dsw-alias-border-l3)}
        .db-bind-availability-copy{display:flex;min-width:0;flex-direction:column;gap:5px}
        .db-bind-availability-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-availability-value{font-size:30px;line-height:34px;font-weight:700;color:var(--dsw-alias-state-success-primary)}
        .db-bind-history-head{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-history-field-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .db-bind-history-field-row>.db-bind-target{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary)}
        .db-bind-history-field-row>.db-bind-target.invalid,.db-bind-history-invalid{color:var(--dsw-alias-state-error-primary)}
        .db-bind-history-invalid{margin-left:auto}
        .db-bind-history-target{display:block;padding:3px 0}
        .db-bind-history-bars{display:flex;align-items:stretch;gap:3px;height:26px}
        .db-bind-history-bars i{flex:1;min-width:2px;border-radius:2px;background:var(--dsw-alias-border-l2)}
        .db-bind-history-bars i.ok{background:var(--dsw-alias-state-success-primary)}
        .db-bind-history-bars i.error{background:var(--dsw-alias-state-error-primary)}
        .db-bind-history-bars i.warn{background:var(--dsw-alias-state-warning-primary, #f59e0b)}
        .db-bind-history-axis{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.12em;color:var(--dsw-alias-label-dimmed)}
        .db-bind-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
        /* 转换附加配置第二行：数字的单位/小数位、百分比的倍率 */
        .db-bind-extra-opts{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l3,var(--dsw-alias-border-l2,#d9dee5))}
        .db-bind-extra-label{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#68707b))}
        .db-bind-action-btn{height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:22px;cursor:pointer}
        .db-bind-action-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        .db-bind-action-btn.on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);color:var(--dsw-alias-brand-primary)}
        .db-bind-card-foot{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l3);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      `;
      document.head.append(style);
    }

    function notifyDock() {
      for (const listener of state.dockListeners) listener();
    }

    function syncSession() {
      const nextId = state.sessions?.list?.getSnapshot?.().current || null;
      if (nextId === state.sessionId) return;
      state.sessionId = nextId;
      state.requestGeneration += 1;
      state.refreshingProviderId = null;
      state.selectedProviderId = resolveSelectedProvider(state.providers, nextId, state.config?.defaultProviderId);
      refreshBar();
    }

    function subscribeDock(listener) {
      state.dockListeners.add(listener);
      return () => state.dockListeners.delete(listener);
    }

    function observeMenuDismissal() {
      const onDocumentPointerDown = (event) => {
        const menu = document.querySelector(".dsh-balance-provider-menu");
        if (menu && !menu.hidden && !menu.contains(event.target) && !event.target.closest?.(".dsh-balance-provider")) {
          menu.hidden = true;
        }
      };
      const closeOverlays = () => {
        const menu = document.querySelector(".dsh-balance-provider-menu");
        if (menu && !menu.hidden) menu.hidden = true;
      };
      window.addEventListener("resize", closeOverlays);
      document.addEventListener("pointerdown", onDocumentPointerDown);
      return () => {
        window.removeEventListener("resize", closeOverlays);
        document.removeEventListener("pointerdown", onDocumentPointerDown);
      };
    }

    function BalanceDock() {
      const [, redraw] = React.useReducer(value => value + 1, 0);
      const hostRef = React.useRef(null);
      const statusBarEnabled = Boolean(state.config?.statusBar);
      React.useEffect(() => subscribeDock(redraw), []);
      if (statusBarEnabled) ensureBar();
      React.useLayoutEffect(() => {
        const host = hostRef.current;
        const bar = state.bar;
        if (!host || !bar) return;
        host.replaceChildren(bar);
        return () => {
          if (bar.parentElement === host) bar.remove();
        };
      }, [statusBarEnabled]);
      if (!statusBarEnabled) return null;
      return h("span", { className: "dsh-balance-dock-host", ref: hostRef });
    }

    function ensureBar() {
      if (state.bar) return state.bar;
      state.style = document.createElement("style");
      state.style.textContent = `
        .dsh-balance-dock-host{display:flex;align-items:center;justify-content:center;min-width:0;width:100%;margin-top:2px}
        .dsh-balance-status{position:relative;z-index:0;display:flex;align-items:center;justify-content:center;min-width:0;width:100%;max-width:100%;color:var(--dsw-alias-label-tertiary,#8a919b);font:12px/18px ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .dsh-balance-status *{box-sizing:border-box}
        .dsh-balance-summary{display:flex;align-items:center;justify-content:center;min-width:0;width:100%;min-height:26px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#68707b);font:inherit;white-space:nowrap}
        .dsh-balance-dot{flex:none;width:5px;height:5px;margin-right:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#21aa8b)}
        .dsh-balance-provider{min-width:0;overflow:hidden;text-overflow:ellipsis;color:inherit;cursor:pointer}
        .dsh-balance-provider:hover{color:var(--dsw-alias-label-primary,#252a31)}
        .dsh-balance-separator{flex:none;margin:0 7px;color:var(--dsw-alias-label-tertiary,#9299a2)}
        .dsh-balance-value{flex:none;color:var(--dsw-alias-label-primary,#30353c);font-weight:650;font-variant-numeric:tabular-nums}
        .dsh-balance-updated{flex:none;margin-left:8px;color:var(--dsw-alias-label-tertiary,#a0a6ae);font-size:11px}
        .dsh-balance-refresh{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;margin-left:5px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#9299a2);font:14px/1 inherit;cursor:pointer}
        .dsh-balance-refresh.loading{animation:dsh-balance-spin .7s linear infinite}
        .dsh-balance-refresh:disabled{cursor:wait;opacity:.65}
        @keyframes dsh-balance-spin{to{transform:rotate(360deg)}}
        .dsh-balance-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f1f3f5);color:var(--dsw-alias-label-primary,#25292f)}
        .dsh-balance-health{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;margin-left:2px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#9299a2);cursor:pointer}
        .dsh-balance-health:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f3f5);color:var(--dsw-alias-state-success-primary,#21aa8b)}
        .dsh-balance-health svg{width:15px;height:15px}
        .dsh-health-backdrop{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,24,30,.46)}
        .dsh-health-modal{display:flex;width:min(920px,100%);max-height:min(760px,calc(100vh - 48px));flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#e1e4e8);border-radius:12px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 24px 70px rgba(18,24,34,.24);color:var(--dsw-alias-label-primary,#25292f)}
        .dsh-health-head{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e1e4e8)}
        .dsh-health-title{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}
        .dsh-health-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;line-height:23px}
        .dsh-health-title span{color:var(--dsw-alias-label-tertiary,#9299a2);font-size:11px}
        .dsh-health-action{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#9299a2);font:18px/1 inherit;cursor:pointer;transition:background .15s,color .15s}
        .dsh-health-action:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f3f5);color:var(--dsw-alias-label-primary,#25292f)}
        .dsh-health-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d73ff);outline-offset:-2px}
        .dsh-health-action:disabled{cursor:wait;opacity:.55}
        .dsh-health-refresh{font-size:14px}
        .dsh-health-body{min-height:220px;overflow:auto;padding:18px 20px;overscroll-behavior:contain;scrollbar-gutter:stable}
        .dsh-health-source{display:flex;min-width:0;align-items:center;gap:6px;margin-bottom:14px}
        .dsh-health-source span{color:var(--dsw-alias-label-secondary,#68707b);font-size:13px;line-height:28px}
        .dsh-health-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;color:var(--dsw-alias-label-secondary,#68707b);font-size:12px}
        .dsh-health-empty{display:flex;min-height:190px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#9299a2);font-size:13px;text-align:center}
        .dsh-health-spinner{width:24px;height:24px;margin-right:10px;border:2px solid var(--dsw-alias-border-l2,#e1e4e8);border-top-color:var(--dsw-alias-brand-primary,#4d73ff);border-radius:50%;animation:dsh-balance-spin .7s linear infinite}
        @media(max-width:620px){.dsh-health-backdrop{padding:12px}.dsh-health-modal{max-height:calc(100vh - 24px)}.dsh-health-head,.dsh-health-body{padding-left:14px;padding-right:14px}}
        .dsh-balance-summary.error{color:var(--dsw-alias-state-error-primary,#d04d59)}
        .dsh-balance-summary.error .dsh-balance-dot{background:var(--dsw-alias-state-error-primary,#d04d59)}
        .dsh-balance-provider-menu{position:fixed;z-index:1001;width:230px;padding:6px;border:1px solid var(--dsw-alias-border-l2,#e1e4e8);border-radius:12px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 12px 34px rgba(26,34,46,.14)}
        .dsh-balance-provider-menu[hidden]{display:none}
        .dsh-balance-provider-option{display:flex;align-items:center;width:100%;min-height:38px;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#25292f);font:13px/20px inherit;text-align:left;cursor:pointer}
        .dsh-balance-provider-option:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f3f5)}
        .dsh-balance-provider-option.active::after{content:"✓";margin-left:auto;font-size:14px}
        .dsh-balance-provider-option .dsh-balance-dot{margin-right:9px}
        .dsh-balance-provider-option-value{margin-left:auto;color:var(--dsw-alias-label-secondary,#68707b);font-size:12px;font-weight:600}
        .dsh-balance-provider-option.active .dsh-balance-provider-option-value{margin-left:8px;margin-right:8px}
        @media (max-width:760px){.dsh-balance-updated{display:none}}
      `;
      document.head.append(state.style);

      const bar = document.createElement("div");
      bar.className = "dsh-balance-status";
      bar.setAttribute("aria-live", "polite");

      const menu = document.createElement("div");
      menu.className = "dsh-balance-provider-menu";
      menu.hidden = true;

      const summary = document.createElement("div");
      summary.className = "dsh-balance-summary";
      summary.addEventListener("click", event => {
        const providerName = event.target.closest?.(".dsh-balance-provider");
        if (!providerName) return;
        event.stopPropagation();
        if (menu.hidden) renderProviderMenu(menu, providerName);
        else menu.hidden = true;
      });

      bar.append(summary);
      document.body.append(menu);
      state.bar = bar;
      return bar;
    }

    function closeHealthModal() {
      state.healthRequestGeneration += 1;
      state.healthModal?.remove();
      state.healthModal = null;
    }

    function renderHealthModal(source, phase) {
      const backdrop = state.healthModal;
      if (!backdrop) return;
      const modal = backdrop.querySelector(".dsh-health-modal");
      const content = backdrop.querySelector(".dsh-health-content");
      const updated = backdrop.querySelector(".dsh-health-source span");
      const refresh = backdrop.querySelector(".dsh-health-refresh");
      if (!modal || !content || !updated || !refresh) return;
      content.replaceChildren();
      refresh.disabled = phase.loading === true;
      updated.textContent = phase.loading ? "正在获取所有模型状态" : phase.error ? "请求失败" : phase.status?.fetchedAt ? `更新于 ${formatHistoryAt(phase.status.fetchedAt)}` : "";

      if (phase.loading) {
        const empty = document.createElement("div");
        empty.className = "dsh-health-empty";
        const spinner = document.createElement("i");
        spinner.className = "dsh-health-spinner";
        empty.append(spinner, document.createTextNode("正在获取健康状态"));
        content.append(empty);
        return;
      }
      if (phase.error) {
        const empty = document.createElement("div");
        empty.className = "dsh-health-empty";
        empty.textContent = phase.error;
        content.append(empty);
        return;
      }

      const models = Array.isArray(phase.status?.models) ? phase.status.models : [];
      // 统计口径与卡片一致：error / warn / unknown 分开计数，不再把警告混进"未知"
      const failed = models.filter(model => model.status === "error").length;
      const warned = models.filter(model => model.status === "warn").length;
      const unknown = models.filter(model => model.status === "unknown").length;
      const summary = document.createElement("div");
      summary.className = "dsh-health-summary";
      const summaryText = document.createElement("strong");
      summaryText.textContent = `${models.length} 个模型`;
      const summaryState = document.createElement("span");
      const parts = [failed && `${failed} 个失败`, warned && `${warned} 个警告`, unknown && `${unknown} 个未知`].filter(Boolean);
      summaryState.textContent = parts.length ? parts.join(" · ") : "全部正常";
      summary.append(summaryText, summaryState);
      content.append(summary);

      if (!models.length) {
        const empty = document.createElement("div");
        empty.className = "dsh-health-empty";
        empty.textContent = "接口未返回模型状态";
        content.append(empty);
        return;
      }

      const grid = document.createElement("div");
      grid.className = "db-preview-cards";
      for (const model of models) {
        // 卡片色调：未知状态独立灰调，与警告黄区分
        const tone = model.status === "ok" ? "ok" : model.status === "error" ? "error" : model.status === "unknown" ? "unknown" : "warn";
        const card = document.createElement("article");
        card.className = `db-preview-card ${tone}`;
        const head = document.createElement("div");
        head.className = "db-preview-card-head";
        const dot = document.createElement("i");
        dot.className = "db-preview-dot";
        // 分组名称：host 归一化输出 group 字段（可选绑定），有值才显示标签（独占一行置于卡片顶部）
        let groupRow = null;
        if (model.group) {
          groupRow = document.createElement("div");
          groupRow.className = "db-preview-card-group";
          const groupLabel = document.createElement("span");
          groupLabel.className = "db-preview-group";
          groupLabel.textContent = model.group;
          groupLabel.title = `分组：${model.group}`;
          groupRow.append(groupLabel);
        }
        const name = document.createElement("strong");
        name.textContent = model.model || "未知模型";
        name.title = name.textContent;
        const status = document.createElement("span");
        status.className = "db-preview-state";
        status.textContent = tone === "ok" ? "正常" : tone === "error" ? "失败" : tone === "warn" ? "警告" : "未知";
        // 分组标签独占一行置于卡片顶部（名称上方）；状态点固定最前：● 名称 状态
        head.append(dot, name, status);
        card.append(head);
        if (groupRow) card.prepend(groupRow);

        const metrics = document.createElement("div");
        metrics.className = "db-preview-metrics";
        const addMetric = (label, value) => {
          const item = document.createElement("span");
          item.append(document.createTextNode(`${label} `));
          const strong = document.createElement("b");
          strong.textContent = value;
          item.append(strong);
          metrics.append(item);
        };
        // 自定义指标名称/单位/小数位：监测源配置后覆盖默认显示（displayUnits 为解析后的最终显示单位）
        const metricLabels = phase.status?.labels || {};
        const metricUnits = phase.status?.units || {};
        const metricDisplayUnits = phase.status?.displayUnits || {};
        const metricDecimals = phase.status?.decimals || {};
        if (model.availability !== undefined) addMetric("可用率", `${Number(model.availability).toFixed(2)}%`);
        if (model.ttftMs !== undefined) addMetric(String(metricLabels.ttft || "").trim() || "TTFT", formatMetricValue(model.ttftMs, metricDisplayUnits.ttft || metricUnits.ttft, metricDecimals.ttft) || `${model.ttftMs}ms`);
        if (model.responseMs !== undefined) addMetric(String(metricLabels.response || "").trim() || "响应", formatMetricValue(model.responseMs, metricDisplayUnits.response || metricUnits.response, metricDecimals.response) || `${model.responseMs}ms`);
        if (model.samples) addMetric("样本", String(model.samples));
        // 自定义字段：host 归一化输出 models[].custom（{[name]: value}），逐项追加显示
        for (const [fieldName, value] of Object.entries(model.custom || {})) {
          if (value === undefined || value === null || value === "") continue;
          addMetric(fieldName, String(value));
        }
        if (metrics.childNodes.length) card.append(metrics);

        // 无历史记录时，绑定可用率则按可用率百分比生成近似进度条，否则显示当前状态单块
        const records = Array.isArray(model.history) && model.history.length
          ? model.history.slice(-60)
          : model.availability !== undefined
            ? (availabilityProgressBars(model.availability) || [{ status: model.status }])
            : [{ status: model.status }];
        const history = document.createElement("div");
        history.className = "db-preview-history";
        history.title = "最近健康记录";
        for (const record of records) {
          const bar = document.createElement("i");
          bar.className = record.status === "ok" ? "ok" : record.status === "error" ? "error" : record.status === "unknown" ? "unknown" : "warn";
          bar.title = [record.note, formatHistoryAt(record.at), record.error].filter(Boolean).join(" · ") || "健康状态记录";
          history.append(bar);
        }
        card.append(history);
        grid.append(card);
      }
      content.append(grid);
    }

    function openHealthModal(source) {
      closeHealthModal();
      const backdrop = document.createElement("div");
      backdrop.className = "dsh-health-backdrop";
      backdrop.setAttribute("role", "presentation");
      const modal = document.createElement("section");
      modal.className = "dsh-health-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", `${source.name} 健康监测`);
      const head = document.createElement("header");
      head.className = "dsh-health-head";
      const title = document.createElement("div");
      title.className = "dsh-health-title";
      const strong = document.createElement("strong");
      strong.textContent = "健康监测";
      title.append(strong);
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "dsh-health-action dsh-health-refresh";
      refresh.textContent = "↻";
      refresh.title = "刷新健康状态";
      refresh.setAttribute("aria-label", "刷新健康状态");
      const close = document.createElement("button");
      close.type = "button";
      close.className = "dsh-health-action";
      close.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      close.title = "关闭健康监测";
      close.setAttribute("aria-label", "关闭健康监测");
      const body = document.createElement("div");
      body.className = "dsh-health-body";
      const sourceMeta = document.createElement("div");
      sourceMeta.className = "dsh-health-source";
      const updated = document.createElement("span");
      sourceMeta.append(updated, refresh);
      const content = document.createElement("div");
      content.className = "dsh-health-content";
      body.append(sourceMeta, content);
      head.append(title, close);
      modal.append(head, body);
      backdrop.append(modal);
      document.body.append(backdrop);
      state.healthModal = backdrop;

      const onKeyDown = event => {
        if (event.key === "Escape") closeHealthModal();
      };
      backdrop.addEventListener("keydown", onKeyDown);
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) closeHealthModal();
      });
      close.addEventListener("click", closeHealthModal);

      const load = async () => {
        const generation = ++state.healthRequestGeneration;
        renderHealthModal(source, { loading: true });
        try {
          const result = await api(`/external-status?force=1&source=${encodeURIComponent(source.id)}`);
          if (generation !== state.healthRequestGeneration || state.healthModal !== backdrop) return;
          const status = (result.sources || []).find(item => item.id === source.id);
          if (!status) throw new Error("未找到当前供应商的健康状态");
          if (status.error) throw new Error(status.error);
          renderHealthModal(source, { status });
        } catch (error) {
          if (generation !== state.healthRequestGeneration || state.healthModal !== backdrop) return;
          renderHealthModal(source, { error: error.message || "健康状态请求失败" });
        }
      };
      refresh.addEventListener("click", load);
      close.focus();
      load();
    }

    function renderProviderMenu(menu, anchor) {
      // 未配置任何供应商时无可切换项，点击状态栏不应弹出空菜单。
      if (!state.providers.length) return;
      menu.replaceChildren();
      for (const item of state.providers) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `dsh-balance-provider-option${item.id === state.provider?.id ? " active" : ""}`;
        const dot = document.createElement("i");
        dot.className = "dsh-balance-dot";
        const label = document.createElement("span");
        label.textContent = item.name;
        const value = document.createElement("span");
        value.className = "dsh-balance-provider-option-value";
        value.textContent = item.status === "disabled"
          ? "余额监测已关闭"
          : (item.usageWindows || []).length
            ? `${Math.max(...item.usageWindows.map(window => window.percent))}%`
            : item.status === "ok"
              ? formatMoney(item.available, item.currency)
              : "查询失败";
        option.append(dot, label, value);
        option.addEventListener("click", event => {
          event.stopPropagation();
          state.selectedProviderId = item.id;
          state.requestGeneration += 1;
          sessionStorage.setItem(selectionKey(state.sessionId), item.id);
          menu.hidden = true;
          renderBar(state.config || { statusBar: true }, state.providers);
          refreshBar(false, false, item.id, state.requestGeneration);
        });
        menu.append(option);
      }
      const rect = anchor.getBoundingClientRect();
      menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 242))}px`;
      menu.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
      menu.hidden = false;
    }

    function renderBar(config, providers) {
      if (!config.statusBar) {
        state.bar?.remove();
        state.bar = null;
        state.provider = null;
        notifyDock();
        return;
      }
      const bar = ensureBar();
      const selected = state.selectedProviderId && providers.some(provider => provider.id === state.selectedProviderId)
        ? providers.find(provider => provider.id === state.selectedProviderId)
        : providers[0];
      const summary = bar.querySelector(".dsh-balance-summary");
      state.provider = selected || null;
      summary.replaceChildren();
      summary.className = "dsh-balance-summary";

      const put = (text, className) => {
        const span = document.createElement("span");
        if (className) span.className = className;
        span.textContent = text;
        summary.append(span);
        return span;
      };

      const dot = document.createElement("i");
      dot.className = "dsh-balance-dot";
      summary.append(dot);

      if (!selected) {
        put("未配置余额供应商", "dsh-balance-provider");
        notifyDock();
        return;
      }

      put(selected.name, "dsh-balance-provider");

      if (selected.status === "disabled") {
        // Provider selection and health monitoring remain available without querying balance.
      } else if (selected.status !== "ok") {
        summary.classList.add("error");
        put("查询失败", "dsh-balance-separator");
        put(selected.error || "余额查询失败", "dsh-balance-value");
      } else {
        const windows = selected.usageWindows || [];
        if (windows.length) {
          for (const item of windows) {
            const level = item.percent >= 90 ? "danger" : item.percent >= 80 ? "warn" : "";
            put(`· ${compactUsageLabel(item.type)} `, "dsh-balance-separator");
            const value = put(`${item.percent}%`, "dsh-balance-value");
            if (level) value.classList.add(level);
          }
        } else {
          put("· 可用余额", "dsh-balance-separator");
          put(formatMoney(selected.available, selected.currency), "dsh-balance-value");
        }
      }

      if (selected.status !== "disabled") {
        if (selected.syncedAt) put(formatSyncedAt(selected.syncedAt), "dsh-balance-updated");

        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = `dsh-balance-refresh${state.refreshingProviderId === selected.id ? " loading" : ""}`;
        refresh.textContent = "↻";
        refresh.title = "刷新余额";
        refresh.setAttribute("aria-label", "刷新余额");
        refresh.disabled = state.refreshingProviderId === selected.id;

        refresh.addEventListener("click", async event => {
          event.stopPropagation();
          if (state.refreshingProviderId) return;
          const providerId = selected.id;
          const generation = ++state.requestGeneration;
          state.refreshingProviderId = providerId;
          renderBar(state.config || { statusBar: true }, state.providers);
          try {
            await refreshBar(false, true, providerId, generation);
          } finally {
            if (state.refreshingProviderId === providerId) state.refreshingProviderId = null;
            if (state.provider?.id === providerId) renderBar(state.config || { statusBar: true }, state.providers);
          }
        });

        summary.append(refresh);
      }

      const healthSource = (config.externalStatusSources || []).find(source => source.providerId === selected.id && source.enabled === true);
      if (healthSource) {
        const health = document.createElement("button");
        health.type = "button";
        health.className = "dsh-balance-health";
        health.title = "查看健康监测";
        health.setAttribute("aria-label", "查看健康监测");
        health.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        health.addEventListener("click", event => {
          event.stopPropagation();
          openHealthModal(healthSource);
        });
        summary.append(health);
      }
      notifyDock();
    }

    async function refreshBar(reloadConfig = false, force = false, providerId = null, requestGeneration = state.requestGeneration) {
      try {
        if (reloadConfig || !state.config) state.config = (await api("/config")).config;
        const targetId = providerId || (force ? state.provider?.id : null);
        const query = new URLSearchParams();
        if (force) query.set("force", "1");
        if (targetId) query.set("provider", targetId);
        const result = (await api(`/summary${query.size ? `?${query}` : ""}`)).providers;
        if (requestGeneration !== state.requestGeneration) return;
        const providers = targetId ? state.providers.map(provider => result.find(item => item.id === provider.id) || provider) : result;
        state.providers = providers;
        const resolvedId = resolveSelectedProvider(providers, state.sessionId, state.config?.defaultProviderId);
        state.selectedProviderId = resolvedId;
        if (resolvedId && sessionStorage.getItem(selectionKey(state.sessionId)) !== resolvedId && sessionStorage.getItem(selectionKey(state.sessionId))) {
          sessionStorage.removeItem(selectionKey(state.sessionId));
        }
        renderBar(state.config, providers);
      } catch {
        if (requestGeneration !== state.requestGeneration) return;
        if (state.bar) {
          state.provider = { name: "余额查询", status: "error", error: "网络连接不可用" };
          renderBar(state.config || { statusBar: true }, [state.provider]);
        }
      }
    }

    const loadLlmSettingsSnapshot = async (force = false) => {
      if (!force && state.llmSettingsSnapshot) return state.llmSettingsSnapshot;
      if (!force && state.llmSettingsPromise) return state.llmSettingsPromise;
      const connection = state.connection;
      if (!connection) throw new Error("未连接到 DSH 宿主服务");
      const pending = Promise.all([
        connection.api.llm.providers({}),
        connection.api.settings.describe({})
      ]).then(([directory, settings]) => {
        if (!directory.result.ok || !settings.result.ok) throw new Error("无法读取模型供应商");
        const snapshot = { directory, settings };
        state.llmSettingsSnapshot = snapshot;
        return snapshot;
      }).finally(() => {
        if (state.llmSettingsPromise === pending) state.llmSettingsPromise = null;
      });
      state.llmSettingsPromise = pending;
      return pending;
    };

    function JsonTreeNode({ value, path, labelKey, depth, bindingSlot, onNodeClick }) {
      const [open, setOpen] = React.useState(depth < 2);
      if (value === null || typeof value !== "object") {
        const type = value === null ? "null" : typeof value;
        const className = type === "string" ? "db-json-string" : type === "number" ? "db-json-number" : type === "boolean" ? "db-json-boolean" : "db-json-null";
        return h(
          "div",
          { className: `db-json-leaf${bindingSlot ? " binding" : ""}`, style: { cursor: "pointer" }, onClick: () => { if (bindingSlot) onNodeClick(path, type); } },
          h("span", { className: "db-json-key" }, labelKey),
          h("span", null, ":"),
          h("span", { className }, JSON.stringify(value))
        );
      }
      const entries = Object.entries(value);
      const isArray = Array.isArray(value);
      const typeLabel = isArray ? `数组 · ${entries.length} 项` : `对象 · ${entries.length} 个字段`;
      const bindingArray = bindingSlot === "modelListPath" || bindingSlot === "history";
      return h(
        "details",
        { className: "db-json-node", open, onToggle: event => setOpen(event.currentTarget.open) },
        h(
          "summary",
          { style: { cursor: "pointer" } },
          h("span", { className: "db-json-key" }, labelKey),
          h("span", null, ":"),
          h("span", { className: `db-json-type${bindingArray && isArray ? " binding" : ""}`, onClick: () => { if (bindingArray && isArray) onNodeClick(path, "array"); } }, typeLabel)
        ),
        open && h(
          "div",
          { className: "db-json-children" },
          ...entries.map(([childKey, child], index) => {
            const childPath = isArray ? `${path}[${index}]` : `${path}.${childKey}`;
            return h(JsonTreeNode, {
              key: childPath,
              value: child,
              path: childPath,
              labelKey: isArray ? `[${index}]` : childKey,
              depth: depth + 1,
              bindingSlot,
              onNodeClick
            });
          })
        )
      );
    }

    // Custom Hook for fetching connected LLM model providers from DSH settings
    // refreshKey 变化时强制重新拉取，保证模型页/高级设置弹窗的增删改能同步。
    function useModelProviders(refreshKey = 0) {
      const [modelProviders, setModelProviders] = React.useState([]);

      React.useEffect(() => {
        if (!state.connection) return;
        // 始终强制刷新（force），设置页/弹窗打开时模型页的增删改立即同步；
        // refreshKey 仅用于弹窗打开时再触发一次。
        loadLlmSettingsSnapshot(true).then(({ directory, settings }) => {
          const namespaces = new Map(settings.result.value.namespaces.map(item => [item.ns, item]));
          const atPath = (value, path) => path.reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), value);
          setModelProviders(
            directory.result.value.providers
              .filter(entry => {
                const namespace = namespaces.get(entry.settingsNs);
                return entry.active && namespace && (entry.settingsPath.length === 0 || atPath(namespace.value, entry.settingsPath) !== undefined);
              })
              .map(entry => {
                const namespace = namespaces.get(entry.settingsNs);
                const profile = atPath(namespace.value, entry.settingsPath) || namespace.value;
                return {
                  id: entry.provider,
                  name: entry.displayName || entry.provider,
                  credentialRef: typeof profile?.apiKeyEnv === "string" ? profile.apiKeyEnv : "",
                  baseURL: typeof profile?.baseURL === "string" ? profile.baseURL : ""
                };
              })
          );
        }).catch(() => setModelProviders([]));
      }, [refreshKey]);

      return modelProviders;
    }

    const ALL_REASONING_EFFORTS = [
      { id: "minimal", label: "极低 (minimal)" },
      { id: "low", label: "低 (low)" },
      { id: "medium", label: "中等 (medium)" },
      { id: "high", label: "高 (high)" },
      { id: "xhigh", label: "极高 (xhigh)" },
      { id: "max", label: "最大 (max)" }
    ];

    function ModelSettingsTab({ provider, boundRoute, refreshKey }) {
      const [llmMeta, setLlmMeta] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState("");
      const [successMsg, setSuccessMsg] = React.useState("");
      const [editingModelId, setEditingModelId] = React.useState(null);
      const [modelDraft, setModelDraft] = React.useState(null);
      const [saving, setSaving] = React.useState(false);

      const loadProviderModels = React.useCallback(async (force = false) => {
        setLoading(true);
        setError("");
        try {
          const { directory: directoryRes, settings: settingsRes } = await loadLlmSettingsSnapshot(force);
          if (!directoryRes.result.ok || !settingsRes.result.ok) {
            throw new Error("读取 DSH 模型设置失败");
          }
          const route = boundRoute(provider?.id) || provider?.id;
          const dirProvider = directoryRes.result.value.providers.find(p => p.provider === route || p.provider === provider?.id);
          const ns = dirProvider?.settingsNs || (provider?.preset === "deepseek" || provider?.id === "deepseek" ? "llm-deepseek" : "llm-pi-ai");
          const namespace = settingsRes.result.value.namespaces.find(n => n.ns === ns);
          const settingsPath = dirProvider?.settingsPath || (ns === "llm-pi-ai" ? ["providers", route] : []);

          let current = namespace?.value;
          for (const key of settingsPath) {
            current = current?.[key];
          }
          const storedModels = current?.models || [];
          const catalogModels = dirProvider?.models || [];
          const models = storedModels.length > 0
            ? storedModels
            : catalogModels.length > 0
              ? catalogModels
              : (ns === "llm-deepseek" ? [{ id: "deepseek-chat", name: "DeepSeek-V3" }, { id: "deepseek-reasoner", name: "DeepSeek-R1" }] : []);

          const providerDefaultReasoning = current?.reasoning || dirProvider?.reasoning || "";

          setLlmMeta({
            ns,
            settingsPath,
            revision: namespace?.revision,
            providerReasoning: providerDefaultReasoning,
            models: models.map(m => typeof m === "string" ? { id: m, name: m } : { ...m }),
            hasCustomOverride: storedModels.length > 0
          });
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, [provider, boundRoute]);

      React.useEffect(() => {
        // 弹窗每次打开都强制重新拉取模型配置，避免模型页增删改后读到旧缓存。
        loadProviderModels(true);
      }, [loadProviderModels, refreshKey]);

      const startEdit = (model) => {
        setEditingModelId(model.id);
        const inputList = Array.isArray(model.input) ? model.input : Array.isArray(model.modalities) ? model.modalities : ["text"];
        const isImageSupported = inputList.includes("image") || Boolean(model.supportsImages);

        let initialEfforts = [];
        if (model.reasoningEfforts === false) {
          initialEfforts = [];
        } else if (typeof model.reasoningEfforts === "object" && model.reasoningEfforts !== null) {
          if (Array.isArray(model.reasoningEfforts)) {
            initialEfforts = model.reasoningEfforts;
          } else {
            initialEfforts = Object.keys(model.reasoningEfforts);
          }
        } else if (model.reasoning || model.reasoningEffort) {
          initialEfforts = ["minimal", "low", "medium", "high", "xhigh", "max"];
        }

        const defaultReasoning = (typeof model.reasoning === "string" ? model.reasoning : model.reasoningEffort) || llmMeta?.providerReasoning || "";

        setModelDraft({
          id: model.id || "",
          name: model.name || "",
          contextWindow: formatCapacity(model.contextWindow),
          maxTokens: formatCapacity(model.maxTokens),
          supportText: inputList.includes("text") || inputList.length === 0,
          supportImage: isImageSupported,
          reasoningDefault: defaultReasoning,
          reasoningEfforts: initialEfforts
        });
        setSuccessMsg("");
        setError("");
      };

      const cancelEdit = () => {
        setEditingModelId(null);
        setModelDraft(null);
      };

      const saveModel = async (event) => {
        event?.preventDefault?.();
        if (!modelDraft || !modelDraft.id.trim()) {
          setError("模型 ID 不能为空");
          return;
        }
        setSaving(true);
        setError("");
        setSuccessMsg("");
        try {
          const connection = state.connection;
          if (!connection) throw new Error("未连接到宿主服务");

          const isNew = editingModelId === "__new__";
          const updatedItem = {
            id: modelDraft.id.trim(),
            name: modelDraft.name.trim() || modelDraft.id.trim()
          };
          if (modelDraft.contextWindow && modelDraft.contextWindow.trim()) {
            updatedItem.contextWindow = parseCapacity(modelDraft.contextWindow);
          }
          if (modelDraft.maxTokens && modelDraft.maxTokens.trim()) {
            updatedItem.maxTokens = parseCapacity(modelDraft.maxTokens);
          }

          const inputModalities = [];
          if (modelDraft.supportText) inputModalities.push("text");
          if (modelDraft.supportImage) inputModalities.push("image");
          if (inputModalities.length > 0) {
            updatedItem.input = inputModalities;
          }

          if (modelDraft.reasoningEfforts && modelDraft.reasoningEfforts.length > 0) {
            const effortDict = {};
            for (const eff of modelDraft.reasoningEfforts) {
              effortDict[eff] = eff;
            }
            updatedItem.reasoningEfforts = effortDict;
          } else if (modelDraft.reasoningEfforts && modelDraft.reasoningEfforts.length === 0) {
            updatedItem.reasoningEfforts = false;
          }

          let nextModels;
          if (isNew) {
            if (llmMeta.models.some(m => m.id === updatedItem.id)) {
              throw new Error(`已存在 ID 为 ${updatedItem.id} 的模型`);
            }
            nextModels = [...llmMeta.models, updatedItem];
          } else {
            nextModels = llmMeta.models.map(m => m.id === editingModelId ? updatedItem : m);
          }

          const ops = [{ op: "set", path: [...llmMeta.settingsPath, "models"], value: nextModels }];
          if (modelDraft.reasoningDefault) {
            ops.push({ op: "set", path: [...llmMeta.settingsPath, "reasoning"], value: modelDraft.reasoningDefault });
          } else {
            ops.push({ op: "unset", path: [...llmMeta.settingsPath, "reasoning"] });
          }

          const res = await connection.api.settings.mutate({
            ns: llmMeta.ns,
            ops,
            expectedRevision: llmMeta.revision
          });

          if (!res.result.ok) {
            const errMsg = res.result.error?.message || (typeof res.result.error === "string" ? res.result.error : JSON.stringify(res.result.error)) || "保存模型失败";
            throw new Error(errMsg);
          }

          setSuccessMsg(`已成功保存模型：${updatedItem.name || updatedItem.id}`);
          setEditingModelId(null);
          setModelDraft(null);
          await loadProviderModels(true);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setSaving(false);
        }
      };

      const removeModel = async (modelId) => {
        setSaving(true);
        setError("");
        setSuccessMsg("");
        try {
          const connection = state.connection;
          if (!connection) throw new Error("未连接到宿主服务");
          const nextModels = llmMeta.models.filter(m => m.id !== modelId);
          const res = await connection.api.settings.mutate({
            ns: llmMeta.ns,
            ops: [{ op: "set", path: [...llmMeta.settingsPath, "models"], value: nextModels }],
            expectedRevision: llmMeta.revision
          });
          if (!res.result.ok) throw new Error(res.result.error || "删除模型失败");
          setSuccessMsg(`已删除模型：${modelId}`);
          if (editingModelId === modelId) cancelEdit();
          await loadProviderModels(true);
        } catch (err) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      };

      const resetDefaultModels = async () => {
        setSaving(true);
        setError("");
        setSuccessMsg("");
        try {
          const connection = state.connection;
          if (!connection) throw new Error("未连接到宿主服务");
          const res = await connection.api.settings.mutate({
            ns: llmMeta.ns,
            ops: [{ op: "unset", path: [...llmMeta.settingsPath, "models"] }],
            expectedRevision: llmMeta.revision
          });
          if (!res.result.ok) throw new Error(res.result.error || "重置失败");
          setSuccessMsg("已恢复为默认模型目录");
          cancelEdit();
          await loadProviderModels(true);
        } catch (err) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      };

      if (loading) return h("div", { style: { padding: 16 } }, "正在读取模型配置…");
      if (!llmMeta) return h("div", { style: { padding: 16 } }, error || "无法读取该供应商的模型配置");

      return h(
        "div",
        { className: "db-models-tab" },
        h(
          "div",
          { className: "db-models-head" },
          h("span", null, "管理此供应商的模型列表、上下文窗口、输入能力与推理等级配置。")
        ),
        h(
          "div",
          { className: "db-model-list" },
          llmMeta.models.map(model => {
            const isEditing = editingModelId === model.id;
            return h(
              "div",
              { className: "db-model-card", key: model.id },
              h(
                "div",
                { className: "db-row-line" },
                h("span", { className: "db-model-id" }, model.id),
                h("div", { className: "db-spacer" }),
                h("button", { className: "db-quiet", type: "button", style: { height: 28, fontSize: 12, padding: "0 10px" }, onClick: () => isEditing ? cancelEdit() : startEdit(model) }, isEditing ? "收起" : "编辑"),
                h("button", { className: "db-delete", type: "button", style: { height: 28, fontSize: 12, padding: "0 10px" }, onClick: () => removeModel(model.id), disabled: saving }, "删除")
              ),
              h(
                "div",
                { className: "db-row-meta" },
                h("span", { className: "db-live" }),
                model.name && model.name !== model.id && h("span", { className: "db-model-name" }, model.name),
                model.contextWindow && h("span", { className: "db-model-tag" }, `上下文 ${formatCapacity(model.contextWindow)}`),
                model.maxTokens && h("span", { className: "db-model-tag" }, `输出 ${formatCapacity(model.maxTokens)}`),
                model.temperature !== undefined && h("span", { className: "db-model-tag" }, `温度 ${model.temperature}`),
                model.topP !== undefined && h("span", { className: "db-model-tag" }, `TopP ${model.topP}`),
                (Array.isArray(model.input) ? model.input.includes("image") : model.supportsImages) && h("span", { className: "db-model-tag" }, "支持图片"),
                (Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts.length > 0 : Boolean(model.reasoning || model.reasoningEffort)) &&
                  h("span", { className: "db-model-tag" }, `推理 ${model.reasoningEffort ? `默认 ${model.reasoningEffort}` : "已开启"}`)
              ),
              isEditing &&
                h(
                  "form",
                  { className: "db-model-editor db-form", onSubmit: saveModel },
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "模型 ID"),
                    h("input", { type: "text", required: true, value: modelDraft.id, onChange: e => setModelDraft({ ...modelDraft, id: e.target.value }) })
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "显示名称"),
                    h("input", { type: "text", value: modelDraft.name, onChange: e => setModelDraft({ ...modelDraft, name: e.target.value }) })
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "上下文窗口（Context Window）"),
                    h("input", { type: "text", placeholder: "例如 128K、256K 或 131072", value: modelDraft.contextWindow, onChange: e => setModelDraft({ ...modelDraft, contextWindow: e.target.value }) })
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "最大输出 Token 数（Max Tokens）"),
                    h("input", { type: "text", placeholder: "例如 8K、16K 或 8192", value: modelDraft.maxTokens, onChange: e => setModelDraft({ ...modelDraft, maxTokens: e.target.value }) })
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "输入能力"),
                    h(
                      "div",
                      { className: "db-checkbox-group" },
                      h(
                        "label",
                        { className: "db-checkbox-label" },
                        h("input", {
                          type: "checkbox",
                          checked: Boolean(modelDraft.supportText),
                          onChange: e => setModelDraft({ ...modelDraft, supportText: e.target.checked })
                        }),
                        "文本"
                      ),
                      h(
                        "label",
                        { className: "db-checkbox-label" },
                        h("input", {
                          type: "checkbox",
                          checked: Boolean(modelDraft.supportImage),
                          onChange: e => setModelDraft({ ...modelDraft, supportImage: e.target.checked })
                        }),
                        "图片"
                      )
                    )
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h("label", null, "默认推理等级"),
                    h(
                      "select",
                      {
                        className: "db-select",
                        value: modelDraft.reasoningDefault || "",
                        onChange: e => {
                          const val = e.target.value;
                          const nextEfforts = val && !modelDraft.reasoningEfforts.includes(val)
                            ? [...modelDraft.reasoningEfforts, val]
                            : modelDraft.reasoningEfforts;
                          setModelDraft({ ...modelDraft, reasoningDefault: val, reasoningEfforts: nextEfforts });
                        }
                      },
                      h("option", { value: "" }, "不设置默认 / 使用系统默认"),
                      ...ALL_REASONING_EFFORTS.map(eff => h("option", { key: eff.id, value: eff.id }, eff.label))
                    )
                  ),
                  h(
                    "div",
                    { className: "db-field" },
                    h(
                      "div",
                      { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
                      h("label", null, "对话框可选推理等级"),
                      h(
                        "button",
                        {
                          type: "button",
                          className: "db-quiet",
                          style: { height: 24, fontSize: 11, padding: "0 8px", borderRadius: 12 },
                          onClick: () => {
                            const allIds = ALL_REASONING_EFFORTS.map(e => e.id);
                            const isAllSelected = modelDraft.reasoningEfforts.length === allIds.length;
                            setModelDraft({
                              ...modelDraft,
                              reasoningEfforts: isAllSelected ? [] : allIds,
                              reasoningDefault: isAllSelected ? "" : (modelDraft.reasoningDefault || "high")
                            });
                          }
                        },
                        modelDraft.reasoningEfforts.length === ALL_REASONING_EFFORTS.length ? "全不选" : "全选"
                      )
                    ),
                    h(
                      "div",
                      { className: "db-checkbox-group", style: { flexWrap: "wrap", gap: "10px 16px", marginTop: 6 } },
                      ...ALL_REASONING_EFFORTS.map(eff => {
                        const checked = modelDraft.reasoningEfforts.includes(eff.id);
                        return h(
                          "label",
                          { className: "db-checkbox-label", key: eff.id },
                          h("input", {
                            type: "checkbox",
                            checked,
                            onChange: e => {
                              const next = e.target.checked
                                ? [...modelDraft.reasoningEfforts, eff.id]
                                : modelDraft.reasoningEfforts.filter(id => id !== eff.id);
                              setModelDraft({
                                ...modelDraft,
                                reasoningEfforts: next,
                                reasoningDefault: !e.target.checked && modelDraft.reasoningDefault === eff.id ? (next[0] || "") : modelDraft.reasoningDefault
                              });
                            }
                          }),
                          eff.label
                        );
                      })
                    ),
                    h("p", { className: "db-field-help" }, "勾选的等级将展示在主对话输入框的模型切换菜单中，用户可自由切换。")
                  ),
                  h(
                    "div",
                    { className: "db-form-actions" },
                    h("button", { className: "db-quiet", type: "button", onClick: cancelEdit }, "取消"),
                    h("button", { className: "db-primary", type: "submit", disabled: saving }, saving ? "保存中…" : "保存")
                  )
                )
            );
          })
        ),
        error && h("p", { className: "db-message error", role: "status" }, error),
        successMsg && h("p", { className: "db-message", role: "status" }, successMsg)
      );
    }

    function SettingsSection() {
      try {
        const [config, setConfig] = React.useState(null);
        const [message, setMessage] = React.useState("");
        const [messageKind, setMessageKind] = React.useState("ok");
        const [statuses, setStatuses] = React.useState({});
        const latestConfigRef = React.useRef(null);
        const balanceSummaryGeneration = React.useRef(0);
        const [editing, setEditing] = React.useState(null);
        const [llmRefreshKey, setLlmRefreshKey] = React.useState(0);
        const modelProviders = useModelProviders(llmRefreshKey);
        const [importMenuOpen, setImportMenuOpen] = React.useState(false);
        const importMenuRef = React.useRef(null);
        const [testing, setTesting] = React.useState(false);
        const [testResult, setTestResult] = React.useState(null);
        const [externalStatuses, setExternalStatuses] = React.useState([]);
        const [externalEditing, setExternalEditing] = React.useState(null);
        const [externalLoading, setExternalLoading] = React.useState(false);
        const [advancedOpen, setAdvancedOpen] = React.useState(false);
        const [advancedTab, setAdvancedTab] = React.useState("models");
        const [advancedProvider, setAdvancedProvider] = React.useState(null);
        const [externalPreview, setExternalPreview] = React.useState(null);
        const [externalPreviewing, setExternalPreviewing] = React.useState(false);
        const externalPreviewCache = React.useRef(new Map());
        const externalPreviewLoadGeneration = React.useRef(0);
        const [externalResultError, setExternalResultError] = React.useState("");
        const [bindingSlot, setBindingSlot] = React.useState(null);
        const [externalShowAllPreview, setExternalShowAllPreview] = React.useState(false);
        const [externalMapOpen, setExternalMapOpen] = React.useState(false);
        // 当前选中槽位：与 bindingSlot（绑定中，完成即清空）分离，保证绑定完成后按钮组仍显示
        const [activeSlotKey, setActiveSlotKey] = React.useState(null);

        React.useEffect(() => {
          if (!importMenuOpen) return;
          const onPointerDown = (event) => {
            if (importMenuRef.current && !importMenuRef.current.contains(event.target) && !event.target.closest?.(".db-import-wrap")) {
              setImportMenuOpen(false);
            }
          };
          document.addEventListener("pointerdown", onPointerDown);
          return () => document.removeEventListener("pointerdown", onPointerDown);
        }, [importMenuOpen]);

        const blankForm = {
          id: "",
          name: "",
          endpoint: "",
          balanceEnabled: true,
          responsePath: "$.remaining ?? $.quota?.remaining ?? $.balance",
          currency: "$.unit ?? $.quota?.unit ?? \"USD\"",
          apiKey: "",
          credentialRef: "",
          route: "",
          method: "GET",
          headersText: "",
          endpointBase: "",
          timeoutSeconds: 10,
          queryIntervalMinutes: 30,
          conversionEnabled: false,
          valueDivisor: 1
        };
        const [form, setForm] = React.useState(blankForm);

        const blankExternalForm = {
          id: "",
          name: "",
          endpoint: "",
          enabled: false,
          requestType: "custom",
          requestMethod: "GET",
          intervalSeconds: 60,
          timeoutSeconds: 10,
          modelListPath: "",
          model: "",
          group: "",
          status: "",
          availability: "",
          ttft: "",
          response: "",
          history: "",
          historyAt: "",
          historyStatus: "",
          historyError: "",
          error: "",
          modelTransform: "identity",
          statusTransform: "status",
          availabilityTransform: "percent",
          ttftTransform: "number",
          responseTransform: "number",
          historyTransform: "identity",
          historyAtTransform: "number",
          historyStatusTransform: "status",
          historyErrorTransform: "identity",
          errorTransform: "identity",
          statusMap: [],
          historyStatusMap: [],
          labels: { ttft: "", response: "" },
          ttftUnit: "ms",
          responseUnit: "ms",
          decimals: { ttft: 0, response: 0 },
          // 显示单位：""=跟随接口单位，可独立选 ms/s（支持接口 ms 按秒展示等组合）
          displayUnit: { ttft: "", response: "" }
        };
        const [externalForm, setExternalForm] = React.useState(blankExternalForm);

        const updateExternalForm = (next, mappingChanged = false) => {
          if (mappingChanged) {
            const cached = next.id && externalPreviewCache.current.get(next.id);
            if (cached) externalPreviewCache.current.set(next.id, { ...cached, normalized: null });
            setExternalTestState("idle");
            // 「预览全部模型」由 previewStatusCards 基于 previewData 实时计算，绑定后即时刷新，无需重新测试。
          }
          setExternalForm(next);
        };

        const [externalCustomFields, setExternalCustomFields] = React.useState([]);
        const [externalFieldEnabled, setExternalFieldEnabled] = React.useState({
          model: true, group: true, status: true, availability: true, ttft: true, response: true,
          history: true, historyAt: true, historyStatus: true, historyError: true, error: true
        });
        const [externalTestState, setExternalTestState] = React.useState("idle");
        const [externalTestMessage, setExternalTestMessage] = React.useState("");
        const [externalSaveMessage, setExternalSaveMessage] = React.useState("");

        const loadExternalStatuses = (force = false) => {
          setExternalLoading(true);
          const query = force ? "?force=1" : "";
          return api(`/external-status${query}`)
            .then(data => setExternalStatuses(data.sources || []))
            .catch(() => setExternalStatuses([]))
            .finally(() => setExternalLoading(false));
        };

        const loadSummary = () => {
          const generation = ++balanceSummaryGeneration.current;
          return api("/summary")
            .then(data => {
              if (generation !== balanceSummaryGeneration.current) return;
              const currentConfig = latestConfigRef.current;
              setStatuses(Object.fromEntries(data.providers.map(provider => {
                const configured = currentConfig?.providers?.find(item => item.id === provider.id);
                return [provider.id, configured?.balanceEnabled === false ? { id: provider.id, name: provider.name, status: "disabled" } : provider];
              })));
            })
            .catch(() => {});
        };

        React.useEffect(() => {
          latestConfigRef.current = config;
        }, [config]);

        React.useEffect(() => {
          api("/config")
            .then(data => setConfig(data.config))
            .catch(error => {
              setMessage(error.message);
              setMessageKind("error");
            });
          loadSummary();
          loadExternalStatuses();
        }, []);

        const boundRoute = React.useCallback(
          (id) => Object.entries(config?.bindings || {}).find(([, bid]) => bid === id)?.[0] || "",
          [config?.bindings]
        );

        const savePreferences = async (next) => {
          const preferences = {
            statusBar: config.statusBar,
            defaultProviderId: Object.prototype.hasOwnProperty.call(next, "defaultProviderId")
              ? next.defaultProviderId
              : config.defaultProviderId ?? null,
            bindings: next.bindings ?? config.bindings
          };
          await api("/preferences", { method: "POST", body: JSON.stringify(preferences) });
          const nextConfig = { ...config, ...next };
          setConfig(nextConfig);
          state.config = nextConfig;
          refreshBar();
        };

        const balanceMeta = (id) => {
          const s = statuses[id];
          if (!s) return null;
          if (s.status === "disabled") return [h("span", { className: "db-meta-note" }, "余额监测已关闭")];
          if (s.status !== "ok") return [h("span", { className: "db-meta-error" }, s.error || "查询失败")];
          const out = (s.usageWindows || []).length ? [] : [h("span", { key: "bal" }, formatMoney(s.available, s.currency))];
          for (const item of s.usageWindows || []) {
            const label = item.type === "rolling" ? "滚动" : item.type === "weekly" ? "本周" : "本月";
            out.push(h("span", { key: item.type, title: item.resetAt ? `重置于 ${item.resetAt}` : undefined }, `${label} ${item.percent}%`));
          }
          if (!(s.usageWindows || []).length) out.push(h("span", { key: "note", className: "db-meta-note" }, "仅余额"));
          return out;
        };

        if (!config) return h("div", { style: { padding: 16 } }, message || "正在加载…");

        const draftPayload = () => {
          const preset = form.preset || (form.route === "opencode-go" || form.id === "opencode-go" ? "opencode-go" : form.route === "deepseek" || form.id === "deepseek" || form.id === "deepseek-official" ? "deepseek" : "");
          const body = {
            ...form,
            ...(preset ? { preset } : {}),
            apiKey: form.apiKey || undefined,
            method: form.method === "POST" ? "POST" : "GET",
            valueDivisor: form.conversionEnabled ? Math.max(1, Number(form.valueDivisor) || 1) : 1
          };
          delete body.conversionEnabled;
          if (body.preset) {
            delete body.endpoint;
            delete body.endpointBase;
            delete body.responsePath;
          } else if (body.endpoint && body.endpoint.startsWith("/") && body.endpointBase) {
            body.endpoint = body.endpointBase.replace(/\/+$/, "") + body.endpoint;
          }
          if (form.headersText.trim()) {
            body.headers = Object.fromEntries(
              form.headersText
                .split(/[\r\n]+/)
                .map(line => {
                  const at = line.indexOf(":");
                  return at < 1 ? [] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                })
                .filter(kv => kv.length === 2 && kv[0] && kv[1])
            );
          }
          return body;
        };

        const testProvider = async () => {
          setTesting(true);
          setTestResult(null);
          try {
            const data = await api("/provider/test", { method: "POST", body: JSON.stringify(draftPayload()) });
            setTestResult(data.result);
          } catch (error) {
            setTestResult({ status: "error", error: error.message });
          } finally {
            setTesting(false);
          }
        };

        const saveProvider = async (event) => {
          event.preventDefault();
          try {
            const body = draftPayload();
            const data = await api("/provider", { method: "POST", body: JSON.stringify(body) });
            let bindings = { ...(config.bindings || {}) };
            if (form.route) {
              for (const [key, bid] of Object.entries(bindings)) {
                if (bid === data.provider.id) delete bindings[key];
              }
              bindings[form.route] = data.provider.id;
              await api("/preferences", { method: "POST", body: JSON.stringify({ statusBar: config.statusBar, bindings }) });
            }
            const saved = {
              ...data.provider,
              method: body.method,
              headers: body.headers || {},
              ...(body.valueDivisor ? { valueDivisor: Number(body.valueDivisor) } : {})
            };
            const nextConfig = {
              ...config,
              providers: [...config.providers.filter(item => item.id !== data.provider.id), saved],
              bindings
            };
            setConfig(nextConfig);
            latestConfigRef.current = nextConfig;
            state.config = nextConfig;
            state.requestGeneration += 1;
            balanceSummaryGeneration.current += 1;
            setForm(blankForm);
            setEditing(null);
            setMessage(
              form.route
                ? `已保存并绑定到 ${modelProviders.find(item => item.id === form.route)?.name || form.route}`
                : form.credentialRef
                  ? "供应商已保存；将复用模型页的凭据"
                  : "供应商已保存；密钥已写入系统钥匙串"
            );
            if (saved.balanceEnabled === false) {
              const disabled = { id: saved.id, name: saved.name, status: "disabled" };
              setStatuses(current => ({ ...current, [saved.id]: disabled }));
              state.providers = state.providers.some(item => item.id === saved.id)
                ? state.providers.map(item => item.id === saved.id ? disabled : item)
                : [...state.providers, disabled];
              renderBar(nextConfig, state.providers);
            } else {
              loadSummary();
              refreshBar();
            }
          } catch (error) {
            setMessage(error.message);
            setMessageKind("error");
          }
        };

        const beginAdd = (source) => {
          setForm(
            source
              ? {
                  ...blankForm,
                  id: source.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
                  name: source.name,
                  credentialRef: source.credentialRef,
                  route: source.id,
                  endpointBase: source.baseURL || "",
                  endpoint: "/usage"
                }
              : blankForm
          );
          setEditing(source?.id || "__new");
          setImportMenuOpen(false);
        };

        const beginPreset = (source, preset = "deepseek") => {
          const id = source?.id || preset;
          const name = source?.name || (preset === "deepseek" ? "DeepSeek" : "OpenCode Go");
          setForm({
            ...blankForm,
            id: id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
            name,
            credentialRef: source?.credentialRef || "",
            preset,
            route: source?.id || "",
            endpointBase: "",
            endpoint: ""
          });
          setEditing(id);
          setImportMenuOpen(false);
        };

        const beginNeco = (source) => {
          const base = String(source.baseURL || "").replace(/\/+$/, "");
          const endpoint = /\/v1$/i.test(base) ? "/usage" : "/v1/usage";
          setForm({
            ...blankForm,
            id: source.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
            name: source.name,
            credentialRef: source.credentialRef,
            route: source.id,
            endpointBase: base,
            endpoint,
            responsePath: "$.wallet.remaining",
            currency: "USD",
            headersText: "Content-Type: application/json\nUser-Agent: cc-switch/1.0",
            conversionEnabled: true,
            valueDivisor: 500000
          });
          setEditing(source.id);
          setImportMenuOpen(false);
        };

        const beginEdit = (provider) => {
          const route = boundRoute(provider.id);
          const editKey = route || provider.id;
          if (editing === editKey) {
            setEditing(null);
            setForm(blankForm);
            return;
          }
          const mp = modelProviders.find(m => m.id === route || m.id === provider.id);
          setForm({
            ...provider,
            apiKey: "",
            headersText: toHeadersText(provider),
            method: provider.method || "GET",
            route,
            endpointBase: mp?.baseURL || "",
            timeoutSeconds: provider.timeoutSeconds ?? 10,
            queryIntervalMinutes: provider.queryIntervalMinutes ?? 30,
            balanceEnabled: provider.balanceEnabled !== false,
            valueDivisor: provider.valueDivisor ?? (provider.id === "neco" ? 500000 : 1),
            conversionEnabled: Number(provider.valueDivisor ?? (provider.id === "neco" ? 500000 : 1)) !== 1
          });
          setEditing(editKey);
          setImportMenuOpen(false);
        };

        const remove = async (id) => {
          try {
            await api(`/provider/${encodeURIComponent(id)}`, { method: "DELETE" });
            const nextConfig = {
              ...config,
              providers: config.providers.filter(item => item.id !== id),
              defaultProviderId: config.defaultProviderId === id ? null : config.defaultProviderId,
              bindings: Object.fromEntries(Object.entries(config.bindings || {}).filter(([, providerId]) => providerId !== id))
            };
            setConfig(nextConfig);
            state.config = nextConfig;
            if (state.selectedProviderId === id) {
              state.selectedProviderId = resolveSelectedProvider(nextConfig.providers, state.sessionId, nextConfig.defaultProviderId);
              if (state.selectedProviderId) sessionStorage.setItem(selectionKey(state.sessionId), state.selectedProviderId);
              else sessionStorage.removeItem(selectionKey(state.sessionId));
            }
            setMessage("供应商已删除");
          } catch (error) {
            setMessage(error.message);
            setMessageKind("error");
          }
        };

        const toggleBalanceEnabled = async (provider, enabled) => {
          const previous = provider.balanceEnabled !== false;
          if (previous === enabled) return;
          try {
            const data = await api("/provider", {
              method: "POST",
              body: JSON.stringify({ ...provider, balanceEnabled: enabled })
            });
            const saved = { ...data.provider, headers: provider.headers || {}, valueDivisor: provider.valueDivisor || 1 };
            const nextConfig = {
              ...config,
              providers: config.providers.map(item => item.id === provider.id ? saved : item)
            };
            setConfig(nextConfig);
            state.config = nextConfig;
            if (!enabled) {
              const disabled = { id: saved.id, name: saved.name, status: "disabled" };
              setStatuses(current => ({ ...current, [saved.id]: disabled }));
              state.providers = state.providers.map(item => item.id === saved.id ? disabled : item);
              renderBar(nextConfig, state.providers);
            } else {
              loadSummary();
              refreshBar();
            }
          } catch (error) {
            setMessage(error.message);
            setMessageKind("error");
          }
        };

        const field = (key, label, type = "text", wide = false) =>
          h(
            "div",
            { className: `db-field${wide ? " wide" : ""}` },
            h("label", { htmlFor: `db-${key}` }, label),
            h("input", {
              id: `db-${key}`,
              type: key === "endpoint" && form.endpointBase ? "text" : type,
              required: key !== "apiKey",
              min: key === "timeoutSeconds" ? 1 : key === "queryIntervalMinutes" ? 0 : undefined,
              max: key === "timeoutSeconds" ? 300 : key === "queryIntervalMinutes" ? 1440 : undefined,
              step: type === "number" ? 1 : undefined,
              value: form[key],
              onChange: event => setForm({ ...form, [key]: event.target.value })
            })
          );

        const toHeadersText = (provider) =>
          Object.entries(provider.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n");

        const headerRows = () =>
          form.headersText
            ? form.headersText.split(/\r?\n/).map(line => {
                const at = line.indexOf(":");
                return at < 0
                  ? { name: line, value: "" }
                  : { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
              })
            : [];

        const updateHeaderRows = (rows) =>
          setForm({ ...form, headersText: rows.map(row => `${row.name}: ${row.value}`).join("\n") });

        const headersEditor = () => {
          const rows = headerRows();
          return h(
            "div",
            { className: "db-field wide" },
            h("label", null, "请求头（Authorization 自动注入，无需填写）"),
            h(
              "div",
              { className: "db-header-list" },
              rows.map((row, index) =>
                h(
                  "div",
                  { className: "db-header-row", key: index },
                  h("input", {
                    type: "text",
                    placeholder: "名称",
                    value: row.name,
                    onChange: event => {
                      const next = [...rows];
                      next[index] = { ...row, name: event.target.value };
                      updateHeaderRows(next);
                    }
                  }),
                  h("input", {
                    type: "text",
                    placeholder: "值",
                    value: row.value,
                    onChange: event => {
                      const next = [...rows];
                      next[index] = { ...row, value: event.target.value };
                      updateHeaderRows(next);
                    }
                  }),
                  h(
                    "button",
                    {
                      className: "db-header-remove",
                      type: "button",
                      title: "删除请求头",
                      "aria-label": "删除请求头",
                      onClick: () => updateHeaderRows(rows.filter((_, rowIndex) => rowIndex !== index))
                    },
                    h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, h("path", { d: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" }))
                  )
                )
              )
            ),
            h(
              "button",
              { className: "db-header-add", type: "button", onClick: () => updateHeaderRows([...rows, { name: "", value: "" }]) },
              "+ 添加请求头"
            )
          );
        };

        const inlineEditor = () =>
          h(
            "div",
            { className: "db-inline-editor" },
            h(
              "form",
              { className: "db-form", onSubmit: saveProvider },
              h(
                "label",
                { className: "db-monitor-toggle" },
                h("span", { className: "db-monitor-toggle-copy" },
                  h("strong", null, "开启余额监测"),
                  h("span", null, "关闭后不再自动请求余额，状态栏仅保留供应商名称和独立健康入口。")
                ),
                h("input", {
                  type: "checkbox",
                  checked: form.balanceEnabled !== false,
                  onChange: event => setForm({ ...form, balanceEnabled: event.target.checked })
                })
              ),
              field("name", "显示名称"),
              form.preset === "deepseek"
                ? h("p", { className: "db-message db-field wide" }, "已使用 DeepSeek 官方余额接口，无需填写查询地址或字段路径。")
                : form.preset === "opencode-go"
                  ? h("p", { className: "db-message db-field wide" }, "已使用 OpenCode Go 官方额度接口，自动查询 5 小时、每周和每月用量。")
                  : [
                      field("endpoint", form.endpointBase ? "余额查询地址（以 / 开头时将拼接基础地址）" : "余额查询 HTTPS 地址", "url", true),
                      form.endpointBase &&
                        h("p", { className: "db-message db-field wide" }, "已复用模型页基础地址：", form.endpointBase, "，仅需在下方追加路径（如 /usage）；或保留为完整地址。"),
                      h(
                        "div",
                        { className: "db-field" },
                        h("label", { htmlFor: "db-method" }, "请求方式"),
                        h(
                          "select",
                          { id: "db-method", className: "db-select", value: form.method, onChange: event => setForm({ ...form, method: event.target.value }) },
                          h("option", { value: "GET" }, "GET"),
                          h("option", { value: "POST" }, "POST（无请求体）")
                        )
                      ),
                      field("responsePath", "余额 JSON 路径"),
                      h("p", { className: "db-field-help" }, "支持 ?? 回退链与可选链，如 $.remaining ?? $.quota?.remaining ?? $.balance；根节点也可写作 response"),
                      field("currency", "币种"),
                      h("p", { className: "db-field-help" }, "可填固定币种（如 USD），或用表达式读取响应单位，如 $.unit ?? \"USD\""),
                      h(
                        "div",
                        { className: "db-field wide" },
                        h(
                          "div",
                          { style: { display: "flex", alignItems: "center", gap: 10 } },
                          h("label", null, "金额换算"),
                          h(
                            "button",
                            {
                              className: `db-toggle${form.conversionEnabled ? " on" : ""}`,
                              type: "button",
                              "aria-pressed": form.conversionEnabled,
                              onClick: () => setForm({ ...form, conversionEnabled: !form.conversionEnabled })
                            },
                            h("i")
                          )
                        ),
                        h("p", { className: "db-field-help" }, "接口返回的是额度单位而非实际金额时开启。")
                      ),
                      form.conversionEnabled &&
                        h("div", { className: "db-field wide" }, field("valueDivisor", "换算除数", "number", true), h("p", { className: "db-field-help" }, "接口原始值 ÷ 换算除数 = 最终显示金额")),
                      headersEditor()
                    ],
              !form.credentialRef && field("apiKey", "API Key（仅写入钥匙串）", "password", true),
              form.credentialRef &&
                h("p", { className: "db-message db-field wide" }, "将复用模型页凭据：", form.credentialRef, "，无需再次输入 API Key。"),
              h(
                "div",
                { className: "db-field wide" },
                h("label", { htmlFor: "db-queryIntervalMinutes" }, "刷新间隔（分钟，0 为不自动刷新）"),
                h("input", {
                  id: "db-queryIntervalMinutes",
                  type: "number",
                  min: 0,
                  max: 1440,
                  value: form.queryIntervalMinutes,
                  onChange: event => setForm({ ...form, queryIntervalMinutes: Number(event.target.value) })
                })
              ),
              h(
                "div",
                { className: "db-field wide" },
                h("label", { htmlFor: "db-timeoutSeconds" }, "请求超时（秒）"),
                h("input", {
                  id: "db-timeoutSeconds",
                  type: "number",
                  min: 1,
                  max: 300,
                  value: form.timeoutSeconds,
                  onChange: event => setForm({ ...form, timeoutSeconds: Number(event.target.value) })
                })
              ),
              testResult &&
                h(
                  "div",
                  { className: "db-field wide" },
                  h("p", { className: testResult.status === "ok" ? "db-message" : "db-message error" }, testResult.status === "ok" ? `测试成功: 可用额度 ${testResult.available ?? "无数值"} ${testResult.currency || ""}` : `测试失败: ${testResult.error || "未知错误"}`)
                ),
              h(
                "div",
                { className: "db-form-actions" },
                h("button", { className: "db-quiet", type: "button", onClick: () => { setForm(blankForm); setEditing(null); } }, "取消"),
                h("button", { className: "db-quiet", type: "button", onClick: testProvider, disabled: testing }, testing ? "测试中…" : "测试"),
                h("button", { className: "db-primary", type: "submit" }, "保存")
              )
            )
          );

        const externalPayload = () => {
          let generatedName = externalForm.name;
          try { generatedName = generatedName || new URL(externalForm.endpoint).hostname; } catch {}
          const transformValue = key => {
            // 映射条目非空时输出 map 结构（优先于普通转换），否则输出所选转换
            const entries = (externalForm[`${key}Map`] || [])
              .filter(row => row && row.raw && String(row.raw).trim())
              .map(row => ({ raw: String(row.raw).trim(), status: ["ok", "error", "warn", "unknown"].includes(row.status) ? row.status : "ok" }));
            if (entries.length) return { kind: "map", entries };
            return externalForm[`${key}Transform`] || "identity";
          };
          return {
            id: externalForm.id || `source-${Date.now().toString(36)}`,
            name: generatedName || "外部监测源",
            providerId: advancedProvider?.id || externalForm.providerId || "",
            enabled: externalForm.enabled === true,
            endpoint: externalForm.endpoint,
            requestType: externalForm.requestType || "custom",
            method: externalForm.requestMethod || "GET",
            intervalSeconds: Number(externalForm.intervalSeconds) || 60,
            timeoutSeconds: Number(externalForm.timeoutSeconds) || 10,
            // 未绑定模型列表时使用默认路径，避免空字符串导致保存校验失败
            modelListPath: externalForm.modelListPath || "$.models",
            fields: Object.fromEntries(
              Object.entries({
                model: externalForm.model,
                group: externalForm.group,
                status: externalForm.status,
                availability: externalForm.availability,
                ttft: externalForm.ttft,
                response: externalForm.response,
                history: externalForm.history,
                historyAt: externalForm.historyAt,
                historyStatus: externalForm.historyStatus,
                historyError: externalForm.historyError,
                error: externalForm.error
              }).map(([key, value]) => [key, value])
            ),
            enabledFields: externalFieldEnabled,
            labels:  {
              ttft: String(externalForm.labels?.ttft || "").trim().slice(0, 20) || undefined,
              response: String(externalForm.labels?.response || "").trim().slice(0, 20) || undefined
            },
            customFields: externalCustomFields
              .map(field => ({ ...field, name: String(field.name || "").trim(), path: String(field.path || "").trim() }))
              .filter(field => field.name && field.path)
              .map(field => ({
                name: field.name,
                path: field.path,
                unit: field.transform === "number" && field.unit === "s" ? "s" : "ms",
                displayUnit: field.transform === "number" && (field.displayUnit === "s" || field.displayUnit === "ms") ? field.displayUnit : "",
                decimals: field.transform === "number" ? Math.max(0, Math.min(2, Math.round(Number(field.decimals) || 0))) : 0,
                // 白名单需与 host validate 一致（含百分比三变体），否则新变体保存时会被降级为 identity
                transform: ["identity", "number", "percent", "percent100", "percentRaw", "status"].includes(field.transform) ? field.transform : "identity"
              })),
            transforms: {
              model: transformValue("model"),
              status: transformValue("status"),
              availability: transformValue("availability"),
              ttft: transformValue("ttft"),
              response: transformValue("response"),
              history: transformValue("history"),
              historyAt: transformValue("historyAt"),
              historyStatus: transformValue("historyStatus"),
              historyError: transformValue("historyError"),
              error: transformValue("error")
            },
            ttftUnit: externalForm.ttftUnit,
            responseUnit: externalForm.responseUnit,
            decimals: {
              ttft: Math.max(0, Math.min(2, Math.round(Number(externalForm.decimals?.ttft) || 0))),
              response: Math.max(0, Math.min(2, Math.round(Number(externalForm.decimals?.response) || 0)))
            },
            displayUnit: {
              ttft: externalForm.displayUnit?.ttft === "s" || externalForm.displayUnit?.ttft === "ms" ? externalForm.displayUnit.ttft : "",
              response: externalForm.displayUnit?.response === "s" || externalForm.displayUnit?.response === "ms" ? externalForm.displayUnit.response : ""
            }
          };
        };

        const externalField = (key, label, type = "text") =>
          h(
            "div",
            { className: "db-field" },
            h("label", { htmlFor: `db-external-${key}` }, label),
            h("input", {
              id: `db-external-${key}`,
              type,
              value: externalForm[key],
              required: key === "endpoint",
              min: key === "intervalSeconds" ? 5 : key === "timeoutSeconds" ? 1 : undefined,
              max: key === "intervalSeconds" ? 86400 : key === "timeoutSeconds" ? 300 : undefined,
              step: type === "number" ? 1 : undefined,
              onChange: event => setExternalForm({ ...externalForm, [key]: event.target.value })
            })
          );

        const previewReady = Boolean(externalPreview?.preview || externalForm.preview);

        const MAP_TARGET_LABELS = { ok: "正常", error: "失败", warn: "警告", unknown: "未知" };

        // 当前样本的健康状态原始值（用于预填映射行与未识别提示）
        const statusSampleValue = () => {
          const previewData = externalPreview?.preview || externalForm.preview;
          const list = previewData && externalForm.modelListPath ? readPreviewPath(previewData, externalForm.modelListPath) : null;
          const sample = Array.isArray(list) ? list[0] : undefined;
          const raw = sample && externalForm.status ? readPreviewPath(sample, externalForm.status) : undefined;
          return raw === undefined || raw === null ? "" : String(raw).trim();
        };

        // 「状态值映射」独立区块：接口返回的原始值 → 健康状态；配置映射后未命中归未知，不回退内置词表
        const statusMapSection = () => {
          const rows = externalForm.statusMap || [];
          const setRow = (index, patch) => updateExternalForm({ ...externalForm, statusMap: rows.map((row, i) => i === index ? { ...row, ...patch } : row) }, true);
          const removeRow = index => updateExternalForm({ ...externalForm, statusMap: rows.filter((_, i) => i !== index) }, true);
          const addRow = () => {
            // 新行预填当前样本值：最常见的场景就是把样本值映射成正常/失败
            updateExternalForm({ ...externalForm, statusMap: [...rows, { raw: statusSampleValue(), status: "ok" }] }, true);
          };
          const sampleValue = statusSampleValue();
          const mapped = rows.some(row => row.raw.trim().toLowerCase() === sampleValue.toLowerCase());
          // 配置映射后，任何未命中值都属于未知；未配置映射时才参考内置词表
          const unrecognized = sampleValue && !mapped && (rows.length > 0 || normalizeHealthLabel(sampleValue) === "未知");
          return h(
            "div",
            { className: "db-map-section" },
            h("div", { className: "db-map-section-head" },
              h("strong", null, "状态值映射"),
              h("span", null, "将接口返回的原始值转换为健康状态；配置映射后，未命中值会显示为未知，不再回退内置词表")
            ),
            unrecognized && h("p", { className: "db-map-section-hint" }, `当前样本值「${sampleValue}」未被内置词表识别，添加映射后即可正确显示。`),
            rows.length > 0 && h("div", { className: "db-map-grid-head" }, h("span", null, "原始值"), h("span", null, "映射为"), h("span", null)),
            ...rows.map((row, index) =>
              h(
                "div",
                { className: "db-map-grid", key: `status-map-${index}` },
                h("input", { type: "text", placeholder: "原始值，如 UP", value: row.raw, onChange: event => setRow(index, { raw: event.target.value }) }),
                h(
                  "select",
                  { className: "db-select", value: row.status || "ok", onChange: event => setRow(index, { status: event.target.value }) },
                  ["ok", "error", "warn", "unknown"].map(opt => h("option", { key: opt, value: opt }, MAP_TARGET_LABELS[opt]))
                ),
                h(
                  "button",
                  { className: "db-delete db-icon-button", type: "button", title: "删除映射", "aria-label": "删除映射", onClick: () => removeRow(index) },
                  h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, h("path", { d: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" }))
                )
              )
            ),
            rows.length === 0 && h("p", { className: "db-map-section-empty" }, "暂无映射，点击下方按钮添加一行，将自动填入当前样本值。"),
            h("button", { className: "db-header-add", type: "button", onClick: addRow }, "+ 添加映射")
          );
        };

        const listField = h(
          "div",
          { className: "db-field" },
          h("label", { htmlFor: "db-external-modelListPath" }, "模型列表路径"),
          h(
            "select",
            {
              id: "db-external-modelListPath",
              className: "db-select",
              value: externalForm.modelListPath,
              disabled: !previewReady,
              onChange: event => updateExternalForm({ ...externalForm, modelListPath: event.target.value }, true)
            },
            h("option", { value: "" }, ""),
            externalForm.modelListPath && h("option", { value: externalForm.modelListPath }, externalForm.modelListPath),
            ...(externalPreview?.keys || externalForm.previewKeys || [])
              .filter(item => item.type === "array")
              .map(item => h("option", { key: item.path, value: item.path }, `${item.path} · 数组`))
          )
        );

        const previewExternal = async event => {
          event?.preventDefault?.();
          if (!externalForm.endpoint.trim()) {
            setExternalTestState("error");
            setExternalTestMessage("请先填写请求地址");
            return;
          }
          if (!/^https:\/\//i.test(externalForm.endpoint.trim())) {
            setExternalTestState("error");
            setExternalTestMessage("请求地址必须使用 HTTPS");
            return;
          }
          setExternalPreviewing(true);
          setExternalTestState("loading");
          setExternalTestMessage("");
          setExternalPreview(null);
          setExternalResultError("");
          try {
            const data = await api("/external-status-preview", {
              method: "POST",
              body: JSON.stringify({
                ...externalPayload(),
                method: "GET",
                modelListPath: externalForm.modelListPath || "$.models",
                id: externalForm.id || "preview-source"
              })
            });
            setExternalPreview(data);
            if (externalForm.id) externalPreviewCache.current.set(externalForm.id, data);
            setExternalForm(current => ({ ...current, preview: data.preview, previewKeys: data.keys }));
            if (data.normalized) {
              setExternalTestState("success");
              setExternalTestMessage("");
              setExternalResultError("");
            } else {
              // 模型列表路径未绑定或结构不匹配：保留 JSON 预览供点击绑定数组，
              // 不再把整个测试判定为失败。
              setExternalTestState("warn");
              setExternalTestMessage("已获取返回结构，但模型列表路径未绑定或不是数组，请在左侧 JSON 预览中点击数组节点绑定模型列表。");
              setExternalResultError("");
            }
            setExternalShowAllPreview(false);
          } catch (error) {
            setExternalTestState("error");
            setExternalTestMessage(error.message || "请求失败");
            setExternalResultError(error.message || "请求失败");
          } finally {
            setExternalPreviewing(false);
          }
        };

        const beginExternalEdit = source => {
          const loadGeneration = ++externalPreviewLoadGeneration.current;
          const saved = (config?.externalStatusSources || []).find(item => item.id === source.id) || source;
          const fields = saved.fields || {};
          const savedTransform = (key, fallback) => {
            const value = saved.transforms?.[key];
            return typeof value === "string" ? value : fallback;
          };
          const savedMapEntries = (key) => {
            const value = saved.transforms?.[key];
            return value && typeof value === "object" && value.kind === "map" && Array.isArray(value.entries) ? value.entries : [];
          };
          // 已配置状态映射的源，进入编辑时自动展开映射区块
          setExternalMapOpen(savedMapEntries("status").length > 0);
          const cachedPreview = externalPreviewCache.current.get(source.id);
          const savedPreview = saved.preview && saved.previewKeys ? { preview: saved.preview, keys: saved.previewKeys, normalized: null } : null;
          const restoredPreview = cachedPreview || savedPreview;
          setExternalForm({
            ...blankExternalForm,
            ...saved,
            requestMethod: saved.method || "GET",
            model: fields.model || "",
            group: fields.group || "",
            status: fields.status || "",
            availability: fields.availability || "",
            ttft: fields.ttft || "",
            response: fields.response || "",
            history: fields.history || "",
            historyAt: fields.historyAt || "",
            historyStatus: fields.historyStatus || "",
            historyError: fields.historyError || "",
            error: fields.error || "",
            modelTransform: savedTransform("model", "identity"),
            statusTransform: savedTransform("status", "status"),
            availabilityTransform: savedTransform("availability", "percent"),
            ttftTransform: savedTransform("ttft", "number"),
            responseTransform: savedTransform("response", "number"),
            historyTransform: savedTransform("history", "identity"),
            historyAtTransform: savedTransform("historyAt", "number"),
            historyStatusTransform: savedTransform("historyStatus", "status"),
            historyErrorTransform: savedTransform("historyError", "identity"),
            errorTransform: savedTransform("error", "identity"),
            statusMap: savedMapEntries("status"),
            historyStatusMap: savedMapEntries("historyStatus"),
            labels: { ttft: saved.labels?.ttft || "", response: saved.labels?.response || "" },
            ttftUnit: saved.ttftUnit === "s" ? "s" : "ms",
            responseUnit: saved.responseUnit === "s" ? "s" : "ms",
            decimals: { ttft: Number(saved.decimals?.ttft) || 0, response: Number(saved.decimals?.response) || 0 },
            displayUnit: {
              ttft: saved.displayUnit?.ttft === "s" || saved.displayUnit?.ttft === "ms" ? saved.displayUnit.ttft : "",
              response: saved.displayUnit?.response === "s" || saved.displayUnit?.response === "ms" ? saved.displayUnit.response : ""
            },
            preview: restoredPreview?.preview,
            previewKeys: restoredPreview?.keys
          });
          setExternalPreview(restoredPreview);
          setExternalCustomFields((saved.customFields || []).map(field => ({ ...field, unit: field.unit === "s" ? "s" : "ms", displayUnit: field.displayUnit === "s" || field.displayUnit === "ms" ? field.displayUnit : "", decimals: Number(field.decimals) || 0 })));
          setExternalFieldEnabled({
            model: true,
            group: true,
            status: true,
            availability: true,
            ttft: true,
            response: true,
            history: true,
            historyAt: true,
            historyStatus: true,
            historyError: true,
            error: true,
            ...(saved.enabledFields || {})
          });
          setExternalEditing(source.id);
          setBindingSlot(null);
          setActiveSlotKey(null);
          setExternalShowAllPreview(false);
          if (!restoredPreview) {
            api(`/external-status-preview/${encodeURIComponent(source.id)}`)
              .then(data => {
                if (externalPreviewLoadGeneration.current !== loadGeneration) return;
                externalPreviewCache.current.set(source.id, data);
                setExternalPreview(data);
                setExternalForm(current => current.id === source.id ? { ...current, preview: data.preview, previewKeys: data.keys } : current);
              })
              .catch(error => {
                if (externalPreviewLoadGeneration.current !== loadGeneration || error.status === 404) return;
                setExternalTestState("error");
                setExternalTestMessage(error.message || "读取预览缓存失败");
              });
          }
        };

        const saveExternal = async event => {
          event.preventDefault();
          setExternalSaveMessage("");
          try {
            const data = await api("/external-status-source", { method: "POST", body: JSON.stringify(externalPayload()) });
            const nextConfig = {
              ...config,
              externalStatusSources: [...(config.externalStatusSources || []).filter(item => item.id !== data.source.id), data.source]
            };
            setConfig(nextConfig);
            state.config = nextConfig;
            renderBar(nextConfig, state.providers);
            setExternalEditing(null);
            setAdvancedOpen(false);
            setExternalTestState("success");
            setExternalTestMessage("");
            setMessage(data.warning ? `监测源已保存；${data.warning}` : "监测源已保存");
            setMessageKind(data.warning ? "warn" : "ok");
            await loadExternalStatuses(true);
          } catch (error) {
            const detail = error.message || "保存监测源失败";
            // 保存失败提示显示在操作按钮附近，避免出现在 URL 输入框下方被忽略。
            setExternalSaveMessage(detail);
            setExternalTestState("error");
            setExternalTestMessage("");
            setMessage(detail);
            setMessageKind("error");
          }
        };

        const removeExternal = async id => {
          try {
            await api(`/external-status-source/${encodeURIComponent(id)}`, { method: "DELETE" });
            externalPreviewLoadGeneration.current += 1;
            externalPreviewCache.current.delete(id);
            const nextConfig = { ...config, externalStatusSources: (config.externalStatusSources || []).filter(item => item.id !== id) };
            setConfig(nextConfig);
            state.config = nextConfig;
            closeHealthModal();
            renderBar(nextConfig, state.providers);
            await loadExternalStatuses(true);
            setMessage("外部状态源已删除");
          } catch (error) {
            setMessage(error.message);
            setMessageKind("error");
          }
        };

        // 「预览全部模型」卡片：直接用已就绪的 previewData + 绑定路径实时计算，
        // 绑定字段后即时生效，不依赖 host 标准化结果、无需重新请求。
        const previewStatusCards = () => {
          const previewData = externalPreview?.preview || externalForm.preview;
          const list = previewData && externalForm.modelListPath ? readPreviewPath(previewData, externalForm.modelListPath) : null;
          if (!Array.isArray(list) || !list.length) return null;
          const enabled = key => externalFieldEnabled[key] !== false;
          const readBound = (item, key) => (enabled(key) && externalForm[key]) ? readPreviewPath(item, externalForm[key]) : undefined;
          const customEntries = externalCustomFields.filter(field => field.name && field.path);
          const models = list.slice(0, 50).map((item, index) => {
            const rawName = readBound(item, "model");
            const name = applyClientTransform(rawName, externalForm.modelTransform || "identity", "model") || `模型 ${index + 1}`;
            // 分组名称：可选字段，未绑定或空值时不显示
            const rawGroup = readBound(item, "group");
            const group = rawGroup === undefined || rawGroup === null || rawGroup === "" ? undefined : String(rawGroup).trim().slice(0, 80) || undefined;
            // 历史记录先于 status 计算：status 未绑定时与 host 一致回退最后一条历史的状态
            let history = [];
            const rawHistory = readBound(item, "history");
            if (Array.isArray(rawHistory)) {
              history = rawHistory.slice(-60).map(record => ({
                at: externalForm.historyAt ? readPreviewPath(record, externalForm.historyAt) : undefined,
                status: externalForm.historyStatus ? clientStatusTone(readPreviewPath(record, externalForm.historyStatus), "historyStatus") : "unknown",
                error: externalForm.historyError ? String(readPreviewPath(record, externalForm.historyError) ?? "").trim() : undefined
              }));
            }
            const rawStatus = readBound(item, "status");
            const status = rawStatus === undefined
              ? (history.length ? history[history.length - 1].status : "unknown")
              : clientStatusTone(rawStatus, "status");
            const rawAvailability = readBound(item, "availability");
            let availability;
            if (rawAvailability !== undefined) {
              const number = Number(rawAvailability);
              if (Number.isFinite(number)) {
                // 与 host 百分比三模式对齐：percent=自动、percent100=×100、percentRaw=原值即百分数
                const mode = externalForm.availabilityTransform;
                // number/identity 表示接口已给出百分数；percent 系列才按对应倍率换算
                const percent = mode === "number" || mode === "identity" ? number : mode === "percent100" ? number * 100 : mode === "percentRaw" ? number : (number >= 0 && number <= 1 ? number * 100 : number);
                availability = Math.max(0, Math.min(100, percent));
              }
            }
            const rawResponse = readBound(item, "response");
            const responseMs = rawResponse === undefined ? undefined : clientLatencyMs(rawResponse, externalForm.responseUnit);
            const rawTtft = readBound(item, "ttft");
            const ttftMs = rawTtft === undefined ? undefined : clientLatencyMs(rawTtft, externalForm.ttftUnit);
            // 自定义字段：按绑定路径读取样本值并应用字段转换，空值不显示
            const custom = Object.fromEntries(customEntries.map(field => {
              const value = clientCustomValue(readPreviewPath(item, field.path), field.transform, field);
              return [field.name, value === undefined ? "" : String(value)];
            }).filter(([, value]) => value !== ""));
            return { name: String(name).slice(0, 160), group, status, availability, responseMs, ttftMs, history, custom };
          });
          const errors = models.filter(model => model.status === "error").length;
          const overall = errors ? (errors === models.length ? "error" : "warn") : models.length ? "ok" : "unknown";
          // 卡片色调：ok / error / warn / unknown（未知独立灰调，不再混入警告黄）
          const tone = model => model.status === "ok" ? "ok" : model.status === "error" ? "error" : model.status === "unknown" ? "unknown" : "warn";
          return h(
            "div",
            { className: "db-preview-status" },
            h("div", { className: "db-preview-status-head" }, h("strong", null, "模型状态预览"), h("span", null, `${models.length} 个模型 · ${overall === "ok" ? "整体正常" : overall === "error" ? "存在失败" : "部分异常"}`)),
            h(
              "div",
              { className: "db-preview-cards" },
              ...models.map((model, index) =>
                h(
                  "div",
                  { className: `db-preview-card ${tone(model)}`, key: `${model.name}-${index}`, title: `${model.name} 最近一次检测结果` },
                  model.group && h("div", { className: "db-preview-card-group" }, h("span", { className: "db-preview-group", title: `分组：${model.group}` }, model.group)),
                  h("div", { className: "db-preview-card-head" }, h("span", { className: "db-preview-dot" }), h("strong", { title: model.name }, model.name), h("span", { className: "db-preview-state" }, model.status === "ok" ? "正常" : model.status === "error" ? "失败" : model.status === "warn" ? "警告" : "未知")),
                  h("div", { className: "db-preview-metrics" }, model.availability !== undefined && h("span", null, "可用率 ", h("b", null, `${Number(model.availability).toFixed(2)}%`)), model.responseMs !== undefined && h("span", null, `${externalForm.labels?.response?.trim() || "响应"} `, h("b", null, formatMetricValue(model.responseMs, resolveDisplayUnit("response", externalForm.responseUnit), externalForm.decimals?.response))), model.ttftMs !== undefined && h("span", null, `${externalForm.labels?.ttft?.trim() || "TTFT"} `, h("b", null, formatMetricValue(model.ttftMs, resolveDisplayUnit("ttft", externalForm.ttftUnit), externalForm.decimals?.ttft))), model.history.length > 0 && h("span", null, "样本 ", h("b", null, String(model.history.length))), ...Object.entries(model.custom || {}).map(([fieldName, value]) => h("span", { key: fieldName }, fieldName, " ", h("b", null, value)))),
                  h("div", { className: "db-preview-history", title: "最近健康记录" }, ...(model.history.length ? model.history : model.availability !== undefined ? (availabilityProgressBars(model.availability) || [{ status: model.status }]) : [{ status: model.status }]).map((record, recordIndex) => h("i", { key: `${model.name}-${recordIndex}`, className: record.status === "ok" ? "ok" : record.status === "error" ? "error" : record.status === "unknown" ? "unknown" : "warn", title: [record.note, formatHistoryAt(record.at), record.error].filter(Boolean).join(" · ") || "健康状态记录" })))
                )
              )
            )
          );
        };

        const readPreviewPath = (data, path) => {
          if (!data || typeof data !== "object" || !path || path === "$") return undefined;
          const keys = path.slice(1).split(/\.|(?=\[)/).filter(Boolean).map(key => key.replace(/^\[/, "").replace(/\]$/, ""));
          let current = data;
          for (const key of keys) {
            if (current === null || typeof current !== "object") return undefined;
            if (/^\d+$/.test(key)) {
              if (!Array.isArray(current)) return undefined;
              current = current[Number(key)];
              continue;
            }
            if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
            current = current[key];
          }
          return current;
        };

        const listPathFromLeaf = path => {
          const match = path.match(/^(.*)\[\d+\]/);
          return match ? match[1] : null;
        };

        const normalizeHealthLabel = value => {
          const text = value === true ? "ok" : value === false ? "fail" : String(value ?? "").toLowerCase();
          if (value === 1 || ["ok", "online", "operational", "healthy", "normal", "good", "available"].includes(text)) return "正常";
          if (value === 0 || ["fail", "failed", "failing", "error", "down", "offline", "degraded", "bad"].includes(text)) return "失败";
          if (["warn", "warning", "partial", "idle", "pending"].includes(text)) return "警告";
          return "未知";
        };

        // 复刻 host 端 normalizeExternalHealth：返回 ok / error / warn / unknown
        const healthTone = value => {
          const text = value === true ? "ok" : value === false ? "fail" : String(value ?? "").toLowerCase();
          if (value === 1 || ["ok", "online", "operational", "healthy", "normal", "good", "available"].includes(text)) return "ok";
          if (value === 0 || ["fail", "failed", "failing", "error", "down", "offline", "degraded", "bad"].includes(text)) return "error";
          if (["warn", "warning", "partial", "idle", "pending"].includes(text)) return "warn";
          return "unknown";
        };

        // 复刻 host 端 normalizeLatency：统一换算为毫秒并保留 3 位小数（显示层按配置格式化）
        const clientLatencyMs = (value, unit) => {
          const number = Number(value);
          if (!Number.isFinite(number) || number < 0) return undefined;
          return Math.round((unit === "s" ? number * 1000 : number) * 1000) / 1000;
        };

        // 自定义字段值转换（与 host EXTERNAL_TRANSFORMS 对齐的 client 版）
        const clientCustomValue = (raw, transform, field) => {
          if (raw === undefined || raw === null || raw === "") return undefined;
          if (transform === "number") {
               const n = Number(raw);
               if (!Number.isFinite(n)) return String(raw);
               const unit = field?.unit === "s" ? "s" : "ms";
               const displayUnit = field?.displayUnit === "s" || field?.displayUnit === "ms" ? field.displayUnit : unit;
               return formatMetricValue(unit === "s" ? n * 1000 : n, displayUnit, field?.decimals);
             }
          if (transform === "percent" || transform === "percent100" || transform === "percentRaw") {
            const n = Number(raw);
            if (!Number.isFinite(n)) return String(raw);
            const percent = transform === "percent100" ? n * 100 : transform === "percentRaw" ? n : (n >= 0 && n <= 1 ? n * 100 : n);
            return `${Math.max(0, Math.min(100, percent)).toFixed(2)}%`;
          }
          if (transform === "status") return normalizeHealthLabel(raw);
          return String(raw);
        };

        // 解析指标显示单位：""=跟随接口单位（存储换算依据），否则用独立配置的显示单位
        const resolveDisplayUnit = (key, dataUnit) => {
          const configured = externalForm.displayUnit?.[key];
          return configured === "s" || configured === "ms" ? configured : dataUnit;
        };

        // 状态转换（含自定义映射）：返回 ok / error / warn / unknown
        // 配置了映射的源完全以映射为主：命中的用映射值，未命中的归 unknown，不回退内置词表
        const clientStatusTone = (value, key) => {
          const mapRows = externalForm[`${key}Map`];
          if (Array.isArray(mapRows) && mapRows.length) {
            const rawKey = value === null || value === undefined ? "" : String(value).trim();
            const hit = mapRows.find(row => row.raw.trim().toLowerCase() === rawKey.toLowerCase());
            return hit && ["ok", "error", "warn", "unknown"].includes(hit.status) ? hit.status : "unknown";
          }
          return healthTone(value);
        };

        const handleNodeClick = (path, type) => {
          if (!bindingSlot) return;
          // 自定义字段槽位（custom:索引）必须在最前处理：未绑模型列表时明确提示，
          // 严禁落入下方兜底分支（会把 "custom:N" 当 externalForm 键写入脏数据）
          if (bindingSlot.startsWith("custom:")) {
            if (!externalForm.modelListPath) {
              setExternalTestState("idle");
              setExternalTestMessage("请先绑定「模型列表」，再为自定义字段选择 JSON 字段");
              return;
            }
            const rest = path?.startsWith(externalForm.modelListPath) ? path.slice(externalForm.modelListPath.length).match(/^\[\d+\](.*)$/) : null;
            if (!rest || !rest[1]) {
              setExternalTestMessage("请选择模型项内的字段作为自定义字段");
              return;
            }
            const index = Number(bindingSlot.slice(7));
            setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === index ? { ...item, path: `$${rest[1]}` } : item));
            setBindingSlot(null);
            return;
          }
          if (bindingSlot === "modelListPath") {
            const listPath = type === "array" ? path : listPathFromLeaf(path);
            if (!listPath) {
              setExternalTestState("idle");
              setExternalTestMessage("请点击 JSON 中的数组节点作为模型列表");
              return;
            }
            updateExternalForm({ ...externalForm, modelListPath: listPath }, true);
            setBindingSlot(null);
            return;
          }
          if (externalForm.modelListPath) {
            const targetPath = bindingSlot === "history" && type !== "array" ? listPathFromLeaf(path) : path;
            const rest = targetPath?.startsWith(externalForm.modelListPath) ? targetPath.slice(externalForm.modelListPath.length).match(/^\[\d+\](.*)$/) : null;
            if (!rest) {
              setExternalTestMessage("该字段不在模型列表内，请先重新绑定模型列表路径");
              return;
            }
            if (bindingSlot === "history") {
              if (!rest[1] || (type !== "array" && !targetPath)) {
                setExternalTestMessage("请点击模型项中的历史记录数组");
                return;
              }
              updateExternalForm({ ...externalForm, history: `$${rest[1]}` }, true);
              setBindingSlot(null);
              return;
            }
            if (bindingSlot === "historyStatus" || bindingSlot === "historyAt" || bindingSlot === "historyError") {
              if (!externalForm.history) {
                const inferred = rest[1].match(/^(.*?)\[\d+\](.*)$/);
                if (!inferred || !inferred[1] || !inferred[2]) {
                  setExternalTestMessage("请选择历史记录数组中的字段");
                  return;
                }
                updateExternalForm({ ...externalForm, history: `$${inferred[1]}`, [bindingSlot]: `$${inferred[2]}` }, true);
                setBindingSlot(null);
                return;
              }
              const historyPrefix = externalForm.history.slice(1);
              const historyRest = rest[1].startsWith(historyPrefix) ? rest[1].slice(historyPrefix.length).match(/^\[\d+\](.*)$/) : null;
              if (!historyRest || !historyRest[1]) {
                setExternalTestMessage("请选择已绑定历史数组中的记录字段");
                return;
              }
              updateExternalForm({ ...externalForm, [bindingSlot]: `$${historyRest[1]}` }, true);
              setBindingSlot(null);
              return;
            }
            updateExternalForm({ ...externalForm, [bindingSlot]: `$${rest[1]}` }, true);
            setBindingSlot(null);
            return;
          }
          const listPath = listPathFromLeaf(path);
          const rest = listPath ? path.slice(listPath.length).match(/^\[\d+\](.*)$/) : null;
          if (!listPath || !rest) {
            setExternalTestMessage("请先点击「模型列表」槽位并选择 JSON 中的数组节点");
            return;
          }
          updateExternalForm({ ...externalForm, modelListPath: listPath, [bindingSlot]: `$${rest[1]}` }, true);
          setBindingSlot(null);
        };

        const jsonTree = (value) => h(JsonTreeNode, {
          value,
          path: "$",
          labelKey: "根节点",
          depth: 0,
          bindingSlot,
          onNodeClick: handleNodeClick
        });

        const jsonPreviewContent = () => {
          if (externalPreviewing) {
            return h("div", { className: "db-json-preview-loading" }, h("div", { className: "db-spinner" }));
          }
          if (externalTestState === "error" && externalResultError) {
            return h(
              "div",
              { className: "db-json-preview-error" },
              h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", "aria-hidden": "true" },
                h("path", { d: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" })),
              externalResultError
            );
          }
          if (externalPreview?.preview) {
            return jsonTree(externalPreview.preview);
          }
          return h(
            "div",
            { className: "db-json-preview-empty" },
            h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", "aria-hidden": "true" },
              h("path", { d: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" })),
            "点击「测试」查看返回 JSON 结构"
          );
        };

        const mappingSlotDefs = [
          { key: "model", label: "模型名称", transformable: true },
          { key: "group", label: "分组名称" },
          { key: "status", label: "健康状态", transformable: true },
          { key: "availability", label: "可用率", transformable: true },
          { key: "ttft", label: "TTFT", transformable: true },
          { key: "response", label: "响应耗时", transformable: true },
          { key: "history", label: "最近记录", array: true },
          { key: "historyStatus", label: "历史状态" },
          { key: "historyAt", label: "记录时间" },
          { key: "historyError", label: "错误原因" }
        ];

        const applyClientTransform = (raw, transform, key) => {
          if (raw === undefined || raw === null || raw === "") return "";
          // 自定义映射：映射条目非空即生效（仅状态类字段有数据），未命中归"未知"、不回退内置词表
          const mapRows = externalForm[`${key}Map`];
          if (Array.isArray(mapRows) && mapRows.length) {
            const rawKey = String(raw).trim();
            const hit = mapRows.find(row => row.raw.trim().toLowerCase() === rawKey.toLowerCase());
            if (hit && MAP_TARGET_LABELS[hit.status]) return MAP_TARGET_LABELS[hit.status];
            return "未知";
          }
          if (transform === "percent" || transform === "percent100" || transform === "percentRaw") {
            const n = Number(raw);
            if (!Number.isFinite(n)) return String(raw);
            // percent=自动（0-1 ×100）、percent100=强制 ×100、percentRaw=原值即百分数
            const percent = transform === "percent100" ? n * 100 : transform === "percentRaw" ? n : (n >= 0 && n <= 1 ? n * 100 : n);
            return `${Math.max(0, Math.min(100, percent)).toFixed(2)}%`;
          }
          if (transform === "number") {
            const n = Number(raw);
            if (!Number.isFinite(n)) return String(raw);
            // 按接口单位换算为统一 ms，再按解析后的显示单位（可独立于接口单位）格式化
            const isTtft = key === "ttft";
            const dataUnit = (isTtft && externalForm.ttftUnit === "s") || (key === "response" && externalForm.responseUnit === "s") ? "s" : "ms";
            return formatMetricValue(dataUnit === "s" ? n * 1000 : n, resolveDisplayUnit(key, dataUnit), isTtft ? externalForm.decimals?.ttft : externalForm.decimals?.response);
          }
          if (transform === "status") return normalizeHealthLabel(raw);
          return String(raw);
        };

        const TRANSFORM_OPTIONS = [["identity", "原文"], ["number", "数字"], ["percent", "百分比"], ["status", "状态"]];

        const mappingPreviewCard = () => {
          const previewData = externalPreview?.preview;
          const list = previewData && externalForm.modelListPath ? readPreviewPath(previewData, externalForm.modelListPath) : null;
          const sample = Array.isArray(list) ? list[0] : undefined;
          const slotDisplay = key => {
            if (!externalForm[key]) return { text: "", empty: true };
            const raw = readPreviewPath(sample, externalForm[key]);
            const text = applyClientTransform(raw, externalForm[`${key}Transform`] || "identity", key);
            return { text, empty: !text };
          };
          const statusInfo = slotDisplay("status");
          const tone = statusInfo.text === "正常" ? " ok" : statusInfo.text === "失败" ? " error" : statusInfo.text === "警告" ? " warn" : "";
          const bindTarget = (key, label, content, extraClass = "", tag = "span") => {
            const active = bindingSlot === key;
            const bound = Boolean(externalForm[key]);
            return h(tag, {
              className: `db-bind-target${active ? " active" : ""}${bound ? "" : " empty"}${extraClass}`,
              title: bound ? `${label} ← ${externalForm[key]}` : `点击后选择左侧 JSON 字段绑定${label}`,
              onClick: () => {
                setActiveSlotKey(key);
                setBindingSlot(active ? null : key);
              }
            }, content);
          };
          // 当前槽位定义基于 activeSlotKey（选中态），而非 bindingSlot（绑定中，完成即清空）
          // custom:N 为自定义字段槽位：绑定/转换写入 externalCustomFields 对应项
          const customSlotIndex = typeof activeSlotKey === "string" && activeSlotKey.startsWith("custom:") ? Number(activeSlotKey.slice(7)) : -1;
          const activeDef = activeSlotKey === "modelListPath"
            ? { key: "modelListPath", label: "模型列表", array: true }
            : customSlotIndex >= 0
              ? { key: activeSlotKey, label: "自定义字段", transformable: true, custom: true }
              : mappingSlotDefs.find(slot => slot.key === activeSlotKey);
          const activeTransformValue = activeDef?.custom
            ? externalCustomFields[customSlotIndex]?.transform || "identity"
            : activeDef
              ? (externalForm[`${activeDef.key}Transform`] || "identity")
              : undefined;
          const activeBound = activeDef ? (activeDef.custom ? Boolean(externalCustomFields[customSlotIndex]?.path) : Boolean(externalForm[activeDef.key])) : false;
          // 转换附加配置（第二行）：数字转换的接口单位/显示单位/小数位、百分比转换的倍率
          const updateTransform = value => {
            if (activeDef?.custom) {
              setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === customSlotIndex ? { ...item, transform: value } : item));
            } else if (activeDef) {
              updateExternalForm({ ...externalForm, [`${activeDef.key}Transform`]: value }, true);
            }
          };
          const extraOptions = [];
           const activeCustomField = activeDef?.custom ? externalCustomFields[customSlotIndex] : null;
          if (activeDef?.transformable && activeBound) {
            if ((activeDef.key === "ttft" || activeDef.key === "response" || activeDef.custom) && activeTransformValue === "number") {
              extraOptions.push(
                h("select", {
                  key: "unit",
                  className: "db-bind-metric-opt",
                  value: activeDef.custom ? (activeCustomField?.unit === "s" ? "s" : "ms") : (externalForm[activeDef.key === "ttft" ? "ttftUnit" : "responseUnit"] === "s" ? "s" : "ms"),
                  title: "接口返回数值的单位（决定存储换算）",
                  onChange: event => activeDef.custom ? setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === customSlotIndex ? { ...item, unit: event.target.value } : item)) : updateExternalForm({ ...externalForm, [activeDef.key === "ttft" ? "ttftUnit" : "responseUnit"]: event.target.value }, true)
                }, h("option", { value: "ms" }, "接口 ms"), h("option", { value: "s" }, "接口 s")),
                h("select", {
                  key: "display-unit",
                  className: "db-bind-metric-opt",
                  value: activeDef.custom ? (activeCustomField?.displayUnit === "s" || activeCustomField?.displayUnit === "ms" ? activeCustomField.displayUnit : "") : (externalForm.displayUnit?.[activeDef.key] === "s" || externalForm.displayUnit?.[activeDef.key] === "ms" ? externalForm.displayUnit[activeDef.key] : ""),
                  title: "卡片上展示的单位",
                  onChange: event => activeDef.custom ? setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === customSlotIndex ? { ...item, displayUnit: event.target.value } : item)) : updateExternalForm({ ...externalForm, displayUnit: { ...externalForm.displayUnit, [activeDef.key]: event.target.value } }, true)
                }, h("option", { value: "" }, "显示跟随"), h("option", { value: "ms" }, "显示 ms"), h("option", { value: "s" }, "显示 s")),
                h("select", {
                  key: "decimals",
                  className: "db-bind-metric-opt",
                  value: String(activeDef.custom ? Number(activeCustomField?.decimals) || 0 : Number(externalForm.decimals?.[activeDef.key]) || 0),
                  title: "保留小数位数",
                  onChange: event => activeDef.custom ? setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === customSlotIndex ? { ...item, decimals: Number(event.target.value) } : item)) : updateExternalForm({ ...externalForm, decimals: { ...externalForm.decimals, [activeDef.key]: Number(event.target.value) } }, true)
                }, h("option", { value: "0" }, "整数"), h("option", { value: "1" }, "1 位"), h("option", { value: "2" }, "2 位"))
              );
            }
            if (activeDef.key !== "availability" && ["percent", "percent100", "percentRaw"].includes(activeTransformValue)) {
              extraOptions.push(
                h("span", { key: "percent-label", className: "db-bind-extra-label" }, "百分比倍率"),
                h("select", {
                  key: "percent-mode",
                  className: "db-bind-metric-opt",
                  value: activeTransformValue,
                  title: "百分比倍率：自动=0-1 视为小数并 ×100；×100=强制乘 100；原值加%=返回值就是百分数",
                  onChange: event => updateTransform(event.target.value)
                }, h("option", { value: "percent" }, "自动"), h("option", { value: "percent100" }, "×100"), h("option", { value: "percentRaw" }, "原值加%"))
              );
            }
          }
          const isBinding = Boolean(bindingSlot) && (bindingSlot === activeSlotKey || bindingSlot === "modelListPath");
          const rawHistory = sample && externalForm.history ? readPreviewPath(sample, externalForm.history) : null;
          const historyRecords = Array.isArray(rawHistory) ? rawHistory.slice(-60) : [];
          const historyStatusMatched = Boolean(externalForm.historyStatus) && historyRecords.some(record => readPreviewPath(record, externalForm.historyStatus) !== undefined);
          const historyStatusInvalid = Boolean(externalForm.historyStatus) && historyRecords.length > 0 && !historyStatusMatched;
          const historyErrorMatched = Boolean(externalForm.historyError) && historyRecords.some(record => readPreviewPath(record, externalForm.historyError) !== undefined);
          const historyErrorInvalid = Boolean(externalForm.historyError) && historyRecords.length > 0 && !historyErrorMatched;
          const history = historyRecords.map(record => {
            const rawStatus = externalForm.historyStatus ? readPreviewPath(record, externalForm.historyStatus) : undefined;
            const label = normalizeHealthLabel(rawStatus);
            return {
              tone: label === "正常" ? "ok" : label === "失败" ? "error" : label === "警告" ? "warn" : "",
              at: externalForm.historyAt ? readPreviewPath(record, externalForm.historyAt) : undefined,
              error: externalForm.historyError ? readPreviewPath(record, externalForm.historyError) : undefined
            };
          });
          // 未绑定历史记录时：绑定可用率则按可用率百分比生成近似进度条，否则显示空格子
          const sampleAvailabilityRaw = sample && externalForm.availability ? readPreviewPath(sample, externalForm.availability) : undefined;
          const sampleAvailability = sampleAvailabilityRaw === undefined || sampleAvailabilityRaw === null || sampleAvailabilityRaw === "" ? NaN : Number(sampleAvailabilityRaw);
          const historyBars = history.length
            ? history
            : Number.isFinite(sampleAvailability)
              ? (availabilityProgressBars(sampleAvailability, 30) || []).map(bar => ({ tone: bar.status, note: bar.note }))
              : Array.from({ length: 30 }, () => ({ tone: "", at: undefined, error: undefined }));
          return h(
            "div",
            { className: `db-preview-card${tone.trim() ? ` ${tone.trim()}` : ""} db-bind-card` },
            h("div", { className: "db-bind-list-row" },
              h("span", null, "模型列表"),
              bindTarget("modelListPath", "模型列表", externalForm.modelListPath || "点击选择数组", " db-bind-list-target"),
              externalForm.modelListPath && h("button", { className: "db-bind-action-btn", type: "button", title: "清除模型列表绑定", onClick: () => updateExternalForm({ ...externalForm, modelListPath: "" }, true) }, "清除")
            ),
            h("div", { className: "db-bind-dashboard-head" },
              h("div", { className: "db-bind-model-copy" },
                bindTarget("group", "分组名称", externalForm.group ? (slotDisplay("group").text || "待预览") : "分组", " db-bind-group"),
                bindTarget("model", "模型名称", slotDisplay("model").text || (externalForm.model ? "待预览" : "绑定模型名称"), " db-bind-model", "strong"),
                h("span", { className: "db-bind-model-meta" }, externalForm.model || "点击模型名称后，在左侧选择字段")
              ),
              bindTarget("status", "健康状态", [
                h("span", { key: "value" }, statusInfo.text || (externalForm.status ? "待预览" : "未绑定")),
                h("span", { key: "path", className: "db-bind-status-path" }, externalForm.status || "点击绑定")
              ], ` db-bind-state${tone}`)
            ),
            h("div", { className: "db-bind-metric-grid" },
              bindTarget("ttft", "TTFT", h("span", { className: "db-bind-metric-card" },
                h("span", { className: "db-bind-metric-label" },
                  h("input", {
                    className: "db-bind-metric-name",
                    type: "text",
                    value: externalForm.labels?.ttft || "",
                    placeholder: "对话延迟",
                    title: "自定义指标名称，留空使用默认",
                    maxLength: 20,
                    // 阻止冒泡：点击输入框编辑文案时不应触发外层槽位的绑定模式
                    onClick: event => event.stopPropagation(),
                    onChange: event => setExternalForm({ ...externalForm, labels: { ...externalForm.labels, ttft: event.target.value } })
                  }),
                  h("span", { className: "db-bind-field-path" }, externalForm.ttft || "点击绑定")
                ),
                h("span", { className: "db-bind-metric-value" }, slotDisplay("ttft").text || "—")
              )),
              bindTarget("response", "响应耗时", h("span", { className: "db-bind-metric-card" },
                h("span", { className: "db-bind-metric-label" },
                  h("input", {
                    className: "db-bind-metric-name",
                    type: "text",
                    value: externalForm.labels?.response || "",
                    placeholder: "端点响应",
                    title: "自定义指标名称，留空使用默认",
                    maxLength: 20,
                    onClick: event => event.stopPropagation(),
                    onChange: event => setExternalForm({ ...externalForm, labels: { ...externalForm.labels, response: event.target.value } })
                  }),
                  h("span", { className: "db-bind-field-path" }, externalForm.response || "点击绑定")
                ),
                h("span", { className: "db-bind-metric-value" }, slotDisplay("response").text || "—")
              )),
              // 自定义字段占位卡（与指标卡同款），最后是「＋」新增按钮
              ...externalCustomFields.map((field, index) => {
                const slotKey = `custom:${index}`;
                const bound = Boolean(field.path);
                const value = bound ? clientCustomValue(readPreviewPath(sample, field.path), field.transform) : undefined;
                return h("span", {
                  key: slotKey,
                  className: `db-bind-target${bindingSlot === slotKey ? " active" : ""}${bound ? "" : " empty"}`,
                  title: bound ? `自定义字段「${field.name || "未命名"}」 ← ${field.path}` : "点击后选择左侧 JSON 字段绑定自定义字段",
                  onClick: () => {
                    setActiveSlotKey(slotKey);
                    setBindingSlot(bindingSlot === slotKey ? null : slotKey);
                  }
                }, h("span", { className: "db-bind-metric-card" },
                  h("span", { className: "db-bind-metric-label" },
                    h("input", {
                      className: "db-bind-metric-name",
                      type: "text",
                      value: field.name,
                      placeholder: "自定义字段",
                      title: "字段显示名称（标签）",
                      maxLength: 20,
                      onClick: event => event.stopPropagation(),
                      onChange: event => setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))
                    }),
                    h("span", { className: "db-bind-field-path" }, field.path || "点击绑定")
                  ),
                  h("span", { className: "db-bind-metric-value" }, value === undefined || value === "" ? "—" : String(value)),
                  h("button", { className: "db-bind-action-btn", type: "button", title: "删除该字段", onClick: event => {
                    event.stopPropagation();
                    setExternalCustomFields(externalCustomFields.filter((_, itemIndex) => itemIndex !== index));
                    // custom:N 用数组下标做槽位标识，删除任意一项都会使后续索引移位，
                    // 必须无条件清空选中/绑定态，避免后续操作写入错误的字段
                    if ((typeof activeSlotKey === "string" && activeSlotKey.startsWith("custom:")) || (typeof bindingSlot === "string" && bindingSlot.startsWith("custom:"))) {
                      setActiveSlotKey(null);
                      setBindingSlot(null);
                    }
                  } }, "删除")
                ));
              }),
              h("button", { className: "db-bind-add-field", type: "button", title: "新增自定义字段", onClick: () => {
                const slotKey = `custom:${externalCustomFields.length}`;
                setExternalCustomFields([...externalCustomFields, { name: "", path: "", transform: "identity", unit: "ms", displayUnit: "", decimals: 0 }]);
                setActiveSlotKey(slotKey);
                setBindingSlot(slotKey);
              } }, "＋")
            ),
            bindTarget("availability", "可用率", h("span", { className: "db-bind-availability" },
              h("span", { className: "db-bind-availability-copy" },
                h("span", { className: "db-bind-availability-label" }, "可用性 · 当前样本"),
                h("span", { className: "db-bind-field-path" }, externalForm.availability || "点击绑定")
              ),
              h("span", { className: "db-bind-availability-value" }, slotDisplay("availability").text || "—")
            )),
            h("div", { className: "db-bind-history-head" },
              bindTarget("history", "最近记录", h("strong", null, history.length ? `最近 ${history.length} 次记录` : externalForm.history ? "最近记录" : "绑定最近记录")),
              h("span", null, "字段映射")
            ),
            h("div", { className: "db-bind-history-field-row" },
              h("span", null, "状态"),
              bindTarget("historyStatus", "历史状态", externalForm.historyStatus || "点击选择字段", historyStatusInvalid ? " invalid" : ""),
              historyStatusInvalid && h("span", { className: "db-bind-history-invalid" }, "无匹配")
            ),
            h("div", { className: "db-bind-history-field-row" },
              h("span", null, "时间"),
              bindTarget("historyAt", "记录时间", externalForm.historyAt || "点击选择字段")
            ),
            h("div", { className: "db-bind-history-field-row" },
              h("span", null, "错误"),
              bindTarget("historyError", "错误原因", externalForm.historyError || "点击选择字段", historyErrorInvalid ? " invalid" : ""),
              historyErrorInvalid && h("span", { className: "db-bind-history-invalid" }, "无匹配")
            ),
            bindTarget("historyStatus", "历史状态", h("span", { className: "db-bind-history-bars" }, ...historyBars.map((record, index) => h("i", {
              key: index,
              className: record.tone,
              title: [record.note, record.at !== undefined && `时间：${formatHistoryAt(record.at)}`, record.error && `错误：${record.error}`].filter(Boolean).join("\n") || "历史状态记录"
            }))), " db-bind-history-target"),
            h("div", { className: "db-bind-history-axis" }, h("span", null, "PAST"), h("span", null, "NOW")),
            h("div", { className: "db-bind-card-foot" },
              activeDef ? [
                isBinding
                  ? h("span", { key: "hint" }, `正在绑定「${activeDef.label}」— 点击左侧 JSON ${activeDef.array ? "中的数组节点" : "中的字段"}完成绑定`)
                  : activeBound
                    ? h("span", { key: "hint" }, `「${activeDef.label}」已绑定 ${activeDef.custom ? externalCustomFields[customSlotIndex]?.path : externalForm[activeDef.key]}`)
                    : h("span", { key: "hint" }, `点击卡片上的「${activeDef.label}」槽位，再点左侧 JSON ${activeDef.array ? "中的数组节点" : "中的字段"}完成绑定`),
                activeDef.transformable && activeBound && h("div", { key: "actions", className: "db-bind-actions" },
                  ...(activeDef.key === "availability" ? [["percent", "百分比"], ["percent100", "百分比×100"], ["percentRaw", "原值+%"]] : TRANSFORM_OPTIONS).map(([value, label]) => h("button", {
                    key: value,
                    // 百分比按钮在三种变体（percent/percent100/percentRaw）下都高亮
                    className: `db-bind-action-btn${activeTransformValue === value || (value === "percent" && ["percent100", "percentRaw"].includes(activeTransformValue)) ? " on" : ""}`,
                    type: "button",
                    onClick: () => updateTransform(value)
                  }, label)),
                  activeDef.key === "status" && h("button", {
                    key: "map",
                    className: `db-bind-action-btn${(externalForm.statusMap || []).length ? " on" : ""}`,
                    type: "button",
                    title: "接口返回值不是标准状态词时，用映射表转换为健康状态",
                    onClick: () => setExternalMapOpen(value => !value)
                  }, "值映射")
                ),
                // 第二行：转换附加配置（数字的单位/小数位、百分比的倍率）
                activeDef.transformable && activeBound && extraOptions.length > 0 && h("div", { key: "extra", className: "db-bind-extra-opts" }, ...extraOptions),
                activeBound && h("button", { key: "clear", className: "db-bind-action-btn", type: "button", onClick: () => (activeDef.custom ? setExternalCustomFields(externalCustomFields.map((item, itemIndex) => itemIndex === customSlotIndex ? { ...item, path: "" } : item)) : updateExternalForm({ ...externalForm, [activeDef.key]: "" }, true)) }, "清除绑定")
              ] : Array.isArray(list)
                ? "点击卡片上的虚线槽位，再点左侧 JSON 中的字段完成绑定，卡片实时预览。"
                : "先点击「模型列表」槽位并在左侧选择一个数组节点，卡片即可实时预览。"
            )
          );
        };

        const externalEditor = () =>
          h(
            "div",
            { className: "db-external-form" },
            h(
              "div",
              { className: "db-models-head", style: { marginBottom: 4 } },
              h("span", null, "配置健康监测端点，系统将定期请求并展示可用率与响应状态。")
            ),
            h(
              "form",
              { className: "db-form", id: "db-external-form", onSubmit: saveExternal },
              h(
                "label",
                { className: "db-monitor-toggle" },
                h("span", { className: "db-monitor-toggle-copy" },
                  h("strong", null, "启用健康监测"),
                  h("span", null, "开启后在当前供应商状态栏显示健康入口，点击入口时才请求接口。")
                ),
                h("input", {
                  type: "checkbox",
                  checked: externalForm.enabled === true,
                  onChange: event => setExternalForm({ ...externalForm, enabled: event.target.checked })
                })
              ),
              h(
                "div",
                { className: "db-field" },
                h("label", null, "请求方式"),
                h("select", { className: "db-select", value: externalForm.requestType, onChange: event => setExternalForm({ ...externalForm, requestType: event.target.value }) }, h("option", { value: "custom" }, "自定义请求"))
              ),
              h(
                "div",
                { className: "db-field" },
                h("label", null, "请求方法"),
                h("select", { className: "db-select", value: externalForm.requestMethod || "GET", onChange: event => setExternalForm({ ...externalForm, requestMethod: event.target.value }) }, h("option", { value: "GET" }, "GET"))
              ),
              h(
                "div",
                { className: "db-field db-endpoint-field" },
                h("label", { htmlFor: "db-external-endpoint" }, "请求地址"),
                h(
                  "div",
                  { className: "db-endpoint-row" },
                  h("input", { id: "db-external-endpoint", type: "url", placeholder: "https://", value: externalForm.endpoint, required: true, onChange: event => setExternalForm({ ...externalForm, endpoint: event.target.value }) }),
                  h("button", { className: "db-quiet", type: "button", onClick: previewExternal, disabled: externalPreviewing }, externalPreviewing ? "测试中" : "测试"),
                  externalPreviewing && h("div", { className: "db-endpoint-loading" })
                )
              ),
              externalTestMessage &&
                h("p", { className: `db-test-message${externalTestState === "error" ? " error" : externalTestState === "success" ? " success" : ""}`, role: "status" }, externalTestMessage),
              h(
                "div",
                { className: "db-field wide" },
                h(
                  "div",
                  { className: "db-json-preview-head" },
                  h("div", { className: "db-json-preview-title" }, h("label", null, "返回 JSON 预览")),
                  h("div", { className: "db-json-preview-title" },
                    h("label", null, "返回状态预览"),
                    previewReady && h("button", { className: "db-quiet db-preview-all-toggle", type: "button", onClick: () => setExternalShowAllPreview(value => !value) }, externalShowAllPreview ? "收起全部状态" : "预览全部模型")
                  )
                ),
                h(
                  "div",
                  { className: "db-json-preview-split" },
                  h("div", { className: `db-json-preview-box${bindingSlot ? " binding" : ""}` }, jsonPreviewContent()),
                  mappingPreviewCard()
                )
              ),
              externalMapOpen && statusMapSection(),
              externalShowAllPreview && previewStatusCards(),
              externalField("intervalSeconds", "刷新间隔（秒）", "number"),
              externalField("timeoutSeconds", "请求超时（秒）", "number")
            )
          );

        const openAdvanced = (sourceId = null, provider = null) => {
          setAdvancedProvider(provider);
          const savedSources = config?.externalStatusSources || [];
          const sourceScore = item => Number(Boolean(item.modelListPath)) + Object.values(item.fields || {}).filter(Boolean).length + (Array.isArray(item.customFields) ? item.customFields.length : 0);
          const providerSources = provider ? savedSources.filter(item => item.providerId === provider.id) : [];
          const sourceForProvider = providerSources.sort((a, b) => sourceScore(b) - sourceScore(a))[0];
          const source = sourceForProvider || (sourceId && sourceId !== "__new" && savedSources.find(item => item.id === sourceId));
          if (source) beginExternalEdit(source);
          else {
            setExternalForm({ ...blankExternalForm, id: `source-${Date.now().toString(36)}`, providerId: provider?.id || "" });
            setExternalCustomFields([]);
            setExternalFieldEnabled({ model: true, group: true, status: true, availability: true, ttft: true, response: true, history: true, historyAt: true, historyStatus: true, historyError: true, error: true });
            setBindingSlot(null);
            setActiveSlotKey(null);
            setExternalShowAllPreview(false);
            setExternalMapOpen(false);
            externalPreviewLoadGeneration.current += 1;
            setExternalEditing("__new");
            setExternalPreview(null);
          }
          setAdvancedTab("models");
          setExternalTestState("idle");
          setExternalTestMessage("");
          // 弹窗每次打开都刷新模型目录，模型页新增/删除的模型在此同步可见。
          setLlmRefreshKey(key => key + 1);
          setAdvancedOpen(true);
        };

        const advancedModal =
          advancedOpen &&
          h(
            "div",
            {
              className: "db-modal-backdrop",
              role: "presentation",
              onClick: event => {
                if (event.target === event.currentTarget) setAdvancedOpen(false);
              }
            },
            h(
              "div",
              { className: "db-modal", role: "dialog", "aria-modal": "true", "aria-label": "高级设置" },
              h(
                "div",
                { className: "db-modal-head" },
                h("strong", null, `高级设置${advancedProvider?.name ? ` · ${advancedProvider.name}` : ""}`),
                h(
                  "button",
                  { className: "db-modal-close", type: "button", onClick: () => setAdvancedOpen(false), "aria-label": "关闭高级设置", title: "关闭" },
                  h(
                    "svg",
                    { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
                    h("path", { d: "M4 4L12 12M12 4L4 12", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" })
                  )
                )
              ),
              h(
                "div",
                { className: "db-modal-tabs" },
                h("button", { className: advancedTab === "models" ? "active" : "", type: "button", onClick: () => setAdvancedTab("models") }, "模型设置"),
                h("button", { className: advancedTab === "health" ? "active" : "", type: "button", onClick: () => setAdvancedTab("health") }, "健康监测")
              ),
              h(
                "div",
                { className: "db-modal-content" },
                advancedTab === "models"
                  ? h(ModelSettingsTab, { provider: advancedProvider, modelProviders, boundRoute, refreshKey: llmRefreshKey })
                  : (externalEditing && externalEditor())
              ),
              advancedTab === "health" &&
                externalEditing &&
                h(
                  "div",
                  { className: "db-modal-footer" },
                  externalSaveMessage && h("p", { className: "db-save-message", role: "alert" }, externalSaveMessage),
                  h("button", { className: "db-quiet", type: "button", onClick: () => { externalPreviewLoadGeneration.current += 1; setAdvancedOpen(false); setExternalEditing(null); setExternalSaveMessage(""); } }, "取消"),
                  h("button", { className: "db-primary", type: "submit", form: "db-external-form" }, "保存监测源")
                )
            )
          );

        // Map configured providers to their model provider entry if applicable
        const configuredProviders = config.providers || [];
        const configuredIds = new Set(configuredProviders.map(p => p.id));
        const configuredRoutes = new Set(Object.keys(config.bindings || {}));

        // Candidate model providers not yet configured
        const unconfiguredModelProviders = modelProviders.filter(mp => !configuredIds.has(mp.id) && !configuredRoutes.has(mp.id));
        const hasDeepSeekPreset = configuredProviders.some(p => p.preset === "deepseek" || p.id === "deepseek");
        const hasOpenCodeGoPreset = configuredProviders.some(p => p.preset === "opencode-go" || p.id === "opencode-go");

        const providerCard = (provider) => {
          const route = boundRoute(provider.id);
          const mp = modelProviders.find(m => m.id === route || m.id === provider.id);
          const meta = balanceMeta(provider.id);
          const isCurrentEditing = editing === (route || provider.id);

          return h(
            "div",
            { className: "db-provider-row db-provider-card", key: provider.id },
            h(
              "div",
              { className: "db-row-line" },
              h("span", { className: "db-provider-name" }, mp?.name || provider.name),
              h(
                "select",
                {
                  className: "db-select db-query-select",
                  value: provider.balanceEnabled === false ? "off" : "on",
                  title: "余额查询开关",
                  onChange: event => toggleBalanceEnabled(provider, event.target.value === "on")
                },
                h("option", { value: "on" }, "开启余额查询"),
                h("option", { value: "off" }, "关闭余额查询")
              ),
              OFFICIAL_PRESETS.has(provider.preset) && h("span", { className: "db-tag" }, "官方内置"),
              h("div", { className: "db-spacer" }),
              h("button", { className: "db-quiet", type: "button", onClick: () => openAdvanced("__new", provider), title: "打开高级设置" }, "高级设置"),
              h("button", { className: "db-quiet", type: "button", onClick: () => beginEdit(provider) }, isCurrentEditing ? "收起" : "编辑"),
              h("button", { className: "db-delete", type: "button", onClick: () => remove(provider.id) }, "删除")
            ),
            h("div", { className: "db-row-meta" }, ...(Array.isArray(meta) ? meta : meta ? [meta] : [])),
            isCurrentEditing && inlineEditor()
          );
        };

        const isAddingNew = editing && !configuredProviders.some(p => p.id === editing || boundRoute(p.id) === editing);

        const importMenu =
          importMenuOpen &&
          h(
            "div",
            { className: "db-import-menu", role: "menu", ref: importMenuRef },
            (!hasDeepSeekPreset || !hasOpenCodeGoPreset) && [
              h("div", { className: "db-import-group-title", key: "preset-title" }, "推荐官方方案"),
              !hasDeepSeekPreset &&
                h(
                  "button",
                  {
                    className: "db-import-item",
                    key: "preset-deepseek",
                    type: "button",
                    onClick: () => {
                      const deepseekModel = modelProviders.find(m => /deepseek/i.test(`${m.id} ${m.name}`));
                      beginPreset(deepseekModel, "deepseek");
                    }
                  },
                  h("span", { className: "db-import-item-name" }, "DeepSeek 官方余额"),
                  h("span", { className: "db-import-item-desc" }, "官方 API")
                ),
              !hasOpenCodeGoPreset &&
                h(
                  "button",
                  {
                    className: "db-import-item",
                    key: "preset-opencode-go",
                    type: "button",
                    onClick: () => {
                      const opencodeModel = modelProviders.find(m => /opencode[-_ ]?go/i.test(`${m.id} ${m.name}`));
                      beginPreset(opencodeModel, "opencode-go");
                    }
                  },
                  h("span", { className: "db-import-item-name" }, "OpenCode Go 官方额度"),
                  h("span", { className: "db-import-item-desc" }, "官方 API")
                ),
              h("div", { className: "db-import-divider", key: "preset-div" })
            ],
            unconfiguredModelProviders.length > 0 && [
              h("div", { className: "db-import-group-title", key: "model-title" }, "从“模型”页引入供应商"),
              ...unconfiguredModelProviders.map(mp => {
                const isNeco = /^neco$/i.test(mp.id) || /^neco$/i.test(mp.name);
                return h(
                  "button",
                  {
                    className: "db-import-item",
                    key: `import-model-${mp.id}`,
                    type: "button",
                    onClick: () => (isNeco ? beginNeco(mp) : beginAdd(mp))
                  },
                  h("span", { className: "db-import-item-name" }, mp.name),
                  h("span", { className: "db-import-item-desc" }, isNeco ? "推荐模板" : "复用凭据")
                );
              }),
              h("div", { className: "db-import-divider", key: "model-div" })
            ],
            h("div", { className: "db-import-group-title", key: "custom-title" }, "自定义接入"),
            h(
              "button",
              {
                className: "db-import-item",
                key: "import-custom",
                type: "button",
                onClick: () => beginAdd(null)
              },
              h("span", { className: "db-import-item-name" }, "+ 新建自定义 HTTPS 供应商"),
              h("span", { className: "db-import-item-desc" }, "JSON 路径")
            )
          );

        return h(
          "section",
          { className: "db-settings" },
          h(
            "div",
            { className: "db-provider-list" },
            configuredProviders.length === 0 &&
              !isAddingNew &&
              h(
                "div",
                { className: "db-empty-state" },
                h("span", null, "暂未接入任何余额供应商")
              ),
            ...configuredProviders.map(provider => providerCard(provider)),
            isAddingNew &&
              h(
                "div",
                { className: "db-provider-row db-provider-card", key: "__new_editor__" },
                h(
                  "div",
                  { className: "db-row-line" },
                  h("span", { className: "db-provider-name" }, form.name ? `正在添加：${form.name}` : "新建供应商"),
                  h("span", { className: "db-tag" }, "配置中"),
                  h("div", { className: "db-spacer" }),
                  h("button", { className: "db-delete", type: "button", onClick: () => setEditing(null) }, "取消")
                ),
                inlineEditor()
              )
          ),
          advancedModal,
          h(
            "div",
            { className: "db-bottom-settings" },
            h("span", { className: "db-setting-label" }, "默认供应商"),
            h(
              "select",
              {
                className: "db-select",
                value: config.defaultProviderId || configuredProviders[0]?.id || "",
                disabled: configuredProviders.length === 0,
                onChange: async event => {
                  const defaultProviderId = event.target.value || null;
                  try {
                    await savePreferences({ defaultProviderId });
                    setMessage("默认供应商已更新");
                  } catch (error) {
                    setMessage(error.message);
                    setMessageKind("error");
                  }
                }
              },
              configuredProviders.map(provider => h("option", { key: provider.id, value: provider.id }, provider.name))
            ),
            h("span", { className: "db-setting-label" }, "状态栏"),
            h(
              "button",
              {
                className: `db-toggle${config.statusBar ? " on" : ""}`,
                "aria-pressed": config.statusBar,
                onClick: async () => {
                  const statusBar = !config.statusBar;
                  try {
                    await savePreferences({ statusBar });
                    setMessage("");
                  } catch (error) {
                    setMessage(error.message);
                    setMessageKind("error");
                  }
                }
              },
              h("i")
            ),
            h(
              "div",
              { className: "db-bottom-actions" },
              h(
                "div",
                { className: "db-import-wrap" },
                h(
                  "button",
                  {
                    className: "db-quiet",
                    type: "button",
                    "aria-expanded": importMenuOpen,
                    onClick: (e) => {
                      e.stopPropagation();
                      setImportMenuOpen(!importMenuOpen);
                    }
                  },
                  "+ 引入供应商 ▾"
                ),
                importMenu
              ),
              h(
                "button",
                {
                  className: "db-quiet",
                  type: "button",
                  onClick: () => {
                    loadSummary();
                    refreshBar();
                  }
                },
                "刷新"
              )
            )
          ),
          message && h("p", { className: `db-message${messageKind === "error" ? " error" : messageKind === "warn" ? " warn" : ""}`, role: "status" }, message)
        );
      } catch (error) {
        try { window.__balanceSectionError = (error && error.stack) || String(error); } catch {}
        return h("div", { className: "db-settings" }, h("p", { className: "db-message error" }, "余额查询分区渲染失败: " + String((error && error.message) || error)));
      }
    }

    function BalancePluginCard() {
      const [open, setOpen] = React.useState(false);

      return h(
        "li",
        { className: `db-plugin-card${open ? " open" : ""}` },
        h(
          "button",
          {
            type: "button",
            className: "db-plugin-card-head",
            "aria-expanded": open,
            onClick: () => setOpen(!open)
          },
          h(
            "span",
            { className: "db-plugin-card-copy" },
            h("span", { className: "db-plugin-card-title" }, "供应商状态"),
            h("span", { className: "db-plugin-card-desc" }, "查询模型供应商的余额、额度与健康状态，管理模型列表、输入能力与推理等级。")
          ),
          h(
            "svg",
            {
              className: "db-plugin-card-chevron",
              width: "14",
              height: "14",
              viewBox: "0 0 14 14",
              fill: "none",
              "aria-hidden": "true"
            },
            h("path", {
              d: "M3.5 5.25L7 8.75L10.5 5.25",
              stroke: "currentColor",
              strokeWidth: "1.2",
              strokeLinecap: "round",
              strokeLinejoin: "round"
            })
          )
        ),
        open && h("div", { className: "db-plugin-card-body" }, h(SettingsSection))
      );
    }

    function apply(ctx) {
      state.connection = ctx.get("connection");
      state.sessions = ctx.get("sessions");
      ensureSettingsStyle();

      ctx.effect(() => {
        const refreshIfDue = () => {
          if (document.visibilityState !== "visible") return;
          const provider = state.provider;
          if (!provider || refreshDue(provider, provider.syncedAt)) refreshBar(false, false, provider?.id);
          else renderBar(state.config || { statusBar: true }, state.providers);
        };
        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") refreshIfDue();
        };
        const onSessionsChange = () => syncSession();

        state.sessionsUnsubscribe = state.sessions?.list?.subscribe?.(onSessionsChange) || null;
        syncSession();
        refreshIfDue();
        state.timer = setInterval(refreshIfDue, 30_000);
        state.clock = setInterval(() => {
          if (document.visibilityState === "visible" && state.provider) renderBar(state.config || { statusBar: true }, state.providers);
        }, 30_000);
        document.addEventListener("visibilitychange", onVisibilityChange);
        const stopObserving = observeMenuDismissal();

        return () => {
          clearInterval(state.timer);
          clearInterval(state.clock);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          state.sessionsUnsubscribe?.();
          state.sessionsUnsubscribe = null;
          state.sessionId = null;
          stopObserving();
          state.bar?.remove();
          closeHealthModal();
          document.querySelector(".dsh-balance-provider-menu")?.remove();
          state.style?.remove();
          state.bar = state.style = state.provider = null;
          state.dockListeners.clear();
        };
      }, "dsh-balance-quota: status bar");

      ctx.effect(() => ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({ name: "conversation.composer.dock", id: "dsh-balance-quota", order: 40 }, BalanceDock)), "dsh-balance-quota: composer dock");
      ctx.effect(() => ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({ name: "settings.plugin.item", key: "dsh-balance-quota", id: "dsh-balance-quota", order: 40, label: () => "供应商状态" }, BalancePluginCard)), "dsh-balance-quota: settings");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
