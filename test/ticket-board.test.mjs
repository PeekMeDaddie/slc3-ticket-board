import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const htmlPath = new URL("../index.html", import.meta.url);
const html = fs.readFileSync(htmlPath, "utf8");

function loadBoard() {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "inline script missing");
  const elements = new Map();
  function el() {
    return {
      hidden: false,
      textContent: "",
      className: "",
      disabled: false,
      innerHTML: "",
      addEventListener() {},
      querySelector() { return null; },
      appendChild() {},
      remove() {},
      setAttribute() {},
      click() {}
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, el());
      return elements.get(id);
    },
    querySelector() { return null; },
    createElement() { return el(); },
    body: el(),
    fonts: { ready: Promise.resolve() }
  };
  const context = {
    document,
    fetch: async function () {
      return { ok: true, text: async function () { return ""; } };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    Date,
    console
  };
  context.window = context;
  vm.runInNewContext(match[1], context, { filename: "index.html" });
  return context.window.ticketBoard;
}

const board = loadBoard();
const today = new Date(2026, 9, 26);

function ticketsFrom(rows) {
  return Array.from(board.rowsToTickets(rows, today));
}

function titles(rows) {
  return ticketsFrom(rows).map(function (t) { return t.title; });
}

test("sheet url reads all of columns A:F instead of a fixed header row", function () {
  assert.match(html, /range=A:F/);
  assert.doesNotMatch(html, /A12:F212/);
  assert.doesNotMatch(html, /range=A3:F/);
});

test("header on row 3 ignores the summary rows above it", function () {
  const rows = [
    ["21 SIM TICKETS", "", "●", "9 RME Fixes", "●", "12 Vendor Fixes"],
    ["", "Age (days open):", "■", "30 or less", "■", "31–59 days"],
    ["#", "Title", "Severity", "Created", "Days Open", "Type"],
    ["1", "First ticket", "5", "2026-08-17", "70", "Vendor"],
    ["2", "", "5", "2026-09-01", "1", "RME"],
    ["3", "Second ticket", "3", "2026-10-05", "21", "RME"]
  ];
  assert.equal(board.findHeaderRow(rows), 2);
  const tickets = ticketsFrom(rows);
  assert.deepEqual(titles(rows), ["First ticket", "Second ticket"]);
  assert.equal(tickets[0].severity, "5");
  assert.equal(tickets[0].type, "Vendor");
  assert.equal(tickets[0].daysOpen, 70);
  assert.equal(tickets[1].severity, "3");
  assert.equal(tickets[1].type, "RME");
  assert.equal(tickets[1].daysOpen, 21);
});

test("header still resolves after it moves further down the sheet", function () {
  const rows = [];
  for (let i = 0; i < 14; i++) {
    rows.push(["summary " + i, "not a ticket", "", "", "", ""]);
  }
  rows.push(["#", "Title", "Severity", "Created", "Days Open", "Type"]);
  rows.push(["9", "Lower ticket", "5", "2026-10-06", "20", "Vendor"]);
  rows.push(["10", "Bottom ticket", "4", "2026-10-20", "6", "RME"]);
  assert.equal(board.findHeaderRow(rows), 14);
  assert.deepEqual(titles(rows), ["Lower ticket", "Bottom ticket"]);
});

test("frozen-row CSV header is the label line, not a ticket", function () {
  const csv = [
    '"21 SIM TICKETS #","Age (days open): Title","● ■ Severity","9 RME Fixes 30 or less Created","● ■ Days Open","12 Vendor Fixes 31–59 days Type"',
    '"1","PROJECT Wellness Center Aesthetic Changes","5","2026-08-17","70","Vendor"',
    '"2","PROJECT ""AMAZON"" LED Sign the Letter ""M"" is faded, at night looks like ""Aazon""","5","2026-09-14","42","Vendor"',
    '"8","SLC3 - Repaint Guard Shack Railing","3","2026-10-05","21","Vendor"',
    '"21","Bustied wire in the racking","5","2026-10-25","1","RME"'
  ].join("\n");
  const rows = board.parseCSV(csv);
  assert.equal(board.findHeaderRow(rows), 0);
  const tickets = ticketsFrom(rows);
  assert.deepEqual(tickets.map(function (t) { return t.title; }), [
    "PROJECT Wellness Center Aesthetic Changes",
    "PROJECT \"AMAZON\" LED Sign the Letter \"M\" is faded, at night looks like \"Aazon\"",
    "SLC3 - Repaint Guard Shack Railing",
    "Bustied wire in the racking"
  ]);
  assert.equal(tickets[2].severity, "3");
  assert.equal(tickets[2].type, "Vendor");
  assert.equal(tickets[2].daysOpen, 21);
  assert.equal(tickets[3].type, "RME");
  assert.equal(tickets[3].daysOpen, 1);
});

test("a header at the first row and a headerless slice both still parse", function () {
  const headed = [
    ["#", "Title", "Severity", "Created", "Days Open", "Type"],
    ["1", "Classic", "5", "2026-10-02", "1", "Vendor"]
  ];
  const headless = [
    ["1", "Plain", "5", "2026-10-01", "1", "RME"]
  ];
  assert.deepEqual(titles(headed), ["Classic"]);
  assert.deepEqual(titles(headless), ["Plain"]);
  assert.equal(board.rowsToTickets(headless, today)[0].type, "RME");
});

test("a repeated header row in the body is not a ticket", function () {
  const rows = [
    ["#", "Title", "Severity", "Created", "Days Open", "Type"],
    ["1", "Keep", "5", "2026-10-02", "1", "RME"],
    ["#", "Title", "Severity", "Created", "Days Open", "Type"],
    ["2", "Also", "5", "2026-10-03", "1", "Vendor"]
  ];
  assert.deepEqual(titles(rows), ["Keep", "Also"]);
});

test("Type stays the RME/Vendor column when Ticket Type is also present", function () {
  const rows = [
    ["#", "Title", "Severity", "Created", "Days Open", "Type", "Ticket Type"],
    ["1", "Pole wrap", "5", "2026-10-21", "5", "RME", "Project"]
  ];
  const tickets = ticketsFrom(rows);
  assert.equal(tickets[0].type, "RME");
  assert.equal(tickets[0].severity, "5");
});

test("quoted titles with commas survive the CSV parser", function () {
  const csv = '"#","Title","Severity","Created","Days Open","Type"\r\n"1","Say ""hi"", friend","5","2026-10-01","1","RME"\r\n';
  const tickets = ticketsFrom(board.parseCSV(csv));
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].title, "Say \"hi\", friend");
});

test("oldest created date sorts first and blank titles are skipped", function () {
  const rows = [
    ["#", "Title", "Severity", "Created", "Days Open", "Type"],
    ["1", "Newer", "5", "2026-10-20", "6", "Vendor"],
    ["2", "   ", "5", "2026-08-01", "1", "RME"],
    ["3", "Older", "4", "2026-09-01", "55", "RME"]
  ];
  const tickets = ticketsFrom(rows);
  assert.deepEqual(tickets.map(function (t) { return t.title; }), ["Older", "Newer"]);
  assert.equal(tickets[0].daysOpen, 55);
});
