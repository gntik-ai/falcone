// Runs inside page.evaluate; keep the collector independent of module scope.
export function unexpectedWelcomeCopy(allowedCopy) {
  const allowed = new Set(allowedCopy);
  // React renders the optional commit suffix as a separate text node.
  const buildVersion = /^(?:(?:dev|\d+\.\d+\.\d+[0-9A-Za-z.+-]*)(?: · [0-9a-f]{7})?|· [0-9a-f]{7})$/;
  const values = [];
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
    }
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) values.push(child.textContent);
    if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
  }
  return values.map((value) => value.replace(/\s+/g, ' ').trim()).filter((value) => value && !allowed.has(value) && !buildVersion.test(value));
}
