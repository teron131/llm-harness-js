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

function pickPrimaryHtml(html: string): string {
	const articleMatch = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
	if (articleMatch?.[0]) {
		return articleMatch[0];
	}
	const mainMatch = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i);
	if (mainMatch?.[0]) {
		return mainMatch[0];
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
		normalizedLine.length > 180 &&
		(/[{;}]/.test(normalizedLine) || normalizedLine.includes("--"))
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

		const turndown = new TurndownService();
		const markdown = turndown.turndown(
			stripHtmlNoise(pickPrimaryHtml(html)),
		);
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
