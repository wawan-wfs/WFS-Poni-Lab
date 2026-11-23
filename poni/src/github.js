'use strict';

(() => {
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const timeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let controls;
  let login = null;
  let busy = false;
  let loaded = false;

  function updatedAgo(value) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return '';
    const minutes = Math.round((time.getTime() - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return timeFormat.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return timeFormat.format(hours, 'hour');
    return timeFormat.format(Math.round(hours / 24), 'day');
  }

  function setBusy(next) {
    busy = next;
    controls.username.disabled = next;
    controls.save.disabled = next;
    controls.refresh.disabled = next || !login;
  }

  function renderGroup(container, title, group) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = group.error ? title : title + ' (' + group.total + ')';
    section.append(heading);
    if (group.error) {
      const error = document.createElement('p');
      error.textContent = group.error;
      section.append(error);
    } else if (!group.items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No open public pull requests';
      section.append(empty);
    }

    for (const item of group.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'github-pr';
      const label = document.createElement('strong');
      label.textContent = item.title;
      const extra = document.createElement('small');
      const details = [item.owner + '/' + item.repo + ' #' + item.number, item.author, updatedAgo(item.updated_at)];
      if (item.draft) details.push('Draft');
      if (item.comments) details.push(item.comments + (item.comments === 1 ? ' comment' : ' comments'));
      extra.textContent = details.filter(Boolean).join(' · ');
      row.append(label, extra);
      row.addEventListener('click', async () => {
        try {
          await invoke('open_github_pull_request', { owner: item.owner, repo: item.repo, number: item.number });
        } catch (error) {
          controls.status.textContent = String(error);
        }
      });
      section.append(row);
    }
    if (group.incomplete || group.total > group.items.length) {
      const limited = document.createElement('p');
      limited.textContent = 'Showing ' + group.items.length + ' of ' + group.total + ' results';
      section.append(limited);
    }
    container.append(section);
  }

  async function fetchInbox() {
    if (!login) {
      controls.list.replaceChildren();
      controls.status.textContent = 'Enter a GitHub username to see its public pull requests.';
      return;
    }
    controls.status.textContent = 'Loading pull requests…';
    const inbox = await invoke('refresh_github_inbox');
    controls.list.replaceChildren();
    renderGroup(controls.list, 'Review requested', inbox.review);
    renderGroup(controls.list, 'Open pull requests by ' + login, inbox.mine);
    controls.status.textContent = '';
  }

  async function run(task) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      controls.status.textContent = String(error);
    } finally {
      setBusy(false);
    }
  }

  function show() {
    if (loaded) return;
    return run(async () => {
      login = await invoke('github_login');
      controls.username.value = login || '';
      await fetchInbox();
      loaded = true;
    });
  }

  function mount(page) {
    page.innerHTML = `
      <form id="github-account" class="entry">
        <input id="github-username" aria-label="GitHub username" autocomplete="off" spellcheck="false" maxlength="39" placeholder="GitHub username">
        <button id="github-save">Save</button>
        <button id="github-refresh" type="button" disabled>Refresh</button>
      </form>
      <div id="github-status" role="status"></div>
      <div id="github-pr-list"></div>
    `;
    controls = {
      username: page.querySelector('#github-username'),
      save: page.querySelector('#github-save'),
      refresh: page.querySelector('#github-refresh'),
      status: page.querySelector('#github-status'),
      list: page.querySelector('#github-pr-list')
    };
    page.querySelector('#github-account').addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        const next = await invoke('save_github_login', { login: controls.username.value });
        if (next !== login) controls.list.replaceChildren();
        login = next;
        controls.username.value = login || '';
        await fetchInbox();
        loaded = true;
      });
    });
    controls.refresh.addEventListener('click', () => { void run(fetchInbox); });
  }

  window.poniModules ||= {};
  window.poniModules.github = { mount, show };
})();
