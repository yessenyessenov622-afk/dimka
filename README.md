# Karas Telegram Bot

A TypeScript Telegram bot for anonymous messages and personal task tracking.
It runs with Telegram long polling, so it does not need an inbound HTTP port or
a webhook.

## Features

- Anonymous messages to the owner, with owner-only sender identification.
- Reply sessions, including a persistent reply mode.
- Conversation history and an owner administration panel.
- Personal tasks with priorities, statuses, due dates, and reminders.
- SQLite storage through Prisma; no separate database service is required.

## Local development

Requirements: Node.js 20.19 or newer and npm.

1. Install dependencies with npm ci.
2. Copy .env.example to .env and set the Telegram token and owner ID.
3. Keep DATABASE_URL=file:./dev.db for a local SQLite database.
4. Apply the schema with npm run db:migrate.
5. Build with npm run build and run with npm start.

Keep .env and SQLite database files out of Git.

## AWS deployment

Production runs on the existing EC2 instance selected by the owner.
Deployment details, the systemd service, and automatic GitHub
deployment are documented in infra/README.md.
