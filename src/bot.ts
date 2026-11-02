import { Markup, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import { DateTime } from 'luxon';
import cron from 'node-cron';
import { Prisma, DialogStatus, MessageDirection, MessageKind, TaskPriority, TaskStatus } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { escapeHtml, isOwner, isValidTimezone, pageCount, parseLocalDateTime, reminderAt, shouldRouteToReplySession } from './domain';

const PAGE_SIZE = 8;
const OWNER_KEY = 1;
type Ctx = Context;
type Button = ReturnType<typeof Markup.button.callback>;

const USER_COMMANDS = [
  { command: 'start', description: 'Начать работу' },
  { command: 'help', description: 'Инструкция по боту' },
  { command: 'cancel', description: 'Отменить текущее действие' },
];
const OWNER_COMMANDS = [
  ...USER_COMMANDS,
  { command: 'admin', description: 'Панель владельца' },
  { command: 'inbox', description: 'Входящие сообщения' },
  { command: 'stats', description: 'Статистика бота' },
  { command: 'tasks', description: 'Трекер задач' },
  { command: 'task_add', description: 'Создать задачу' },
  { command: 'settings', description: 'Настройки бота' },
  { command: 'active', description: 'Текущий диалог' },
  { command: 'stop', description: 'Завершить режим ответа' },
];

function keyboard(rows: Button[][]) {
  return Markup.inlineKeyboard(rows);
}

function button(text: string, data: string): Button {
  return Markup.button.callback(text, data);
}

function nameOf(user: { firstName: string; lastName?: string | null; username?: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || (user.username ? `@${user.username}` : 'Пользователь');
}

function isCommandMessage(message: unknown): boolean {
  return !!message && typeof message === 'object' && 'text' in message && typeof message.text === 'string' && message.text.startsWith('/');
}

async function show(ctx: Ctx, text: string, rows: Button[][] = []): Promise<void> {
  const options = { parse_mode: 'HTML' as const, ...(rows.length ? keyboard(rows) : {}) };
  try {
    if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
      await ctx.editMessageText(text, options);
    } else {
      await ctx.reply(text, options);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('message is not modified')) return;
    if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
      await ctx.reply(text, options);
    } else {
      throw error;
    }
  }
}

async function ownerSettings() {
  return prisma.ownerSettings.upsert({
    where: { id: OWNER_KEY },
    create: { id: OWNER_KEY, ownerTelegramId: config.ownerTelegramId, timezone: config.defaultTimezone },
    update: { ownerTelegramId: config.ownerTelegramId },
  });
}

async function currentFlow() {
  return prisma.ownerFlow.findUnique({ where: { ownerId: OWNER_KEY } });
}

async function setFlow(kind: string, data: Record<string, unknown> = {}) {
  const jsonData = data as Prisma.InputJsonObject;
  return prisma.ownerFlow.upsert({
    where: { ownerId: OWNER_KEY },
    create: { ownerId: OWNER_KEY, kind, data: jsonData },
    update: { kind, data: jsonData },
  });
}

async function clearFlow() {
  await prisma.ownerFlow.deleteMany({ where: { ownerId: OWNER_KEY } });
}

function flowData(data: Prisma.JsonValue | null): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

async function ownerGuard(ctx: Ctx): Promise<boolean> {
  if (isOwner(ctx.from?.id, config.ownerTelegramId)) return true;
  await ctx.reply('⛔ Эта функция доступна только владельцу бота.');
  return false;
}

function taskPriorityLabel(priority: TaskPriority): string {
  return priority === 'HIGH' ? '🔴 Высокий' : priority === 'MEDIUM' ? '🟡 Средний' : '🟢 Низкий';
}

function taskStatusLabel(status: TaskStatus): string {
  return ({ NEW: 'Новая', IN_PROGRESS: 'В процессе', COMPLETED: 'Выполнена', CANCELLED: 'Отменена' })[status];
}

function formatDate(date: Date | null, timezone: string): string {
  return date ? DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).toFormat('dd.LL.yyyy HH:mm') : 'не задан';
}

function kindLabel(kind: MessageKind): string {
  return ({
    TEXT: 'текст', PHOTO: 'фото', VIDEO: 'видео', DOCUMENT: 'документ', AUDIO: 'аудио', VOICE: 'голосовое',
    STICKER: 'стикер', ANIMATION: 'анимация', VIDEO_NOTE: 'видеосообщение', LOCATION: 'геопозиция', CONTACT: 'контакт',
    POLL: 'опрос', VENUE: 'место', OTHER: 'вложение',
  })[kind];
}

function messageKind(message: object): MessageKind {
  const keys: [string, MessageKind][] = [
    ['text', 'TEXT'], ['photo', 'PHOTO'], ['video', 'VIDEO'], ['document', 'DOCUMENT'], ['audio', 'AUDIO'],
    ['voice', 'VOICE'], ['sticker', 'STICKER'], ['animation', 'ANIMATION'], ['video_note', 'VIDEO_NOTE'],
    ['location', 'LOCATION'], ['contact', 'CONTACT'], ['poll', 'POLL'], ['venue', 'VENUE'],
  ];
  for (const [key, kind] of keys) if (key in message) return kind;
  return 'OTHER';
}

function messageText(message: object): string | null {
  if ('text' in message && typeof message.text === 'string') return message.text;
  if ('caption' in message && typeof message.caption === 'string') return message.caption;
  return null;
}

function preview(text: string | null, kind: MessageKind): string {
  const value = text?.replace(/\s+/g, ' ').trim() || `[${kindLabel(kind)}]`;
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

async function mainMenu(ctx: Ctx) {
  await show(ctx, '🛠 <b>Панель владельца</b>\n\nВыберите раздел:', [
    [button('📩 Входящие сообщения', 'inbox:0')],
    [button('👥 Пользователи', 'people:0')],
    [button('📊 Статистика', 'stats')],
    [button('✅ Мои задачи', 'tasks:active:0'), button('➕ Добавить задачу', 'task:add')],
    [button('⚙️ Настройки', 'settings')],
  ]);
}

async function showInbox(ctx: Ctx, page = 0) {
  const total = await prisma.dialog.count();
  const pages = pageCount(total, PAGE_SIZE);
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const dialogs = await prisma.dialog.findMany({
    include: { user: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
    skip: safePage * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const unreadTotal = await prisma.message.count({ where: { direction: 'INBOUND', isRead: false } });
  const rows: Button[][] = [];
  for (const dialog of dialogs) {
    const unread = await prisma.message.count({ where: { dialogId: dialog.id, direction: 'INBOUND', isRead: false } });
    const latest = dialog.messages[0];
    const mark = dialog.status === 'OPEN' ? '🟢' : '⚪';
    const unreadMark = unread ? ` · 🔔${unread}` : '';
    rows.push([button(`${mark} ${nameOf(dialog.user)}${unreadMark}`, `dialog:${dialog.id}`)]);
    if (latest) rows.push([button(`   ${preview(latest.text, latest.kind)}`, `history:${dialog.id}:0`)]);
  }
  if (!dialogs.length) rows.push([button('🔎 Найти пользователя', 'search:start')]);
  const pager: Button[] = [];
  if (safePage > 0) pager.push(button('⬅️', `inbox:${safePage - 1}`));
  pager.push(button(`${safePage + 1}/${pages}`, 'noop'));
  if (safePage + 1 < pages) pager.push(button('➡️', `inbox:${safePage + 1}`));
  rows.push(pager);
  rows.push([button('🔎 Поиск', 'search:start'), button('🏠 Главное меню', 'admin')]);
  await show(ctx, `📩 <b>Входящие</b> · непрочитанных: <b>${unreadTotal}</b>\nВыберите диалог или сообщение.`, rows);
}

async function showPeople(ctx: Ctx, page = 0) {
  const total = await prisma.user.count();
  const pages = pageCount(total, PAGE_SIZE);
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const users = await prisma.user.findMany({
    include: { dialogs: { include: { _count: { select: { messages: true } } } } },
    orderBy: { updatedAt: 'desc' }, skip: safePage * PAGE_SIZE, take: PAGE_SIZE,
  });
  const rows: Button[][] = users.map((user) => [button(`👤 ${nameOf(user)} · ${user.dialogs[0]?._count.messages ?? 0}`, `profile:${user.dialogs[0]?.id ?? 0}`)]);
  const pager: Button[] = [];
  if (safePage > 0) pager.push(button('⬅️', `people:${safePage - 1}`));
  pager.push(button(`${safePage + 1}/${pages}`, 'noop'));
  if (safePage + 1 < pages) pager.push(button('➡️', `people:${safePage + 1}`));
  rows.push(pager, [button('🔎 Поиск', 'search:start'), button('⬅️ Назад', 'admin')]);
  await show(ctx, `👥 <b>Пользователи</b> · всего: ${total}`, rows);
}

async function showProfile(ctx: Ctx, dialogId: number) {
  const dialog = await prisma.dialog.findUnique({ where: { id: dialogId }, include: { user: true } });
  if (!dialog) return show(ctx, 'Диалог не найден.', [[button('⬅️ Входящие', 'inbox:0')]]);
  const [count, inbound, outbound] = await Promise.all([
    prisma.message.count({ where: { dialogId } }),
    prisma.message.count({ where: { dialogId, direction: 'INBOUND' } }),
    prisma.message.count({ where: { dialogId, direction: 'OUTBOUND' } }),
  ]);
  const user = dialog.user;
  const text = [
    `👤 <b>${escapeHtml(nameOf(user))}</b>`,
    `Telegram ID: <code>${user.telegramId.toString()}</code>`,
    `Username: ${user.username ? `@${escapeHtml(user.username)}` : 'не задан'}`,
    `Имя: ${escapeHtml(user.firstName)}${user.lastName ? ` ${escapeHtml(user.lastName)}` : ''}`,
    `Сообщений: ${count} · входящих ${inbound} · ответов ${outbound}`,
    `Статус: ${dialog.status === 'OPEN' ? 'открыт' : 'закрыт'}`,
  ].join('\n');
  await show(ctx, text, [
    [button('📂 История', `history:${dialog.id}:0`), button('💬 Ответить', `reply:${dialog.id}`)],
    [button(dialog.status === 'OPEN' ? '✅ Закрыть диалог' : '↩️ Открыть диалог', `close:${dialog.id}`)],
    [button('⬅️ Входящие', 'inbox:0'), button('🏠 Меню', 'admin')],
  ]);
}

async function showHistory(ctx: Ctx, dialogId: number, page = 0) {
  const dialog = await prisma.dialog.findUnique({ where: { id: dialogId }, include: { user: true } });
  if (!dialog) return show(ctx, 'Диалог не найден.', [[button('⬅️ Входящие', 'inbox:0')]]);
  const total = await prisma.message.count({ where: { dialogId } });
  const pages = pageCount(total, PAGE_SIZE);
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const messages = await prisma.message.findMany({
    where: { dialogId }, orderBy: { createdAt: 'desc' }, skip: safePage * PAGE_SIZE, take: PAGE_SIZE,
  });
  await prisma.message.updateMany({ where: { dialogId, direction: 'INBOUND', isRead: false }, data: { isRead: true } });
  const lines = messages.map((item) => {
    const direction = item.direction === 'INBOUND' ? '👤' : '➡️';
    const date = DateTime.fromJSDate(item.createdAt, { zone: 'utc' }).toFormat('dd.LL HH:mm');
    const content = escapeHtml(preview(item.text, item.kind));
    return `${direction} <code>${date}</code> ${content}`;
  });
  const rows: Button[][] = [];
  const pager: Button[] = [];
  if (safePage > 0) pager.push(button('⬅️ Старее', `history:${dialogId}:${safePage - 1}`));
  pager.push(button(`${safePage + 1}/${pages}`, 'noop'));
  if (safePage + 1 < pages) pager.push(button('Новее ➡️', `history:${dialogId}:${safePage + 1}`));
  rows.push(pager, [button('💬 Ответить', `reply:${dialogId}`), button('👤 Профиль', `profile:${dialogId}`)]);
  rows.push([button('⬅️ К диалогу', `dialog:${dialogId}`), button('📩 Входящие', 'inbox:0')]);
  await show(ctx, `📂 <b>История с ${escapeHtml(nameOf(dialog.user))}</b>\nСообщений: ${total}\n\n${lines.join('\n') || 'Пока нет сообщений.'}`, rows);
}

async function showStats(ctx: Ctx) {
  const [users, messages, replies, activeDialogs, unread, activeTasks, completedTasks] = await Promise.all([
    prisma.user.count(), prisma.message.count(), prisma.message.count({ where: { direction: 'OUTBOUND' } }),
    prisma.dialog.count({ where: { status: 'OPEN' } }), prisma.message.count({ where: { direction: 'INBOUND', isRead: false } }),
    prisma.task.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] } } }), prisma.task.count({ where: { status: 'COMPLETED' } }),
  ]);
  await show(ctx, `📊 <b>Статистика</b>\n\n👥 Пользователей: <b>${users}</b>\n✉️ Сообщений: <b>${messages}</b>\n↩️ Ответов владельца: <b>${replies}</b>\n🟢 Активных диалогов: <b>${activeDialogs}</b>\n🔔 Непрочитанных: <b>${unread}</b>\n\n✅ Активных задач: <b>${activeTasks}</b>\n🏁 Выполнено задач: <b>${completedTasks}</b>`, [[button('🏠 Панель владельца', 'admin')]]);
}

async function showTasks(ctx: Ctx, filter = 'active', page = 0) {
  const where: Prisma.TaskWhereInput = filter === 'all'
    ? {}
    : filter === 'completed'
    ? { status: 'COMPLETED' }
    : filter === 'overdue'
      ? { status: { in: ['NEW', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } }
      : { status: { in: ['NEW', 'IN_PROGRESS'] } };
  const total = await prisma.task.count({ where });
  const pages = pageCount(total, PAGE_SIZE);
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const tasks = await prisma.task.findMany({ where, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'asc' }, { createdAt: 'desc' }], skip: safePage * PAGE_SIZE, take: PAGE_SIZE });
  const settings = await ownerSettings();
  const rows: Button[][] = tasks.map((task) => [button(`${task.status === 'IN_PROGRESS' ? '🔄' : '⬜'} ${task.title.slice(0, 52)}`, `task:${task.id}`)]);
  const pager: Button[] = [];
  if (safePage > 0) pager.push(button('⬅️', `tasks:${filter}:${safePage - 1}`));
  pager.push(button(`${safePage + 1}/${pages}`, 'noop'));
  if (safePage + 1 < pages) pager.push(button('➡️', `tasks:${filter}:${safePage + 1}`));
  rows.push(pager);
  rows.push([button('📋 Активные', 'tasks:active:0'), button('🏁 Выполненные', 'tasks:completed:0')]);
  rows.push([button('⏰ Просроченные', 'tasks:overdue:0'), button('📚 Все', 'tasks:all:0')]);
  rows.push([button('➕ Новая задача', 'task:add'), button('🏠 Панель', 'admin')]);
  const counts = await Promise.all([
    prisma.task.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] } } }),
    prisma.task.count({ where: { status: 'COMPLETED' } }),
    prisma.task.findFirst({ where: { status: { in: ['NEW', 'IN_PROGRESS'] }, dueAt: { not: null } }, orderBy: { dueAt: 'asc' } }),
  ]);
  const closest = counts[2] ? `\nБлижайшая: ${escapeHtml(counts[2].title)} · ${formatDate(counts[2].dueAt, settings.timezone)}` : '';
  const filterLabel = filter === 'all' ? 'все' : filter === 'completed' ? 'выполненные' : filter === 'overdue' ? 'просроченные' : 'активные';
  await show(ctx, `✅ <b>Трекер задач</b>\nАктивных: ${counts[0]} · выполнено: ${counts[1]}${closest}\nСписок: <b>${filterLabel}</b>`, rows);
}

async function showTask(ctx: Ctx, taskId: number) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return show(ctx, 'Задача не найдена.', [[button('⬅️ К задачам', 'tasks:active:0')]]);
  const settings = await ownerSettings();
  await show(ctx, `🗒 <b>${escapeHtml(task.title)}</b>\n\n${task.description ? escapeHtml(task.description) : 'Описание не задано.'}\n\nПриоритет: ${taskPriorityLabel(task.priority)}\nСтатус: ${taskStatusLabel(task.status)}\nСрок: ${formatDate(task.dueAt, settings.timezone)}`, [
    [button(task.status === 'COMPLETED' || task.status === 'CANCELLED' ? '↩️ Вернуть в работу' : '✅ Выполнено', `taskstatus:${task.id}:${task.status === 'COMPLETED' || task.status === 'CANCELLED' ? 'NEW' : 'COMPLETED'}`), button(task.status === 'IN_PROGRESS' ? '⏸ Новая' : '🔄 В процессе', `taskstatus:${task.id}:${task.status === 'IN_PROGRESS' ? 'NEW' : 'IN_PROGRESS'}`)],
    [button('🚫 Отменить задачу', `taskstatus:${task.id}:CANCELLED`)],
    [button('✏️ Изменить', `taskedit:${task.id}`), button(`Приоритет: ${taskPriorityLabel(task.priority)}`, `taskpriority:${task.id}`)],
    [button('🗑 Удалить', `taskdelete:${task.id}`)],
    [button('⬅️ К задачам', 'tasks:active:0'), button('🏠 Меню', 'admin')],
  ]);
}

async function promptCreateTask(ctx: Ctx) {
  await setFlow('TASK_CREATE_TITLE');
  await show(ctx, '➕ <b>Новая задача</b>\n\nОтправьте краткое название (3–120 символов).', [[button('❌ Отмена', 'flow:cancel')]]);
}

async function startSearch(ctx: Ctx) {
  await setFlow('SEARCH');
  await show(ctx, '🔎 Введите имя, username или Telegram ID для поиска.', [[button('❌ Отмена', 'flow:cancel')]]);
}

async function showSearchResults(ctx: Ctx, query: string) {
  const numericId = /^\d+$/.test(query) ? BigInt(query) : undefined;
  const normalized = query.replace(/^@/, '');
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: normalized, mode: 'insensitive' } },
        { firstName: { contains: normalized, mode: 'insensitive' } },
        { lastName: { contains: normalized, mode: 'insensitive' } },
        ...(numericId ? [{ telegramId: numericId }] : []),
      ],
    }, include: { dialogs: true }, orderBy: { updatedAt: 'desc' }, take: 15,
  });
  await clearFlow();
  const rows: Button[][] = users.flatMap((user) => user.dialogs.length
    ? [[button(`👤 ${nameOf(user)}${user.username ? ` · @${user.username}` : ''}`, `dialog:${user.dialogs[0]!.id}`)]]
    : []);
  rows.push([button('🔎 Искать ещё', 'search:start'), button('⬅️ Входящие', 'inbox:0')]);
  await show(ctx, users.length ? `Результаты поиска «${escapeHtml(query)}»: ${users.length}` : `По запросу «${escapeHtml(query)}» никого не нашёл.`, rows);
}

async function askForTaskEdit(ctx: Ctx, taskId: number, field: 'title' | 'description' | 'dueAt') {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return show(ctx, 'Задача не найдена.');
  await setFlow(`TASK_EDIT_${field.toUpperCase()}`, { taskId });
  const prompts = {
    title: 'Введите новое название (3–120 символов).',
    description: 'Введите новое описание или отправьте «-», чтобы очистить его.',
    dueAt: 'Введите срок как <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> по часовому поясу настроек или «-», чтобы убрать срок.',
  };
  await show(ctx, `✏️ <b>${escapeHtml(task.title)}</b>\n${prompts[field]}`, [[button('❌ Отмена', 'flow:cancel')]]);
}

async function handleOwnerFlowText(ctx: Ctx, text: string) {
  const flow = await currentFlow();
  if (!flow) return false;
  const data = flowData(flow.data);
  const value = text.trim();
  switch (flow.kind) {
    case 'SEARCH': await showSearchResults(ctx, value); return true;
    case 'TIMEZONE': {
      if (!isValidTimezone(value)) {
        await show(ctx, 'Не удалось распознать часовой пояс. Пример: <code>Asia/Almaty</code>.', [[button('❌ Отмена', 'flow:cancel')]]);
        return true;
      }
      await prisma.ownerSettings.update({ where: { id: OWNER_KEY }, data: { timezone: value } });
      await clearFlow();
      await show(ctx, `✅ Часовой пояс сохранён: <code>${escapeHtml(value)}</code>.`, [[button('⚙️ Настройки', 'settings')]]);
      return true;
    }
    case 'TASK_CREATE_TITLE': {
      if (value.length < 3 || value.length > 120) {
        await show(ctx, 'Название должно содержать от 3 до 120 символов. Попробуйте ещё раз.', [[button('❌ Отмена', 'flow:cancel')]]);
        return true;
      }
      await setFlow('TASK_CREATE_DESCRIPTION', { title: value });
      await show(ctx, `Название: <b>${escapeHtml(value)}</b>\n\nОтправьте описание или пропустите этот шаг.`, [[button('⏭ Пропустить', 'flow:skip-description'), button('❌ Отмена', 'flow:cancel')]]);
      return true;
    }
    case 'TASK_CREATE_DESCRIPTION': {
      if (value.length > 1000) {
        await show(ctx, 'Описание должно быть короче 1000 символов. Попробуйте ещё раз.', [[button('⏭ Пропустить', 'flow:skip-description'), button('❌ Отмена', 'flow:cancel')]]);
        return true;
      }
      await setFlow('TASK_CREATE_PRIORITY', { ...data, description: value });
      await show(ctx, 'Выберите приоритет задачи:', [[button('🔴 Высокий', 'flow:priority:HIGH'), button('🟡 Средний', 'flow:priority:MEDIUM'), button('🟢 Низкий', 'flow:priority:LOW')], [button('❌ Отмена', 'flow:cancel')]]);
      return true;
    }
    case 'TASK_CREATE_DUE': {
      const settings = await ownerSettings();
      const dueAt = value === '-' ? null : parseLocalDateTime(value, settings.timezone);
      if (value !== '-' && !dueAt) {
        await show(ctx, 'Дата не распознана. Используйте формат <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> или нажмите «Без срока».', [[button('⏭ Без срока', 'flow:skip-due'), button('❌ Отмена', 'flow:cancel')]]);
        return true;
      }
      const finalData = flowData(flow.data);
      const created = await prisma.task.create({ data: {
        title: String(finalData.title), description: typeof finalData.description === 'string' ? finalData.description || null : null,
        priority: finalData.priority as TaskPriority, status: 'NEW', dueAt, reminderAt: reminderAt(dueAt),
      } });
      await clearFlow();
      await show(ctx, `✅ Задача «${escapeHtml(created.title)}» создана.`, [[button('🗒 Открыть задачу', `task:${created.id}`), button('📋 К задачам', 'tasks:active:0')]]);
      return true;
    }
    case 'TASK_EDIT_TITLE':
    case 'TASK_EDIT_DESCRIPTION':
    case 'TASK_EDIT_DUEAT': {
      const taskId = Number(data.taskId);
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) { await clearFlow(); await show(ctx, 'Задача не найдена.'); return true; }
      if (flow.kind === 'TASK_EDIT_TITLE') {
        if (value.length < 3 || value.length > 120) { await show(ctx, 'Название должно содержать от 3 до 120 символов.', [[button('❌ Отмена', 'flow:cancel')]]); return true; }
        await prisma.task.update({ where: { id: taskId }, data: { title: value } });
      } else if (flow.kind === 'TASK_EDIT_DESCRIPTION') {
        if (value.length > 1000) { await show(ctx, 'Описание должно быть короче 1000 символов.', [[button('❌ Отмена', 'flow:cancel')]]); return true; }
        await prisma.task.update({ where: { id: taskId }, data: { description: value === '-' ? null : value } });
      } else {
        const settings = await ownerSettings();
        const dueAt = value === '-' ? null : parseLocalDateTime(value, settings.timezone);
        if (value !== '-' && !dueAt) { await show(ctx, 'Используйте <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> или «-» для удаления срока.', [[button('❌ Отмена', 'flow:cancel')]]); return true; }
        await prisma.task.update({ where: { id: taskId }, data: { dueAt, reminderAt: reminderAt(dueAt), reminderSentAt: null } });
      }
      await clearFlow();
      await showTask(ctx, taskId);
      return true;
    }
    default:
      await clearFlow();
      return false;
  }
}

async function showSettings(ctx: Ctx) {
  const settings = await ownerSettings();
  await show(ctx, `⚙️ <b>Настройки</b>\nЧасовой пояс: <code>${escapeHtml(settings.timezone)}</code>\n\nВремя задач вводится в формате <code>ГГГГ-ММ-ДД ЧЧ:ММ</code>. Напоминания приходят за 15 минут до срока.`, [
    [button('🇰🇿 Asia/Almaty', 'timezone:Asia/Almaty'), button('🌍 UTC', 'timezone:UTC')],
    [button('🇷🇺 Europe/Moscow', 'timezone:Europe/Moscow'), button('✍️ Другой пояс', 'timezone:custom')],
    [button('⬅️ Панель владельца', 'admin')],
  ]);
}

async function showActive(ctx: Ctx) {
  const active = await prisma.replySession.findUnique({ where: { ownerId: OWNER_KEY }, include: { dialog: { include: { user: true } } } });
  if (!active) return show(ctx, 'Сейчас режим ответа выключен.', [[button('📩 Входящие', 'inbox:0'), button('🏠 Панель', 'admin')]]);
  await show(ctx, `💬 Сейчас вы отвечаете: <b>${escapeHtml(nameOf(active.dialog.user))}</b>\nTelegram ID: <code>${active.dialog.user.telegramId.toString()}</code>\n\nРежим останется включённым, пока вы не переключитесь или не остановите его.`, [[button('❌ Отменить ответ', 'reply:stop'), button('📂 История', `history:${active.dialogId}:0`)]]);
}

async function beginReply(ctx: Ctx, dialogId: number) {
  const dialog = await prisma.dialog.findUnique({ where: { id: dialogId }, include: { user: true } });
  if (!dialog) return show(ctx, 'Диалог не найден.');
  await prisma.dialog.update({ where: { id: dialogId }, data: { status: 'OPEN' } });
  await prisma.replySession.upsert({ where: { ownerId: OWNER_KEY }, create: { ownerId: OWNER_KEY, dialogId }, update: { dialogId, startedAt: new Date() } });
  await show(ctx, `💬 <b>Режим ответа включён</b>\nПолучатель: ${escapeHtml(nameOf(dialog.user))}${dialog.user.username ? ` (@${escapeHtml(dialog.user.username)})` : ''}\nTelegram ID: <code>${dialog.user.telegramId.toString()}</code>\n\nОтправляйте текст и вложения сюда подряд — они будут передаваться этому собеседнику. Чтобы переключиться, нажмите «Ответить» у другого диалога.`, [[button('❌ Отменить ответ', 'reply:stop'), button('📂 История', `history:${dialogId}:0`)], [button('📩 Входящие', 'inbox:0')]]);
}

async function closeDialog(ctx: Ctx, dialogId: number) {
  const dialog = await prisma.dialog.findUnique({ where: { id: dialogId }, include: { user: true } });
  if (!dialog) return show(ctx, 'Диалог не найден.');
  const nextStatus: DialogStatus = dialog.status === 'OPEN' ? 'CLOSED' : 'OPEN';
  await prisma.dialog.update({ where: { id: dialogId }, data: { status: nextStatus } });
  if (nextStatus === 'CLOSED') await prisma.replySession.deleteMany({ where: { ownerId: OWNER_KEY, dialogId } });
  await show(ctx, nextStatus === 'CLOSED'
    ? `✅ Диалог с ${escapeHtml(nameOf(dialog.user))} закрыт. Новое сообщение снова откроет его.`
    : `↩️ Диалог с ${escapeHtml(nameOf(dialog.user))} открыт.`, [[button('📂 История', `history:${dialogId}:0`), button('📩 Входящие', 'inbox:0')]]);
}

async function handleCallback(ctx: Ctx, data: string) {
  if (data === 'noop') return;
  if (!(await ownerGuard(ctx))) return;
  const parts = data.split(':');
  const action = parts[0];
  if (action === 'admin') return mainMenu(ctx);
  if (action === 'inbox') return showInbox(ctx, Number(parts[1] ?? 0));
  if (action === 'people') return showPeople(ctx, Number(parts[1] ?? 0));
  if (action === 'stats') return showStats(ctx);
  if (action === 'dialog') return showProfile(ctx, Number(parts[1]));
  if (action === 'profile') return showProfile(ctx, Number(parts[1]));
  if (action === 'history') return showHistory(ctx, Number(parts[1]), Number(parts[2] ?? 0));
  if (action === 'reply') {
    if (parts[1] === 'stop') {
      await prisma.replySession.deleteMany({ where: { ownerId: OWNER_KEY } });
      return show(ctx, '❌ Режим ответа выключен. Обычные сообщения больше не пересылаются.', [[button('📩 Входящие', 'inbox:0'), button('🏠 Панель', 'admin')]]);
    }
    return beginReply(ctx, Number(parts[1]));
  }
  if (action === 'close') {
    const dialog = await prisma.dialog.findUnique({ where: { id: Number(parts[1]) } });
    if (!dialog) return show(ctx, 'Диалог не найден.');
    if (dialog.status === 'CLOSED') return closeDialog(ctx, dialog.id);
    return show(ctx, 'Закрыть этот диалог? Новое сообщение от пользователя снова откроет его.', [[button('✅ Да, закрыть', `closeconfirm:${dialog.id}`), button('⬅️ Назад', `dialog:${dialog.id}`)]]);
  }
  if (action === 'closeconfirm') return closeDialog(ctx, Number(parts[1]));
  if (action === 'search' && parts[1] === 'start') return startSearch(ctx);
  if (action === 'tasks') return showTasks(ctx, parts[1] ?? 'active', Number(parts[2] ?? 0));
  if (action === 'task' && parts[1] === 'add') return promptCreateTask(ctx);
  if (action === 'task' && parts[1]) return showTask(ctx, Number(parts[1]));
  if (action === 'taskstatus') {
    const taskId = Number(parts[1]);
    const status = parts[2] as TaskStatus;
    if (!['NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) return;
    await prisma.task.update({ where: { id: taskId }, data: { status } });
    return showTask(ctx, taskId);
  }
  if (action === 'taskpriority') {
    const taskId = Number(parts[1]);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return show(ctx, 'Задача не найдена.');
    const next: Record<TaskPriority, TaskPriority> = { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'HIGH' };
    await prisma.task.update({ where: { id: taskId }, data: { priority: next[task.priority] } });
    return showTask(ctx, taskId);
  }
  if (action === 'taskedit') {
    const taskId = Number(parts[1]);
    return show(ctx, 'Что изменить?', [[button('Название', `taskfield:${taskId}:title`), button('Описание', `taskfield:${taskId}:description`)], [button('Срок', `taskfield:${taskId}:dueAt`), button('Приоритет', `taskpriority:${taskId}`)], [button('⬅️ К задаче', `task:${taskId}`)]]);
  }
  if (action === 'taskfield') {
    const field = parts[2];
    if (field === 'title' || field === 'description' || field === 'dueAt') return askForTaskEdit(ctx, Number(parts[1]), field);
  }
  if (action === 'taskdelete') {
    const taskId = Number(parts[1]);
    return show(ctx, 'Удалить эту задачу? Действие нельзя отменить.', [[button('🗑 Да, удалить', `taskremove:${taskId}`), button('⬅️ Назад', `task:${taskId}`)]]);
  }
  if (action === 'taskremove') {
    const taskId = Number(parts[1]);
    await prisma.task.deleteMany({ where: { id: taskId } });
    return show(ctx, '🗑 Задача удалена.', [[button('📋 К задачам', 'tasks:active:0')]]);
  }
  if (action === 'settings') return showSettings(ctx);
  if (action === 'timezone') {
    const timezone = parts.slice(1).join(':');
    if (timezone === 'custom') {
      await setFlow('TIMEZONE');
      return show(ctx, '✍️ Отправьте название часового пояса IANA, например <code>Asia/Almaty</code>.', [[button('❌ Отмена', 'flow:cancel')]]);
    }
    if (!isValidTimezone(timezone)) return show(ctx, 'Часовой пояс не распознан.', [[button('⬅️ Настройки', 'settings')]]);
    await prisma.ownerSettings.update({ where: { id: OWNER_KEY }, data: { timezone } });
    return showSettings(ctx);
  }
  if (action === 'active') return showActive(ctx);
  if (action === 'flow') {
    if (parts[1] === 'cancel') {
      await clearFlow();
      return show(ctx, 'Действие отменено.', [[button('🏠 Панель владельца', 'admin')]]);
    }
    const flow = await currentFlow();
    if (!flow) return show(ctx, 'Нет незавершённого действия.', [[button('🏠 Панель', 'admin')]]);
    if (parts[1] === 'skip-description' && flow.kind === 'TASK_CREATE_DESCRIPTION') {
      await setFlow('TASK_CREATE_PRIORITY', { ...flowData(flow.data), description: '' });
      return show(ctx, 'Выберите приоритет задачи:', [[button('🔴 Высокий', 'flow:priority:HIGH'), button('🟡 Средний', 'flow:priority:MEDIUM'), button('🟢 Низкий', 'flow:priority:LOW')], [button('❌ Отмена', 'flow:cancel')]]);
    }
    if (parts[1] === 'skip-due' && flow.kind === 'TASK_CREATE_DUE') {
      const data = flowData(flow.data);
      const task = await prisma.task.create({ data: { title: String(data.title), description: typeof data.description === 'string' ? data.description || null : null, priority: data.priority as TaskPriority, status: 'NEW' } });
      await clearFlow();
      return show(ctx, `✅ Задача «${escapeHtml(task.title)}» создана без срока.`, [[button('🗒 Открыть задачу', `task:${task.id}`), button('📋 К задачам', 'tasks:active:0')]]);
    }
    if (parts[1] === 'priority') {
      const priority = parts[2] as TaskPriority;
      if (flow.kind !== 'TASK_CREATE_PRIORITY' || !['HIGH', 'MEDIUM', 'LOW'].includes(priority)) return;
      await setFlow('TASK_CREATE_DUE', { ...flowData(flow.data), priority });
      return show(ctx, '📅 Добавьте срок или пропустите этот шаг.\nФормат: <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> по настроенному часовому поясу.', [[button('⏭ Без срока', 'flow:skip-due'), button('❌ Отмена', 'flow:cancel')]]);
    }
  }
  await show(ctx, 'Кнопка устарела или не поддерживается.', [[button('🏠 Панель владельца', 'admin')]]);
}

async function receiveUserMessage(bot: Telegraf<Ctx>, ctx: Ctx) {
  const message = ctx.message;
  const sender = ctx.from;
  if (!message || !sender || !ctx.chat || ctx.chat.type !== 'private') return;
  if (sender.is_bot) return;
  if (isOwner(sender.id, config.ownerTelegramId)) return;

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(sender.id) },
    create: { telegramId: BigInt(sender.id), username: sender.username ?? null, firstName: sender.first_name, lastName: sender.last_name ?? null },
    update: { username: sender.username ?? null, firstName: sender.first_name, lastName: sender.last_name ?? null },
  });
  const now = new Date();
  const dialog = await prisma.dialog.upsert({
    where: { userId: user.id }, create: { userId: user.id, status: 'OPEN', lastMessageAt: now },
    update: { status: 'OPEN', lastMessageAt: now },
  });
  const kind = messageKind(message);
  const record = await prisma.message.create({ data: {
    dialogId: dialog.id, direction: 'INBOUND', kind, text: messageText(message),
    telegramMessageId: message.message_id, sourceChatId: BigInt(ctx.chat.id), isRead: false,
  } });
  const unread = await prisma.message.count({ where: { dialogId: dialog.id, direction: 'INBOUND', isRead: false } });
  const header = `📩 <b>Новое сообщение</b>\n\nОт: <b>${escapeHtml(nameOf(user))}</b>${user.username ? ` (@${escapeHtml(user.username)})` : ''}\nTelegram ID: <code>${user.telegramId.toString()}</code>\nВ диалоге: ${unread} непрочитанных\nID сообщения: <code>${record.id}</code>`;
  await bot.telegram.sendMessage(config.ownerTelegramId.toString(), header, {
    parse_mode: 'HTML',
    ...keyboard([
      [button('💬 Ответить', `reply:${dialog.id}`), button('📂 История', `history:${dialog.id}:0`)],
      [button('✅ Закрыть диалог', `close:${dialog.id}`)],
    ]),
  });
  try {
    await bot.telegram.copyMessage(config.ownerTelegramId.toString(), ctx.chat.id, message.message_id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await bot.telegram.sendMessage(config.ownerTelegramId.toString(), `⚠️ Сообщение сохранено, но Telegram не разрешил скопировать его вложение. (${escapeHtml(reason.slice(0, 180))})`, { parse_mode: 'HTML' });
  }
  await ctx.reply(`✅ Сообщение доставлено владельцу.\n\nℹ️ Владелец видит Telegram ID и доступные данные вашего профиля. Ваше имя скрыто от других пользователей бота.`);
}

async function forwardOwnerMessage(bot: Telegraf<Ctx>, ctx: Ctx) {
  const message = ctx.message;
  if (!message || !ctx.from || !ctx.chat || ctx.chat.type !== 'private') return;
  if (isCommandMessage(message)) {
    await ctx.reply('Неизвестная команда. Используйте /help для списка доступных команд.');
    return;
  }
  if (!isOwner(ctx.from.id, config.ownerTelegramId)) return receiveUserMessage(bot, ctx);

  const flow = await currentFlow();
  if (flow) {
    if ('text' in message && typeof message.text === 'string') await handleOwnerFlowText(ctx, message.text);
    else await ctx.reply('Текущее действие ожидает текстовый ответ. Завершите его или отмените через /cancel.');
    return;
  }
  const session = await prisma.replySession.findUnique({ where: { ownerId: OWNER_KEY }, include: { dialog: { include: { user: true } } } });
  if (!shouldRouteToReplySession(false, !!session, !!flow)) {
    await ctx.reply('Сообщение не переслано. Выберите диалог и нажмите «💬 Ответить», либо откройте /admin.');
    return;
  }
  if (!session) return;
  try {
    await bot.telegram.copyMessage(session.dialog.user.telegramId.toString(), ctx.chat.id, message.message_id);
    const kind = messageKind(message);
    await prisma.message.create({ data: {
      dialogId: session.dialogId, direction: 'OUTBOUND', kind, text: messageText(message),
      telegramMessageId: message.message_id, sourceChatId: BigInt(ctx.chat.id), isRead: true,
    } });
    await prisma.dialog.update({ where: { id: session.dialogId }, data: { lastMessageAt: new Date(), status: 'OPEN' } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.reply(`Не удалось доставить сообщение ${escapeHtml(nameOf(session.dialog.user))}. Возможно, пользователь заблокировал бота. Режим ответа остаётся включённым.`, { parse_mode: 'HTML' });
    console.error('Message delivery failed:', reason);
  }
}

async function startReminders(bot: Telegraf<Ctx>) {
  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const tasks = await prisma.task.findMany({
        where: { reminderAt: { lte: now }, reminderSentAt: null, status: { in: ['NEW', 'IN_PROGRESS'] } },
        orderBy: { reminderAt: 'asc' }, take: 25,
      });
      if (!tasks.length) return;
      const settings = await ownerSettings();
      for (const task of tasks) {
        try {
          await bot.telegram.sendMessage(config.ownerTelegramId.toString(), `⏰ <b>Напоминание о задаче</b>\n\n${escapeHtml(task.title)}\nСрок: ${formatDate(task.dueAt, settings.timezone)}\nПриоритет: ${taskPriorityLabel(task.priority)}`, {
            parse_mode: 'HTML', ...keyboard([[button('✅ Выполнено', `taskstatus:${task.id}:COMPLETED`), button('🗒 Открыть', `task:${task.id}`)]]),
          });
          await prisma.task.updateMany({ where: { id: task.id, reminderSentAt: null }, data: { reminderSentAt: now } });
        } catch (error) {
          console.error(`Reminder delivery failed for task ${task.id}:`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.error('Reminder scan failed:', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  }, { timezone: 'UTC' });
}

export async function startBot() {
  await ownerSettings();
  const bot = new Telegraf<Ctx>(config.botToken);

  bot.start(async (ctx) => {
    if (isOwner(ctx.from?.id, config.ownerTelegramId)) return mainMenu(ctx);
    await ctx.reply('👋 Добро пожаловать! Напишите сообщение или отправьте фото, видео, документ, голосовое сообщение или другое вложение.\n\nℹ️ Сообщение передаётся владельцу бота. Он видит ваш Telegram ID, username и доступное имя профиля. Другим пользователям ваша личность не раскрывается.', { ...keyboard([[button('❓ Как это работает', 'userhelp')]]) });
  });
  bot.help(async (ctx) => {
    if (isOwner(ctx.from?.id, config.ownerTelegramId)) {
      await ctx.reply('Команды владельца: /admin — панель, /inbox — диалоги, /stats — статистика, /tasks — задачи, /task_add — новая задача, /settings — настройки, /active — текущий получатель, /stop — отменить ответ.');
    } else {
      await ctx.reply('Чтобы написать владельцу, отправьте сообщение или вложение. Для отмены текущего действия используйте /cancel. Владелец видит переданные Telegram данные вашего профиля.');
    }
  });
  bot.command('cancel', async (ctx) => {
    if (isOwner(ctx.from?.id, config.ownerTelegramId)) {
      const flow = await currentFlow();
      if (flow) {
        await clearFlow();
        await ctx.reply('Текущее действие отменено. Режим ответа не изменён.', { ...keyboard([[button('🏠 Панель владельца', 'admin')]]) });
      } else {
        await ctx.reply('Нет действия для отмены. Чтобы выключить режим ответа, используйте /stop.');
      }
    } else await ctx.reply('Текущих действий нет. Чтобы написать владельцу, отправьте сообщение.');
  });
  bot.command('admin', async (ctx) => { if (await ownerGuard(ctx)) await mainMenu(ctx); });
  bot.command('inbox', async (ctx) => { if (await ownerGuard(ctx)) await showInbox(ctx); });
  bot.command('stats', async (ctx) => { if (await ownerGuard(ctx)) await showStats(ctx); });
  bot.command('tasks', async (ctx) => { if (await ownerGuard(ctx)) await showTasks(ctx); });
  bot.command('task_add', async (ctx) => { if (await ownerGuard(ctx)) await promptCreateTask(ctx); });
  bot.command('settings', async (ctx) => { if (await ownerGuard(ctx)) await showSettings(ctx); });
  bot.command('active', async (ctx) => { if (await ownerGuard(ctx)) await showActive(ctx); });
  bot.command('stop', async (ctx) => {
    if (!(await ownerGuard(ctx))) return;
    await prisma.replySession.deleteMany({ where: { ownerId: OWNER_KEY } });
    await ctx.reply('❌ Режим ответа выключен. Обычные сообщения владельца не пересылаются.', { ...keyboard([[button('📩 Входящие', 'inbox:0'), button('🏠 Панель', 'admin')]]) });
  });

  bot.action(/.+/, async (ctx) => {
    const query = ctx.callbackQuery;
    if (!('data' in query)) return ctx.answerCbQuery();
    try {
      if (query.data === 'userhelp') {
        await ctx.answerCbQuery();
        return ctx.editMessageText('Отправьте текст или вложение — владелец получит его вместе с доступными данными вашего Telegram профиля. Другим пользователям эти данные не показываются.', { ...keyboard([[button('⬅️ Назад', 'userstart')]]) });
      }
      if (query.data === 'userstart') {
        await ctx.answerCbQuery();
        return ctx.editMessageText('Напишите владельцу сообщение. Владелец видит ваш Telegram ID и доступные данные профиля.', { ...keyboard([[button('❓ Как это работает', 'userhelp')]]) });
      }
      await handleCallback(ctx, query.data);
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Callback failed:', error instanceof Error ? error.message : error);
      try { await ctx.answerCbQuery('Не удалось выполнить действие. Попробуйте ещё раз.', { show_alert: true }); } catch { /* callback may have expired */ }
    }
  });

  bot.on('message', async (ctx) => {
    try {
      await forwardOwnerMessage(bot, ctx);
    } catch (error) {
      console.error('Message handler failed:', error instanceof Error ? error.message : error);
      if (ctx.from?.id === Number(config.ownerTelegramId)) {
        await ctx.reply('Не удалось обработать сообщение. Данные диалога сохранены, если база уже приняла запись.');
      } else {
        await ctx.reply('Не удалось доставить сообщение сейчас. Пожалуйста, попробуйте ещё раз позже.');
      }
    }
  });

  bot.catch((error, ctx) => {
    console.error(`Telegram update ${ctx.update.update_id} failed:`, error instanceof Error ? error.message : String(error));
  });

  try {
    await bot.telegram.setMyCommands(USER_COMMANDS, { scope: { type: 'default' } });
    await bot.telegram.setMyCommands(OWNER_COMMANDS, { scope: { type: 'chat', chat_id: config.ownerTelegramId.toString() } });
  } catch (error) {
    console.error('Could not configure Telegram command menus:', error instanceof Error ? error.message : error);
  }

  await startReminders(bot);
  await bot.launch({ dropPendingUpdates: false });
  console.log('Telegram bot is running.');

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; stopping bot.`);
    bot.stop(signal);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  return bot;
}
