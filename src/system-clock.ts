import type { Clock } from "./ports.js";

export function systemClock(): Clock {
  return {
    nowMs: () => Date.now(),
    schedule: (delayMs, callback) => {
      const timer = setTimeout(() => {
        callback();
      }, delayMs);
      return () => {
        clearTimeout(timer);
      };
    },
  };
}
