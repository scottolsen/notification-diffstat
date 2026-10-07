const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+/
const DONE = "data-gh-diffstat"

// Where the badge goes on each page: right after "owner/repo #123".
const PAGES = [
  { prefix: "/notifications", anchor: (link) => link.querySelector("p.f6") },
  { prefix: "/pulls", anchor: (_link, row) => row.querySelector('[class*="Description-module"] > span:first-child') }
]

function currentPage() {
  return PAGES.find(({ prefix }) => location.pathname.startsWith(prefix))
}

function scan() {
  const page = currentPage()
  if (!page) return
  for (const link of document.querySelectorAll('a[href*="/pull/"]')) {
    const path = prPath(link)
    const row = link.closest("li")
    if (!path || !row || row.hasAttribute(DONE)) continue
    const anchor = page.anchor(link, row)
    if (!anchor) continue
    row.setAttribute(DONE, "")
    decorate(anchor, path)
  }
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

let scheduled = false
function scheduleScan() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    scan()
  })
}

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true })
scan()
