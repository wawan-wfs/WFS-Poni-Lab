'use strict';

(() => {
  const MAX_BYTES = 2 * 1024 * 1024;

  function describe(summary) {
    const parts = [
      `Imported ${summary.imported || 0}`,
      `${summary.duplicates || 0} already in Calendar`,
      `${summary.skipped || 0} skipped`,
    ];
    const reasons = Object.entries(summary.reasons || {}).map(([reason, count]) => `${reason}: ${count}`);
    return parts.join(' · ') + (reasons.length ? `. ${reasons.join(' · ')}` : '.');
  }

  function mount(container, importFile) {
    if (!container || typeof importFile !== 'function') return;

    const label = document.createElement('label');
    label.textContent = 'Import a local calendar (.ics, up to 2 MB)';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,text/calendar';
    label.append(input);

    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'ics-import-status';
    const hint = document.createElement('p');
    hint.className = 'ics-import-hint';
    hint.textContent = 'Imports timed, one-time events. Already imported events are compared by title, time, duration and location.';
    container.replaceChildren(label, hint, status);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.disabled = true;
      status.textContent = 'Importing calendar…';
      try {
        if (!file.name.toLowerCase().endsWith('.ics')) {
          throw new Error('Choose a file ending in .ics.');
        }
        if (file.size > MAX_BYTES) {
          throw new Error('Choose an .ics file of 2 MB or less.');
        }
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        } catch {
          throw new Error('This file could not be read as a UTF-8 calendar.');
        }
        const summary = await importFile(text);
        status.textContent = describe(summary);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        input.value = '';
        input.disabled = false;
      }
    });
  }

  window.poniIcsImport = { mount };
})();
