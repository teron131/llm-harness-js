/** Disk-backed logo caching helpers for stats payloads. */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

import { fetchWithTimeout } from "./utils";

const LOGO_CACHE_DIR = resolve(".cache/stats-logos");
const LOGO_CACHE_SIZE = 128;
const LOGO_FETCH_TIMEOUT_MS = 15_000;

const pendingCacheRequestBySource = new Map<string, Promise<string>>();

function isRemoteLogoSource(source: string): boolean {
	return /^https?:\/\//i.test(source);
}

function logoCachePath(source: string): string {
	const sourceHash = createHash("sha256").update(source).digest("hex");
	return resolve(LOGO_CACHE_DIR, `${sourceHash}.png`);
}

function pngDataUrl(imageBuffer: Buffer): string {
	return `data:image/png;base64,${imageBuffer.toString("base64")}`;
}

async function loadCachedLogoDataUrl(
	cachePath: string,
): Promise<string | null> {
	try {
		await access(cachePath);
		const imageBuffer = await readFile(cachePath);
		return pngDataUrl(imageBuffer);
	} catch {
		return null;
	}
}

async function saveCachedLogoBuffer(
	cachePath: string,
	imageBuffer: Buffer,
): Promise<void> {
	await mkdir(LOGO_CACHE_DIR, { recursive: true });
	await writeFile(cachePath, imageBuffer);
}

async function resizeLogoToPng(imageBuffer: Buffer): Promise<Buffer> {
	return sharp(imageBuffer, { density: 300 })
		.resize(LOGO_CACHE_SIZE, LOGO_CACHE_SIZE, {
			fit: "contain",
			background: {
				r: 0,
				g: 0,
				b: 0,
				alpha: 0,
			},
			withoutEnlargement: true,
		})
		.png()
		.toBuffer();
}

async function buildCachedLogoDataUrl(source: string): Promise<string> {
	const cachePath = logoCachePath(source);
	const cachedLogoDataUrl = await loadCachedLogoDataUrl(cachePath);
	if (cachedLogoDataUrl) {
		return cachedLogoDataUrl;
	}

	const response = await fetchWithTimeout(
		source,
		{
			method: "GET",
		},
		LOGO_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Failed to fetch logo: ${source}`);
	}

	const imageBuffer = Buffer.from(await response.arrayBuffer());
	const resizedLogoBuffer = await resizeLogoToPng(imageBuffer);
	await saveCachedLogoBuffer(cachePath, resizedLogoBuffer);
	return pngDataUrl(resizedLogoBuffer);
}

function uniqueLogoSources<TModel extends { logo: string }>(
	models: TModel[],
): string[] {
	return [...new Set(models.map((model) => model.logo))].filter(
		(source) => source.length > 0,
	);
}

export async function cacheStatsLogo(source: string): Promise<string> {
	if (source.length === 0 || !isRemoteLogoSource(source)) {
		return source;
	}

	const existingRequest = pendingCacheRequestBySource.get(source);
	if (existingRequest) {
		return existingRequest;
	}

	const request = buildCachedLogoDataUrl(source)
		.catch(() => source)
		.finally(() => {
			pendingCacheRequestBySource.delete(source);
		});
	pendingCacheRequestBySource.set(source, request);
	return request;
}

export async function cacheStatsLogos<
	TModel extends {
		logo: string;
	},
>(models: TModel[]): Promise<TModel[]> {
	const cachedLogoBySource = new Map<string, string>();
	const uniqueSources = uniqueLogoSources(models);

	await Promise.all(
		uniqueSources.map(async (source) => {
			cachedLogoBySource.set(source, await cacheStatsLogo(source));
		}),
	);

	return models.map((model) => ({
		...model,
		logo: cachedLogoBySource.get(model.logo) ?? model.logo,
	}));
}
