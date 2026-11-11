// Run with: node test.js
const assert = require("node:assert")
const { count, blocks } = require("./diffstat.js")
const ReviewRequests = require("./review-requests.js")
const Reviewers = require("./reviewers.js")

const diff = [
  "diff --git a/a.rb b/a.rb",
  "index 1..2 100644",
  "--- a/a.rb",
  "+++ b/a.rb",
  "@@ -1,3 +1,3 @@",
  " context",
  "-old",
  "--- removed line that starts with dashes",
  "+new",
  "+++ added line that starts with pluses",
  "\\ No newline at end of file",
  "diff --git a/img.png b/img.png",
  "Binary files a/img.png and b/img.png differ",
  ""
].join("\n")

assert.deepStrictEqual(count(diff), { additions: 2, deletions: 2 })
assert.deepStrictEqual(blocks({ additions: 10, deletions: 53 }), { added: 0, deleted: 4, neutral: 1 })
assert.deepStrictEqual(blocks({ additions: 0, deletions: 0 }), { added: 0, deleted: 0, neutral: 5 })
assert.deepStrictEqual(blocks({ additions: 24, deletions: 0 }), { added: 5, deleted: 0, neutral: 0 })
assert.deepStrictEqual(blocks({ additions: 12, deletions: 14 }), { added: 2, deleted: 2, neutral: 1 })
const search = {
  payload: {
    blackbirdSearchRoute: {
      logged_in: true,
      page_count: 2,
      results: [{ number: 947, repo: { repository: { owner_login: "Acme", name: "Widgets" } } }]
    }
  }
}
assert.deepStrictEqual(ReviewRequests.parse(search), { paths: ["/acme/widgets/pull/947"], pageCount: 2 })
search.payload.blackbirdSearchRoute.logged_in = false
assert.throws(() => ReviewRequests.parse(search), /not signed in/)
assert.throws(() => ReviewRequests.parse({}), /unexpected search response/)
assert.match(ReviewRequests.searchUrl(2), /p=2&q=is%3Apr%20is%3Aopen%20user-review-requested%3A%40me$/)

const mergeBox = {
  pullRequest: {
    latestOpinionatedReviews: [
      { author: { login: "ana" }, state: "APPROVED" },
      { author: { login: "bo" }, state: "CHANGES_REQUESTED" },
      { author: { login: "cy" }, state: "COMMENTED" },
      { author: { login: "ed" }, state: "APPROVED" }
    ],
    pendingReviewRequests: [
      { reviewer: { login: "di", type: "USER" } },
      { reviewer: { login: "ed", type: "USER" } },
      { reviewer: { name: "Core", type: "TEAM" } }
    ]
  }
}
assert.deepStrictEqual(Reviewers.parse(mergeBox), [
  { login: "ana", state: "approved", label: "ana approved these changes" },
  { login: "bo", state: "changes-requested", label: "bo requested changes" },
  { login: "cy", state: "commented", label: "cy left review comments" },
  { login: "di", state: "pending", label: "Awaiting requested review from di" },
  { login: "ed", state: "pending", label: "Awaiting requested review from ed" },
  { login: "Core", state: "pending", label: "Awaiting requested review from Core" }
])
assert.deepStrictEqual(Reviewers.parse({ pullRequest: {} }), [])
assert.throws(() => Reviewers.parse({}), /no pull request/)
assert.strictEqual(Reviewers.url("/acme/widgets/pull/12"), "https://github.com/acme/widgets/pull/12/page_data/merge_box")

console.log("ok")
