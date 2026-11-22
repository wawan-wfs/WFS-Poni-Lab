'use strict';

(() => {
  const invoke = window.__TAURI__.core.invoke;
  const unsorted = '\u0001';
  let page;
  let data = { items: [], categories: [] };
  let editing = null;
  let busy = false;

  function element(selector) {
    return page.querySelector(selector);
  }

  function button(label, handler, accessibleName) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    if (accessibleName) control.setAttribute('aria-label', accessibleName);
    control.addEventListener('click', handler);
    return control;
  }

  function setStatus(message) {
    element('#bookmarks-status').textContent = message;
  }

  function resetForm() {
    editing = null;
    element('#bookmarks-form').reset();
    const category = element('#bookmarks-filter').value;
    if (category && category !== unsorted) element('#bookmark-category').value = category;
    element('#bookmark-submit').textContent = 'Save';
    element('#bookmark-cancel').hidden = true;
  }

  function editBookmark(bookmark) {
    editing = bookmark.id;
    element('#bookmark-url').value = bookmark.url;
    element('#bookmark-title').value = bookmark.title;
    element('#bookmark-category').value = bookmark.category || '';
    element('#bookmark-submit').textContent = 'Update';
    element('#bookmark-cancel').hidden = false;
    element('#bookmark-title').focus();
  }

  function renderItems() {
    const list = element('#bookmarks-list');
    const filter = element('#bookmarks-filter').value;
    const query = element('#bookmarks-search').value.trim().toLowerCase();
    const matches = data.items.filter(item => {
      const categoryMatches = !filter || (filter === unsorted ? !item.category : item.category === filter);
      return categoryMatches && [item.title, item.url, item.category].some(value => (value || '').toLowerCase().includes(query));
    });

    list.replaceChildren();
    if (!matches.length) {
      list.textContent = data.items.length ? 'No matching bookmarks' : 'No bookmarks yet';
      return;
    }
    for (const bookmark of matches) {
      const row = document.createElement('div');
      row.className = 'bookmark-row';
      const link = button(bookmark.title, () => openBookmark(bookmark), 'Open ' + bookmark.title);
      link.className = 'bookmark-link';
      link.title = bookmark.url;
      const detail = document.createElement('small');
      detail.textContent = bookmark.category ? bookmark.url + ' · ' + bookmark.category : bookmark.url;
      link.append(detail);

      row.append(
        link,
        button('Edit', () => editBookmark(bookmark), 'Edit ' + bookmark.title),
        button('Copy', () => copyBookmark(bookmark), 'Copy ' + bookmark.title),
        button('Delete', () => deleteBookmark(bookmark), 'Delete ' + bookmark.title)
      );
      list.append(row);
    }
  }

  function render(preferredFilter = element('#bookmarks-filter').value) {
    const filter = element('#bookmarks-filter');
    filter.replaceChildren(new Option('All', ''), new Option('Unsorted', unsorted));
    for (const category of data.categories) filter.add(new Option(category, category));
    filter.value = [...filter.options].some(option => option.value === preferredFilter) ? preferredFilter : '';
    const options = element('#bookmark-categories');
    options.replaceChildren(...data.categories.map(category => new Option(category, category)));
    const categorySelected = filter.value && filter.value !== unsorted;
    element('#bookmark-category-rename').disabled = !categorySelected;
    element('#bookmark-category-delete').disabled = !categorySelected;
    renderItems();
  }

  async function update(command, args, onSuccess) {
    if (busy) return false;
    busy = true;
    try {
      data = await invoke(command, args);
      setStatus('');
      render(onSuccess?.());
      return true;
    } catch (error) {
      setStatus(String(error));
      return false;
    } finally {
      busy = false;
    }
  }

  async function openBookmark(bookmark) {
    try {
      await invoke('open_bookmark', { id: bookmark.id });
      setStatus('');
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function copyBookmark(bookmark) {
    try {
      await navigator.clipboard.writeText(bookmark.url);
      setStatus('Link copied');
    } catch {
      setStatus('Could not copy link');
    }
  }

  function deleteBookmark(bookmark) {
    if (window.confirm('Delete this bookmark?')) {
      void update('remove_bookmark', { id: bookmark.id }, () => {
        if (editing === bookmark.id) resetForm();
      });
    }
  }

  function mount(container) {
    page = container;
    page.innerHTML = `
      <form class="entry bookmark-form" id="bookmarks-form">
        <input id="bookmark-url" aria-label="Bookmark link" placeholder="Paste a link" maxlength="2048" required>
        <input id="bookmark-title" aria-label="Bookmark title" placeholder="Title (optional)" maxlength="200">
        <input id="bookmark-category" aria-label="Bookmark category" placeholder="Category" maxlength="40" list="bookmark-categories">
        <datalist id="bookmark-categories"></datalist>
        <button id="bookmark-submit">Save</button>
        <button id="bookmark-cancel" type="button" hidden>Cancel</button>
      </form>
      <div class="bookmark-tools">
        <select id="bookmarks-filter" aria-label="Filter bookmarks by category"><option value="">All</option></select>
        <input id="bookmarks-search" aria-label="Search bookmarks" type="search" placeholder="Search">
        <button id="bookmark-category-add" type="button">Add category</button>
        <button id="bookmark-category-rename" type="button" disabled>Rename category</button>
        <button id="bookmark-category-delete" type="button" disabled>Delete category</button>
      </div>
      <form class="entry bookmark-category-form" id="bookmark-category-form" hidden>
        <input id="bookmark-category-name" aria-label="Category name" maxlength="40" required>
        <button>Save category</button>
        <button id="bookmark-category-cancel" type="button">Cancel</button>
      </form>
      <div id="bookmarks-status" role="status"></div>
      <div id="bookmarks-list" class="items"></div>
    `;
    const categoryForm = element('#bookmark-category-form');
    const categoryField = element('#bookmark-category-name');
    let previousCategory = null;
    function editCategory(previous) {
      previousCategory = previous;
      categoryField.value = previous || '';
      categoryForm.hidden = false;
      categoryField.focus();
      categoryField.select();
    }

    element('#bookmarks-form').addEventListener('submit', event => {
      event.preventDefault();
      const args = {
        id: editing,
        url: element('#bookmark-url').value,
        title: element('#bookmark-title').value,
        category: element('#bookmark-category').value
      };
      void update('save_bookmark', args, () => {
        resetForm();
        const saved = data.categories.find(category => category.toLowerCase() === args.category.trim().toLowerCase());
        return saved ? saved : '';
      }).then(saved => {
        if (saved) {
          const filter = element('#bookmarks-filter').value;
          if (filter && filter !== unsorted) element('#bookmark-category').value = filter;
        }
      });
    });
    element('#bookmark-cancel').addEventListener('click', resetForm);
    element('#bookmarks-filter').addEventListener('change', () => {
      const filter = element('#bookmarks-filter').value;
      if (!editing) element('#bookmark-category').value = filter === unsorted ? '' : filter;
      render();
    });
    element('#bookmarks-search').addEventListener('input', renderItems);

    element('#bookmark-category-add').addEventListener('click', () => editCategory(null));
    element('#bookmark-category-rename').addEventListener('click', () => editCategory(element('#bookmarks-filter').value));
    element('#bookmark-category-cancel').addEventListener('click', () => { categoryForm.hidden = true; });
    element('#bookmark-category-delete').addEventListener('click', () => {
      const name = element('#bookmarks-filter').value;
      if (window.confirm('Delete this category and keep its links in Unsorted?')) {
        void update('remove_bookmark_category', { name }, () => {
          if (element('#bookmark-category').value === name) element('#bookmark-category').value = '';
          return '';
        });
      }
    });
    categoryForm.addEventListener('submit', event => {
      event.preventDefault();
      const name = categoryField.value.trim();
      void update('rename_bookmark_category', { previous: previousCategory, name }, () => {
        categoryForm.hidden = true;
        const category = data.categories.find(value => value.toLowerCase() === name.toLowerCase()) || '';
        if (!editing || element('#bookmark-category').value === previousCategory) {
          element('#bookmark-category').value = category;
        }
        return category;
      });
    });
    render();
  }

  function show() {
    return update('list_bookmarks', {});
  }

  window.poniModules ||= {};
  window.poniModules.bookmarks = { mount, show };
})();
