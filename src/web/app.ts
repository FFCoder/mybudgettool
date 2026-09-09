import { money as parseMoney } from "../shared/domain";
import { formatMoneyInput, formatUsdCents as money } from "./money-input";

type Category = { id: string; name: string };
type Item = {
  id: string;
  name: string;
  amountCents: number;
  categoryId: string | null;
  dueDate: string | null;
  monthlyDueDay?: number | null;
  notes: string;
  externalRefs: { system: string; id: string }[];
  position: number;
};
type Paycheck = {
  id: string;
  date: string;
  incomeCents: number;
  notes: string;
  items: Item[];
  totalCents: number;
  remainingCents: number;
};
type Template = { id: string; name: string; items: Item[] };
type State = {
  settings: { defaultIncomeCents: number };
  month: string;
  months: string[];
  categories: Category[];
  templates: Template[];
  paychecks: Paycheck[];
};
const root = document.querySelector<HTMLDivElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
let token = sessionStorage.getItem("budget-token") || "";
let month =
  new Date().getFullYear() +
  "-" +
  String(new Date().getMonth() + 1).padStart(2, "0");
let page: "planner" | "templates" | "categories" = "planner";
let state: State = {
  settings: { defaultIncomeCents: 0 },
  month,
  months: [],
  categories: [],
  templates: [],
  paychecks: [],
};
let pending = false;
let needsRefresh = false;
const uncertainWrites = new Map<string, string>();
const saveStatus = document.createElement("div");
saveStatus.className = "save-status";
saveStatus.setAttribute("role", "status");
saveStatus.setAttribute("aria-live", "polite");
document.body.append(saveStatus);
function savingState() {
  root.inert = pending || needsRefresh;
  root.setAttribute("aria-busy", String(pending));
  saveStatus.hidden = !pending && !needsRefresh;
  saveStatus.innerHTML = needsRefresh
    ? '<span>Saved successfully. The latest view could not load.</span><button id="retry-refresh">Reload view</button>'
    : "Saving your change…";
  saveStatus.querySelector("button")?.addEventListener("click", async () => {
    try {
      await refresh();
      needsRefresh = false;
      savingState();
      toast("View updated");
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
}
saveStatus.hidden = true;
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const decimal = (v: number) => (v / 100).toFixed(2);
const dateLabel = (v: string) =>
  new Date(v + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
const monthLabel = () =>
  new Date(month + "-01T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
const catName = (id: string | null) =>
  state.categories.find((c) => c.id === id)?.name || "Uncategorized";
function toast(message: string, error = false) {
  const e = document.querySelector<HTMLDivElement>("#toast")!;
  e.textContent = message;
  e.classList.toggle("error", error);
  e.style.display = "block";
  setTimeout(() => (e.style.display = "none"), 6000);
}
async function api(path: string, options: RequestInit = {}) {
  const r = await fetch("/api/" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(data.error?.message || "Request failed", r.status);
  return data;
}
async function refresh() {
  state = await api("state?month=" + month);
  render();
}
async function command(operation: string, input: Record<string, unknown>) {
  if (pending || needsRefresh)
    throw new Error(
      "Please wait until the current save finishes or reload the view.",
    );
  pending = true;
  savingState();
  const body = JSON.stringify({ operation, input });
  // Preserve the same key after an uncertain response, including manual retries.
  const key = uncertainWrites.get(body) || crypto.randomUUID();
  uncertainWrites.set(body, key);
  try {
    let result;
    try {
      result = await api("commands", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        uncertainWrites.delete(body);
        throw error;
      }
      try {
        result = await api("commands", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body,
        });
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status < 500) {
          uncertainWrites.delete(body);
          throw retryError;
        }
        throw new Error(
          "The save could not be confirmed. Retry without changing the values; the same request identifier will prevent a duplicate.",
        );
      }
    }
    uncertainWrites.delete(body);
    try {
      await refresh();
    } catch {
      // The write was acknowledged: never report it as failed or offer to repeat it.
      needsRefresh = true;
    }
    return result.result;
  } finally {
    pending = false;
    savingState();
  }
}
function login(error = "") {
  root.innerHTML = `<main class="login"><div class="brand"><span class="brandmark">↗</span>My Budget</div><h1>A little planning.<br>More peace of mind.</h1><p class="muted">Give your future paychecks a plan. Enter your application access token to open your workspace.</p><form id="login"><label>Access token<input name="token" type="password" required autocomplete="current-password" placeholder="Your API token"></label><p class="formerror">${esc(error)}</p><button class="primary">Open my planner →</button></form><p class="hint">Use the API_TOKEN configured on your server. Stored only for this browser session.</p></main>`;
  document.querySelector<HTMLFormElement>("#login")!.onsubmit = async (e) => {
    e.preventDefault();
    token = String(
      new FormData(e.currentTarget as HTMLFormElement).get("token"),
    ).trim();
    try {
      await refresh();
      sessionStorage.setItem("budget-token", token);
    } catch (e) {
      login((e as Error).message);
    }
  };
}
function shell(content: string) {
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brandmark">↗</span>My Budget</div><div class="nav-label">Your workspace</div><nav class="nav"><button data-page="planner" class="${page === "planner" ? "active" : ""}"><span>▦</span> Paycheck planner</button><button data-page="templates" class="${page === "templates" ? "active" : ""}"><span>▤</span> Templates</button><button data-page="categories" class="${page === "categories" ? "active" : ""}"><span>◇</span> Categories</button></nav><div class="sidebar-note"><strong>Looking ahead, feeling ready.</strong>Plan money before it arrives. Each paycheck starts fresh.<br><button class="quiet" style="color:#bed2c2;padding:15px 0 0" data-action="logout">Lock workspace ↗</button></div></aside><main class="main">${content}</main></div>`;
  root.onclick = click;
  root.onchange = change;
}
function render() {
  if (page === "planner") renderPlanner();
  else if (page === "templates") renderTemplates();
  else renderCategories();
}
function renderPlanner() {
  const income = state.paychecks.reduce((s, p) => s + p.incomeCents, 0),
    total = state.paychecks.reduce((s, p) => s + p.totalCents, 0);
  shell(
    `<header class="topline"><div><div class="eyebrow">Make room for what matters</div><h1>Paycheck planner</h1><div class="muted">A clear plan for the money on its way.</div></div><button class="primary" data-action="new-paycheck">＋ New paycheck</button></header><div class="toolbar"><div class="monthnav"><button data-action="prev" aria-label="Previous month">←</button><strong>${monthLabel()}</strong><button data-action="next" aria-label="Next month">→</button></div><div class="actions"><input aria-label="Jump to month" type="month" id="month" value="${month}"><button class="quiet" data-action="today">This month</button></div></div><div class="planner-default"><span>Start each new paycheck with your usual income.</span><button data-action="default-income">Default paycheck income: ${money(state.settings.defaultIncomeCents)}</button></div><section class="summary"><div class="metric"><span>Expected income</span><strong>${money(income)}</strong><small>${state.paychecks.length} planned paycheck${state.paychecks.length === 1 ? "" : "s"}</small></div><div class="metric"><span>Planned spending & saving</span><strong>${money(total)}</strong><small>Every item has a place</small></div><div class="metric"><span>Left to plan</span><strong class="${income - total < 0 ? "negative" : ""}">${money(income - total)}</strong><small>${income - total < 0 ? "Plans exceed expected income" : "Across this month’s paychecks · no carryover"}</small></div></section>${state.paychecks.length ? state.paychecks.map(paycheckCard).join("") : `<section class="empty"><div class="empty-symbol">▦</div><h2>Your next paycheck starts here</h2><p class="muted">Add an expected payday, then make room for bills, everyday expenses, savings, and everything in between.</p><button class="primary" data-action="new-paycheck">＋ Plan a paycheck</button><div class="hint">Start empty or reuse a paycheck template.</div></section>`}<p class="hint">Future plans only. Remaining balances never carry into another paycheck.</p>`,
  );
}
function categoryOptions(selected: string | null = "") {
  return (
    `<option value="">Uncategorized</option>` +
    state.categories
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`,
      )
      .join("")
  );
}
function itemTable(items: Item[], parentId: string, isTemplate = false) {
  if (!items.length)
    return `<div style="padding:28px 24px" class="muted">No planned items yet. Add your first expense, saving, or extra debt payment.</div>`;
  const groups = [...new Set(items.map((i) => i.categoryId))];
  return `<div class="tablewrap"><table><thead><tr><th>Planned item</th><th>Category</th><th>Due date</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${groups
    .map(
      (group) =>
        `<tr class="group"><td colspan="5">${esc(catName(group))}<span class="group-total">${money(items.filter((i) => i.categoryId === group).reduce((s, i) => s + i.amountCents, 0))}</span></td></tr>${items
          .filter((i) => i.categoryId === group)
          .map(
            (i) =>
              `<tr data-item="${i.id}" data-parent="${parentId}" data-template="${isTemplate}"><td><input aria-label="Item name" data-field="name" value="${esc(i.name)}">${i.notes || i.externalRefs.length ? `<div class="hint" style="margin:0 5px">${i.notes ? "Note" : ""}${i.notes && i.externalRefs.length ? " · " : ""}${i.externalRefs.length ? `${i.externalRefs.length} reference${i.externalRefs.length === 1 ? "" : "s"}` : ""}</div>` : ""}</td><td><select aria-label="Category" data-field="categoryId">${categoryOptions(i.categoryId)}</select></td><td><input aria-label="Due date" type="date" data-field="dueDate" value="${i.dueDate || ""}">${isTemplate && i.monthlyDueDay ? `<div class="hint" style="margin:0 5px">Monthly day ${i.monthlyDueDay}</div>` : ""}</td><td><input aria-label="Amount" class="amount" inputmode="decimal" data-field="amount" value="${money(i.amountCents)}"></td><td><div class="rowactions"><button class="quiet" data-action="up-item" data-id="${i.id}" title="Move up within category" ${items.filter((other) => other.categoryId === group)[0]?.id === i.id ? "disabled" : ""} aria-label="Move ${esc(i.name)} up">↑</button><button class="quiet" data-action="down-item" data-id="${i.id}" title="Move down within category" ${items.filter((other) => other.categoryId === group).at(-1)?.id === i.id ? "disabled" : ""} aria-label="Move ${esc(i.name)} down">↓</button><button class="quiet" data-action="edit-item" data-id="${i.id}" title="Edit item details" aria-label="Edit ${esc(i.name)} details">•••</button></div></td></tr>`,
          )
          .join("")}`,
    )
    .join("")}</tbody></table></div>`;
}
function paycheckCard(p: Paycheck) {
  return `<article class="card"><div class="cardhead"><div><span class="datepill">PAYDAY</span><h2>${dateLabel(p.date)}</h2></div><div class="actions"><div class="income"><label for="income-${p.id}">Expected income</label><input id="income-${p.id}" data-income="${p.id}" aria-label="Expected income for ${esc(p.date)}" inputmode="decimal" value="${money(p.incomeCents)}"></div><button class="quiet" data-action="edit-paycheck" data-id="${p.id}" aria-label="Edit paycheck ${esc(p.date)}">•••</button></div></div>${p.notes ? `<div class="note">${esc(p.notes)}</div>` : ""}${itemTable(p.items, p.id)}<div class="cardfoot"><button class="quiet" data-action="add-item" data-paycheck="${p.id}">＋ Add item</button><div class="balance"><span>Planned<strong>${money(p.totalCents)}</strong></span><span>${p.remainingCents < 0 ? "Overplanned" : "Remaining"}<strong class="${p.remainingCents < 0 ? "negative" : ""}">${money(p.remainingCents)}</strong></span></div></div></article>`;
}
function renderTemplates() {
  shell(
    `<header class="topline"><div><div class="eyebrow">A head start every payday</div><h1>Paycheck templates</h1><div class="muted">Save a starting plan. Every new paycheck gets its own independent copy.</div></div><button class="primary" data-action="new-template">＋ New template</button></header>${state.templates.length ? state.templates.map((t) => `<article class="card"><div class="cardhead"><div><h2>${esc(t.name)}</h2><span class="muted">${t.items.length} starting items · ${money(t.items.reduce((s, i) => s + i.amountCents, 0))}</span></div><button data-action="edit-template" data-id="${t.id}">Manage</button></div>${itemTable(t.items, t.id, true)}<div class="cardfoot"><button class="quiet" data-action="add-item" data-template="${t.id}">＋ Add starting item</button><span class="hint">Changes apply only to future copies.</span></div></article>`).join("") : `<section class="empty"><div class="empty-symbol">▤</div><h2>Start with a familiar plan</h2><p class="muted">Create a template for a regular paycheck, or save the items from a paycheck you’ve already planned.</p><button class="primary" data-action="new-template">Create a template</button></section>`}`,
  );
}
function renderCategories() {
  shell(
    `<header class="topline"><div><div class="eyebrow">Bring a little order</div><h1>Categories</h1><div class="muted">Group your planned items in a way that makes sense to you.</div></div><button class="primary" data-action="new-category">＋ New category</button></header><div class="entity-list">${state.categories.length ? state.categories.map((c) => `<article class="entity"><div><h3>◇ &nbsp;${esc(c.name)}</h3></div><button data-action="edit-category" data-id="${c.id}">Edit category</button></article>`).join("") : `<section class="empty"><div class="empty-symbol">◇</div><h2>Give your plans some structure</h2><p class="muted">Try categories for monthly expenses, last-minute expenses, or savings. Your categories are yours to manage.</p><button class="primary" data-action="new-category">Create a category</button></section>`}</div><p class="hint">Categories organize your plans. External references are managed separately on each item.</p>`,
  );
}
function field(
  label: string,
  name: string,
  value: unknown = "",
  type = "text",
  extra = "",
) {
  return `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function notes(value = "") {
  return `<label class="field">Notes <textarea name="notes" placeholder="Anything you’d like to remember…">${esc(value)}</textarea></label>`;
}
function modal(
  title: string,
  body: string,
  save: (data: FormData) => Promise<void>,
  extras = "",
) {
  dialog.innerHTML = `<form id="modal-form"><div class="dialoghead"><h2>${esc(title)}</h2><button type="button" class="quiet" data-close aria-label="Close">✕</button></div><div class="dialogbody">${body}<div class="formerror" id="form-error" role="alert"></div></div><div class="dialogfoot">${extras}<button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  dialog
    .querySelectorAll("[data-close]")
    .forEach((e) => e.addEventListener("click", () => dialog.close()));
  dialog.querySelector<HTMLFormElement>("form")!.onsubmit = async (e) => {
    e.preventDefault();
    const button = dialog.querySelector<HTMLButtonElement>("[type=submit]")!;
    button.disabled = true;
    try {
      await save(new FormData(e.currentTarget as HTMLFormElement));
      dialog.close();
      toast("Saved");
    } catch (e) {
      dialog.querySelector("#form-error")!.textContent = (e as Error).message;
    } finally {
      button.disabled = false;
    }
  };
  dialog.showModal();
}
function moneyEntry(data: FormData, key: string) {
  return decimal(parseMoney(text(data, key)));
}
function text(data: FormData, key: string) {
  return String(data.get(key) || "");
}
function defaultIncomeForm() {
  modal(
    "Default paycheck income",
    `<p class="muted">Set the expected income for one paycheck. This is a per-paycheck amount, not your annual salary.</p>${field("Expected income per paycheck", "defaultIncome", money(state.settings.defaultIncomeCents), "text", 'required inputmode="decimal"')}<p class="hint">New paychecks start with this amount, and you can change it for an individual payday. Existing paychecks keep their current income.</p>`,
    async (data) => {
      await command("settings.update", {
        defaultIncome: moneyEntry(data, "defaultIncome"),
      });
    },
  );
}
function paycheckForm(p?: Paycheck) {
  modal(
    p ? "Edit paycheck" : "Plan a new paycheck",
    `<div class="fields2">${field("Payday", "date", p?.date || month + "-01", "date", "required")}${field("Expected income", "income", p ? money(p.incomeCents) : money(state.settings.defaultIncomeCents), "text", 'required inputmode="decimal"')}</div>${!p ? `<label class="field">Starting template<select name="templateId"><option value="">Start with an empty paycheck</option>${state.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select><small>Items are copied. Later template edits won’t change this paycheck.</small></label>` : ""}${notes(p?.notes)}`,
    async (d) => {
      const date = text(d, "date");
      await command(p ? "paycheck.update" : "paycheck.create", {
        ...(p
          ? { id: p.id }
          : text(d, "templateId")
            ? { templateId: text(d, "templateId") }
            : {}),
        date,
        income: moneyEntry(d, "income"),
        notes: text(d, "notes"),
      });
      if (date.slice(0, 7) !== month) {
        month = date.slice(0, 7);
        try {
          await refresh();
          needsRefresh = false;
        } catch {
          needsRefresh = true;
        }
        savingState();
      }
    },
    p
      ? `<button type="button" class="danger" id="delete-paycheck">Delete paycheck</button>`
      : "",
  );
  if (p)
    dialog
      .querySelector("#delete-paycheck")!
      .addEventListener("click", () =>
        confirmDelete(
          "Delete this paycheck?",
          `This removes the paycheck and its ${p.items.length} planned items.`,
          "paycheck.delete",
          p.id,
        ),
      );
}
function findItem(id: string) {
  for (const parent of [...state.paychecks, ...state.templates]) {
    const item = parent.items.find((i) => i.id === id);
    if (item) return { item, parent, isTemplate: "name" in parent };
  }
  throw new Error("Item not found");
}
function monthlyDayEntry(value: string): number | null {
  if (!value) return null;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 31) {
    throw new Error("Monthly due day must be a whole number from 1 to 31.");
  }
  return Number(value);
}
function itemForm(parentId: string, isTemplate: boolean, item?: Item) {
  modal(
    item ? "Edit planned item" : "Add a planned item",
    `${field("Item name", "name", item?.name || "", "text", 'required maxlength="200"')}<div class="fields2">${field("Amount", "amount", item ? money(item.amountCents) : "$0.00", "text", 'required inputmode="decimal" placeholder="0.00"')}<label class="field">Category<select name="categoryId">${categoryOptions(item?.categoryId)}</select><button type="button" class="quiet" id="show-new-category">＋ New category</button></label></div><div id="inline-category" class="inline-category" hidden><label class="field">New category name<input id="new-category-name" type="text" maxlength="120" placeholder="e.g. Monthly expenses"></label><button type="button" id="create-inline-category">Create & select</button><div class="formerror" id="category-error" role="alert"></div></div>${isTemplate ? `${field("Monthly due day (optional)", "monthlyDueDay", item?.monthlyDueDay ?? "", "number", 'min="1" max="31" step="1"')}<p class="hint">Use a day from 1 to 31. Each copy uses that day in its paycheck month; shorter months use their last day. This takes precedence over the fixed due date below.</p>` : ""}${field(isTemplate ? "Fixed due date (optional fallback)" : "Due date (optional)", "dueDate", item?.dueDate || "", "date")}${notes(item?.notes)}<label class="field">External references<textarea name="externalRefs" placeholder="Actual: record-id\nActual: another-record-id">${esc(item?.externalRefs.map((r) => r.system + ": " + r.id).join("\n") || "")}</textarea><small>Optional: one “system: identifier” per line. These are manual references; no import or sync occurs.</small></label>${item ? '<p class="hint">Use Move to send this item to another paycheck or template.</p>' : ""}`,
    async (d) => {
      const refs = text(d, "externalRefs")
        .split("\n")
        .filter((s) => s.trim())
        .map((s) => {
          const at = s.indexOf(":");
          if (at < 1 || !s.slice(at + 1).trim())
            throw new Error(
              "Use “system: identifier” for each external reference.",
            );
          return { system: s.slice(0, at).trim(), id: s.slice(at + 1).trim() };
        });
      await command(item ? "item.update" : "item.create", {
        ...(item
          ? { id: item.id }
          : { [isTemplate ? "templateId" : "paycheckId"]: parentId }),
        name: text(d, "name"),
        amount: moneyEntry(d, "amount"),
        categoryId: text(d, "categoryId") || null,
        dueDate: text(d, "dueDate") || null,
        ...(isTemplate
          ? { monthlyDueDay: monthlyDayEntry(text(d, "monthlyDueDay")) }
          : {}),
        notes: text(d, "notes"),
        externalRefs: refs,
      });
    },
    item
      ? '<button type="button" class="danger" id="delete-item">Delete</button><button type="button" id="move-item">Move</button>'
      : "",
  );
  dialog.querySelector("#show-new-category")!.addEventListener("click", () => {
    dialog.querySelector<HTMLElement>("#inline-category")!.hidden = false;
    dialog.querySelector<HTMLInputElement>("#new-category-name")!.focus();
  });
  dialog
    .querySelector<HTMLInputElement>("#new-category-name")!
    .addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        dialog
          .querySelector<HTMLButtonElement>("#create-inline-category")!
          .click();
      }
    });
  dialog
    .querySelector("#create-inline-category")!
    .addEventListener("click", async () => {
      const nameInput =
        dialog.querySelector<HTMLInputElement>("#new-category-name")!;
      const error = dialog.querySelector<HTMLElement>("#category-error")!;
      const createButton = dialog.querySelector<HTMLButtonElement>(
        "#create-inline-category",
      )!;
      const saveButton =
        dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
      if (!nameInput.value.trim()) {
        error.textContent = "Enter a category name.";
        nameInput.focus();
        return;
      }
      error.textContent = "";
      createButton.disabled = true;
      saveButton.disabled = true;
      try {
        const category = (await command("category.create", {
          name: nameInput.value.trim(),
        })) as Category;
        const select = dialog.querySelector<HTMLSelectElement>(
          '[name="categoryId"]',
        )!;
        select.innerHTML = categoryOptions(category.id);
        if (!select.querySelector(`option[value="${category.id}"]`)) {
          select.add(new Option(category.name, category.id));
        }
        select.value = category.id;
        nameInput.value = "";
        dialog.querySelector<HTMLElement>("#inline-category")!.hidden = true;
        toast("Category created and selected");
      } catch (e) {
        error.textContent = (e as Error).message;
      } finally {
        createButton.disabled = false;
        saveButton.disabled = false;
      }
    });
  if (item) {
    dialog
      .querySelector("#delete-item")!
      .addEventListener("click", () =>
        confirmDelete(
          "Delete planned item?",
          `Remove “${item.name}” from this plan?`,
          "item.delete",
          item.id,
        ),
      );
    dialog
      .querySelector("#move-item")!
      .addEventListener("click", () => moveForm(item, parentId));
  }
}
async function moveForm(item: Item, parentId: string) {
  try {
    const all: State = await api("state");
    dialog.close();
    modal(
      "Move planned item",
      `<p class="muted">Move “${esc(item.name)}” with its amount, notes, and references intact.</p><label class="field">Destination<select name="destination" required><option value="">Choose a destination</option><optgroup label="Paychecks">${all.paychecks
        .filter((p) => p.id !== parentId)
        .map(
          (p) =>
            `<option value="paycheckId:${p.id}">${esc(p.date)} · ${money(p.incomeCents)}</option>`,
        )
        .join("")}</optgroup><optgroup label="Templates">${all.templates
        .filter((t) => t.id !== parentId)
        .map(
          (t) => `<option value="templateId:${t.id}">${esc(t.name)}</option>`,
        )
        .join("")}</optgroup></select></label>`,
      async (d) => {
        const [kind, id] = text(d, "destination").split(":");
        await command("item.move", { id: item.id, [kind!]: id });
      },
    );
  } catch (e) {
    toast((e as Error).message, true);
  }
}
function categoryForm(c?: Category) {
  modal(
    c ? "Edit category" : "New category",
    field(
      "Category name",
      "name",
      c?.name || "",
      "text",
      'required maxlength="120"',
    ),
    async (d) => {
      await command(c ? "category.update" : "category.create", {
        ...(c ? { id: c.id } : {}),
        name: text(d, "name"),
      });
    },
    c
      ? '<button type="button" class="danger" id="delete-category">Delete category</button>'
      : "",
  );
  if (c)
    dialog
      .querySelector("#delete-category")!
      .addEventListener("click", () =>
        confirmDelete(
          "Delete category?",
          "Items in this category will become uncategorized. Their amounts and other details stay intact.",
          "category.delete",
          c.id,
        ),
      );
}
function templateForm(t?: Template) {
  modal(
    t ? "Manage template" : "New paycheck template",
    `${field("Template name", "name", t?.name || "", "text", 'required maxlength="200"')}${!t ? `<label class="field">Starting items<select name="paycheckId"><option value="">Start with an empty template</option>${state.paychecks.map((p) => `<option value="${p.id}">Copy ${esc(p.date)} paycheck</option>`).join("")}</select><small>Copies items from a paycheck in the selected month. The original is unchanged.</small></label>` : ""}`,
    async (d) => {
      await command(t ? "template.update" : "template.create", {
        ...(t
          ? { id: t.id }
          : text(d, "paycheckId")
            ? { paycheckId: text(d, "paycheckId") }
            : {}),
        name: text(d, "name"),
      });
    },
    t
      ? '<button type="button" class="danger" id="delete-template">Delete template</button>'
      : "",
  );
  if (t)
    dialog
      .querySelector("#delete-template")!
      .addEventListener("click", () =>
        confirmDelete(
          "Delete template?",
          "This removes the template and its starting items. Paychecks already created from it stay unchanged.",
          "template.delete",
          t.id,
        ),
      );
}
function confirmDelete(
  title: string,
  description: string,
  operation: string,
  id: string,
) {
  dialog.close();
  modal(title, `<p class="muted">${esc(description)}</p>`, async () => {
    await command(operation, { id });
  });
  const b = dialog.querySelector<HTMLButtonElement>("[type=submit]")!;
  b.textContent = "Delete";
  b.className = "danger";
}
async function click(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page as typeof page;
    render();
    return;
  }
  const id = target.dataset.id;
  try {
    switch (target.dataset.action) {
      case "logout":
        token = "";
        sessionStorage.removeItem("budget-token");
        login();
        break;
      case "prev":
      case "next": {
        const d = new Date(month + "-01T12:00:00");
        d.setMonth(d.getMonth() + (target.dataset.action === "prev" ? -1 : 1));
        month =
          d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        await refresh();
        break;
      }
      case "today": {
        const d = new Date();
        month =
          d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        await refresh();
        break;
      }
      case "default-income":
        defaultIncomeForm();
        break;
      case "new-paycheck":
        paycheckForm();
        break;
      case "edit-paycheck":
        paycheckForm(state.paychecks.find((p) => p.id === id));
        break;
      case "add-item":
        itemForm(
          target.dataset.paycheck || target.dataset.template!,
          !!target.dataset.template,
        );
        break;
      case "edit-item": {
        const f = findItem(id!);
        itemForm(f.parent.id, f.isTemplate, f.item);
        break;
      }
      case "up-item":
      case "down-item": {
        const f = findItem(id!);
        const ids = f.parent.items.map((i) => i.id);
        const siblings = f.parent.items.filter(
          (i) => i.categoryId === f.item.categoryId,
        );
        const siblingIndex = siblings.findIndex((i) => i.id === id);
        const adjacent =
          siblings[
            siblingIndex + (target.dataset.action === "up-item" ? -1 : 1)
          ];
        if (!adjacent) return;
        const index = ids.indexOf(id!);
        const next = ids.indexOf(adjacent.id);
        [ids[index], ids[next]] = [ids[next]!, ids[index]!];
        await command("item.reorder", {
          [f.isTemplate ? "templateId" : "paycheckId"]: f.parent.id,
          itemIds: ids,
        });
        break;
      }
      case "new-category":
        categoryForm();
        break;
      case "edit-category":
        categoryForm(state.categories.find((c) => c.id === id));
        break;
      case "new-template":
        templateForm();
        break;
      case "edit-template":
        templateForm(state.templates.find((t) => t.id === id));
        break;
    }
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function change(event: Event) {
  const el = event.target as HTMLInputElement;
  try {
    if (el.id === "month") {
      if (el.value) {
        month = el.value;
        await refresh();
      }
      return;
    }
    if (el.dataset.income) {
      await command("paycheck.update", {
        id: el.dataset.income,
        income: decimal(parseMoney(el.value)),
      });
      toast("Income updated");
      return;
    }
    if (el.dataset.field) {
      const row = el.closest<HTMLTableRowElement>("[data-item]")!,
        key = el.dataset.field;
      await command("item.update", {
        id: row.dataset.item,
        [key]:
          key === "amount"
            ? decimal(parseMoney(el.value))
            : el.value ||
              (key === "categoryId" || key === "dueDate" ? null : ""),
      });
      toast("Item updated");
    }
  } catch (e) {
    toast((e as Error).message, true);
    el.setAttribute("aria-invalid", "true");
  } finally {
    // Editing is paused while the request is in flight. Return to the edited cell
    // after repainting, and keep an invalid value visible so it can be corrected.
    if (!needsRefresh && !dialog.open) {
      const itemId =
        el.closest<HTMLTableRowElement>("[data-item]")?.dataset.item;
      const selector = el.dataset.income
        ? `[data-income="${el.dataset.income}"]`
        : itemId && el.dataset.field
          ? `[data-item="${itemId}"] [data-field="${el.dataset.field}"]`
          : undefined;
      if (selector) root.querySelector<HTMLInputElement>(selector)?.focus();
    }
  }
}
if (token) {
  root.innerHTML = '<div class="loading">Opening your planner…</div>';
  refresh().catch((e) => login((e as Error).message));
} else login();

// Keep decimal editing natural, but format only after strict full-string validation.
document.addEventListener("focusin", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.inputMode !== "decimal")
    return;
  try {
    input.value = decimal(parseMoney(input.value));
  } catch {
    /* Keep invalid drafts intact. */
  }
});
document.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.inputMode !== "decimal")
    return;
  input.setCustomValidity("");
  input.removeAttribute("aria-invalid");
});
document.addEventListener("focusout", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.inputMode !== "decimal")
    return;
  const formatted = formatMoneyInput(input.value);
  input.value = formatted.value;
  input.setCustomValidity(formatted.error || "");
  if (formatted.error) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
});
