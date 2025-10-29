function initializeBot(db, cfApi, parentDomain, telegramGroupChatId, botToken) {
    console.log("Bot initialized with minimal code.");
    return {
        sendApplicationNotification: () => {},
        sendAbuseReportNotification: () => {},
        editTelegramMessage: () => {}
    };
}

module.exports = initializeBot;