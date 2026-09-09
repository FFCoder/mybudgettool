export type Ref = { system: string; id: string };
export type Item = {
  id: string;
  name: string;
  amountCents: number;
  categoryId: string | null;
  dueDate: string | null;
  monthlyDueDay?: number | null;
  notes: string;
  externalRefs: Ref[];
  position: number;
  createdAt: string;
  updatedAt: string;
};
export type Category = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
export type Template = Category & { items: Item[] };
export type Paycheck = {
  id: string;
  date: string;
  incomeCents: number;
  notes: string;
  items: Item[];
  createdAt: string;
  updatedAt: string;
};
export type Budget = {
  // Older documents may omit settings; they retain the original zero default.
  settings?: { defaultIncomeCents: number };
  categories: Category[];
  templates: Template[];
  paychecks: Paycheck[];
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const emptyBudget = (): Budget => ({
  settings: { defaultIncomeCents: 0 },
  categories: [],
  templates: [],
  paychecks: [],
});
const fail = (message: string): never => {
  throw new AppError("validation", message);
};
export function money(value: unknown): number {
  // Validate the whole entry before removing formatting; never turn malformed
  // grouping, signs, or arbitrary text into an apparently valid amount.
  const entry = typeof value === "string" ? value.trim() : "";
  if (!/^\$?(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(entry))
    return fail(
      "Enter a nonnegative amount such as 3200.00 or $3,200.00, with at most two decimal places",
    );
  const [whole, fraction = ""] = entry.replace(/^\$/, "").replaceAll(",", "").split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > 1000000000000n) return fail("Money exceeds supported limit");
  return Number(cents);
}
export function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" ||
    !Number.isFinite(new Date(value + "T00:00:00Z").getTime()) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    return fail("Date must be a valid YYYY-MM-DD");
  return value;
}
export function month(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    value.startsWith("0000")
  )
    return fail("Month must be YYYY-MM");
  return value;
}
export function monthlyDueDate(payday: string, day: number): string {
  date(payday);
  if (!Number.isInteger(day) || day < 1 || day > 31)
    return fail("Monthly due day must be an integer from 1 to 31");
  const year = Number(payday.slice(0, 4));
  const m = Number(payday.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return `${payday.slice(0, 7)}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}
function str(value: unknown, label: string, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > 10000 ||
    (required && !value.trim())
  )
    return fail(
      `${label} must be ${required ? "a nonempty" : "a"} string (maximum 10000 characters)`,
    );
  return value;
}
function get<T extends { id: string }>(list: T[], id: unknown): T {
  const found = list.find((x) => x.id === id);
  if (!found) throw new AppError("not_found", "Record not found", 404);
  return found;
}
function total(items: Item[]): number {
  const n = items.reduce((sum, x) => sum + BigInt(x.amountCents), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER))
    return fail("Total exceeds supported limit");
  return Number(n);
}
export function summary(p: Paycheck) {
  const grouped = new Map<string | null, number>();
  for (const i of p.items)
    grouped.set(i.categoryId, (grouped.get(i.categoryId) || 0) + i.amountCents);
  const totalCents = total(p.items);
  return {
    ...p,
    totalCents,
    remainingCents: p.incomeCents - totalCents,
    categoryTotals: [...grouped].map(([categoryId, totalCents]) => ({
      categoryId,
      totalCents,
    })),
  };
}
export function state(b: Budget, m?: string) {
  if (m) month(m);
  return {
    month: m ?? null,
    settings: { defaultIncomeCents: b.settings?.defaultIncomeCents ?? 0 },
    months: [...new Set(b.paychecks.map((p) => p.date.slice(0, 7)))].sort(),
    categories: b.categories,
    templates: b.templates,
    paychecks: b.paychecks
      .filter((p) => !m || p.date.startsWith(m))
      .sort((a, z) => a.date.localeCompare(z.date))
      .map(summary),
  };
}
export function command(
  b: Budget,
  operation: unknown,
  input: unknown,
): unknown {
  if (
    typeof operation !== "string" ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  )
    return fail("Expected operation and input object");
  const x = input as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    "settings.update": ["defaultIncome"],
    "category.create": ["name"],
    "category.update": ["id", "name"],
    "category.delete": ["id"],
    "paycheck.create": ["date", "income", "notes", "templateId"],
    "paycheck.update": ["id", "date", "income", "notes"],
    "paycheck.delete": ["id"],
    "template.create": ["name", "paycheckId"],
    "template.update": ["id", "name"],
    "template.delete": ["id"],
    "item.create": [
      "paycheckId",
      "templateId",
      "name",
      "amount",
      "categoryId",
      "dueDate",
      "monthlyDueDay",
      "notes",
      "externalRefs",
      "position",
    ],
    "item.update": [
      "id",
      "name",
      "amount",
      "categoryId",
      "dueDate",
      "monthlyDueDay",
      "notes",
      "externalRefs",
      "position",
    ],
    "item.delete": ["id"],
    "item.move": ["id", "paycheckId", "templateId", "position"],
    "item.reorder": ["paycheckId", "templateId", "itemIds"],
  };
  if (fields[operation]) {
    const unknown = Object.keys(x).filter(
      (k) => !fields[operation]!.includes(k),
    );
    if (unknown.length)
      return fail("Unknown input fields: " + unknown.join(", "));
  }
  const now = new Date().toISOString();
  const meta = () => ({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  const parent = () => {
    if (Boolean(x.paycheckId) === Boolean(x.templateId))
      return fail("Supply exactly one paycheckId or templateId");
    return x.paycheckId
      ? get(b.paychecks, x.paycheckId)
      : get(b.templates, x.templateId);
  };
  const locate = () => {
    for (const p of [...b.paychecks, ...b.templates]) {
      const item = p.items.find((i) => i.id === x.id);
      if (item) return { p, item };
    }
    throw new AppError("not_found", "Item not found", 404);
  };
  const normalize = (p: { items: Item[]; updatedAt: string }) => {
    p.items.forEach((i, n) => {
      if (i.position !== n) i.updatedAt = now;
      i.position = n;
    });
    p.updatedAt = now;
    total(p.items);
  };
  const insert = (p: { items: Item[]; updatedAt: string }, item: Item) => {
    let position = x.position ?? p.items.length;
    if (
      !Number.isInteger(position) ||
      Number(position) < 0 ||
      Number(position) > p.items.length
    )
      return fail("Position is outside item list");
    p.items.splice(Number(position), 0, item);
    normalize(p);
  };
  const fill = (i: Item, create = false, isTemplate = false) => {
    if (x.monthlyDueDay !== undefined) {
      if (x.monthlyDueDay !== null && (!isTemplate || !Number.isInteger(x.monthlyDueDay) || Number(x.monthlyDueDay) < 1 || Number(x.monthlyDueDay) > 31))
        return fail("Monthly due day is available on template items only and must be an integer from 1 to 31");
      i.monthlyDueDay = x.monthlyDueDay as number | null;
    }
    if (create || x.name !== undefined) i.name = str(x.name, "Name", true);
    if (create || x.amount !== undefined) i.amountCents = money(x.amount);
    if (x.categoryId !== undefined) {
      if (x.categoryId !== null) get(b.categories, x.categoryId);
      i.categoryId = x.categoryId as string | null;
    }
    if (x.dueDate !== undefined)
      i.dueDate = x.dueDate === null ? null : date(x.dueDate);
    if (x.notes !== undefined) i.notes = str(x.notes, "Notes");
    if (x.externalRefs !== undefined) {
      if (!Array.isArray(x.externalRefs) || x.externalRefs.length > 100)
        return fail("External refs must be an array (maximum 100)");
      i.externalRefs = x.externalRefs.map((r) => {
        if (!r || typeof r !== "object")
          return fail("Invalid external reference");
        return {
          system: str(r.system, "Reference system", true),
          id: str(r.id, "Reference id", true),
        };
      });
    }
    i.updatedAt = now;
  };
  const unique = (list: Category[], name: string, id?: string) => {
    if (
      list.some(
        (c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new AppError("conflict", "Name already exists", 409);
  };
  switch (operation) {
    case "category.create": {
      const name = str(x.name, "Name", true).trim();
      unique(b.categories, name);
      const c = { ...meta(), name };
      b.categories.push(c);
      return c;
    }
    case "category.update": {
      const c = get(b.categories, x.id);
      const name = str(x.name, "Name", true).trim();
      unique(b.categories, name, c.id);
      Object.assign(c, { name, updatedAt: now });
      return c;
    }
    case "category.delete": {
      const c = get(b.categories, x.id);
      b.categories = b.categories.filter((a) => a.id !== c.id);
      for (const p of [...b.paychecks, ...b.templates])
        for (const i of p.items)
          if (i.categoryId === c.id) {
            i.categoryId = null;
            i.updatedAt = now;
            p.updatedAt = now;
          }
      return { id: c.id, deleted: true };
    }
    case "settings.update": {
      b.settings = { defaultIncomeCents: money(x.defaultIncome) };
      return b.settings;
    }
    case "paycheck.create": {
      const p: Paycheck = {
        ...meta(),
        date: date(x.date),
        incomeCents: x.income === undefined
          ? (b.settings?.defaultIncomeCents ?? 0)
          : money(x.income),
        notes: str(x.notes ?? "", "Notes"),
        items: [],
      };
      if (x.templateId)
        p.items = get(b.templates, x.templateId).items.map((i) => ({
          ...structuredClone(i),
          ...meta(),
          dueDate: i.monthlyDueDay == null ? i.dueDate : monthlyDueDate(p.date, i.monthlyDueDay),
          monthlyDueDay: null,
        }));
      b.paychecks.push(p);
      return summary(p);
    }
    case "paycheck.update": {
      const p = get(b.paychecks, x.id);
      if (x.date !== undefined) p.date = date(x.date);
      if (x.income !== undefined) p.incomeCents = money(x.income);
      if (x.notes !== undefined) p.notes = str(x.notes, "Notes");
      p.updatedAt = now;
      return summary(p);
    }
    case "paycheck.delete": {
      const p = get(b.paychecks, x.id);
      b.paychecks = b.paychecks.filter((a) => a.id !== p.id);
      return { id: p.id, deleted: true };
    }
    case "template.create": {
      const name = str(x.name, "Name", true).trim();
      unique(b.templates, name);
      const t: Template = {
        ...meta(),
        name,
        items: x.paycheckId
          ? get(b.paychecks, x.paycheckId).items.map((i) => ({
              ...structuredClone(i),
              ...meta(),
            }))
          : [],
      };
      b.templates.push(t);
      return t;
    }
    case "template.update": {
      const t = get(b.templates, x.id);
      if (x.name !== undefined) {
        const name = str(x.name, "Name", true).trim();
        unique(b.templates, name, t.id);
        t.name = name;
      }
      t.updatedAt = now;
      return t;
    }
    case "template.delete": {
      const t = get(b.templates, x.id);
      b.templates = b.templates.filter((a) => a.id !== t.id);
      return { id: t.id, deleted: true };
    }
    case "item.create": {
      const p = parent();
      const i: Item = {
        ...meta(),
        name: "",
        amountCents: 0,
        categoryId: null,
        dueDate: null,
        notes: "",
        externalRefs: [],
        position: 0,
      };
      fill(i, true, "name" in p);
      insert(p, i);
      return i;
    }
    case "item.update": {
      const { p, item } = locate();
      fill(item, false, "name" in p);
      if (x.position !== undefined) {
        p.items = p.items.filter((a) => a.id !== item.id);
        insert(p, item);
      }
      normalize(p);
      return item;
    }
    case "item.delete": {
      const { p, item } = locate();
      p.items = p.items.filter((a) => a.id !== item.id);
      normalize(p);
      return { id: item.id, deleted: true };
    }
    case "item.move": {
      const { p, item } = locate();
      const target = parent();
      if ("name" in p && "date" in target && item.monthlyDueDay != null) {
        item.dueDate = monthlyDueDate(target.date, item.monthlyDueDay);
        item.monthlyDueDay = null;
      }
      p.items = p.items.filter((a) => a.id !== item.id);
      normalize(p);
      item.updatedAt = now;
      insert(target, item);
      return item;
    }
    case "item.reorder": {
      const p = parent();
      if (
        !Array.isArray(x.itemIds) ||
        x.itemIds.length !== p.items.length ||
        new Set(x.itemIds).size !== p.items.length ||
        x.itemIds.some((id) => !p.items.some((i) => i.id === id))
      )
        return fail("itemIds must contain every item exactly once");
      p.items = x.itemIds.map((id) => get(p.items, id));
      normalize(p);
      return p;
    }
    default:
      throw new AppError("unknown_operation", "Unknown operation", 400);
  }
}
