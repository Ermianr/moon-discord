export function median(samples: number[]): number {
  const sorted = sortedCopy(samples);
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    return value === undefined ? 0 : value;
  }
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a === undefined || b === undefined) {
    return 0;
  }
  return (a + b) / 2;
}

export function percentile95(samples: number[]): number {
  const sorted = sortedCopy(samples);
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(0.95 * sorted.length);
  const index = rank - 1;
  const value = sorted[index < 0 ? 0 : index];
  return value === undefined ? 0 : value;
}

function sortedCopy(samples: number[]): number[] {
  const copy: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    if (value !== undefined) {
      copy.push(value);
    }
  }
  copy.sort((a, b) => a - b);
  return copy;
}
