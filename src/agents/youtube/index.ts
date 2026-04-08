/** YouTube summarization agent exports. */

import type { Summary } from "./schemas.js";
/** Summarize a YouTube video or transcript. */

export async function summarizeVideo(
    transcriptOrUrl: string,
    targetLanguage?: string | null,
): Promise<Summary> {
    const { summarizeVideo } = await import("./summarizer.js");
    return summarizeVideo({
        transcriptOrUrl,
        ...(targetLanguage !== undefined ? { targetLanguage } : {}),
    });
}
/** Stream a YouTube video summary. */

export async function streamSummarizeVideo(
    transcriptOrUrl: string,
    targetLanguage?: string | null,
) {
    const { streamSummarizeVideo } = await import("./summarizer-react.js");
    return streamSummarizeVideo({
        transcriptOrUrl,
        ...(targetLanguage !== undefined ? { targetLanguage } : {}),
    });
}
/** Summarize a YouTube video with the ReAct workflow. */

export async function summarizeVideoReact(
    transcriptOrUrl: string,
    targetLanguage?: string | null,
): Promise<Summary> {
    const { summarizeVideo } = await import("./summarizer-react.js");
    return summarizeVideo({
        transcriptOrUrl,
        ...(targetLanguage !== undefined ? { targetLanguage } : {}),
    });
}

export { youtubeLoader } from "../../tools/youtube/index.js";
