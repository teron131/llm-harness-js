/** Agent exports. */

import { webloaderTool } from "../tools/web/index.js";
import { youtubeloaderTool } from "../tools/youtube/index.js";
/** Return the configured tool set for the agent stack. */

export function getTools() {
	return [webloaderTool, youtubeloaderTool];
}

export { webloader, webloaderTool } from "../tools/web/index.js";
export { youtubeLoader, youtubeloaderTool } from "../tools/youtube/index.js";
export {
	BaseHarnessAgent,
	FixerAgent,
	ImageAnalysisAgent,
	WebLoaderAgent,
	YouTubeSummarizer,
	YouTubeSummarizerGemini,
	YouTubeSummarizerReAct,
} from "./agents.js";
export { ExaAnswerAgent, ExaLoadAgent } from "./exa.js";
export * from "./fixer/index.js";
