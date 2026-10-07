// Run with: npm test
// Loads diffstat.js and content.js unchanged into jsdom with a stub
// chrome.runtime. The stub reports +<PR number> additions, so each badge
// shows which PR it was made for.
const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const { JSDOM } = require("jsdom")

const SOURCE = ["diffstat.js", "content.js"].map((f) => fs.readFileSync(`${__dirname}/${f}`, "utf8")).join("\n")

function load(url, html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true })
  const { window } = dom
  const asked = []
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "requested") return { ok: true, result: [] }
        asked.push(msg.path)
        return { ok: true, result: { additions: Number(msg.path.split("/").pop()), deletions: 0 } }
      }
    }
  }
  window.eval(SOURCE)
  const settle = () => new Promise((resolve) => window.setTimeout(resolve, 50))
  const badges = (root = window.document) =>
    [...root.querySelectorAll(".gh-diffstat")].map((b) => b.querySelector(".gh-diffstat__add")?.textContent ?? b.textContent)
  return { window, document: window.document, asked, settle, badges }
}

// Markup from github.com/pulls (October 2026), with the hashed suffixes of the
// CSS-module class names shortened.
function pullsRow(number, { title = number, extra = "", tag = "li" } = {}) {
  return `
    <${tag} class="ListItem-module__row PullsListItem-module__row" ${tag === "li" ? "" : 'role="listitem"'}>
      ${extra}
      <div class="Title-module__container"><h3 class="Title-module__heading">
        <a class="Title-module__link" href="https://github.com/acme/widgets/pull/${title}">Make widgets faster</a>
      </h3></div>
      <div class="MainContent-module__inner"><div class="Description-module__description PullsListItem-module__description">
        <span><button>acme/widgets</button><span>#${title}</span></span>
        <span><span>·</span> opened yesterday</span>
      </div></div>
    </${tag}>`
}

// Markup from github.com/notifications.
function notificationRow(number) {
  return `<li class="notifications-list-item"><a href="/acme/widgets/pull/${number}"><p class="f6">acme/widgets #${number}</p></a></li>`
}

const list = (...rows) => `<ul>${rows.join("")}</ul>`

test("/pulls: each row gets one badge for its PR, after owner/repo #number", async () => {
  const page = load("https://github.com/pulls/review-requested", list(pullsRow(12), pullsRow(34)))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12", "+34"])
  for (const span of page.document.querySelectorAll('[class*="Description-module"] > span:first-child')) {
    assert.strictEqual(span.querySelectorAll(".gh-diffstat").length, 1)
  }
})

test("/notifications: each row gets one badge inside the repo line", async () => {
  const page = load("https://github.com/notifications", list(notificationRow(7)))
  await page.settle()
  assert.deepStrictEqual(page.badges(page.document.querySelector("p.f6")), ["+7"])
})

test("rows added after load are decorated", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  await page.settle()
  page.document.querySelector("ul").insertAdjacentHTML("beforeend", pullsRow(34))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12", "+34"])
})

test("pages outside /notifications and /pulls are left alone", async () => {
  const page = load("https://github.com/acme/widgets/pulls", list(pullsRow(12), notificationRow(7)))
  await page.settle()
  assert.deepStrictEqual(page.badges(), [])
  assert.deepStrictEqual(page.asked, [])
})

// Review finding 2.
test("an owner whose name starts with pulls or notifications doesn't match", async () => {
  for (const url of ["https://github.com/pullsbot/widgets/pulls", "https://github.com/notificationsbot/widgets/pulls"]) {
    const page = load(url, list(pullsRow(12), notificationRow(7)))
    await page.settle()
    assert.deepStrictEqual(page.badges(), [], url)
    assert.deepStrictEqual(page.asked, [], url)
  }
})

// Review finding 1. GitHub keys /pulls rows by PR today (checked in Chrome
// by switching lists), so these guard against a change in that, not a
// current bug.
test("a row React reuses for another PR shows that PR's diffstat", { todo: "the done marker is on the li, not tied to the PR" }, async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  await page.settle()
  page.document.querySelector("a").setAttribute("href", "https://github.com/acme/widgets/pull/34")
  page.document.querySelector('[class*="Description-module"] > span:first-child > span').textContent = "#34"
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+34"])
})

test("a row whose badge span React re-renders gets a badge again", { todo: "the li stays marked done" }, async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  await page.settle()
  const span = page.document.querySelector('[class*="Description-module"] > span:first-child')
  span.replaceWith(span.ownerDocument.createRange().createContextualFragment("<span><button>acme/widgets</button><span>#12</span></span>"))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

// Review finding 3.
test("the badge uses the row's title PR, not the first PR link in the row", { todo: "scan() takes the first /pull/ link it reaches" }, async () => {
  const linked = `<a href="https://github.com/acme/widgets/pull/99">linked: #99</a>`
  const page = load("https://github.com/pulls", list(pullsRow(12, { extra: linked })))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

// Review finding 4.
test("a row with no badge anchor isn't re-queried on every mutation", { todo: "rows without an anchor are never marked" }, async () => {
  const page = load("https://github.com/pulls", list(`<li><a href="https://github.com/acme/widgets/pull/12">No description</a></li>`))
  const { Element } = page.window
  const querySelector = Element.prototype.querySelector
  let lookups = 0
  Element.prototype.querySelector = function (selector) {
    if (selector.includes("Description-module")) lookups++
    return querySelector.call(this, selector)
  }
  for (let i = 0; i < 5; i++) {
    page.document.body.append(page.document.createElement("div"))
    await page.settle()
  }
  assert.ok(lookups <= 1, `queried ${lookups} times`)
})

// Review finding 5.
test("another *Description-module* element earlier in the row doesn't take the badge", { todo: "the anchor selector matches any class containing Description-module" }, async () => {
  const decoy = `<div class="TitleDescription-module__summary"><span>Draft</span></div>`
  const page = load("https://github.com/pulls", list(pullsRow(12, { extra: decoy })))
  await page.settle()
  assert.deepStrictEqual(page.badges(page.document.querySelector(".TitleDescription-module__summary")), [])
  assert.deepStrictEqual(page.badges(page.document.querySelector(".Description-module__description")), ["+12"])
})

// Review finding 6.
test("rows rendered as div[role=listitem] are decorated", { todo: "scan() requires an li" }, async () => {
  const page = load("https://github.com/pulls", `<div role="list">${pullsRow(12, { tag: "div" })}</div>`)
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

test("a PR link inside a nested li still decorates its row", { todo: "closest('li') finds the inner li" }, async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12).replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/, "<h3$1><ul><li>$2</li></ul></h3>")))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})
