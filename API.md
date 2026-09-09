# API contract
All `/api/*` endpoints require `Authorization: Bearer $API_TOKEN`. JSON response errors: `{error:{code,message}}`. GET `/api/state?month=YYYY-MM` returns `{month,months,settings,categories,templates,paychecks}`; omitted month returns all paychecks. POST `/api/commands` body `{operation,input}` requires `Idempotency-Key` UUID/string; same key + same body replays response; changed body conflicts. Returns `{result}`. IDs UUID strings. Money input `amount`/`income`/`defaultIncome` strings accepting an optional leading dollar sign, standard thousands grouping, and surrounding whitespace (for example `$3,200.00`; no more than 2 fraction digits); output `amountCents`/`incomeCents`/`defaultIncomeCents`, integer cents. Dates strict YYYY-MM-DD; months YYYY-MM. Timestamps ISO.

Entities: settings `{defaultIncomeCents:number}`; category `{id,name,createdAt,updatedAt}`; item `{id,name,amountCents,categoryId:null|string,dueDate:null|string,monthlyDueDay?:number|null,notes,externalRefs:[{system,id}],position,createdAt,updatedAt}`; paycheck `{id,date,incomeCents,notes,items,totalCents,remainingCents,categoryTotals:[{categoryId,totalCents}],createdAt,updatedAt}`; template `{id,name,items,createdAt,updatedAt}`. State always includes settings, all categories and templates. No carryover.

Operations (input fields; optional indicated ?):
- `settings.update` defaultIncome (decimal string per paycheck). Returns settings.
- `category.create` name; `category.update` id,name; `category.delete` id (items become uncategorized).
- `paycheck.create` date,income?,notes?,templateId?; `paycheck.update` id,date?,income?,notes?; `paycheck.delete` id.
- `template.create` name,paycheckId? (copy items); `template.update` id,name?; `template.delete` id.
- `item.create` paycheckId OR templateId, name,amount,categoryId?,dueDate?,monthlyDueDay?,notes?,externalRefs?,position?.
- `item.update` id, name?,amount?,categoryId?,dueDate?,monthlyDueDay?,notes?,externalRefs?,position? (finds item in either paycheck/template).
- `item.delete` id.
- `item.move` id,paycheckId OR templateId,position? (cross paycheck/template or same parent; preserves item identity).
- `item.reorder` paycheckId OR templateId,itemIds (complete ordered list).
Mutation result is affected entity; delete returns `{id,deleted:true}`; reorder returns parent. UI refreshes GET state after mutations.

Omitting `income` on `paycheck.create` uses the persisted default income per paycheck, initially zero. An explicit `"0"` overrides the default. Updating the default affects future paycheck creation only; existing paychecks retain their income. The default is a per-paycheck amount, not an annual or monthly income. Template instantiation follows the same rule.

Template items accept `monthlyDueDay` as an integer from 1 through 31, or `null` to clear the recurrence. On `paycheck.create` from a template, the day resolves within the paycheck date’s month, clamped to that month’s last day (for example, day 31 becomes February 28 in 2027). The copied item has a concrete `dueDate` and `monthlyDueDay:null`; the template remains unchanged. A monthly day takes precedence over a template’s existing explicit `dueDate`. Clearing or omitting the monthly day preserves and uses any explicit legacy due date; it does not discard that date. Moving a recurring template item into a paycheck also resolves its monthly day in the destination paycheck’s month and clears recurrence. Moving concrete paycheck items retains their explicit due dates.
