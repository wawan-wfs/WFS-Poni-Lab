'use strict';

(() => {
  const codes = ['en', 'id', 'ms', 'ar', 'zh-CN', 'ja', 'ko', 'th', 'vi', 'hi', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'ru', 'tr'];
  const languages = new Intl.DisplayNames(undefined, {type: 'language'});
  const encoder = new TextEncoder();
  const limit = 500;
  const preferencesKey = 'poni-translate-languages';

  function mount(page) {
    page.innerHTML = `
      <div class="translate-panel">
        <div class="translate-controls">
          <select id="translate-from" aria-label="Source language"></select>
          <button id="translate-swap" type="button" aria-label="Swap languages">⇄</button>
          <select id="translate-to" aria-label="Target language"></select>
          <button id="translate-copy" type="button">Copy</button>
          <button id="translate-submit" type="button">Translate</button>
        </div>
        <div class="translate-texts">
          <textarea id="translate-input" aria-label="Text to translate" placeholder="Type or paste text…" spellcheck="false"></textarea>
          <div id="translate-output" role="region" aria-label="Translation" tabindex="0"></div>
        </div>
        <div class="translate-footer"><span id="translate-status" role="status"></span><span id="translate-count"></span></div>
      </div>`;
    const field = name => page.querySelector(`#translate-${name}`);
    const from = field('from');
    const to = field('to');
    const input = field('input');
    const output = field('output');
    const status = field('status');
    const count = field('count');
    const submit = field('submit');
    const swap = field('swap');
    const copy = field('copy');
    let translation = '';
    let busy = false;
    let message = '';

    for (const select of [from, to]) {
      select.replaceChildren(...codes.map(code => new Option(languages.of(code), code)));
    }
    const saved = (localStorage.getItem(preferencesKey) || '').split('|');
    from.value = codes.includes(saved[0]) ? saved[0] : 'en';
    to.value = codes.includes(saved[1]) ? saved[1] : 'id';

    function update() {
      const size = encoder.encode(input.value.trim()).length;
      output.textContent = translation || 'Translation appears here';
      output.classList.toggle('is-placeholder', !translation);
      count.textContent = `${size} / ${limit} bytes`;
      copy.disabled = !translation || busy;
      submit.disabled = busy || size === 0 || size > limit || from.value === to.value;
      from.disabled = to.disabled = swap.disabled = input.readOnly = busy;
      status.textContent = message || 'Translate sends your text to MyMemory.';
    }

    function changeLanguages() {
      localStorage.setItem(preferencesKey, `${from.value}|${to.value}`);
      translation = '';
      message = from.value === to.value ? 'Choose two different languages.' : '';
      update();
    }

    async function translate() {
      if (submit.disabled) return;
      busy = true;
      translation = '';
      message = 'Translating…';
      update();
      try {
        translation = await window.__TAURI__.core.invoke('translate_text', {
          text: input.value.trim(), from: from.value, to: to.value,
        });
        message = '';
      } catch (error) {
        message = String(error);
      } finally {
        busy = false;
        update();
      }
    }

    input.addEventListener('input', () => {
      translation = '';
      message = '';
      update();
    });
    input.addEventListener('keydown', event => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        void translate();
      }
    });
    from.addEventListener('change', changeLanguages);
    to.addEventListener('change', changeLanguages);
    submit.addEventListener('click', () => void translate());
    swap.addEventListener('click', () => {
      [from.value, to.value] = [to.value, from.value];
      if (translation) input.value = translation;
      changeLanguages();
    });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(translation);
        message = 'Copied';
      } catch {
        message = 'Cannot copy to clipboard';
      }
      update();
    });
    update();
  }

  window.poniModules ||= {};
  window.poniModules.translate = {mount};
})();
