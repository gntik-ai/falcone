export function allowedNotFoundCopy(copy, common) {
  return [
    ...Object.values(copy), ...Object.values(common.locale),
    common.shell.console, common.shell.about, common.shell.userMenu, 'Falcone', '.',
    // The shared Suspense fallback announces loading before the login chunk
    // resolves. LiveAnnouncer retains it across in-app navigation to the 404.
    `${common.states.loading.title}. ${common.states.loading.body}`,
  ];
}
