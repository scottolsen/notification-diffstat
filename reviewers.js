// Shared by background.js and the Node test. No chrome APIs.
var Reviewers = (() => {
  const STATES = {
    APPROVED: "approved",
    CHANGES_REQUESTED: "changes-requested",
    COMMENTED: "commented",
    DISMISSED: "dismissed"
  }

  const LABELS = {
    approved: (login) => `${login} approved these changes`,
    "changes-requested": (login) => `${login} requested changes`,
    commented: (login) => `${login} left review comments`,
    dismissed: (login) => `${login}'s review was dismissed`,
    pending: (login) => `Awaiting requested review from ${login}`
  }

  // The JSON the PR page's React app loads its merge box from. Since GitHub
  // moved PR pages to React (November 2026), the page's HTML no longer holds
  // the Reviewers sidebar. GitHub answers 406 unless the request asks for
  // JSON with X-Requested-With.
  function url(path) {
    return `https://github.com${path}/page_data/merge_box`
  }

  // Each reviewer's latest review, then everyone still asked to review. A
  // reviewer asked again after reviewing shows as pending, as GitHub's
  // sidebar does. A team request has a name but no login.
  function parse(data) {
    const pr = data?.pullRequest
    if (!pr) throw new Error("no pull request in merge box response")
    const pending = (pr.pendingReviewRequests ?? []).map(({ reviewer }) => entry(reviewer.login ?? reviewer.name, "pending"))
    const waiting = new Set(pending.map(({ login }) => login))
    const reviewed = (pr.latestOpinionatedReviews ?? [])
      .map(({ author, state }) => entry(author.login, STATES[state] ?? "unknown"))
      .filter(({ login }) => !waiting.has(login))
    return [...reviewed, ...pending]
  }

  function entry(login, state) {
    return { login, state, label: LABELS[state]?.(login) ?? login }
  }

  return { url, parse }
})()

if (typeof module !== "undefined") module.exports = Reviewers
