import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en.json";
import ptBR from "../i18n/messages/pt-BR.json";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "__tests__" || f === "node_modules") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

function has(messages: unknown, path: string): boolean {
  let cur: unknown = messages;
  for (const k of path.split(".")) {
    if (typeof cur !== "object" || cur === null || !(k in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

describe("i18n messages", () => {
  // Users saw raw keys ("tasks.due", "activities.page") on several pages
  // because components referenced messages that were never added.
  it("every statically-referenced translation key exists in en.json", () => {
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      const binds = new Map<string, Set<string>>();
      for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']([\w.]+)["']\s*\)/g)) {
        if (!binds.has(m[1])) binds.set(m[1], new Set());
        binds.get(m[1])!.add(m[2]);
      }
      for (const [name, namespaces] of binds) {
        const call = new RegExp(`(?<![\\w.])${name}(?:\\.rich|\\.raw)?\\(\\s*["']([\\w.]+)["']`, "g");
        for (const m of src.matchAll(call)) {
          if (![...namespaces].some((ns) => has(en, `${ns}.${m[1]}`))) {
            missing.push(`${[...namespaces].join("/")}.${m[1]}  (${file.replace(SRC, "")})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("pt-BR has every key en has", () => {
    const pt = new Set(flatten(ptBR as Record<string, unknown>));
    expect(flatten(en as Record<string, unknown>).filter((k) => !pt.has(k))).toEqual([]);
  });
});
