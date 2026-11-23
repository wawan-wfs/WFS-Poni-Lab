from playwright.sync_api import expect


def test_chat(page):
    page.evaluate('''() => {
      const original = window.__TAURI__.core.invoke;
      let chat = {model:'', active:null, conversations:[]};
      window.chatRequests = [];
      window.__TAURI__.core.invoke = async (command, args) => {
        switch (command) {
          case 'chat_state': break;
          case 'chat_model':
            chat.model = args.model;
            break;
          case 'chat_select':
            chat.active = args.conversationId;
            break;
          case 'chat_send': {
            window.chatRequests.push(args);
            if (args.prompt === 'offline') throw new Error('Ollama is unavailable');
            let target = chat.conversations.find(item => item.id === chat.active);
            if (!target) {
              target = {id:crypto.randomUUID(), title:args.prompt, messages:[]};
              chat.conversations.unshift(target);
              chat.active = target.id;
            }
            target.messages.push({role:'user',content:args.prompt}, {role:'assistant',content:'<b>Text answer</b>'});
            break;
          }
          case 'chat_delete':
            chat.conversations = chat.conversations.filter(item => item.id !== args.conversationId);
            chat.active = null;
            break;
          default: return original(command, args);
        }
        return structuredClone(chat);
      };
    }''')
    page.locator('[data-page="chat"]').click()
    panel = page.locator('#page-chat')
    prompt = panel.get_by_role('textbox', name='Message')
    expect(prompt).to_be_disabled()
    panel.get_by_label('Local Ollama model').fill('qwen3:4b')
    panel.get_by_role('button', name='Save model').click()
    expect(prompt).to_be_enabled()
    prompt.fill('界' * 1334)
    expect(panel.get_by_role('button', name='Send')).to_be_disabled()
    prompt.fill('offline')
    prompt.press('Control+Enter')
    expect(panel.get_by_role('status')).to_contain_text('Ollama is unavailable')
    expect(prompt).to_have_value('offline')
    prompt.fill('Hello Poni')
    prompt.press('Control+Enter')
    log = panel.get_by_role('log', name='Chat messages')
    expect(log).to_contain_text('<b>Text answer</b>')
    expect(log.locator('b')).to_have_count(0)
    assert page.evaluate('window.chatRequests[1]') == {'conversationId': None, 'prompt': 'Hello Poni'}

    conversations = panel.get_by_label('Conversation')
    saved = conversations.input_value()
    conversations.select_option('')
    expect(log).to_contain_text('Start a new conversation.')
    conversations.select_option(saved)
    expect(log).to_contain_text('Hello Poni')
    page.once('dialog', lambda dialog: dialog.accept())
    panel.get_by_role('button', name='Delete chat').click()
    expect(conversations.locator('option')).to_have_count(1)
    expect(log).to_contain_text('Start a new conversation.')
