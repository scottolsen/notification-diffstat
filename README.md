# GitHub Notification Diffstat

A Chrome extension that shows the size of each pull request on
[github.com/notifications](https://github.com/notifications) and in the
pull request lists under [github.com/pulls](https://github.com/pulls), such as
[review requests](https://github.com/pulls/reviews): additions, deletions, and
GitHub's five-block diffstat, right after the PR number in each row.

![A notification row showing +9 −54 and four red diffstat blocks right after the PR number](screenshot.png)

Then you can tell a one-line fix from a 2,000-line refactor before you open it.

## Install

The extension isn't on the Chrome Web Store. Load it unpacked:

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the cloned folder.
4. Reload github.com/notifications.

It also works in other Chromium browsers (Edge, Brave, Arc).

## How it works

- A content script finds pull request links in the notification list and in
  the `/pulls` lists. Issues and other notification types are left alone.
- For each PR, the background service worker downloads
  `github.com/<owner>/<repo>/pull/<n>.diff` using your existing GitHub login
  and counts the added and removed lines. Private repos work if your account
  can see them. You don't need a token.
- A pink ★ after the diffstat marks PRs where someone requested your review
  by name, as opposed to a team you're on. The extension finds these with one
  GitHub search (`is:pr is:open user-review-requested:@me`) per page view.
  GitHub clears a request once you submit a review, so the star goes away
  then too.
- Up to four diffs are fetched at once, and results are cached for five
  minutes per browser session. The review request search is cached for two
  minutes.
- The blocks use GitHub's rounding, so `+10 −53` shows 0 green, 4 red and
  1 grey, the same as on the PR page.
- Colors come from GitHub's own CSS variables, so it matches light and dark
  themes.

If a diff can't be fetched, the row shows a grey `diff ?`. Hover over it to
see the error.

## Permissions

| Permission | Why |
| --- | --- |
| `https://github.com/*` | Runs on the notifications and pull request list pages, requests `.diff` files and searches your review requests. |
| `https://patch-diff.githubusercontent.com/*` | GitHub redirects `.diff` requests here. |
| `storage` | Caches diff counts and review requests for the browser session. |

The extension sends nothing anywhere except GitHub.

## Development

```bash
node test.js
```

The tests cover the diff line counter and block math in `diffstat.js`, and
the search response parsing in `review-requests.js`.
After editing, click the reload icon on the extension's card in
`chrome://extensions`, then reload the notifications page.

## Limitations

- The badge is placed using GitHub's notification and pull request list
  markup. If GitHub changes it, the badge may stop appearing until the
  extension is updated.
- Very large PRs mean very large `.diff` downloads.

## License

[MIT](LICENSE)
