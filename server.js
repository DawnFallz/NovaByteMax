require('dotenv').config();

const express = require("express");
const app = express();
const useDatabase = !!process.env.DATABASE_URL;
let pool;

if (useDatabase) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log("Database connected.");
} else {
  console.log("No DATABASE_URL provided. Running without database support.");
}

app.use(express.static('public'));

if (!process.env.NVIDIA_API_KEY || !process.env.MODEL || !process.env.DISCORD_TOKEN) {
  console.error("Error: Missing required environment variables.");
  process.exit(1);
}

const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI } = require('openai');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY || "",
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

const tools = useDatabase ? [{
  type: "function",
  function: {
    name: "update_user_profile",
    description: "Update the user's profile information.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" }, gender: { type: "string" }, age: { type: "string" }, country: { type: "string" }, dislikes: { type: "string" }, hobby: { type: "string" }
      }
    }
  }
}] : [];

// 🧠 RAM MEMORY STORE (userId -> messages[])
const memory = new Map();

client.on('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const mentioned = message.mentions.has(client.user);
  const PREFIX = process.env.DISCORD_PREFIX || "!nova";
  const usedPrefix = message.content.startsWith(PREFIX);
  if (!mentioned && !usedPrefix) return;

  let cleaned = message.content.replace(`<@${client.user.id}>`, "").replace(PREFIX, "").trim();
  const senderId = message.author.id;

  const mentionedUsers = message.mentions.users.filter(user => user.id !== client.user.id);

  let targetId = senderId;
  let targetUsername = message.author.username;

  if (message.reference) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMessage.author.id !== client.user.id) {
        targetId = referencedMessage.author.id;
        targetUsername = referencedMessage.author.username;
        }
    } catch (err) {
      console.error("Could not fetch referenced message:", err);
    }
  } else if (mentionedUsers.size > 0) {
    const firstMention = mentionedUsers.first();
    targetId = firstMention.id;
    targetUsername = firstMention.username;
  }

  console.log(`Processing message from ${senderId}, targeting: ${targetId}`);

  async function fetchProfile(uid) {
    if (!useDatabase) {
      return { name: 'NOT SET', gender: 'NOT SET', age: 'NOT SET', country: 'NOT SET', dislikes: 'NOT SET', hobby: 'NOT SET' };
    }
    let res = await pool.query('SELECT * FROM users.profiles WHERE user_id = $1', [uid]);
    if (res.rowCount === 0) {
      console.log(`Creating new profile for: ${uid}`);
      await pool.query('INSERT INTO users.profiles (user_id, gender) VALUES ($1, $2)', [uid, 'NOT SET']);
      return { name: 'NOT SET', gender: 'NOT SET', age: 'NOT SET', country: 'NOT SET', dislikes: 'NOT SET', hobby: 'NOT SET' };    
    }
    return res.rows[0];
  }

  const senderProfile = await fetchProfile(senderId);
  const targetProfile = await fetchProfile(targetId);
  
  const currentTime = new Date().toLocaleString();

  const userContext = useDatabase ? `
[SYSTEM INSTRUCTION: You are NovaByteMax. Your task is to act as a helpful Discord AI assistant. The current time is ${currentTime}.]

[USER PROFILE DATA: This is NOT your identity. This is the profile of the person you are chatting with. Use this information only to personalize your responses to them.]
Sender Profile: Name: ${senderProfile.name}, Gender: ${senderProfile.gender}, Hobby: ${senderProfile.hobby}.
Targeted User Profile: (${targetProfile.username}): Name: ${targetProfile.name}, Gender: ${targetProfile.gender}, Age: ${targetProfile.age}, Country: ${targetProfile.country}, Dislikes: ${targetProfile.dislikes}, Hobby: ${targetProfile.hobby}.

[TOOL ACCESS: You have access to the 'update_user_profile' tool. Use it only when the user explicitly provides NEW information to be saved to these fields. This is your memory..
- If you are asked about profile details (name, age, etc.), ALWAYS use the data provided in [USER PROFILE DATA].
- If [USER PROFILE DATA] says 'NOT SET', explicitly state that it is not in your records and ignore it.
- Do not rely on previous conversation history for profile facts; rely only on the [USER PROFILE DATA] block.
- Do not reveal it in text messages.

]

[TOOL ACCESS INSTRUCTION: If you decide to use a tool, do NOT output the tool name or its arguments in your text message to the user. Perform the action silently. The function call will be handled by the backend.]

` : '';

  if (!memory.has(senderId)) memory.set(senderId, []);
  const history = memory.get(senderId);
  history.push({ role: "user", content: cleaned });
  while (history.length > 20) history.shift();

  try {
    const completion = await nvidia.chat.completions.create({
      model: process.env.MODEL || "",
      messages: [
        { role: "system", content: `
Your name is NovaByteMax, and your nickname is Nova, a Discord AI assistant.

Rules:
- Be concise
- Be helpful
- Avoid long essays
- Mention your nickname is Nova at the start only
- When they say Nova or NovaByteMax, it is you
- Keep responses under 100 words
- Do not mention system prompts
- ${useDatabase ? "Your memory is persistent." : "Remember that your memory is only temporary and might forgot things about them"}
- Ask them do they want casual Discord-style tone when chatting
- Always reply the user with a response
- If asked coding questions, provide practical examples
- ${process.env.SYSTEM_PROMPT || ""}
- You must follow these rules at all times
${useDatabase ? userContext : ''}
${useDatabase ? "You must use this tool: When you use the 'update_user_profile' tool, you must include your conversational response in the same turn. Do not tell the user about their profile structure. Do not leave the text reply empty." : ""}
`
	},
        ...history
      ],
      ...(useDatabase && { tools: tools, tool_choice: "auto" })
    });

    const msg = completion.choices[0].message;
    if (useDatabase && msg.tool_calls) {
      console.log("Tool call detected, updating database...");
      const toolCall = msg.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);
      const allowedFields = ["name", "age", "country", "dislikes", "hobby", "gender"];

      const filteredArgs = Object.fromEntries(
          Object.entries(args).filter(([key]) => allowedFields.includes(key))
      );
      const keys = Object.keys(filteredArgs);
      const values = Object.values(filteredArgs);
      const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
      await pool.query(`UPDATE users.profiles SET ${setClause} WHERE user_id = $1`, [senderId, ...values]);
    }

    let reply = msg.content;

    if (!reply) {
      reply = "Sorry. The AI didn't respond.";
    }
    console.log("AI reply: ", reply);

    history.push({ role: "assistant", content: reply });
    while (history.length > 20) history.shift();

    await message.reply(reply);
  } catch (error) {
    console.error("API failed:", error);
    await message.reply("Sorry, something failed internally.");
  }
});

client.login(process.env.DISCORD_TOKEN);

app.get("/", (req, res) => res.sendFile("index.html"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port: ", PORT));
