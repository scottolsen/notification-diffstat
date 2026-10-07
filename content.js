const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+/
const DONE = "data-gh-diffstat"
const ROW = 'li, [role="listitem"]'
// The first span in a /pulls row's description holds "owner/repo #123".
// GitHub hashes the CSS module class (Description-module__description__AbC12),
// so match its start, and not names that only contain it, like
// TitleDescription-module__.
const DESCRIPTION_SPAN = ['[class^="Description-module__"]', '[class*=" Description-module__"]']
  .map((description) => `${description} > span:first-child`)
  .join(", ")

// On each page: the link that names the row's PR, and where the badge goes,
// right after "owner/repo #123". On /pulls a row can link to other PRs too,
// so only the title link counts.
const PAGES = [
  { prefix: "/notifications", link: 'a[href*="/pull/"]', anchor: (link) => link.querySelector("p.f6") },
  {
    prefix: "/pulls",
    link: 'h3 a[href*="/pull/"]',
    anchor: (_link, row) => row.querySelector(DESCRIPTION_SPAN)
  }
]

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
    for (const stale of row.querySelectorAll(".gh-diffstat")) stale.remove()
    row.setAttribute(DONE, path)
    decorate(anchor, path)
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

async function decorate(anchor, path) {
  const badge = document.createElement("span")
  badge.className = "gh-diffstat gh-diffstat--loading"
  badge.textContent = "…"
  anchor.append(badge)

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
      if (node.nodeType !== Node.ELEMENT_NODE || node.closest(".gh-diffstat")) continue
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
