use super::Store;
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::State;
use uuid::Uuid;

const OLLAMA_CHAT: &str = "http://127.0.0.1:11434/api/chat";
const MAX_PROMPT: usize = 4_000;
const MAX_ANSWER: usize = 10_000;
const MAX_RESPONSE: usize = 128 * 1024;
const MAX_CONVERSATIONS: usize = 12;
const MAX_MESSAGES: usize = 24;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct ChatData {
    model: String,
    active: Option<Uuid>,
    conversations: Vec<Conversation>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Conversation {
    id: Uuid,
    title: String,
    messages: Vec<Message>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
struct Message {
    role: Role,
    content: String,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    User,
    Assistant,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: Message,
    done: bool,
}

fn model_name(model: &str) -> Result<&str, String> {
    let model = model.trim();
    if model.is_empty()
        || model.len() > 120
        || !model.as_bytes()[0].is_ascii_alphanumeric()
        || !model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_/:@".contains(&byte))
    {
        return Err("Enter an installed Ollama model name, such as qwen3:4b".into());
    }
    Ok(model)
}

impl ChatData {
    fn messages(&self, conversation_id: Option<Uuid>) -> Result<&[Message], String> {
        if self.active != conversation_id {
            return Err("The active conversation changed".into());
        }
        match conversation_id {
            None => Ok(&[]),
            Some(id) => self
                .conversations
                .iter()
                .find(|conversation| conversation.id == id)
                .map(|conversation| conversation.messages.as_slice())
                .ok_or_else(|| "Conversation no longer exists".into()),
        }
    }

    fn record(
        &mut self,
        conversation_id: Option<Uuid>,
        original: &[Message],
        model: &str,
        messages: Vec<Message>,
    ) -> Result<(), String> {
        if self.model != model || self.messages(conversation_id)? != original {
            return Err("The chat changed before the answer arrived. Send again to retry.".into());
        }
        let title = messages[0]
            .content
            .lines()
            .next()
            .unwrap_or("Chat")
            .chars()
            .take(60)
            .collect();
        if let Some(id) = conversation_id {
            let position = self
                .conversations
                .iter()
                .position(|conversation| conversation.id == id)
                .ok_or("Conversation no longer exists")?;
            let mut conversation = self.conversations.remove(position);
            conversation.messages = messages;
            self.conversations.insert(0, conversation);
        } else {
            let id = Uuid::new_v4();
            self.conversations.insert(
                0,
                Conversation {
                    id,
                    title,
                    messages,
                },
            );
            self.active = Some(id);
        }
        self.conversations.truncate(MAX_CONVERSATIONS);
        Ok(())
    }
}

async fn request_answer(model: &str, messages: &[Message]) -> Result<Message, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "Cannot initialize the Ollama connection")?;
    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "options": {"num_predict": 768, "num_ctx": 4096},
    });
    let mut response = client
        .post(OLLAMA_CHAT)
        .json(&payload)
        .send()
        .await
        .map_err(|error| {
            if error.is_connect() {
                "Ollama is unavailable. Start Ollama on this computer and try again."
            } else if error.is_timeout() {
                "Ollama took too long to respond"
            } else {
                "Cannot contact the local Ollama service"
            }
        })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("This model is not installed in Ollama".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Ollama returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err("The Ollama response exceeds the size limit".into());
    }

    let mut body = Vec::new();
    while let Some(bytes) = response
        .chunk()
        .await
        .map_err(|_| "Cannot read the Ollama response")?
    {
        if body.len().saturating_add(bytes.len()) > MAX_RESPONSE {
            return Err("The Ollama response exceeds the size limit".into());
        }
        body.extend_from_slice(&bytes);
    }
    let answer: OllamaResponse =
        serde_json::from_slice(&body).map_err(|_| "Ollama returned an invalid response")?;
    if !answer.done
        || answer.message.role != Role::Assistant
        || answer.message.content.trim().is_empty()
    {
        return Err("Ollama returned no text answer".into());
    }
    let mut message = answer.message;
    let mut end = message.content.len().min(MAX_ANSWER);
    while !message.content.is_char_boundary(end) {
        end -= 1;
    }
    message.content.truncate(end);
    Ok(message)
}

#[tauri::command]
pub(super) fn chat_state(store: State<'_, Mutex<Store>>) -> Result<ChatData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .chat
        .clone())
}

#[tauri::command]
pub(super) fn chat_model(
    store: State<'_, Mutex<Store>>,
    model: String,
) -> Result<ChatData, String> {
    let model = model_name(&model)?;
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.chat.model = model.to_owned();
            Ok(())
        })?;
    Ok(saved.chat)
}

#[tauri::command]
pub(super) fn chat_select(
    store: State<'_, Mutex<Store>>,
    conversation_id: Option<Uuid>,
) -> Result<ChatData, String> {
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            if conversation_id.is_some_and(|id| {
                !data
                    .chat
                    .conversations
                    .iter()
                    .any(|conversation| conversation.id == id)
            }) {
                return Err("Conversation no longer exists".into());
            }
            data.chat.active = conversation_id;
            Ok(())
        })?;
    Ok(saved.chat)
}

#[tauri::command]
pub(super) fn chat_delete(
    store: State<'_, Mutex<Store>>,
    conversation_id: Uuid,
) -> Result<ChatData, String> {
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.chat
                .conversations
                .retain(|conversation| conversation.id != conversation_id);
            if data.chat.active == Some(conversation_id) {
                data.chat.active = None;
            }
            Ok(())
        })?;
    Ok(saved.chat)
}

#[tauri::command]
pub(super) async fn chat_send(
    store: State<'_, Mutex<Store>>,
    conversation_id: Option<Uuid>,
    prompt: String,
) -> Result<ChatData, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.len() > MAX_PROMPT {
        return Err("Enter 1 to 4,000 bytes of text".into());
    }
    let (model, original) = {
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        let chat = &store.data.chat;
        (
            model_name(&chat.model)?.to_owned(),
            chat.messages(conversation_id)?.to_vec(),
        )
    };
    let mut messages = original.clone();
    if messages.len() >= MAX_MESSAGES {
        let oldest = messages.len() - (MAX_MESSAGES - 2);
        messages.drain(..oldest);
    }
    messages.push(Message {
        role: Role::User,
        content: prompt.to_owned(),
    });
    messages.push(request_answer(&model, &messages).await?);
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.chat
                .record(conversation_id, &original, &model, messages)
        })?;
    Ok(saved.chat)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_exchanges_and_rejects_replies_to_removed_conversations() {
        let mut state = ChatData {
            model: "qwen3:4b".into(),
            ..ChatData::default()
        };
        let messages = vec![
            Message {
                role: Role::User,
                content: "Hello".into(),
            },
            Message {
                role: Role::Assistant,
                content: "Hi".into(),
            },
        ];
        assert!(state
            .record(None, &[], "qwen3:4b", messages.clone())
            .is_ok());
        let original_id = state.active;
        let saved = serde_json::to_string(&state).unwrap();
        let mut restored: ChatData = serde_json::from_str(&saved).unwrap();
        assert_eq!(restored.messages(original_id).unwrap()[1].content, "Hi");
        restored.conversations.clear();
        restored.active = None;
        assert!(restored
            .record(original_id, &messages, "qwen3:4b", messages.clone())
            .is_err());
        assert!(restored.conversations.is_empty());
        assert!(model_name("https://other host").is_err());
    }
}
