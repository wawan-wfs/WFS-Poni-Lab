(() => {
  'use strict';
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const modules = window.poniModules ||= {};
  let page, search, genre, country, volume, list, status, now, player, playButton;
  let state;
  let current = null;
  let audio = null;
  let mode = 'popular';
  let directory = [];
  let searchTimer;
  let playbackTimer;
  let request = 0;
  let queue = Promise.resolve();
  let loading = false;

  function localeCountry() {
    try { return new Intl.Locale(navigator.language).maximize().region || ''; }
    catch { return ''; }
  }

  function update(command, args) {
    queue = queue.then(async () => {
      try {
        state = await invoke(command, args);
        renderList();
      } catch (error) {
        status.textContent = String(error);
      }
    });
  }

  function stationMeta(station) {
    return [station.country, station.codec, station.tags].filter(Boolean).join(' · ');
  }

  function renderList() {
    if (!state) return;
    const stations = mode === 'favourites' ? state.favourites :
      mode === 'recent' ? state.recent : directory;
    list.replaceChildren();
    for (const station of stations) {
      const row = document.createElement('div');
      row.className = 'radio-station';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'radio-select';
      select.textContent = station.name;
      select.title = stationMeta(station);
      select.dataset.station = station.id;
      select.setAttribute('aria-pressed', String(current?.id === station.id && !!audio));
      select.addEventListener('click', () => {
        if (audio && current?.id === station.id) stop();
        else start(station);
      });
      const favourite = document.createElement('button');
      favourite.type = 'button';
      const starred = state.favourites.some(item => item.id === station.id);
      favourite.textContent = starred ? '★' : '☆';
      favourite.setAttribute('aria-label', (starred ? 'Remove favourite ' : 'Favourite ') + station.name);
      favourite.addEventListener('click', () => update('update_radio_stations', {action: 'favourite', station}));
      row.append(select, favourite);
      if (mode === 'recent') {
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.textContent = '×';
        forget.setAttribute('aria-label', 'Remove recent ' + station.name);
        forget.addEventListener('click', () => update('update_radio_stations', {action: 'forget', station}));
        row.append(forget);
      }
      list.append(row);
    }
  }

  function displayPlayer(message) {
    now.textContent = current?.name || 'Select a station';
    playButton.textContent = audio ? 'Stop' : 'Play';
    playButton.disabled = !current;
    if (message !== undefined) status.textContent = message;
    for (const button of list.querySelectorAll('[data-station]')) {
      button.setAttribute('aria-pressed', String(current?.id === button.dataset.station && !!audio));
    }
  }

  function stop(message = 'Stopped') {
    clearTimeout(playbackTimer);
    if (audio) {
      const previous = audio;
      audio = null;
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
      previous.remove();
    }
    displayPlayer(message);
  }

  function start(station) {
    stop('');
    current = station;
    const stream = document.createElement('audio');
    stream.preload = 'none';
    stream.volume = Number(volume.value) / 100;
    audio = stream;
    player.append(stream);
    displayPlayer('Connecting…');
    let recorded = false;
    stream.addEventListener('playing', () => {
      if (audio !== stream) return;
      clearTimeout(playbackTimer);
      displayPlayer('Live');
      if (!recorded) {
        recorded = true;
        update('update_radio_stations', {action: 'recent', station});
      }
    });
    stream.addEventListener('waiting', () => {
      if (audio === stream) displayPlayer('Buffering…');
    });
    const fail = () => {
      if (audio === stream) stop('This station could not be played.');
    };
    stream.addEventListener('error', fail, {once: true});
    playbackTimer = setTimeout(fail, 18000);
    stream.src = station.url;
    stream.play().catch(fail);
  }

  async function find() {
    if (!state || mode !== 'popular') return;
    const token = ++request;
    const query = search.value.trim();
    list.setAttribute('aria-busy', 'true');
    directory = [];
    renderList();
    list.textContent = 'Loading stations…';
    try {
      const stations = await invoke('find_radio_stations', {
        country: country.value.trim().toUpperCase(),
        query,
        genre: genre.checked,
      });
      if (token !== request) return;
      directory = stations;
      renderList();
      if (!stations.length) list.textContent = 'No playable stations found.';
    } catch (error) {
      if (token !== request) return;
      list.textContent = String(error);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void find());
      list.append(' ', retry);
    } finally {
      if (token === request) list.removeAttribute('aria-busy');
    }
  }

  function setMode(next) {
    mode = next;
    clearTimeout(searchTimer);
    request++;
    list.removeAttribute('aria-busy');
    for (const button of page.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    page.querySelector('.radio-search').hidden = mode !== 'popular';
    if (mode === 'popular') void find();
    else {
      renderList();
      if (!list.childElementCount) list.textContent = mode === 'favourites' ? 'No favourites yet.' : 'No stations played yet.';
    }
  }

  function savePreferences() {
    update('set_radio_preferences', {volume: Number(volume.value), country: country.value.trim().toUpperCase()});
  }

  modules.radio = {
    mount(target) {
      page = target;
      page.innerHTML = `
        <div class="radio-layout">
          <div class="radio-controls">
            <strong class="radio-now">Select a station</strong>
            <div class="radio-actions">
              <button type="button" class="radio-play" disabled>Play</button>
              <label>Volume <input type="range" min="0" max="100" value="60" class="radio-volume"></label>
            </div>
            <p class="radio-status" role="status"></p>
            <div class="radio-audio" hidden></div>
          </div>
          <div class="radio-directory">
            <div class="radio-modes">
              <button type="button" data-mode="popular" aria-pressed="true">Popular</button>
              <button type="button" data-mode="favourites" aria-pressed="false">Favourites</button>
              <button type="button" data-mode="recent" aria-pressed="false">Recent</button>
            </div>
            <form class="radio-search">
              <input type="search" aria-label="Search stations" placeholder="Search stations" maxlength="80">
              <input type="text" aria-label="Country code" title="Two-letter country code. Leave blank for worldwide." placeholder="All" maxlength="2" pattern="[A-Za-z]{2}">
              <label><input type="checkbox" class="radio-genre"> Genre</label>
              <button type="submit">Search</button>
            </form>
            <div class="radio-list" aria-label="Radio stations"></div>
          </div>
        </div>`;
      const findElement = selector => page.querySelector(selector);
      search = findElement('.radio-search [type="search"]');
      country = findElement('.radio-search [type="text"]');
      genre = findElement('.radio-genre');
      volume = findElement('.radio-volume');
      list = findElement('.radio-list');
      status = findElement('.radio-status');
      now = findElement('.radio-now');
      player = findElement('.radio-audio');
      playButton = findElement('.radio-play');
      for (const button of page.querySelectorAll('[data-mode]')) {
        button.addEventListener('click', () => setMode(button.dataset.mode));
      }
      findElement('.radio-search').addEventListener('submit', event => {
        event.preventDefault();
        clearTimeout(searchTimer);
        void find();
      });
      search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (country.validity.valid) void find();
        }, 350);
      });
      genre.addEventListener('change', () => {
        if (country.validity.valid) void find();
      });
      country.addEventListener('change', () => {
        country.value = country.value.trim().toUpperCase();
        if (!country.validity.valid || !state) return;
        savePreferences();
        void find();
      });
      volume.addEventListener('input', () => {
        if (audio) audio.volume = Number(volume.value) / 100;
      });
      volume.addEventListener('change', () => {
        if (state && country.validity.valid) savePreferences();
      });
      playButton.addEventListener('click', () => {
        if (audio) stop();
        else if (current) start(current);
      });
    },
    async show() {
      if (state || loading) return;
      loading = true;
      try {
        state = await invoke('get_radio');
        country.value = state.country ?? localeCountry();
        volume.value = state.volume;
        current = state.recent[0] || null;
        displayPlayer();
        setMode(mode);
      } catch (error) {
        status.textContent = String(error);
      } finally {
        loading = false;
      }
    },
  };
})();
