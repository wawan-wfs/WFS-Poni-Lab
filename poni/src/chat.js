(() => {
  'use strict';

  const modules = window.poniModules ||= {};
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
  const maxPrompt = 4000;
  let page;
  let data;
  let busy = false;

  const element = selector => page.querySelector(selector);

  function showStatus(message) {
    element('.chat-status').textContent = message;
  }

  function activeConversation() {
    return data?.conversations.find(chat => chat.id === data.active);
  }

  function updateControls() {
    const prompt = element('.chat-prompt');
    const size = new TextEncoder().encode(prompt.value.trim()).length;
    const configured = Boolean(data?.model);
    element('.chat-size').textContent = `${size} / ${maxPrompt} bytes`;
    element('.chat-send').disabled = !configured || busy || size === 0 || size > maxPrompt;
    prompt.disabled = !configured || busy;
    element('.chat-delete').disabled = busy || !activeConversation();
    element('.chat-model').disabled = busy;
    element('.chat-settings button').disabled = busy;
    element('.chat-select').disabled = busy || !data;
  }

  function render() {
    const selector = element('.chat-select');
    selector.replaceChildren(new Option('New conversation', ''));
    for (const chat of data.conversations) {
      selector.add(new Option(chat.title, chat.id));
    }
    selector.value = data.active ?? '';
    element('.chat-model').value = data.model;
    const messages = element('.chat-messages');
    messages.replaceChildren();
    const active = activeConversation();
    if (active) {
      for (const entry of active.messages) {
        const row = document.createElement('article');
        row.className = `chat-message chat-${entry.role}`;
        const author = document.createElement('strong');
        author.textContent = entry.role === 'user' ? 'You' : 'Assistant';
        const text = document.createElement('p');
        text.textContent = entry.content;
        row.append(author, text);
        messages.append(row);
      }
    } else {
      const message = document.createElement('p');
      message.className = 'chat-empty';
      message.textContent = data.model ? 'Start a new conversation.' : 'Enter the name of an installed Ollama model to start.';
      messages.append(message);
    }
    messages.scrollTop = messages.scrollHeight;
    updateControls();
  }

  async function perform(command, args, success = () => {}, workingMessage = '') {
    if (busy) return;
    busy = true;
    updateControls();
    showStatus(workingMessage);
    try {
      data = await invoke(command, args);
      success();
      showStatus('');
      render();
    } catch (error) {
      const selector = element('.chat-select');
      selector.value = data?.active ?? '';
      showStatus(String(error));
    } finally {
      busy = false;
      updateControls();
    }
  }

  function send(event) {
    event.preventDefault();
    if (element('.chat-send').disabled) return;
    const prompt = element('.chat-prompt');
    void perform('chat_send', {
      conversationId: data.active,
      prompt: prompt.value.trim(),
    }, () => { prompt.value = ''; }, 'Waiting for Ollama…');
  }

  function mount(container) {
    page = container;
    page.innerHTML = `
      <form class="chat-settings">
        <label for="chat-model">Local Ollama model</label>
        <input id="chat-model" class="chat-model" type="text" maxlength="120" placeholder="qwen3:4b" required>
        <button type="submit">Save model</button>
      </form>
      <div class="chat-toolbar">
        <label for="chat-select">Conversation</label>
        <select id="chat-select" class="chat-select"></select>
        <button type="button" class="chat-delete">Delete chat</button>
      </div>
      <div class="chat-messages" role="log" aria-label="Chat messages"></div>
      <form class="chat-compose">
        <textarea class="chat-prompt" aria-label="Message" placeholder="Write a message…" rows="2" maxlength="4000"></textarea>
        <button type="submit" class="chat-send">Send</button>
        <small class="chat-size"></small>
      </form>
      <p class="chat-status" role="status"></p>`;
    element('.chat-settings').addEventListener('submit', event => {
      event.preventDefault();
      void perform('chat_model', {model: element('.chat-model').value.trim()});
    });
    element('.chat-select').addEventListener('change', event => {
      void perform('chat_select', {conversationId: event.target.value || null}, () => {
        element('.chat-prompt').value = '';
      });
    });
    element('.chat-delete').addEventListener('click', () => {
      if (data?.active && window.confirm('Delete this saved conversation?')) {
        void perform('chat_delete', {conversationId: data.active}, () => { element('.chat-prompt').value = ''; });
      }
    });
    element('.chat-compose').addEventListener('submit', send);
    element('.chat-prompt').addEventListener('input', updateControls);
    element('.chat-prompt').addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send(event);
    });
    updateControls();
  }

  async function show() {
    if (!data) await perform('chat_state');
  }

  modules.chat = {mount, show};
})();
