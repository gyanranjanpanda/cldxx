/**
 * Paginator — runs INSIDE the browser, after layout, before printing.
 *
 * The old renderer decided page breaks in Node by counting blocks ("start a new
 * page after every H1"). Node cannot know how tall a rendered table or diagram
 * is, so pages came out either half empty or with content sliced through the
 * middle. This measures the real thing instead.
 *
 * Algorithm: elements are appended one at a time and the page's used height is
 * measured after each. The first element that overflows is pulled back off and
 * starts the next page, so nothing is ever cut mid-element. Sections flow
 * continuously rather than each claiming a page, with orphan control keeping a
 * section heading from stranding at the foot of a page.
 *
 * Exported as a string because it is injected via `page.evaluate`, not imported.
 */

export const PAGINATOR_SOURCE = `
(function () {
  var doc = document.querySelector('.doc');
  if (!doc) return { pages: 0 };

  // Measure the usable height of a content page from a real one, so this tracks
  // whatever the stylesheet says rather than a duplicated constant.
  var probe = document.createElement('div');
  probe.className = 'page content-page';
  probe.style.visibility = 'hidden';
  doc.appendChild(probe);
  var styles = getComputedStyle(probe);
  var CONTENT_H = probe.clientHeight
    - parseFloat(styles.paddingTop)
    - parseFloat(styles.paddingBottom);
  doc.removeChild(probe);

  // How much of the page the content actually occupies.
  //
  // NOT scrollHeight: .page-body is a stretched flex item, so its scrollHeight is
  // the full content box no matter how little is in it. Reading that made every
  // page look full, which fired the orphan check on every section and gave each
  // one its own page. Measure from the body's top to the last child's bottom.
  function usedHeight(body) {
    var last = body.lastElementChild;
    if (!last) return 0;
    return last.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
  }

  function newPage() {
    var p = document.createElement('div');
    p.className = 'page content-page';
    var inner = document.createElement('div');
    inner.className = 'page-body';
    p.appendChild(inner);
    return p;
  }

  // A section heading landing in the last fifth of a page is an orphan: the
  // reader gets a title and nothing under it. Push it to the next page instead.
  var ORPHAN_ZONE = CONTENT_H * 0.2;

  var groups = Array.prototype.slice.call(doc.querySelectorAll('.flow-group'));
  var sectionPages = {};

  groups.forEach(function (group) {
    var children = Array.prototype.slice.call(group.children);
    var page = newPage();
    var body = page.firstChild;
    group.parentNode.insertBefore(page, group);

    function breakPage() {
      page = newPage();
      body = page.firstChild;
      group.parentNode.insertBefore(page, group);
    }

    children.forEach(function (child) {
      var startsSection = child.hasAttribute('data-section-start');

      // Orphan control, before the element is even placed.
      if (startsSection && body.children.length &&
          CONTENT_H - usedHeight(body) < ORPHAN_ZONE) {
        breakPage();
      }

      body.appendChild(child);

      if (usedHeight(body) > CONTENT_H) {
        // It overflowed. If the page already holds something, move this child to
        // a fresh page. If it is alone and still too tall, it cannot fit any page
        // — keep it and let it be the tall one rather than dropping content.
        if (body.children.length > 1) {
          body.removeChild(child);
          breakPage();
          body.appendChild(child);
        }
      }

      if (startsSection) {
        sectionPages[child.getAttribute('data-section-start')] = page;
        // A section that opens mid-page needs air above it; one that opens a
        // page must sit on the top margin.
        child.classList.add(body.children.length === 1 ? 'section-at-top' : 'section-mid-page');
      }
    });

    // A group that produced nothing leaves no blank page behind.
    if (!body.children.length) page.parentNode.removeChild(page);

    group.parentNode.removeChild(group);
  });

  // ── Number the pages and stamp footers ────────────────────────────────────
  var pages = Array.prototype.slice.call(doc.querySelectorAll('.page'));
  var pageOf = {};

  // Map flowed sections to the page element they actually landed on.
  Object.keys(sectionPages).forEach(function (id) {
    var idx = pages.indexOf(sectionPages[id]);
    if (idx !== -1) pageOf[id] = idx + 1;
  });

  pages.forEach(function (p, i) {
    var num = i + 1;
    var id = p.getAttribute('data-section-id');
    if (id) pageOf[id] = num;

    // The cover is page 1 but never wears a number.
    if (p.classList.contains('cover')) return;

    var existing = p.querySelector('.page-footer');
    if (existing) {
      var label = existing.querySelector('.footer-page');
      if (label) label.textContent = String(num);
      return;
    }
    if (p.classList.contains('section-break')) return;

    var footer = document.createElement('div');
    footer.className = 'page-footer';
    footer.innerHTML = '<span class="footer-brand">cldxAI</span>' +
                       '<span class="footer-page">' + num + '</span>';
    p.appendChild(footer);
  });

  // ── Resolve TOC page numbers ──────────────────────────────────────────────
  Array.prototype.slice.call(doc.querySelectorAll('[data-toc-target]')).forEach(function (el) {
    var n = pageOf[el.getAttribute('data-toc-target')];
    el.textContent = n ? String(n) : '';
  });

  return { pages: pages.length };
})();
`;
