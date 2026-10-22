const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+/
const DONE = "data-gh-diffstat"
const ROW = 'li, [role="listitem"]'
const OURS = ".gh-diffstat, .gh-reviewers"

// On each page: the link that names the row's PR, and where the badge goes,
// right after "owner/repo #123". On /pulls a row can link to other PRs too,
// so only the title link counts. Rows on both pages also get a line listing
// their reviewers, placed after the element `reviewersAfter` returns: the PR
// title on /notifications, the "owner/repo #123" line on /pulls.
const PAGES = [
  {
    prefix: "/notifications",
    link: 'a[href*="/pull/"]',
    anchor: (link) => link.querySelector("p.f6"),
    reviewersAfter: (anchor) => anchor.closest("a")?.querySelector(".markdown-title") ?? anchor.parentElement
  },
  {
    prefix: "/pulls",
    link: 'h3 a[href*="/pull/"]',
    anchor: prNumberLine,
    reviewersAfter: (anchor) => anchor.parentElement
  }
]

// 16px octicons, as GitHub's PR sidebar shows them for each review state.
const ICONS = {
  approved: "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z",
  "changes-requested": "M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z",
  commented: "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
  pending: "M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
}

// The span in a /pulls row's description that holds "owner/repo #123".
// GitHub renames its hashed CSS classes (Description-module__description__AbC12
// became description__mZjLFE), so find it by the "#123" text instead, outside
// the title so a PR title mentioning its own number doesn't count.
function prNumberLine(link, row) {
  const number = `#${prPath(link)?.split("/").pop()}`
  for (const span of row.querySelectorAll("span")) {
    if (span.textContent.trim() === number && !span.closest("h3")) return span.parentElement
  }
  return null
}

// "/pulls" and "/pulls/review-requested", but not "/pullsbot/widgets/pulls".
function currentPage() {
  const path = location.pathname
  return PAGES.find(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
}

// Decorates the PR rows in `scope`, which is the document or part of it.
function scan(scope) {
  const page = currentPage()
  if (!page) return
  const links = [...scope.querySelectorAll(page.link)]
  if (scope.matches?.(page.link)) links.push(scope)
  for (const link of links) {
    const path = prPath(link)
    const found = path && locate(page, link)
    if (!found) continue
    // React can reuse a row for another PR, or re-render the part holding
    // the badge, so a row is done only while its badge is there for its PR.
    const { row, anchor } = found
    if (row.getAttribute(DONE) === path && anchor.querySelector(".gh-diffstat")) continue
    for (const stale of row.querySelectorAll(OURS)) stale.remove()
    row.setAttribute(DONE, path)
    decorate(page, anchor, path)
  }
}

// The list item for `link`'s PR and where its badge goes. Starts at the
// nearest list item and moves out, so a link inside a nested list still
// finds its row, but stops at an item holding more than one PR, which is a
// whole list rather than a row.
function locate(page, link) {
  for (let row = link.closest(ROW); row; row = row.parentElement?.closest(ROW)) {
    if (row.querySelectorAll(page.link).length > 1) return null
    const anchor = page.anchor(link, row)
    if (anchor) return { row, anchor }
  }
  return null
}

function prPath(link) {
  const url = new URL(link.getAttribute("href"), location.origin)
  if (url.origin !== location.origin) return null
  return url.pathname.match(PR_PATH)?.[0] ?? null
}

async function decorate(page, anchor, path) {
  const badge = document.createElement("span")
  badge.className = "gh-diffstat gh-diffstat--loading"
  badge.textContent = "…"
  anchor.append(badge)
  showReviewers(page.reviewersAfter(anchor), badge, path)

  const [res, requested] = await Promise.all([ask({ type: "diffstat", path }), requestedPaths()])
  if (res.ok) render(badge, res.result)
  else fail(badge, res.error)
  if (requested.includes(path.toLowerCase())) badge.append(star())
}

async function ask(msg) {
  return (await chrome.runtime.sendMessage(msg)) ?? { ok: false, error: "no response" }
}

// One search per page view, shared by every row on it.
let requested = { href: null, paths: null }

function requestedPaths() {
  if (requested.href !== location.href) {
    requested = { href: location.href, paths: loadRequested() }
  }
  return requested.paths
}

async function loadRequested() {
  const res = await ask({ type: "requested" })
  if (res.ok) return res.result
  console.warn("notification-diffstat: couldn't load your review requests:", res.error)
  return []
}

// Adds a line after `after` with each reviewer's state. The
// badge stands for this decoration of the row: once a rescan has removed
// it, the line belongs to a row that's been decorated again.
async function showReviewers(after, badge, path) {
  const res = await ask({ type: "reviewers", path })
  if (!res.ok) return console.warn(`notification-diffstat: couldn't load reviewers for ${path}:`, res.error)
  const reviewers = Reviewers.parse(new DOMParser().parseFromString(res.result, "text/html"))
  if (reviewers.length === 0 || !badge.isConnected) return
  const line = document.createElement("div")
  line.className = "gh-reviewers"
  line.append(...reviewers.map(reviewer))
  after.after(line)
}

function reviewer({ login, state, label }) {
  const el = span(`gh-reviewers__reviewer gh-reviewers__reviewer--${state}`)
  el.title = label
  el.append(icon(state, label), login)
  return el
}

function icon(state, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "gh-reviewers__icon")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("width", "16")
  svg.setAttribute("height", "16")
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", label)
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", ICONS[state] ?? ICONS.pending)
  svg.append(path)
  return svg
}

function star() {
  const el = span("gh-diffstat__star", "★")
  el.title = "Review requested from you by name"
  return el
}

function render(badge, stats) {
  const { added, deleted, neutral } = Diffstat.blocks(stats)
  badge.className = "gh-diffstat"
  badge.title = `${stats.additions} additions, ${stats.deletions} deletions`
  badge.replaceChildren(
    span("gh-diffstat__add", `+${stats.additions}`),
    span("gh-diffstat__del", `−${stats.deletions}`),
    ...repeat(added, "gh-diffstat__block gh-diffstat__block--add"),
    ...repeat(deleted, "gh-diffstat__block gh-diffstat__block--del"),
    ...repeat(neutral, "gh-diffstat__block")
  )
}

function fail(badge, error) {
  badge.className = "gh-diffstat gh-diffstat--error"
  badge.textContent = "diff ?"
  badge.title = error
}

function span(className, text = "") {
  const el = document.createElement("span")
  el.className = className
  el.textContent = text
  return el
}

function repeat(n, className) {
  return Array.from({ length: n }, () => span(className))
}

// Rescans only the rows that changed, so a row that never gets a badge
// isn't searched again every time something else on the page changes.
const changed = new Set()
let scheduled = false
function scheduleScan(records) {
  for (const record of records) {
    for (const node of record.type === "attributes" ? [record.target] : record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE || node.closest(OURS)) continue
      changed.add(node.closest(ROW) ?? node)
    }
  }
  if (scheduled || changed.size === 0) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    for (const scope of changed) if (scope.isConnected) scan(scope)
    changed.clear()
  })
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributeFilter: ["href"]
})
scan(document)
