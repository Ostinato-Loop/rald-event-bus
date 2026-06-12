// RALD Event Bus — KV Rate Limiter (sliding window)
// LILCKY STUDIO LIMITED

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const now   = Math.floor(Date.now() / 1000);
    const start = now - windowSeconds;
    const raw   = await kv.get(`rl:${key}`);
    const hits: number[] = raw ? JSON.parse(raw) : [];
    const recent = hits.filter((t) => t > start);
    if (recent.length >= limit) return { allowed: false, remaining: 0 };
    recent.push(now);
    await kv.put(`rl:${key}`, JSON.stringify(recent), { expirationTtl: windowSeconds + 60 });
    return { allowed: true, remaining: limit - recent.length };
  } catch { return { allowed: true, remaining: limit }; } // fail-open
}
