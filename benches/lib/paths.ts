export function scenarioTouched(files: string[], prefixes: string[]): boolean {
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file === undefined) {
      continue;
    }
    for (let j = 0; j < prefixes.length; j += 1) {
      const prefix = prefixes[j];
      if (prefix !== undefined && file.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}
