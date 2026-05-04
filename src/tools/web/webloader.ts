/** Web page loading helpers for scraping and conversion. */

import { tool } from "@langchain/core/tools";
import TurndownService from "turndown";
import { z } from "zod";

const MAX_MARKDOWN_CHARS = 6_000;
const MIN_MARKDOWN_CHARS = 120;
const CONSENT_MARKERS = [
	"your privacy choices",
	"manage privacy settings",
	"accept all",
	"reject all",
	"cookie policy",
	"privacy policy",
	"privacy dashboard",
	"iab transparency",
	"consent-layer",
];
const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting"]);

function countMarkerMatches(text: string, markers: readonly string[]): number {
	const normalizedText = text.toLowerCase();
	return markers.reduce(
		(count, marker) => count + Number(normalizedText.includes(marker)),
		0,
	);
}

function trimMarkdown(markdown: string, maxChars = MAX_MARKDOWN_CHARS): string {
	if (markdown.length <= maxChars) {
		return markdown;
	}
	return `${markdown.slice(0, maxChars).trimEnd()}...`;
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_match, value: string) =>
			String.fromCodePoint(Number.parseInt(value, 16)),
		)
		.replace(/&#([0-9]+);/g, (_match, value: string) =>
			String.fromCodePoint(Number.parseInt(value, 10)),
		)
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function jsonLdBlocks(html: string): unknown[] {
	const blocks = [
		...html.matchAll(
			/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
		),
	];
	const parsedBlocks: unknown[] = [];
	for (const block of blocks) {
		const payload = block[1];
		if (!payload) {
			continue;
		}
		try {
			parsedBlocks.push(JSON.parse(payload.trim()));
		} catch {
			try {
				parsedBlocks.push(JSON.parse(decodeHtmlEntities(payload.trim())));
			} catch {}
		}
	}
	return parsedBlocks;
}

function collectJsonLdNodes(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectJsonLdNodes(item));
	}
	if (!value || typeof value !== "object") {
		return [];
	}
	const node = value as Record<string, unknown>;
	const graph = Array.isArray(node["@graph"])
		? node["@graph"].flatMap((item) => collectJsonLdNodes(item))
		: [];
	return [node, ...graph];
}

function nodeHasArticleType(node: Record<string, unknown>): boolean {
	const type = node["@type"];
	if (typeof type === "string") {
		return ARTICLE_TYPES.has(type);
	}
	return (
		Array.isArray(type) && type.some((item) => ARTICLE_TYPES.has(String(item)))
	);
}

function structuredArticleMarkdown(html: string): string | null {
	const articleNodes = jsonLdBlocks(html)
		.flatMap((block) => collectJsonLdNodes(block))
		.filter(nodeHasArticleType);
	for (const node of articleNodes) {
		const articleBody =
			typeof node.articleBody === "string" ? node.articleBody : "";
		if (articleBody.trim().length < MIN_MARKDOWN_CHARS) {
			continue;
		}
		const parts = [
			typeof node.headline === "string" ? node.headline : "",
			typeof node.description === "string" ? node.description : "",
			articleBody,
		].filter((part) => part.trim().length > 0);
		return parts.map((part) => decodeHtmlEntities(part).trim()).join("\n\n");
	}
	return null;
}

function tagBlocks(html: string, tagName: string): string[] {
	const pattern = new RegExp(
		`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`,
		"gi",
	);
	return [...html.matchAll(pattern)].map((match) => match[0]);
}

function scorePrimaryHtml(html: string): number {
	const text = stripHtmlNoise(html)
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length;
}

function pickPrimaryHtml(html: string): string {
	const candidates = [
		...tagBlocks(html, "main"),
		...tagBlocks(html, "article"),
	];
	if (candidates.length > 0) {
		return candidates.reduce((best, candidate) =>
			scorePrimaryHtml(candidate) > scorePrimaryHtml(best) ? candidate : best,
		);
	}

	const bodyMatch = html.match(/<body\b[^>]*>[\s\S]*?<\/body>/i);
	return bodyMatch?.[0] ?? html;
}

function stripHtmlNoise(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
		.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
		.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
		.replace(/<(header|footer|nav|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function isGarbageLine(line: string): boolean {
	const normalizedLine = line.trim();
	if (!normalizedLine) {
		return true;
	}

	const lowerLine = normalizedLine.toLowerCase();
	if (CONSENT_MARKERS.some((marker) => lowerLine.includes(marker))) {
		return true;
	}
	if (
		lowerLine === "share" ||
		lowerLine === "share this article" ||
		lowerLine === "copy link" ||
		lowerLine.startsWith("table of contents")
	) {
		return true;
	}
	if (/^!\[[^\]]*]\([^)]*\)/.test(normalizedLine)) {
		return true;
	}
	if (
		normalizedLine.length > 180 &&
		((normalizedLine.match(/https?:\/\//g) ?? []).length >= 2 ||
			(normalizedLine.match(/%[0-9a-f]{2}/gi) ?? []).length >= 4)
	) {
		return true;
	}
	if (
		normalizedLine.length > 180 &&
		(/[{}]/.test(normalizedLine) || normalizedLine.includes("--"))
	) {
		return true;
	}

	const punctuationCount = [...normalizedLine].filter((character) =>
		/[{}[\];:=<>]/.test(character),
	).length;
	return (
		normalizedLine.length > 120 &&
		punctuationCount / normalizedLine.length > 0.18
	);
}

function cleanMarkdown(markdown: string): string {
	const cleanedMarkdown = markdown
		.replace(/^<!-- image -->$/gm, "")
		.replace(/ {2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n");
	const filteredLines = cleanedMarkdown
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => !isGarbageLine(line));
	return trimMarkdown(filteredLines.join("\n\n").trim());
}

async function convertUrl(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			headers: {
				"user-agent": "Mozilla/5.0",
				"accept-language": "en-US,en;q=0.9",
			},
		});
		if (!response.ok) {
			return null;
		}

		const html = await response.text();
		if (countMarkerMatches(html, CONSENT_MARKERS) >= 3) {
			return null;
		}

		const structuredMarkdown = structuredArticleMarkdown(html);
		if (structuredMarkdown) {
			const cleanedStructuredMarkdown = cleanMarkdown(structuredMarkdown);
			if (cleanedStructuredMarkdown.length >= MIN_MARKDOWN_CHARS) {
				return cleanedStructuredMarkdown;
			}
		}

		const turndown = new TurndownService();
		const markdown = turndown.turndown(stripHtmlNoise(pickPrimaryHtml(html)));
		if (!markdown) {
			return null;
		}

		const cleanedMarkdown = cleanMarkdown(markdown);
		if (
			cleanedMarkdown.length < MIN_MARKDOWN_CHARS ||
			countMarkerMatches(cleanedMarkdown, CONSENT_MARKERS) >= 1
		) {
			return null;
		}
		return cleanedMarkdown;
	} catch {
		return null;
	}
}

export function webloader(
	urls: string | string[],
): Promise<Array<string | null>> {
	const normalizedUrls = Array.isArray(urls) ? urls : [urls];
	return Promise.all(normalizedUrls.map((url) => convertUrl(url)));
}

export const webloaderTool = tool(
	async ({ urls }: { urls: string[] }): Promise<Array<string | null>> =>
		webloader(urls),
	{
		name: "webloader_tool",
		description: "Load the web content from the given URLs.",
		schema: z.object({
			urls: z.array(z.string()),
		}),
	},
);
