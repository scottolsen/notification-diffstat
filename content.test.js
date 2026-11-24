// Run with: npm test
// Loads diffstat.js and content.js unchanged into jsdom with a stub
// chrome.runtime. The stub reports +<PR number> additions, so each badge
// shows which PR it was made for, the reviewers from the merge box data in
// `boxes`, parsed by reviewers.js as the background worker does, and the
// author and comment count in `details`, where null stands for a lookup
// that failed.
const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const { JSDOM } = require("jsdom")

const Reviewers = require("./reviewers.js")

const SOURCE = ["diffstat.js", "content.js"].map((f) => fs.readFileSync(`${__dirname}/${f}`, "utf8")).join("\n")

function load(url, html, boxes = {}, details = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true })
  const { window } = dom
  const asked = []
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "requested") return { ok: true, result: [] }
        if (msg.type === "reviewers") return { ok: true, result: Reviewers.parse(boxes[msg.path] ?? mergeBox()) }
        if (msg.type === "details") return detailsResponse(details[msg.path])
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

function detailsResponse(found = { author: "octo", comments: 0 }) {
  return found ? { ok: true, result: found } : { ok: false, error: "HTTP 500" }
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

// Markup from github.com/notifications, trimmed: "owner/repo #123" sits in
// its own wrapper, with the PR title after it.
function notificationRow(number) {
  return `<li class="notifications-list-item"><a href="/acme/widgets/pull/${number}">
    <div class="d-flex"><p class="m-0 f6 flex-auto">acme/widgets <span>#${number}</span></p></div>
    <p class="markdown-title m-0">Make widgets faster</p></a></li>`
}

const list = (...rows) => `<ul>${rows.join("")}</ul>`

// Trimmed from a PR's /page_data/merge_box JSON (November 11, 2026).
const REVIEW_STATES = { approved: "APPROVED", "changes-requested": "CHANGES_REQUESTED", commented: "COMMENTED" }

const reviewerRow = (login, state) => ({ login, state })

function mergeBox(...rows) {
  return {
    pullRequest: {
      state: "OPEN",
      latestOpinionatedReviews: rows
        .filter(({ state }) => state !== "pending")
        .map(({ login, state }) => ({ id: 1, author: { login, avatarUrl: "" }, state: REVIEW_STATES[state] })),
      pendingReviewRequests: rows
        .filter(({ state }) => state === "pending")
        .map(({ login }) => ({ reviewer: { login, avatarUrl: "", type: "USER" }, isCodeOwner: false }))
    }
  }
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
    "/acme/widgets/pull/12": mergeBox(
      reviewerRow("ana", "approved"),
      reviewerRow("bo", "changes-requested"),
      reviewerRow("cy", "commented"),
      reviewerRow("di", "pending")
    ),
    "/acme/widgets/pull/34": mergeBox(reviewerRow("ana", "pending"))
  })
  await page.settle()
  assert.deepStrictEqual(reviewerLines(page), [
    [
      "approved ana (ana approved these changes)",
      "changes-requested bo (bo requested changes)",
      "commented cy (cy left review comments)",
      "pending di (Awaiting requested review from di)"
    ],
    ["pending ana (Awaiting requested review from ana)"]
  ])
  const line = page.document.querySelector(".gh-reviewers")
  assert.strictEqual(line.previousElementSibling, page.document.querySelector(".description__mZjLFE"))
  assert.deepStrictEqual(
    [...line.querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-label")),
    ["ana approved these changes", "bo requested changes", "cy left review comments", "Awaiting requested review from di"]
  )
})

// The line is there from the first scan, at a fixed height, so rows don't
// grow one at a time as each PR's reviewers arrive.
test("every row has its reviewer line before any reviewers have loaded", () => {
  const pulls = load("https://github.com/pulls", list(pullsRow(12), pullsRow(34)))
  assert.deepStrictEqual(reviewerLines(pulls), [[], []])
  const notifications = load("https://github.com/notifications", list(notificationRow(7)))
  assert.deepStrictEqual(reviewerLines(notifications), [[]])
})

test("/pulls: a PR with no reviewers keeps an empty reviewer line", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), { "/acme/widgets/pull/12": mergeBox() })
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
  assert.deepStrictEqual(reviewerLines(page), [[]])
})

test("/pulls: a PR whose reviewers fail to load keeps an empty reviewer line", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)))
  const { sendMessage } = page.window.chrome.runtime
  page.window.chrome.runtime.sendMessage = async (msg) => (msg.type === "reviewers" ? { ok: false, error: "HTTP 500" } : sendMessage(msg))
  page.window.console.warn = () => {}
  page.document.querySelector("ul").insertAdjacentHTML("beforeend", pullsRow(34))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12", "+34"])
  assert.deepStrictEqual(reviewerLines(page)[1], [])
})

test("/pulls: a row whose reviewer line React drops gets it back", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {
    "/acme/widgets/pull/12": mergeBox(reviewerRow("ana", "approved"))
  })
  await page.settle()
  page.document.querySelector(".gh-reviewers").remove()
  page.document.querySelector(".inner__Rm1Enx").append(page.document.createElement("div"))
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+12"])
  assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved these changes)"]])
})

test("a reviewer line's tooltip lists every reviewer, for the ones clipped off the end", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {
    "/acme/widgets/pull/12": mergeBox(reviewerRow("ana", "approved"), reviewerRow("bo", "pending"))
  })
  await page.settle()
  assert.strictEqual(page.document.querySelector(".gh-reviewers").title, "ana approved these changes\nAwaiting requested review from bo")
})

test("every /pulls list gets reviewer lines", async () => {
  for (const url of ["https://github.com/pulls", "https://github.com/pulls/review-requested", "https://github.com/pulls/assigned"]) {
    const page = load(url, list(pullsRow(12)), { "/acme/widgets/pull/12": mergeBox(reviewerRow("ana", "approved")) })
    await page.settle()
    assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved these changes)"]], url)
  }
})

test("/notifications: each PR row gets a reviewer line under its title", async () => {
  const page = load("https://github.com/notifications", list(notificationRow(7)), {
    "/acme/widgets/pull/7": mergeBox(reviewerRow("ana", "approved"), reviewerRow("bo", "pending"))
  })
  await page.settle()
  assert.deepStrictEqual(page.badges(), ["+7"])
  assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved these changes)", "pending bo (Awaiting requested review from bo)"]])
  const line = page.document.querySelector(".gh-reviewers")
  assert.strictEqual(line.previousElementSibling, page.document.querySelector(".markdown-title"))
})

test("/pulls: a row decorated again keeps a single reviewer line", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {
    "/acme/widgets/pull/12": mergeBox(reviewerRow("ana", "approved"))
  })
  await page.settle()
  const span = page.document.querySelector(".description__mZjLFE > span:first-child")
  span.replaceWith(span.ownerDocument.createRange().createContextualFragment("<span><button>acme/widgets</button><span>#12</span></span>"))
  await page.settle()
  assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved these changes)"]])
})

const metas = (page) => [...page.document.querySelectorAll(".gh-pr-meta")].map((meta) => meta.textContent)

test("each row shows who opened the PR and its comment count, after the diffstat", async () => {
  const details = {
    "/acme/widgets/pull/12": { author: "ana", comments: 11 },
    "/acme/widgets/pull/34": { author: "bo", comments: 1 },
    "/acme/widgets/pull/7": { author: "cy", comments: 0 }
  }
  const pulls = load("https://github.com/pulls", list(pullsRow(12), pullsRow(34)), {}, details)
  await pulls.settle()
  assert.deepStrictEqual(metas(pulls), ["by ana · 11 comments", "by bo · 1 comment"])
  const meta = pulls.document.querySelector(".gh-pr-meta")
  assert.strictEqual(meta.previousElementSibling, pulls.document.querySelector(".gh-diffstat"))
  assert.deepStrictEqual(pulls.asked, ["/acme/widgets/pull/12", "/acme/widgets/pull/34"])

  const notifications = load("https://github.com/notifications", list(notificationRow(7)), {}, details)
  await notifications.settle()
  assert.deepStrictEqual(metas(notifications), ["by cy · 0 comments"])
  assert.strictEqual(notifications.document.querySelector("p.f6 .gh-pr-meta").previousElementSibling.className, "gh-diffstat")
})

test("a PR whose author and comment count fail to load keeps its badge and reviewers", async () => {
  const boxes = { "/acme/widgets/pull/12": mergeBox(reviewerRow("ana", "approved")) }
  const page = load("https://github.com/pulls", list(pullsRow(12)), boxes, { "/acme/widgets/pull/12": null })
  page.window.console.warn = () => {}
  await page.settle()
  assert.deepStrictEqual(metas(page), [""])
  assert.deepStrictEqual(page.badges(), ["+12"])
  assert.deepStrictEqual(reviewerLines(page), [["approved ana (ana approved these changes)"]])
})

test("a PR whose author GitHub doesn't name shows only its comment count", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {}, { "/acme/widgets/pull/12": { author: null, comments: 4 } })
  await page.settle()
  assert.deepStrictEqual(metas(page), ["4 comments"])
})

test("a row decorated again keeps a single author and comment count", async () => {
  const page = load("https://github.com/pulls", list(pullsRow(12)), {}, { "/acme/widgets/pull/12": { author: "ana", comments: 2 } })
  await page.settle()
  const span = page.document.querySelector(".description__mZjLFE > span:first-child")
  span.replaceWith(span.ownerDocument.createRange().createContextualFragment("<span><button>acme/widgets</button><span>#12</span></span>"))
  await page.settle()
  assert.deepStrictEqual(metas(page), ["by ana · 2 comments"])
  assert.deepStrictEqual(page.badges(), ["+12"])
})
