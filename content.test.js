// Run with: npm test
// Loads diffstat.js and content.js unchanged into jsdom with a stub
// chrome.runtime. The stub reports +<PR number> additions, so each badge
// shows which PR it was made for, and the reviewers sidebar in `sidebars`.
const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const { JSDOM } = require("jsdom")

const SOURCE = ["diffstat.js", "reviewers.js", "content.js"].map((f) => fs.readFileSync(`${__dirname}/${f}`, "utf8")).join("\n")

function load(url, html, sidebars = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true })
  const { window } = dom
  const asked = []
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "requested") return { ok: true, result: [] }
        if (msg.type === "reviewers") return { ok: true, result: sidebars[msg.path] ?? sidebar() }
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

// Markup from github.com/pulls (October 13, 2026). GitHub hashes these class
// names and renames them, so content.js mustn't depend on them.
function pullsRow(number, { title = number, heading = "Make widgets faster", extra = "", tag = "li" } = {}) {
  return `
    <${tag} class="listItem__X41oTe" ${tag === "li" ? "" : 'role="listitem"'}>
      ${extra}
      <div class="container__mDVuhO"><h3 class="heading__fzQskI">
        <a class="anchor__PSAOdR" href="https://github.com/acme/widgets/pull/${title}">${heading}</a>
      </h3></div>
      <div class="inner__Rm1Enx"><div class="container__W45oI6 description__mZjLFE">
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

// Markup from a PR page's Reviewers sidebar (October 21, 2026), trimmed.
const STATE_ICONS = {
  approved: '<svg class="octicon octicon-check color-fg-success"></svg>',
  "changes-requested": '<svg class="octicon octicon-file-diff color-fg-danger"></svg>',
  commented: '<svg class="octicon octicon-comment color-fg-muted"></svg>'
}

function reviewerRow(login, state) {
  const person = `<span class="d-flex min-width-0 flex-1" data-hovercard-type="user" data-assignee-name="${login}"><a class="assignee Link--primary"><span>${login}</span></a></span>`
  if (state === "pending") {
    return `<div class="d-flex flex-items-center mb-2">${person}
      <button class="btn-link flex-order-2" aria-label="Awaiting requested review from ${login}"><span class="reviewers-status-icon"><svg class="octicon octicon-dot-fill hx_dot-fill-pending-icon"></svg></span></button>
      <tool-tip>Awaiting requested review from ${login}</tool-tip></div>`
  }
  return `<div class="d-flex flex-items-center mb-2">${person}
    <a class="flex-order-1" id="review-status-${login}">${STATE_ICONS[state]}</a>
    <tool-tip for="review-status-${login}">${login} ${state}</tool-tip>
    <button class="mr-2 btn-link muted-icon" type="submit"><span class="reviewers-status-icon"><svg class="octicon octicon-sync"></svg></span></button>
    <tool-tip>Re-request review</tool-tip></div>`
}

function sidebar(...rows) {
  const picker = `<details><div data-hovercard-type="user" data-assignee-name="suggested">suggested</div></details>`
  return `<form class="js-issue-sidebar-form" aria-label="Select reviewers">${picker}<span class="css-truncate">${rows.join("")}
    <p class="mt-2">At least 1 approving review is required to merge this pull request.</p></span></form>`
}

const reviewerLines = (page) =>
  [...page.document.querySelectorAll(".gh-reviewers")].map((line) =>
    [...line.children].map((r) => `${r.className.split("--").pop()} ${r.textContent} (${r.title})`)
  )

test("/pulls: each row gets one badge for its PR, after owner/repo #number", async () => {
  const page = load("https://github.com/pulls/review-requested", list(pullsRow(12), pullsRow(34)))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12", "+34"])
  for (const span of page.document.querySelectorAll(".description__mZjLFE > span:first-child")) {
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

test("a row whose description renders after its title is decorated", async () => {
  const [, before, description, after] = pullsRow(12).match(/^([\s\S]*)(<div class="container__W45oI6[\s\S]*?<\/div>)([\s\S]*)$/)
  const page = load("https://github.com/pulls", list(before + after))
  await page.settle()
  assert.deepStrictEqual(page.badges(), [])
  page.document.querySelector(".inner__Rm1Enx").insertAdjacentHTML("beforeend", description)
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
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
test("a row React reuses for another PR shows that PR's diffstat", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  await page.settle()
  page.document.querySelector("a").setAttribute("href", "https://github.com/acme/widgets/pull/34")
  page.document.querySelector(".description__mZjLFE > span:first-child > span").textContent = "#34"
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+34"])
})

test("a row whose badge span React re-renders gets a badge again", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  await page.settle()
  const span = page.document.querySelector(".description__mZjLFE > span:first-child")
  span.replaceWith(span.ownerDocument.createRange().createContextualFragment("<span><button>acme/widgets</button><span>#12</span></span>"))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

// Review finding 3.
test("the badge uses the row's title PR, not the first PR link in the row", async () => {
  const linked = `<a href="https://github.com/acme/widgets/pull/99">linked: #99</a>`
  const page = load("https://github.com/pulls", list(pullsRow(12, { extra: linked })))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

// Review finding 4.
test("a row with no badge anchor isn't re-queried on every mutation", async () => {
  const page = load("https://github.com/pulls", list(`<li><h3><a href="https://github.com/acme/widgets/pull/12">No description</a></h3></li>`))
  const { Element } = page.window
  const querySelectorAll = Element.prototype.querySelectorAll
  let lookups = 0
  Element.prototype.querySelectorAll = function (selector) {
    if (selector === "span") lookups++
    return querySelectorAll.call(this, selector)
  }
  for (let i = 0; i < 5; i++) {
    page.document.body.append(page.document.createElement("div"))
    await page.settle()
  }
  assert.ok(lookups <= 1, `queried ${lookups} times`)
})

// Review finding 5.
test("another span earlier in the row doesn't take the badge", async () => {
  const decoy = `<div class="summary__Q1w2E3"><span>Draft</span></div>`
  const page = load("https://github.com/pulls", list(pullsRow(12, { extra: decoy })))
  await page.settle()
  assert.deepStrictEqual(page.badges(page.document.querySelector(".summary__Q1w2E3")), [])
  assert.deepStrictEqual(page.badges(page.document.querySelector(".description__mZjLFE")), ["+12"])
})

test("a title that mentions its own PR number doesn't take the badge", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12, { heading: "<span>#12</span> follow-up" })))
  await page.settle()
  assert.deepStrictEqual(page.badges(page.document.querySelector("h3")), [])
  assert.deepStrictEqual(page.badges(page.document.querySelector(".description__mZjLFE")), ["+12"])
})

test("the old Description-module class names still work", async () => {
  const old = pullsRow(12).replace("container__W45oI6 description__mZjLFE", "Description-module__description__AbC12")
  const page = load("https://github.com/pulls", list(old))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

// Review finding 6.
test("rows rendered as div[role=listitem] are decorated", async () => {
  const page = load("https://github.com/pulls", `<div role="list">${pullsRow(12, { tag: "div" })}</div>`)
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

test("a PR link inside a nested li still decorates its row", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12).replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/, "<h3$1><ul><li>$2</li></ul></h3>")))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

test("a row with no anchor doesn't borrow another row's from an enclosing list item", async () => {
  const bare = `<li><h3><a href="https://github.com/acme/widgets/pull/34">No description</a></h3></li>`
  const page = load("https://github.com/pulls", `<ul><li>${list(pullsRow(12), bare)}</li></ul>`)
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
})

test("/pulls: each row gets a line with every reviewer and their review state", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12), pullsRow(34)), {
    "/acme/widgets/pull/12": sidebar(
      reviewerRow("ana", "approved"),
      reviewerRow("bo", "changes-requested"),
      reviewerRow("cy", "commented"),
      reviewerRow("di", "pending")
    ),
    "/acme/widgets/pull/34": sidebar(reviewerRow("ana", "pending"))
  })
  await page.settle()
  assert.deepStrictEqual(reviewerLines(page), [
    [
      "approved ana (ana approved)",
      "changes-requested bo (bo changes-requested)",
      "commented cy (cy commented)",
      "pending di (Awaiting requested review from di)"
    ],
    ["pending ana (Awaiting requested review from ana)"]
  ])
  const line = page.document.querySelector(".gh-reviewers")
  assert.strictEqual(line.previousElementSibling, page.document.querySelector(".description__mZjLFE"))
  assert.deepStrictEqual(
    [...line.querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-label")),
    ["ana approved", "bo changes-requested", "cy commented", "Awaiting requested review from di"]
  )
})

test("/pulls: a PR with no reviewers gets no reviewer line", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), { "/acme/widgets/pull/12": sidebar() })
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
  assert.deepStrictEqual(reviewerLines(page), [])
})

test("every /pulls list gets reviewer lines", async () => {
  for (const url of ["https://github.com/pulls", "https://github.com/pulls/review-requested", "https://github.com/pulls/assigned"]) {
    const page = load(url, list(pullsRow(12)), { "/acme/widgets/pull/12": sidebar(reviewerRow("ana", "approved")) })
    await page.settle()
    assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved)"]], url)
  }
})

test("/notifications rows don't get reviewer lines", async () => {
  const page = load("https://github.com/notifications", list(notificationRow(7)), {
    "/acme/widgets/pull/7": sidebar(reviewerRow("ana", "approved"))
  })
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+7"])
  assert.deepStrictEqual(reviewerLines(page), [])
})

test("/pulls: a row decorated again keeps a single reviewer line", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {
    "/acme/widgets/pull/12": sidebar(reviewerRow("ana", "approved"))
  })
  await page.settle()
  const span = page.document.querySelector(".description__mZjLFE > span:first-child")
  span.replaceWith(span.ownerDocument.createRange().createContextualFragment("<span><button>acme/widgets</button><span>#12</span></span>"))
  await page.settle()
  assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved)"]])
})
