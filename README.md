[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/logo-javascript-blue?logo=javascript)](https://mozilla.org)
[![Discord.js](https://img.shields.io/badge/Built%20with-discord.js-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.js.org/)

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=5865f2&height=180&section=header&text=NovaByteMax&fontSize=50&fontColor=ffffff" alt="Project Banner" width="100%">
</p>

# NovaByteMax

An AI Discord Assistant bot.
It supports Nvidia models only unless you change the code.

---

## Cloning

Feel free to clone it.

``` bash
git clone https://github.com/DawnFallz/NovaByteMax.git
cd NovaByteMax
npm start

```

---

### Requirements

Make a copy .env.example file as .env file and put the requirements in.

``` bash
cp .env.example .env

```

Example:

``` .env
DISCORD_TOKEN=xxxxxx
NVIDIA_API_KEY=xxxxxx
MODEL=xxxxxx
DATABASE_URL=xxxxxx
DISCORD_PREFIX=xxxxxx
SYSTEM_PROMPT=xxxxxx

```

**(OPTIONAL VARIABLES)**
- DATABASE_URL
- DISCORD_PREFIX
- SYSTEM_PROMPT

Note: If the DATABASE_URL variable is empty, there will be no database for this bot.
Note: The DISCORD_PREFIX variable is used for when calling the bot (e.g. !nova)
Note: The SYSTEM_PROMPT variable is for additional system prompts and it isn'r required but the rest are required.

---

## Notes
Built as a learning project for my learning journey.

Built with Discord.js

This project is deployed in Render free tier.

---

by **DawnFallz**
