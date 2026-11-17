# Деплой на Firebase Hosting + вход через Telegram

## 1. Бот
1. В Telegram откройте @BotFather → `/newbot` → получите **токен** и **username бота**.
2. `/setdomain` → выберите бота → введите `propuski-791e4.web.app` (или свой домен).
3. В `public/index.html` найдите `const TG_BOT="";` и впишите username бота без `@`.

## 2. Файлы сайта
Положите в папку `public/` остальные файлы приложения рядом с `index.html`:
`manifest.webmanifest`, `sw.js`, `icon-192.png`, `apple-touch-icon.png` (и другие иконки).

## 3. Деплой
```
npm i -g firebase-tools
firebase login
cd firebase-site
(cd functions && npm install)
firebase functions:secrets:set BOT_TOKEN     # вставьте токен бота
firebase deploy
```
Функции Firebase требуют тарифа **Blaze** (нужна карта; для такой нагрузки платить не придётся,
входит бесплатная квота). Сам Hosting работает и на бесплатном Spark.

## 4. Как привязать студентов
Староста: Настройки → «Инструменты и Игры» → «Telegram-юзы группы» → вписать @юзернейм.
При первом входе через Telegram юзернейм сопоставляется со студентом, и дальше
привязка идёт по числовому Telegram ID (хранится в `journal/cfg/tgId`).
Чтобы отвязать студента, удалите его ID из `journal/cfg/tgId` в консоли Firebase.
