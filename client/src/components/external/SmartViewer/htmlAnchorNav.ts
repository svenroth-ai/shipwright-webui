/*
 * In-page `#fragment` navigation for the sandboxed HTML preview.
 *
 * The srcdoc carries `<base target=_blank>` so external links open in a new tab. That also
 * catches a table-of-contents link (`<a href="#chapter-2">`): the browser opens it as a new
 * window instead of scrolling the page. This script (injected into the srcdoc, runs inside the
 * sandboxed frame — no access to the app) scrolls to the target itself. A page's own click
 * handler that already called preventDefault() wins.
 */

const SCRIPT_BODY = `(function () {
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (_) {}
    // An element carrying the id wins; "#" / "#top" scroll to the top only when nothing matches (HTML spec).
    var target = id === "" ? null : document.getElementById(id) || document.getElementsByName(id)[0] || null;
    if (!target && (id === "" || id === "top")) target = document.documentElement;
    e.preventDefault();
    if (target && target.scrollIntoView) target.scrollIntoView({ block: "start" });
  });
})();`;

/** `<script>` element to splice into the srcdoc head (CSP allows inline scripts). */
export const ANCHOR_NAV_SCRIPT = `<script>${SCRIPT_BODY}</script>`;
