export interface DistributionStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  stddev: number;
}

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function computeDistributionStats(values: number[]): DistributionStats {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      stddev: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length;
  const stddev = Math.sqrt(variance);

  const p50 = computePercentile(sorted, 50);
  const p90 = computePercentile(sorted, 90);
  const p95 = computePercentile(sorted, 95);
  const p99 = computePercentile(sorted, 99);

  return {
    count: sorted.length,
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    mean: Number(mean.toFixed(2)),
    median: Number(p50.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
  };
}

export function computeHistogramBins(
  values: number[],
  binCount = 15,
  minVal?: number,
  maxVal?: number
): { binStart: number; binEnd: number; count: number; percentage: number }[] {
  if (values.length === 0) return [];
  const min = minVal ?? Math.min(...values);
  const max = maxVal ?? Math.max(...values);
  const range = Math.max(1, max - min);
  const binWidth = range / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    binStart: min + i * binWidth,
    binEnd: min + (i + 1) * binWidth,
    count: 0,
    percentage: 0,
  }));

  for (const v of values) {
    let index = Math.floor((v - min) / binWidth);
    if (index >= binCount) index = binCount - 1;
    if (index < 0) index = 0;
    bins[index].count++;
  }

  for (const b of bins) {
    b.percentage = Number(((b.count / values.length) * 100).toFixed(1));
    b.binStart = Number(b.binStart.toFixed(1));
    b.binEnd = Number(b.binEnd.toFixed(1));
  }

  return bins;
}
