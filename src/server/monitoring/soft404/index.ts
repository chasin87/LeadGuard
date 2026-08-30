export {
  SOFT404_CLASSIFIER_VERSION,
  SOFT404_MAX_BODY_BYTES,
  SOFT404_SOFT_THRESHOLD,
} from "@/server/monitoring/soft404/config";
export {
  analyzeSoft404,
  createHeuristicSoft404Classifier,
} from "@/server/monitoring/soft404/analyze";
export { isAnalyzableContentType } from "@/server/monitoring/soft404/content-type";
export {
  formatSoft404Signal,
  parseStoredSoft404Signals,
  soft404ConfidenceLabel,
} from "@/server/monitoring/soft404/signals";
export type {
  Soft404AnalysisResult,
  Soft404Classification,
  Soft404SignalCode,
} from "@/server/monitoring/soft404/types";
