/** Shared Artificial Analysis provider-logo resolution helpers for stats payloads. */

const ARTIFICIAL_ANALYSIS_LOGO_URL = "https://artificialanalysis.ai/img/logos";

const ARTIFICIAL_ANALYSIS_LOGO_ASSET_BY_PROVIDER: Record<string, string> = {
	ai2: "ai2_small.svg",
	ai21: "ai21_small.svg",
	alibaba: "alibaba_small.svg",
	allenai: "ai2_small.svg",
	amazon: "aws_small.svg",
	anthropic: "anthropic_small.svg",
	arcee: "arcee_small.svg",
	"arcee-ai": "arcee_small.svg",
	aws: "aws_small.svg",
	baidu: "baidu_small.svg",
	bytedance: "bytedance_small.svg",
	"bytedance-seed": "bytedance_small.svg",
	cohere: "cohere_small.svg",
	deepseek: "deepseek_small.svg",
	google: "google_small.svg",
	ibm: "ibm_small.svg",
	"ibm-granite": "ibm_small.svg",
	inception: "inceptionlabs_small.jpg",
	kimi: "kimi_small.png",
	liquid: "liquidai_small.svg",
	"liquid-ai": "liquidai_small.svg",
	meituan: "meituan_small.svg",
	meta: "meta_small.svg",
	"meta-llama": "meta_small.svg",
	microsoft: "microsoft_small.svg",
	"microsoft-azure": "microsoft_small.svg",
	minimax: "minimax_small.svg",
	mistral: "mistral_small.png",
	mistralai: "mistral_small.png",
	moonshotai: "kimi_small.png",
	nvidia: "nvidia_small.svg",
	openai: "openai_small.svg",
	openrouter: "openrouter_small.svg",
	perplexity: "perplexity_small.png",
	"prime-intellect": "prime-intellect_small.svg",
	qwen: "alibaba_small.svg",
	stepfun: "stepfun_small.svg",
	tencent: "tencent_small.svg",
	upstage: "upstage_small.svg",
	"x-ai": "xai.svg",
	xai: "xai.svg",
	xiaomi: "xiaomi_small.svg",
	"z-ai": "zai_small.svg",
};

function nonEmptyString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalizedValue = value.trim();
	return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeProvider(provider: string | null | undefined): string | null {
	const providerValue = nonEmptyString(provider);
	if (!providerValue) {
		return null;
	}
	const normalizedProvider = providerValue
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalizedProvider.length > 0 ? normalizedProvider : null;
}

function toAbsoluteArtificialAnalysisLogoUrl(
	logoUrl: string | null | undefined,
): string | null {
	const logoValue = nonEmptyString(logoUrl);
	if (!logoValue) {
		return null;
	}
	if (logoValue.startsWith("http://") || logoValue.startsWith("https://")) {
		return logoValue;
	}
	if (logoValue.startsWith("/")) {
		return `https://artificialanalysis.ai${logoValue}`;
	}
	if (logoValue.includes("/")) {
		return `https://artificialanalysis.ai/${logoValue}`;
	}
	return `${ARTIFICIAL_ANALYSIS_LOGO_URL}/${logoValue}`;
}

function buildArtificialAnalysisLogoUrl(
	asset: string | null | undefined,
): string | null {
	const assetValue = nonEmptyString(asset);
	if (!assetValue) {
		return null;
	}
	return `${ARTIFICIAL_ANALYSIS_LOGO_URL}/${assetValue}`;
}

function artificialAnalysisLogoAsset(provider: string | null): string | null {
	if (!provider) {
		return null;
	}
	return ARTIFICIAL_ANALYSIS_LOGO_ASSET_BY_PROVIDER[provider] ?? null;
}

export function resolveStatsLogo(options: {
	provider?: string | null;
	explicitLogo?: string | null;
}): string {
	const provider = normalizeProvider(options.provider);
	return (
		toAbsoluteArtificialAnalysisLogoUrl(options.explicitLogo) ??
		buildArtificialAnalysisLogoUrl(artificialAnalysisLogoAsset(provider)) ??
		""
	);
}
