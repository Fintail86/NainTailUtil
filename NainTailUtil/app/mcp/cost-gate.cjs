"use strict";

const { NainTailError } = require("../core/errors.cjs");
const { estimateAnlasCost } = require("../core/anlas-cost.cjs");
const { materializeArtistStudy } = require("../core/artist-study-model.cjs");
const { materializeMulti } = require("../core/multi-model.cjs");
const { materializeProject, materializeSingle } = require("../core/request-resolver.cjs");

const SUBSCRIPTION_CACHE_MS = 5 * 60 * 1000;

function isOpusSubscription(subscription) {
  const tier = subscription?.tier ?? subscription?.subscriptionTier ?? subscription?.subscription_tier;
  return Number(tier) === 3 || String(tier || "").toLowerCase() === "opus";
}

function materialize(app, mode, request, options = {}) {
  if (mode === "single") return materializeSingle(request);
  if (mode === "multi") return materializeMulti(request);
  if (mode === "artist-study") return materializeArtistStudy(request || app.getArtistStudy());
  if (mode === "project") return materializeProject(app.getProject(options.projectId), {
    scope: options.scope || "all",
    characterId: options.characterId,
  });
  throw new NainTailError("MCP_MODE_INVALID", `지원하지 않는 MCP 생성 모드입니다: ${mode}`);
}

class McpCostGate {
  constructor(app, options = {}) {
    this.app = app;
    this.now = options.now || (() => Date.now());
    this.cacheMs = options.cacheMs ?? SUBSCRIPTION_CACHE_MS;
    this.subscriptionCache = null;
  }

  async subscriptionState() {
    await this.app.requireToken();
    if (this.subscriptionCache && this.now() - this.subscriptionCache.checkedAt < this.cacheMs) {
      return this.subscriptionCache;
    }
    try {
      const subscription = await this.app.subscription();
      this.subscriptionCache = { checkedAt: this.now(), known: true, subscription, isOpus: isOpusSubscription(subscription) };
    } catch (error) {
      if (error?.code === "NAI_TOKEN_MISSING") throw error;
      this.subscriptionCache = { checkedAt: this.now(), known: false, subscription: null, isOpus: false, error: error?.message || String(error) };
    }
    return this.subscriptionCache;
  }

  async estimate(mode, request, options = {}) {
    const tasks = materialize(this.app, mode, request, options);
    if (!tasks.length) throw new NainTailError("NO_ENABLED_SLOTS", "생성 대상으로 선택된 슬롯이 없습니다.");
    const subscription = await this.subscriptionState();
    const firstRequest = tasks[0].request;
    const vibes = firstRequest.vibes || [];
    const vibeStatus = vibes.length ? this.app.vibeCacheStatus({ vibes, model: firstRequest.settings.model }) : [];
    return estimateAnlasCost(firstRequest.settings, {
      subscriptionKnown: subscription.known,
      isOpus: subscription.isOpus,
      generationCount: tasks.length,
      settingsVariants: tasks.map((task) => ({ settings: task.request.settings, count: 1 })),
      preciseReferenceCount: (firstRequest.preciseReferences || []).length,
      vibeCount: vibes.length,
      vibeEncodingCount: vibeStatus.filter((item) => !item.cached).length,
    });
  }

  async authorize(mode, request, options = {}) {
    const estimate = await this.estimate(mode, request, options);
    if (estimate.totalCost <= 0) return estimate;
    if (options.allowPaidAnlas !== true) {
      throw new NainTailError(
        "ANLAS_CONFIRMATION_REQUIRED",
        `예상 ${estimate.totalCost} Anlas 유료 작업입니다. 승인과 최대 허용액을 지정해 다시 호출하세요.`,
        { estimate, retry: { allowPaidAnlas: true, maxAnlas: estimate.totalCost } },
      );
    }
    const maximum = Number(options.maxAnlas);
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new NainTailError("ANLAS_LIMIT_REQUIRED", "유료 MCP 생성에는 양의 정수 maxAnlas가 필요합니다.", { estimate });
    }
    if (estimate.totalCost > maximum) {
      throw new NainTailError(
        "ANLAS_LIMIT_EXCEEDED",
        `예상 ${estimate.totalCost} Anlas가 승인 한도 ${maximum} Anlas를 초과합니다.`,
        { estimate, maxAnlas: maximum },
      );
    }
    return estimate;
  }
}

module.exports = { McpCostGate, SUBSCRIPTION_CACHE_MS, isOpusSubscription, materialize };
