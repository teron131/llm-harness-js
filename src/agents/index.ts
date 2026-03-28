/** Agent exports. */

import { webloaderTool } from "../tools/web/index.js";
import { youtubeLoader } from "./youtube/index.js";
/** Return the YouTube loader tool for the agent stack. */

export function youtubeloaderTool(url: string): Promise<string> {
  return youtubeLoader(url);
}
/** Return the configured tool set for the agent stack. */

export function getTools() {
  return [webloaderTool, youtubeloaderTool];
}

export { webloader, webloaderTool } from "../tools/web/index.js";
export {
  BaseHarnessAgent,
  ExaAgent,
  ImageAnalysisAgent,
  WebLoaderAgent,
  WebSearchAgent,
  WebSearchLoaderAgent,
  YouTubeSummarizer,
  YouTubeSummarizerGemini,
  YouTubeSummarizerReAct,
} from "./agents.js";
export { youtubeLoader } from "./youtube/index.js";
