// fix-1118: errors from drivers/transports can carry URLs in messages, stacks or causes.
// For query-bearing requests, log only the pathname and bounded diagnostic metadata.
// Leave the error untouched so response classification and queryless diagnostics stay intact.
export function requestErrorForLog(error, requestUrl) {
  let url;
  try { url = new URL(requestUrl, 'http://request.invalid'); }
  catch { return { pathname: 'unmatched' }; }
  if (!url.search) return error;
  const code = error?.code;
  const queryValues = [...url.searchParams.values()].filter(Boolean);
  return {
    pathname: url.pathname,
    ...(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
      && !queryValues.some((value) => code.includes(value)) ? { code } : {}),
    ...(Number.isInteger(error?.statusCode) ? { statusCode: error.statusCode } : {}),
  };
}
