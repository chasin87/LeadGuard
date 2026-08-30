type HostGate = {
  active: number;
  waiters: Array<() => void>;
};

const gates = new Map<string, HostGate>();

export async function withHostConcurrency<T>(
  hostname: string,
  max: number,
  work: () => Promise<T>,
): Promise<T> {
  const key = hostname.toLowerCase();
  let gate = gates.get(key);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    gates.set(key, gate);
  }

  if (gate.active >= max) {
    await new Promise<void>((resolve) => {
      gate!.waiters.push(resolve);
    });
  }

  gate.active += 1;
  try {
    return await work();
  } finally {
    gate.active -= 1;
    const next = gate.waiters.shift();
    if (next) next();
    else if (gate.active === 0 && gate.waiters.length === 0) {
      gates.delete(key);
    }
  }
}

export function resetHostConcurrencyForTests(): void {
  gates.clear();
}
