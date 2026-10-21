const DIFFSTAT_TTL_MS = 5 * 60 * 1000
const REQUESTED_TTL_MS = 2 * 60 * 1000
const REVIEWERS_TTL_MS = 2 * 60 * 1000
const MAX_CONCURRENT = 4
const MAX_SEARCH_PAGES = 10

importScripts("diffstat.js", "review-requests.js", "reviewers.js")

let active = 0
const queue = []

const handlers = {
  diffstat: ({ path }) => cached(`diffstat:${path}`, DIFFSTAT_TTL_MS, () => throttled(() => fetchStats(path))),
  requested: () => cached("requested", REQUESTED_TTL_MS, fetchRequested),
  reviewers: ({ path }) => cached(`reviewers:${path}`, REVIEWERS_TTL_MS, () => throttled(() => fetchReviewers(path)))
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type]
  if (!handler) return
  handler(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }))
  return true
})

async function cached(key, ttl, load) {
  const hit = (await chrome.storage.session.get(key))[key]
  if (hit && Date.now() - hit.at < ttl) return hit.value

  const value = await load()
  await chrome.storage.session.set({ [key]: { at: Date.now(), value } })
  return value
}

async function fetchStats(path) {
  const res = await fetch(`https://github.com${path}.diff`, { credentials: "include" })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}.diff`)
  return Diffstat.count(await res.text())
}

async function fetchReviewers(path) {
  const res = await fetch(`https://github.com${path}`, { credentials: "include" })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return Reviewers.section(await res.text())
}

async function fetchRequested() {
  const paths = []
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const result = ReviewRequests.parse(await fetchSearchPage(page))
    paths.push(...result.paths)
    if (page >= result.pageCount) break
  }
  return paths
}

async function fetchSearchPage(page) {
  const res = await fetch(ReviewRequests.searchUrl(page), {
    credentials: "include",
    headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} searching review requests`)
  return res.json()
}

function throttled(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject })
    drain()
  })
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length) {
    const { task, resolve, reject } = queue.shift()
    active++
    task().then(resolve, reject).finally(() => {
      active--
      drain()
    })
  }
}
