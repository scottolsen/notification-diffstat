// Shared by background.js, content.js and the Node test. No chrome APIs.
var Reviewers = (() => {
  // The octicon GitHub's PR sidebar shows for each review state.
  const STATES = {
    "octicon-check": "approved",
    "octicon-file-diff": "changes-requested",
    "octicon-comment": "commented",
    "octicon-dot-fill": "pending"
  }

  // The PR page's "Reviewers" sidebar form, cut out of the page's HTML as a
  // string so the background worker, which has no DOMParser, can cache a few
  // KB instead of the whole page. Forms can't nest, so the first </form>
  // after the label closes it.
  function section(html) {
    const label = html.indexOf('aria-label="Select reviewers"')
    if (label === -1) throw new Error("no reviewers sidebar")
    const start = html.lastIndexOf("<form", label)
    const end = html.indexOf("</form>", label)
    if (start === -1 || end === -1) throw new Error("no reviewers sidebar")
    return html.slice(start, end + "</form>".length)
  }

  // Reads each reviewer row out of the parsed sidebar form. A row holds the
  // reviewer's hovercard, a state icon, and for a submitted review, a
  // "Re-request review" button with its own sync icon. The reviewer picker
  // inside <details> lists people too, so it's skipped.
  function parse(root) {
    return [...root.querySelectorAll("[data-hovercard-type]")]
      .filter((el) => !el.closest("details"))
      .map((el) => {
        const row = el.parentElement
        return {
          login: el.getAttribute("data-assignee-name") ?? el.textContent.trim(),
          team: el.getAttribute("data-hovercard-type") === "team",
          state: state(row),
          label: row.querySelector("tool-tip")?.textContent.trim() ?? ""
        }
      })
  }

  function state(row) {
    for (const icon of row.querySelectorAll("svg")) {
      for (const name of icon.classList) if (STATES[name]) return STATES[name]
    }
    return "unknown"
  }

  return { section, parse }
})()

if (typeof module !== "undefined") module.exports = Reviewers
