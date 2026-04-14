/** Shared provider-logo resolution helpers for stats payloads. */

const ARTIFICIAL_ANALYSIS_LOGO_URL = "https://artificialanalysis.ai/img/logos";
const MODELS_DEV_LOGO_URL = "https://models.dev/logos";

const TRUSTED_ARTIFICIAL_ANALYSIS_PROVIDER_SLUGS = new Set([
	"ai21",
	"alibaba",
	"anthropic",
	"baidu",
	"bytedance",
	"cohere",
	"deepseek",
	"google",
	"meituan",
	"microsoft",
	"minimax",
	"moonshotai",
	"nvidia",
	"openai",
	"openrouter",
	"prime-intellect",
	"stepfun",
	"tencent",
	"upstage",
	"xiaomi",
]);

const TRUSTED_MODELS_DEV_LOGO_PROVIDERS = new Set([
	"alibaba",
	"anthropic",
	"cohere",
	"deepseek",
	"google",
	"inception",
	"minimax",
	"moonshotai",
	"nvidia",
	"openai",
	"openrouter",
	"perplexity",
	"xiaomi",
]);

const ARTIFICIAL_ANALYSIS_PROVIDER_SLUG_OVERRIDES: Record<string, string> = {
	allenai: "ai2",
	amazon: "aws",
	"arcee-ai": "arcee",
	"bytedance-seed": "bytedance",
	qwen: "alibaba",
};

function normalizeProvider(provider: string | null | undefined): string | null {
	if (typeof provider !== "string") {
		return null;
	}
	const normalizedProvider = provider.trim().toLowerCase();
	return normalizedProvider.length > 0 ? normalizedProvider : null;
}

function artificialAnalysisLogoUrl(slug: string): string {
	return `${ARTIFICIAL_ANALYSIS_LOGO_URL}/${slug}_small.svg`;
}

function modelsDevLogoUrl(provider: string): string {
	return `${MODELS_DEV_LOGO_URL}/${provider}.svg`;
}

function trustedArtificialAnalysisProviderSlug(
	provider: string | null,
): string | null {
	if (!provider) {
		return null;
	}
	const overriddenSlug = ARTIFICIAL_ANALYSIS_PROVIDER_SLUG_OVERRIDES[provider];
	if (overriddenSlug) {
		return overriddenSlug;
	}
	if (TRUSTED_ARTIFICIAL_ANALYSIS_PROVIDER_SLUGS.has(provider)) {
		return provider;
	}
	return null;
}

function trustedModelsDevLogo(provider: string | null): string | null {
	if (!provider || !TRUSTED_MODELS_DEV_LOGO_PROVIDERS.has(provider)) {
		return null;
	}
	return modelsDevLogoUrl(provider);
}

function sanitizeLogoUrl(
	logoUrl: string | null | undefined,
	provider: string | null,
): string | null {
	if (typeof logoUrl !== "string" || logoUrl.length === 0) {
		return null;
	}
	if (logoUrl.includes("models.dev/logos/")) {
		return trustedModelsDevLogo(provider);
	}
	return logoUrl;
}

export function resolveStatsLogo(options: {
	provider?: string | null;
	explicitLogo?: string | null;
	fallbackLogo?: string | null;
	modelCreatorSlug?: string | null;
}): string {
	const provider = normalizeProvider(options.provider);
	const explicitLogo = sanitizeLogoUrl(options.explicitLogo, provider);
	const trustedProviderSlug = trustedArtificialAnalysisProviderSlug(provider);
	const providerLogo = trustedProviderSlug
		? artificialAnalysisLogoUrl(trustedProviderSlug)
		: null;
	const modelCreatorLogo =
		typeof options.modelCreatorSlug === "string" &&
		options.modelCreatorSlug.length > 0
			? artificialAnalysisLogoUrl(options.modelCreatorSlug)
			: null;
	const modelsDevLogo =
		sanitizeLogoUrl(options.fallbackLogo, provider) ??
		trustedModelsDevLogo(provider);

	return (
		explicitLogo ?? modelCreatorLogo ?? modelsDevLogo ?? providerLogo ?? ""
	);
}
