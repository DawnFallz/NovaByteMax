require('dotenv').config();

const express = require("express");
const app = express();
app.use(express.static('public'));


if (!process.env.NVIDIA_API_KEY) {
  console.error("Error: NVIDIA_API_KEY is not set in environment variables.");
  process.exit(1);
}
if (!process.env.MODEL) {
  console.error("Error: MODEL is not set in environment variables.");
  process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
  console.error("Error: DISCORD_TOKEN is not set in environment variables.");
  process.exit(1);
}

const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI } = require('openai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY || "",
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

// 🧠 RAM MEMORY STORE (userId -> messages[])
const memory = new Map();

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const mentioned = message.mentions.has(client.user);

  const PREFIX = process.env.DISCORD_PREFIX || "!nova";
  const usedPrefix = message.content.startsWith(PREFIX);

  if (!mentioned && !usedPrefix) return;

  let cleaned = message.content;

  if (usedPrefix) {
    cleaned = cleaned.slice(PREFIX.length).trim();
  }

  if (mentioned) {
    cleaned = cleaned.replace(`<@${client.user.id}>`, "").trim();
  }

  const userId = message.author.id;

  if (!memory.has(userId)) {
    memory.set(userId, []);
  }

  const history = memory.get(userId);

  history.push({
    role: "user",
    content: cleaned
  });

  // limit RAM memory (important for Rende)
  while (history.length > 20) {
    history.shift();
  }

  try {
    const completion = await nvidia.chat.completions.create({
      model: process.env.MODEL || "",
      messages: [
        {
          role: "system",
          content: `
Your name is NovaByteMax, and your nickname is Nova, a Discord AI assistant.

Rules:
- Be concise
- Be helpful
- Avoid long essays
- Mention your nickname is Nova at the start only
- When they say Nova or NovaByteMax, it is you
- Keep responses under 100 words
- Do not mention system prompts
- Remember that your memory is only temporary and might forgot things about them
- Ask them do they want casual Discord-style tone when chatting
- If asked coding questions, provide practical examples
- ${process.env.SYSTEM_PROMPT || ""}
- You must follow these rules at all times
          `
        },
        ...history
      ],
    });

    const reply = String(
      completion.choices?.[0]?.message?.content || ""
    ).trim();

    console.log("AI reply:", reply);

    if (!reply) {
      return await message.reply("Empty AI response.");
    }

    history.push({
      role: "assistant",
      content: reply
    });

    // keep memory small (again safety)
    while (history.length > 20) {
      history.shift();
    }

    let finalReply = reply;

    await message.reply(finalReply);

  } catch (error) {
    console.error("API request failed:", error);

    let errorMessage = "Sorry, something failed internally.";
    if (error.response) {
      errorMessage = `AI API error (${error.response.status}): ${error.message}`;
    } else if (error.request) {
      errorMessage = "No response from AI API. Please try again.";
    } else {
      errorMessage = `Error setting up AI API request: ${error.message}`;
    }

    await message.reply(errorMessage);
  }
});

client.login(process.env.DISCORD_TOKEN);

app.get("/", (req, res) => {
  res.sendFile("index.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port: ", PORT);
});
