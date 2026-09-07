// Wird als ERSTES importiert: ESM wertet Module in Reihenfolge der
// import-Deklarationen aus, deshalb steht die Konfiguration hier schon fest,
// bevor src/config.js sie liest.
process.env.SERVER_HOST = 'dayz.example.net';
process.env.SERVER_PORT = '2302';
process.env.SERVER_NAME = '';
process.env.DISCORD_TOKEN = 'selftest';
process.env.CLIENT_ID = '000000000000000000';
process.env.STATUS_CHANNEL_ID = '000000000000000000';
process.env.DB_PATH = './data/selftest.db';
