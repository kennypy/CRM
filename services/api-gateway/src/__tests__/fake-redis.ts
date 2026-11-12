/** Minimal in-memory Redis stand-in for SET NX/PX/EX, GET, DEL, EVAL (lock scripts). */
export class FakeRedis {
  store = new Map<string, { v: string; exp: number | null }>();
  down = false;
  now = () => Date.now();

  private live(k: string) {
    const e = this.store.get(k);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.now()) { this.store.delete(k); return undefined; }
    return e;
  }
  private check() { if (this.down) throw new Error("ECONNREFUSED"); }

  async get(k: string) { this.check(); return this.live(k)?.v ?? null; }
  async del(k: string) { this.check(); return this.store.delete(k) ? 1 : 0; }
  async set(k: string, v: string, ...args: (string | number)[]) {
    this.check();
    let exp: number | null = null; let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === "NX") nx = true;
      if (a === "PX") exp = this.now() + Number(args[++i]);
      if (a === "EX") exp = this.now() + Number(args[++i]) * 1000;
    }
    if (nx && this.live(k)) return null;
    this.store.set(k, { v, exp });
    return "OK";
  }
  async eval(script: string, _n: number, key: string, owner: string, ttl?: number) {
    this.check();
    const e = this.live(key);
    if (!e || e.v !== owner) return 0;
    if (script.includes("PEXPIRE")) { e.exp = this.now() + Number(ttl); return 1; }
    this.store.delete(key); return 1;
  }
}
