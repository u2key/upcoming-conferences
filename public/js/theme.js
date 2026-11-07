// Loaded before the stylesheet in <head>, so a dark page never flashes white.
(function () {
  'use strict';

  const STORAGE_KEY = 'uc-theme';
  const root = document.documentElement;
  const framed = window.self !== window.top;
  const osQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const osTheme = () => (osQuery && osQuery.matches ? 'dark' : 'light');
  let requested = new URLSearchParams(location.search).get('theme');

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null; // storage can be refused, such as in a sandboxed iframe
    }
  }

  function resolve() {
    if (requested === 'dark' || requested === 'light') return requested;
    if (requested === 'auto') return osTheme();
    // A host page decides how its embed looks: don't let a viewer's OS setting
    // put a dark box on a light site unless the host asks with ?theme=
    if (framed) return 'light';
    const stored = readStored();
    return stored === 'dark' || stored === 'light' ? stored : osTheme();
  }

  function apply() {
    root.dataset.theme = resolve();
  }

  apply();
  if (osQuery) osQuery.addEventListener('change', apply);

  window.UCTheme = {
    current: () => root.dataset.theme,
    toggle() {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      requested = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // applies to this page only
      }
      apply();
      return next;
    },
  };
})();
