import { ScenarioBenchmarkResult } from "../reporters/JsonReporter.js";
import { DriftTimePoint } from "../reporters/ChartGenerator.js";

export interface ScenarioRunOutput {
  result: ScenarioBenchmarkResult;
  rawLatencies: number[];
  driftTimePoints?: DriftTimePoint[];
}
