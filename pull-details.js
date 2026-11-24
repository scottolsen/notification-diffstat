// Shared by background.js and the Node test. Pure functions, no chrome APIs.
var PullDetails = (() => {
  // The repository's own pull request list, searched for the PR's number.
  // Asked for as JSON, it names each PR's author and comment count, which
  // the notifications page and the merge box data don't. The search matches
  // the number anywhere in a PR's text, so other PRs can come back too.
  function url(path) {
    const [, owner, repo, , number] = path.split("/")
    return `https://github.com/${owner}/${repo}/pulls?q=${encodeURIComponent(`is:pr ${number}`)}`
  }

  // Who opened the PR at `path` and GitHub's comment total for it, the
  // number its PR lists show. GitHub leaves out a count of zero.
  function parse(json, path) {
    const results = json?.payload?.repoPullsDashboardContentRoute?.results
    if (!results) throw new Error("unexpected pull request list response")
    const number = Number(path.split("/").pop())
    const pr = results.find((result) => result.number === number)
    if (!pr) throw new Error(`#${number} isn't in the pull request list response`)
    return { author: pr.author?.displayLogin ?? null, comments: pr.commentCount ?? 0 }
  }

  return { url, parse }
})()

if (typeof module !== "undefined") module.exports = PullDetails
