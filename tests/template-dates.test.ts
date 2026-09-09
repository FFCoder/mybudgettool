import {expect, test} from "bun:test";
import {command, emptyBudget, monthlyDueDate, state} from "../src/shared/domain";

test("monthly due days clamp by calendar month including leap years and year boundaries", () => {
  for (const [payday, day, expected] of [
    ["2026-12-01", 31, "2026-12-31"],
    ["2027-01-15", 1, "2027-01-01"],
    ["2027-02-15", 31, "2027-02-28"],
    ["2028-02-15", 31, "2028-02-29"],
    ["2100-02-01", 29, "2100-02-28"],
    ["2000-02-01", 29, "2000-02-29"],
    ["2026-04-30", 31, "2026-04-30"],
  ] as const) expect(monthlyDueDate(payday, day)).toBe(expected);
  for (const day of [0, 32, -1, 1.5, NaN]) expect(() => monthlyDueDate("2026-01-01", day)).toThrow();
});

test("template dates resolve independently, retain legacy dates, and moves retain concrete dates", () => {
  const b = emptyBudget();
  const run = (op:string, input:object):any => command(b, op, input);
  const template = run("template.create", {name: "Monthly"});
  const recurring = run("item.create", {templateId:template.id, name:"Car", amount:"50", monthlyDueDay:31, dueDate:"2025-12-15"});
  run("item.create", {templateId:template.id, name:"Legacy", amount:"1", dueDate:"2025-12-20"});
  run("item.create", {templateId:template.id, name:"Unset", amount:"1"});
  const first = run("paycheck.create", {date:"2027-02-15", templateId:template.id});
  expect(first.items.map((i:any)=>i.dueDate)).toEqual(["2027-02-28", "2025-12-20", null]);
  expect(first.items[0].monthlyDueDay).toBeNull();
  expect(recurring.dueDate).toBe("2025-12-15");
  run("item.update", {id:recurring.id, monthlyDueDay:15});
  const second = run("paycheck.create", {date:"2028-01-01", templateId:template.id});
  expect(second.items[0].dueDate).toBe("2028-01-15");
  expect(first.items[0].dueDate).toBe("2027-02-28");
  run("item.update", {id:first.items[0].id, dueDate:"2027-03-03"});
  run("item.move", {id:first.items[0].id, paycheckId:second.id});
  expect(state(b).paychecks[1]!.items.at(-1)!.dueDate).toBe("2027-03-03");
  run("item.update", {id:recurring.id, monthlyDueDay:null});
  expect(run("paycheck.create", {date:"2028-03-01", templateId:template.id}).items[0].dueDate).toBe("2025-12-15");
  for (const bad of [0, 32, -1, 1.5, "15", "", true])
    expect(() => run("item.update", {id:recurring.id, monthlyDueDay:bad})).toThrow();
  expect(() => run("item.update", {id:second.items[0].id, monthlyDueDay:15})).toThrow();
});
