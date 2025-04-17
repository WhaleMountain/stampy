const props = PropertiesService.getScriptProperties().getProperties();
const GEMINI_API_KEY = props.GEMINI_API_KEY;
const GEMINI_AI_MODEL = "gemma-3-27b-it";
const SLACK_API_TOKEN = props.SLACK_API_TOKEN;
const SLACK_VERIFICATION_TOKEN = props.SLACK_VERIFICATION_TOKEN;

// Slack Event API
function doPost(event) {
  const payload = JSON.parse(event.postData.getDataAsString());
  if (payload.type === "url_verification") {
    return ContentService.createTextOutput(JSON.stringify(payload.challenge));
  }
  if (payload.token !== SLACK_VERIFICATION_TOKEN) return;
  if (payload.event.item.type !== 'message') return;
  if (payload.event.reaction !== 'robot_face') return;

  const channel = payload.event.item.channel;
  const ts = payload.event.item.ts;

  // メッセージ内容の取得
  const { message, usedReactions } = get_message_and_reactions(channel, ts);
  if (!message) return ContentService.createTextOutput("failed to get message");

  // リアクションの生成
  const reactions = generate_reactions(message, usedReactions);
  if (!reactions) return ContentService.createTextOutput("failed to generate reactions");

  // リアクションの追加
  for (let reaction of reactions) {
    const r = reaction.match(/:(.+):/);
    if(r && r[1]) {
      post_reaction(channel, ts, r[1]);
    }
  }

  return ContentService.createTextOutput("ok");
}

// メッセージにリアクションを追加する
function post_reaction(channel, timestamp, reaction) {
  const apiUrl = "https://slack.com/api/reactions.add"
  const options = {
    'method': 'post',
    'headers': {
      'Authorization': `Bearer ${SLACK_API_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'channel': channel,
      'timestamp': timestamp,
      'name': reaction
    }
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const data = JSON.parse(response.getContentText());

  return data['ok'];
}

// robot_faceリアクションが追加されたメッセージ内容とリアクション一覧を取得する
function get_message_and_reactions(channel, timestamp) {
  const apiUrl = "https://slack.com/api/reactions.get"
  const options = {
    'method': 'get',
    'headers': {
      'Authorization': `Bearer ${SLACK_API_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'channel': channel,
      'timestamp': timestamp,
      'full': true
    }
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const data = JSON.parse(response.getContentText());

  const message = data.message.text;
  let usedReactions = '';
  if (data.message.reactions) {
    usedReactions = data.message.reactions.map(reaction => `:${reaction.name}:`).join(',');
  }

  return {message: message, usedReactions: usedReactions};
}

// Gemini APIを使ってリアクションを生成する
function generate_reactions(message, usedReactions) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_AI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `以下のSlackメッセージにリアクションする、メッセージ内容に関連したユーモアのある絵文字を3つ考えてください。
            絵文字は「:名前1:,:名前2:,:名前3:」のように、カンマ区切りで「:英単語:」のみを用いて出力してください。
            出力には絵文字の名前以外のテキストを含めないでください。
            使用済みリアクションに含まれる絵文字は候補から除外してください。
            カスタム絵文字やUnicodeに含まれない絵文字、不適切な意味を持つ絵文字は使用しないでください。
            ## Slackメッセージ
            ${message}
            
            ## 使用済みリアクション
            ${usedReactions}`
          }
        ]
      }
    ]
  };

  const options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  };

  const response = UrlFetchApp.fetch(apiUrl, options)
  const data = JSON.parse(response);
  const content = data.candidates[0].content.parts[0].text;

  return content.split(/,/);
}
