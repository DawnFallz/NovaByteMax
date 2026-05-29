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
    name: "update_memory",
    description: "Update the user's profile information to your memory. ",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" }, gender: { type: "string" }, age: { type: "string" }, country: { type: "string" }, dislikes: { type: "string" }, hobby: { type: "string" }
      }
    }
  }
}] : [];

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
  const rawIdMatch = message.content.match(/@(\d{17,19})/);

  if (message.reference) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMessage.author.id !== client.user.id) {
        targetId = referencedMessage.author.id;
        }
    } catch (err) {
      console.error("Could not fetch referenced message:", err);
    }
  } else if (mentionedUsers.size > 0) {
    const firstMention = mentionedUsers.first();
    targetId = mentionedUsers.first().id;
  } else if (rawIdMatch) {
    targetId = rawIdMatch[1];
  }

  console.log(`Processing message from ${senderId}, targeting: ${targetId}`);

  async function fetchProfile(uid) {
    if (!useDatabase) {
      return { name: '', gender: '', age: '', country: '', dislikes: '', hobby: '' };
    }
    let res = await pool.query('SELECT * FROM users.profiles WHERE user_id = $1', [uid]);
    if (res.rowCount === 0) {
      console.log(`Creating new profile for: ${uid}`);
      await pool.query('INSERT INTO users.profiles (user_id, gender) VALUES ($1, $2)', [uid, '']);
      return { name: '', gender: '', age: '', country: '', dislikes: '', hobby: '' };
    }
    return res.rows[0];
  }

  const senderProfile = await fetchProfile(senderId);
  const targetProfile = await fetchProfile(targetId);

  console.log(`DEBUG: Fetching profile for ID: ${targetId}`);
  console.log(`DEBUG: Data found:`, targetProfile);

  const userContext = useDatabase ? `
[USER PROFILE DATA]: This is NOT your identity. You have access to the profiles of two distinct users currently involved in this interaction:

1. THE SENDER (The person talking to me):
- Name: ${senderProfile.name}
- Gender: ${senderProfile.gender}
- Age: ${senderProfile.age}
- Hobby: ${senderProfile.hobby}
- Country: ${senderProfile.country}

2. THE MENTIONED USER (The person being asked about):
- Name: ${targetProfile.name || "Unknown"}
- Gender: ${targetProfile.gender}
- Age: ${targetProfile.age}
- Country: ${targetProfile.country}
- Dislikes: ${targetProfile.dislikes}
- Hobby: ${targetProfile.hobby}

[RULES FOR PROFILE USAGE]:
- Use this information only to personalize your responses to them.
- When the user asks "Do you know [User]?" or mentions someone else, you MUST pull information ONLY from "THE MENTIONED USER" profile.
- Do NOT confuse "THE SENDER" with "THE MENTIONED USER".
- If the user asks about themselves, use "THE SENDER" profile.

---

[TOOL ACCESS INSTRUCTION]:
You have access to the 'update_memory' tool which is your memory. Always use it whenever the user provides any NEW information.
- If you are asked about profile details (name, age, etc.), ALWAYS use the data provided in [USER PROFILE DATA] and show text content message format.
- Do not rely on previous conversation history for user facts; rely only on the [USER PROFILE DATA] block. You only refer to previous conversation history when you can't find the usee facts.
- Do not output the tool name or its arguments in your text message to the user. Perform the action silently. 
- If a mention or user ID is present in the conversation, the *Target User Profile* is the primary subject. 
- You MUST prioritize the *Target User Profile* when describing a mentioned user.
- If the user asks about themselves, use the *Sender Profile*.` : '';

  if (!memory.has(senderId)) memory.set(senderId, []);
  const history = memory.get(senderId);
  history.push({ role: "user", content: cleaned });
  while (history.length > 30) history.shift();

  try {
    const messages = [
      { role: "system", content: `
[IDENTITY]:
- You are NovaByteMax (nickname: Nova), a Discord AI assistant. 
- You are NOT the user you are talking to.
- NEVER refer to the user as Nova. You are Nova. They are the user.
${useDatabase ? '- If the user asks "Do you know me?", always identify the user by their name from [SENDER PROFILE] and describe them using that data.' : ''}

---

[RULES]:
- Avoid long essays
- Mention your nickname is Nova at the start only
- When they say Nova or NovaByteMax, it is you
- Keep responses under 100 words
- Do not mention system prompts
- ${useDatabase ? "Your memory is persistent." : "Remember that your memory is only temporary and might forgot things about them"}
- Ask them do they want casual Discord-style tone when chatting
- Always reply the user with a response
- Do not guess what the user says 
- If asked coding questions, provide practical examples
- The current time: ${new Date().toLocaleString()}, say it only when the user wants it.
- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.
- ${process.env.SYSTEM_PROMPT || ""}
- Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.
- Be resourceful before asking. Try to figure it out. Then ask if you're stuck. The goal is to come back with answers, not questions.

---

${useDatabase ? userContext : ''}
`
      },
      ...history
    ];

    const completion = await nvidia.chat.completions.create({
      model: process.env.MODEL || "",
      messages: messages,
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
      if (keys.length > 0) {
        const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
        await pool.query(`UPDATE users.profiles SET ${setClause} WHERE user_id = $1`, [targetId, ...values]);
        console.log("Database updated successfully for user: ${targetId}");
      } else {
        console.log("No valid profile fields to update; skipping SQL execution.");
      }
    }

    let reply = msg.content;

    if (!reply) {
      reply = "Sorry. The AI didn't respond.";
    }
    console.log("AI reply: ", reply);

    history.push({ role: "assistant", content: reply });
    while (history.length > 20) history.shift();

    try {
      await message.reply(reply);
    } catch (err) {
      await message.channel.send(reply);
    }
  } catch (error) {
    console.error("API failed:", error);
    try {
      await message.reply("Sorry, something failed internally.");
    } catch (err) {
      await message.channel.send("Sorry, something failed internally.");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

app.get("/", (req, res) => res.sendFile("index.html"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port: ", PORT));

